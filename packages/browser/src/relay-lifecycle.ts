/**
 * relay-lifecycle.ts — Relay Lifecycle Management
 *
 * Extracts relay startup, port discovery, token resolution, security
 * configuration, and activation paths from extension.ts into a focused module.
 *
 * Handles:
 *   - Free port scanning
 *   - Relay token resolution (SecretStorage + globalState migration)
 *   - Relay port persistence for Chrome extension discovery
 *   - Security configuration construction
 *   - Shared relay activation path
 *   - Per-window relay activation path
 *
 * @module
 */

import type * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "node:crypto";
import type { SecurityConfig } from "./security/index.js";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { DEFAULT_REDACTION_PATTERNS } from "./security/index.js";
import { BrowserAuditLog } from "./security/audit-log.js";
import { generateRelayToken } from "./relay-auth.js";
import { BrowserRelayServer } from "./relay-server.js";
import { SharedBrowserRelayServer } from "./shared-relay-server.js";
import { SharedRelayClient } from "./shared-relay-client.js";
import { SnapshotRetentionStore } from "./snapshot-retention.js";
import { ScreenshotRetentionStore } from "./screenshot-retention.js";
import { buildBrowserTools } from "./tool-assembly.js";
import {
  registerBrowserNotifier,
  browserActionToUnifiedTool,
} from "./comment-notifier.js";
import { handleBrowserCommentAction } from "./browser-comment-relay-handler.js";
import {
  readSharedRelayInfo,
  writeSharedRelayInfo,
  isRelayAlive,
  acquireRelayLock,
  releaseRelayLock,
  removeSharedRelayInfo,
} from "./relay-discovery.js";
import type { SharedRelayInfo } from "./shared-relay-types.js";
import { BrowserCommentSyncScheduler } from "./comment-sync.js";

const EXTENSION_ID = "accordo.accordo-browser";
const RELAY_BASE_PORT = 40111;
const RELAY_HOST = "127.0.0.1";

// ── Port Discovery ───────────────────────────────────────────────────────────

/**
 * Find a free TCP port starting at `startPort`, scanning up to `maxTries`
 * candidates on `host`.
 *
 * @param startPort - First port to try
 * @param host      - Host to bind to (e.g. "127.0.0.1")
 * @param maxTries  - Maximum number of ports to scan (default: 10)
 * @returns The first available port
 * @throws If no free port is found within the range
 */
export function findFreePort(
  startPort: number,
  host: string,
  maxTries = 10,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      if (attempt++ >= maxTries) {
        reject(new Error(`No free port found in range ${startPort}–${startPort + maxTries - 1}`));
        return;
      }
      const server = net.createServer();
      server.once("error", () => {
        server.close();
        tryPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, host);
    };
    tryPort(startPort);
  });
}

// ── Token Resolution ─────────────────────────────────────────────────────────

const TOKEN_KEY = "browserRelayToken";

/**
 * AUTH-03 / AUTH-06: Resolve the relay token with SecretStorage primary storage
 * and globalState migration.
 *
 * Resolution order (AUTH-03):
 *  1. secrets.get(TOKEN_KEY) succeeds → return it.
 *  2. secrets returns undefined AND globalState has a token → migrate to
 *     SecretStorage, clean up globalState, return the token.
 *  3. Both absent → generate a fresh cryptographically random token, store in
 *     SecretStorage, return it.
 *
 * @param context - The VS Code extension context
 * @returns A valid non-empty token string. Never throws. Never returns a
 *          hardcoded value.
 */
export async function resolveRelayToken(
  context: vscode.ExtensionContext,
): Promise<string> {
  // Helper to safely unwrap VS Code thenables and native promises into Promise<T>.
  const toPromise = <T>(v: T | Promise<T> | { then(onfulfilled: (val: T) => void): void }): Promise<T> =>
    Promise.resolve(v as T);

  // Step 1: Try SecretStorage first.
  try {
    const stored = await toPromise(context.secrets.get(TOKEN_KEY));
    if (typeof stored === "string" && stored.trim().length > 0) {
      return stored.trim();
    }
    // Step 2: Fall through to migration / fresh generation.
  } catch (err) {
    // AUTH-03-ERR Step 1: SecretStorage unavailable.
    // Generate ephemeral token — never fall back to globalState.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[accordo-browser] WARN: SecretStorage unavailable — using ephemeral relay token (${msg})`);
    return generateRelayToken();
  }

  // Step 2: SecretStorage absent — check globalState for migration.
  const fromGlobal = context.globalState.get<string>(TOKEN_KEY);
  if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0) {
    // Migration path: move token from globalState to SecretStorage.
    try {
      await toPromise(context.secrets.store(TOKEN_KEY, fromGlobal.trim()));
    } catch (err) {
      // AUTH-03-ERR Step 2a: SecretStorage write failed during migration.
      // Keep using the globalState token — it was already in unencrypted storage.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[accordo-browser] WARN: SecretStorage store failed during migration — using globalState token (${msg})`);
      return fromGlobal.trim();
    }
    // Cleanup globalState after successful migration.
    try {
      await toPromise(context.globalState.update(TOKEN_KEY, undefined));
    } catch (err) {
      // AUTH-03-ERR Step 2b: globalState cleanup failed — harmless, next activation
      // will find token in SecretStorage (step 1).
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[accordo-browser] WARN: globalState cleanup failed after migration (${msg})`);
    }
    return fromGlobal.trim();
  }

  // Step 3: Neither store has a token — generate a fresh one.
  const fresh = generateRelayToken();
  try {
    await toPromise(context.secrets.store(TOKEN_KEY, fresh));
  } catch (err) {
    // AUTH-03-ERR Step 3: Cannot persist fresh token — return ephemeral.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[accordo-browser] WARN: SecretStorage unavailable for fresh token — using ephemeral token (${msg})`);
    return fresh;
  }
  return fresh;
}

// ── Port Persistence ─────────────────────────────────────────────────────────

/**
 * Persist the relay port to `~/.accordo/relay.port` so the Chrome extension
 * (or other consumers) can discover the active relay when the default port
 * is in use.
 *
 * Best-effort — failure must not block activation.
 *
 * @param port - The port number the relay is listening on
 */
export function writeRelayPort(port: number): void {
  try {
    const dir = path.join(os.homedir(), ".accordo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "relay.port"), String(port), "utf8");
  } catch {
    // best-effort — failure must not block activation
  }
}

// ── Security Configuration ───────────────────────────────────────────────────

/**
 * Build security config once — used in both shared and per-window activation
 * paths.
 *
 * @returns A fully constructed SecurityConfig with default policies
 */
export function getSecurityConfig(): SecurityConfig {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({ filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl") }),
    snapshotRetention: { maxAgeMs: 0 },
  };
}

// ── Relay Services Wiring ────────────────────────────────────────────────────

/**
 * Describes the set of services that both shared and per-window relay paths
 * wire together during activation.
 */
export interface RelayServices {
  /** The VS Code extension context for subscription management. */
  readonly context: vscode.ExtensionContext;
  /** Output channel for logging. */
  readonly out: vscode.OutputChannel;
  /** The bridge API for tool registration and state publishing. */
  readonly bridge: BrowserBridgeAPI;
  /** The relay authentication token. */
  readonly token: string;
  /** Whether the accordo-comments extension is available. */
  readonly commentsAvailable: boolean;
}

/**
 * Centralised wiring of all common relay services (tools, notifier, sync
 * scheduler, snapshot store). Returns disposables that the caller should add
 * to `context.subscriptions`.
 *
 * @param opts - The relay services configuration
 * @returns An array of disposables for cleanup
 */
export function wireRelayServices(
  opts: RelayServices,
): vscode.Disposable[] {
  // Centralised wiring — the common service bag is passed to each activation
  // path; activation-specific wiring (tools, scheduler, notifier) is owned
  // by the caller which has full relay context.
  void opts;
  return [];
}

// ── Activation Paths ─────────────────────────────────────────────────────────

/**
 * SBR-F-030..043: Shared relay activation path.
 *
 * Discovery flow:
 * 1. Read ~/.accordo/shared-relay.json — if valid and relay process is alive → Hub path
 * 2. Otherwise → Owner path: start SharedBrowserRelayServer + write shared-relay.json
 * 3. Fall back to per-window BrowserRelayServer if shared relay fails
 */
export async function activateSharedRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  _commentsAvailable: boolean,
  handleBrowserComment?: (
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    relay: SharedRelayClient,
    correlationId?: string,
  ) => Promise<BrowserRelayResponse>,
): Promise<void> {
  let relayStartError: string | null = null;
  let relayPort = RELAY_BASE_PORT;

  // SBR-F-030: read shared-relay.json on activation
  const existingInfo = readSharedRelayInfo();
  if (existingInfo && isRelayAlive(existingInfo)) {
    // SBR-F-031: Hub path — connect to existing shared relay as client
    out.appendLine(`[accordo-browser] shared relay already running on ${RELAY_BASE_PORT} — connecting as Hub`);
    const hubId = randomUUID();
    const client: SharedRelayClient = new SharedRelayClient({
      host: RELAY_HOST,
      port: RELAY_BASE_PORT,
      hubId,
      token: existingInfo.token, // Use token from discovery file, not session token
      label: "accordo-browser-hub",
      onEvent: (event, details) => {
        out.appendLine(`[accordo-browser:hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      },
      onRelayRequest: handleBrowserComment
        ? (action, payload): Promise<BrowserRelayResponse> => {
            out.appendLine(`[onRelayRequest] action=${action} payload=${JSON.stringify(payload)}`);
            return handleBrowserComment(action, payload, client);
          }
        : async (action, payload): Promise<BrowserRelayResponse> => {
            out.appendLine(`[onRelayRequest] action=${action} payload=${JSON.stringify(payload)}`);
            const mapped = browserActionToUnifiedTool(action, payload);
            if (!mapped) {
              return { requestId: "", success: false, error: "action-failed" as const };
            }
            try {
              const result = await bridge.invokeTool(mapped.toolName, mapped.args);
              return { requestId: "", success: true, data: result };
            } catch {
              return { requestId: "", success: false, error: "action-failed" as const };
            }
          },
    });

    client.start();
    context.subscriptions.push({ dispose: () => client.stop() });
    out.appendLine(`[accordo-browser] SharedRelayClient started for hub ${hubId}`);
    // SUB-01: Register browser notifier so agent comment mutations trigger Chrome popup refresh
    registerBrowserNotifier(context, out, client);

    // SBR-SYNC-01: Start periodic browser comment sync (shared relay path)
    const sharedSyncScheduler = new BrowserCommentSyncScheduler(client, bridge, out);
    sharedSyncScheduler.start();
    context.subscriptions.push({ dispose: () => sharedSyncScheduler.stop() });

    // SBR-F-050: shared mode — register browser tools with the SharedRelayClient (BrowserRelayLike)
    const snapshotStore = new SnapshotRetentionStore(0);
    const screenshotStore = new ScreenshotRetentionStore();
    const securityConfig = getSecurityConfig();
    const allBrowserTools = buildBrowserTools(client, snapshotStore, securityConfig, screenshotStore);
    const toolsDisposable = bridge.registerTools(EXTENSION_ID, allBrowserTools);
    context.subscriptions.push(toolsDisposable);
    out.appendLine(`[accordo-browser] registered ${allBrowserTools.length} browser MCP tools (shared mode)`);
  } else {
    // SBR-F-032: Owner path — start new SharedBrowserRelayServer and write shared-relay.json
    out.appendLine(`[accordo-browser] no running shared relay found — starting as Owner`);

    const lockAcquired = acquireRelayLock();
    if (!lockAcquired) {
      out.appendLine("[accordo-browser] could not acquire lock — falling back to per-window relay");
      await activatePerWindowRelay(context, out, bridge, token, _commentsAvailable);
      return;
    }

    try {
      const server = new SharedBrowserRelayServer({
        port: RELAY_BASE_PORT,
        host: RELAY_HOST,
        token,
        onEvent: (event, details) => {
          out.appendLine(`[accordo-browser:server] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
        },
      });

      await server.start();

      const ownerInfo: SharedRelayInfo = {
        port: RELAY_BASE_PORT,
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        ownerHubId: randomUUID(),
      };
      writeSharedRelayInfo(ownerInfo);
      releaseRelayLock(); // Lock no longer needed once relay info is written
      out.appendLine(`[accordo-browser] SharedBrowserRelayServer started on ${RELAY_HOST}:${RELAY_BASE_PORT}`);
      relayPort = RELAY_BASE_PORT;

      context.subscriptions.push({
        dispose: () => {
          server.stop();
          // SBR-F-039: Clean up discovery/lock files on graceful owner shutdown
          removeSharedRelayInfo();
          releaseRelayLock();
        },
      });

      // SBR-F-050: Owner window also connects as a Hub client to its own server.
      // SharedBrowserRelayServer does not implement BrowserRelayLike — only SharedRelayClient does.
      const ownerClient: SharedRelayClient = new SharedRelayClient({
        host: RELAY_HOST,
        port: RELAY_BASE_PORT,
        hubId: ownerInfo.ownerHubId,
        token,
        label: "accordo-browser-owner",
        onEvent: (event, details) => {
          out.appendLine(`[accordo-browser:owner-hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
        },
        onRelayRequest: handleBrowserComment
          ? (action, payload): Promise<BrowserRelayResponse> => {
              out.appendLine(`[onRelayRequest:owner] action=${action} payload=${JSON.stringify(payload)}`);
              return handleBrowserComment(action, payload, ownerClient);
            }
          : async (action, payload): Promise<BrowserRelayResponse> => {
              out.appendLine(`[onRelayRequest:owner] action=${action} payload=${JSON.stringify(payload)}`);
              const mapped = browserActionToUnifiedTool(action, payload);
              if (!mapped) {
                return { requestId: "", success: false, error: "action-failed" as const };
              }
              try {
                const result = await bridge.invokeTool(mapped.toolName, mapped.args);
                return { requestId: "", success: true, data: result };
              } catch {
                return { requestId: "", success: false, error: "action-failed" as const };
              }
            },
      });
      ownerClient.start();
      context.subscriptions.push({ dispose: () => ownerClient.stop() });
      out.appendLine(`[accordo-browser] SharedRelayClient started for owner hub ${ownerInfo.ownerHubId}`);

      // SUB-01: Register browser notifier so agent comment mutations trigger Chrome popup refresh
      registerBrowserNotifier(context, out, ownerClient);

      // SBR-SYNC-01: Start periodic browser comment sync (owner relay path)
      const ownerSyncScheduler = new BrowserCommentSyncScheduler(ownerClient, bridge, out);
      ownerSyncScheduler.start();
      context.subscriptions.push({ dispose: () => ownerSyncScheduler.stop() });

      const ownerSnapshotStore = new SnapshotRetentionStore(0);
      const ownerScreenshotStore = new ScreenshotRetentionStore();
      const ownerSecurityConfig = getSecurityConfig();
      const ownerBrowserTools = buildBrowserTools(ownerClient, ownerSnapshotStore, ownerSecurityConfig, ownerScreenshotStore);
      const ownerToolsDisposable = bridge.registerTools(EXTENSION_ID, ownerBrowserTools);
      context.subscriptions.push(ownerToolsDisposable);
      out.appendLine(`[accordo-browser] registered ${ownerBrowserTools.length} browser MCP tools (shared mode, owner)`);
    } catch (err) {
      relayStartError = err instanceof Error ? err.message : String(err);
      out.appendLine(`[accordo-browser] SharedBrowserRelayServer start failed: ${relayStartError}`);
      releaseRelayLock();
      // SBR-F-033: Fall back to per-window relay if shared relay fails to start
      await activatePerWindowRelay(context, out, bridge, token, _commentsAvailable);
      return;
    }
  }

  bridge.publishState(EXTENSION_ID, {
    connected: true,
    relayHost: RELAY_HOST,
    relayPort,
    relayStartError,
  });
}

/**
 * Per-window BrowserRelayServer activation path (SBR-F-051).
 * Used when sharedRelay=false or shared relay fallback is triggered.
 */
export async function activatePerWindowRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  _commentsAvailable: boolean,
): Promise<void> {
  let relayStartError: string | null = null;

  const relayPort = await findFreePort(RELAY_BASE_PORT, RELAY_HOST).catch((err: unknown) => {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] findFreePort failed: ${relayStartError}`);
    return RELAY_BASE_PORT;
  });

  const relay = new BrowserRelayServer({
    host: RELAY_HOST,
    port: relayPort,
    token,
    onEvent: (event, details) => {
      out.appendLine(`[accordo-browser] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      if (event === "relay-client-connected" || event === "relay-client-disconnected") {
        bridge.publishState(EXTENSION_ID, {
          connected: relay.isConnected(),
          relayHost: RELAY_HOST,
          relayPort,
          relayStartError,
        });
      }
    },
    onRelayRequest: async (action, payload) => {
      out.appendLine(`[onRelayRequest] action=${action} payload=${JSON.stringify(payload)}`);
      const mapped = browserActionToUnifiedTool(action, payload);
      if (!mapped) {
        out.appendLine(`[onRelayRequest] action=${action} → no tool mapping, returning error`);
        return { requestId: "", success: false, error: "action-failed" };
      }
      out.appendLine(`[onRelayRequest] → invoking tool=${mapped.toolName} args=${JSON.stringify(mapped.args)}`);
      let result: unknown;
      try {
        result = await bridge.invokeTool(mapped.toolName, mapped.args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`[onRelayRequest] action=${action} → ERROR: ${msg}`);
        return { requestId: "", success: false, error: "action-failed", data: msg };
      }

      const MUTATING = ["create_comment", "reply_comment", "resolve_thread", "reopen_thread", "delete_comment", "delete_thread"] as const;
      if ((MUTATING as readonly string[]).includes(action)) {
        const url = payload["url"] as string | undefined;
        try {
          relay.push("notify_comments_updated", url ? { url } : {});
        } catch {
          // push is best-effort
        }
      }

      if (action === "get_comments" || action === "get_all_comments") {
        const threads = Array.isArray(result) ? result : [];
        return { requestId: "", success: true, data: { threads } };
      }
      return { requestId: "", success: true, data: result };
    },
  });

  try {
    await relay.start();
    writeRelayPort(relayPort);
    out.appendLine(`[accordo-browser] relay listening on ${RELAY_HOST}:${relayPort} (per-window mode)`);
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  const securityConfig = getSecurityConfig();
  const snapshotStore = new SnapshotRetentionStore(securityConfig.snapshotRetention?.maxAgeMs ?? 0);
  const screenshotStore = new ScreenshotRetentionStore();
  const allBrowserTools = buildBrowserTools(relay, snapshotStore, securityConfig, screenshotStore);

  const toolsDisposable = bridge.registerTools(EXTENSION_ID, allBrowserTools);
  context.subscriptions.push(toolsDisposable);
  out.appendLine(`[accordo-browser] registered ${allBrowserTools.length} browser MCP tools`);

  context.subscriptions.push({ dispose: () => relay.stop() });

  // SUB-01: Register browser notifier so agent comment mutations trigger Chrome popup refresh
  registerBrowserNotifier(context, out, relay);

  // SBR-SYNC-01: Start periodic browser comment sync (per-window relay path)
  const perWindowSyncScheduler = new BrowserCommentSyncScheduler(relay, bridge, out);
  perWindowSyncScheduler.start();
  context.subscriptions.push({ dispose: () => perWindowSyncScheduler.stop() });

  bridge.publishState(EXTENSION_ID, {
    connected: relay.isConnected(),
    relayHost: RELAY_HOST,
    relayPort,
    relayStartError,
  });
}
