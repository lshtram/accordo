import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BrowserRelayServer } from "./relay-server.js";
import { buildPageUnderstandingTools } from "./page-understanding-tools.js";
import { buildWaitForTool } from "./wait-tool.js";
import { buildTextMapTool } from "./text-map-tool.js";
import { buildSemanticGraphTool } from "./semantic-graph-tool.js";
import { buildDiffSnapshotsTool } from "./diff-tool.js";
import { buildHealthTool } from "./health-tool.js";
import { buildControlTools } from "./control-tool-types.js";
import { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { BrowserBridgeAPI, BrowserRelayAction } from "./types.js";
import { BrowserAuditLog } from "./security/audit-log.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_REDACTION_PATTERNS } from "./security/index.js";

const EXTENSION_ID = "accordo.accordo-browser";
const TOKEN_KEY = "browserRelayToken";
const DEV_RELAY_TOKEN = "accordo-local-dev-token";
const RELAY_BASE_PORT = 40111;
const RELAY_HOST = "127.0.0.1";

/**
 * Find a free TCP port starting at `startPort`, scanning up to `maxTries` candidates.
 */
function findFreePort(startPort: number, host: string, maxTries = 10): Promise<number> {
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

/**
 * Persist the relay port to ~/.accordo/relay.port so the Chrome extension
 * (or other consumers) can discover the active relay when the default port is in use.
 */
function writeRelayPort(port: number): void {
  try {
    const dir = path.join(os.homedir(), ".accordo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "relay.port"), String(port), "utf8");
  } catch {
    // best-effort — failure must not block activation
  }
}

/**
  * Map a Chrome browser relay action to the corresponding unified comment_* tool.
 * Returns { toolName, args } or null if the action has no corresponding tool.
 */
function browserActionToUnifiedTool(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
): { toolName: string; args: Record<string, unknown> } | null {
  switch (action) {
    case "get_all_comments":
      return { toolName: "comment_list", args: { scope: { modality: "browser" }, detail: true } };

    case "get_comments": {
      const url = payload["url"] as string | undefined;
      return {
        toolName: "comment_list",
        args: url
          ? { scope: { modality: "browser", url }, detail: true }
          : { scope: { modality: "browser" }, detail: true },
      };
    }

    case "create_comment":
      return {
        toolName: "comment_create",
        args: {
          body: payload["body"] as string,
          scope: {
            modality: "browser",
            url: (payload["url"] as string | undefined) ?? "",
          },
          anchor: {
            kind: "browser",
            anchorKey: (payload["anchorKey"] as string | undefined) ?? "body:center",
          },
          ...(payload["threadId"] !== undefined ? { threadId: payload["threadId"] as string } : {}),
          ...(payload["commentId"] !== undefined ? { commentId: payload["commentId"] as string } : {}),
          ...(payload["anchorKey"] !== undefined
            ? {
                context: {
                  surfaceMetadata: {
                    anchorKey: payload["anchorKey"] as string,
                  },
                },
              }
            : {}),
          ...(payload["authorName"] !== undefined
            ? { authorKind: "user", authorName: payload["authorName"] as string }
            : {}),
        },
      };

    case "reply_comment":
      return {
        toolName: "comment_reply",
        args: {
          threadId: payload["threadId"] as string,
          body: payload["body"] as string,
          ...(payload["commentId"] ? { commentId: payload["commentId"] as string } : {}),
          ...(payload["authorName"] !== undefined
            ? { authorKind: "user", authorName: payload["authorName"] as string }
            : {}),
        },
      };

    case "resolve_thread":
      return {
        toolName: "comment_resolve",
        args: {
          threadId: payload["threadId"] as string,
          resolutionNote: (payload["resolutionNote"] as string | undefined) ?? "",
        },
      };

    case "reopen_thread":
      return {
        toolName: "comment_reopen",
        args: { threadId: payload["threadId"] as string },
      };

    case "delete_comment":
      return {
        toolName: "comment_delete",
        args: {
          threadId: payload["threadId"] as string,
          commentId: payload["commentId"] as string | undefined,
        },
      };

    case "delete_thread":
      return {
        toolName: "comment_delete",
        args: { threadId: payload["threadId"] as string },
      };

    case "get_comments_version":
      return { toolName: "comment_sync_version", args: {} };

    default:
      return null;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("Accordo Browser Relay");
  context.subscriptions.push(out);
  out.appendLine("[accordo-browser] activating...");

  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    out.appendLine("[accordo-browser] accordo-bridge not installed; aborting activation");
    return;
  }
  const bridge = bridgeExt.exports as BrowserBridgeAPI | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    out.appendLine("[accordo-browser] Bridge exports unavailable; aborting activation");
    return;
  }

  const token = (context.globalState.get<string>(TOKEN_KEY) ?? DEV_RELAY_TOKEN).trim();
  await context.globalState.update(TOKEN_KEY, token);

  let relayStartError: string | null = null;

  const relayPort = await findFreePort(RELAY_BASE_PORT, RELAY_HOST).catch((err: unknown) => {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] findFreePort failed: ${relayStartError}`);
    return RELAY_BASE_PORT; // fallback — start() will fail and be caught below
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
    // Route all Chrome events through unified comment_* tools
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
        return {
          requestId: "",
          success: false,
          error: "action-failed",
          data: msg,
        };
      }

      // After any mutating tool call, push Chrome to refresh its popup.
      // Fire-and-forget: errors here must not affect the response returned to Chrome.
      // Uses relay.push() (not relay.request()) to avoid recursive onRelayRequest calls.
      const MUTATING = ["create_comment", "reply_comment", "resolve_thread", "reopen_thread", "delete_comment", "delete_thread"] as const;
      if ((MUTATING as readonly string[]).includes(action)) {
        const url = payload["url"] as string | undefined;
        out.appendLine(`[onRelayRequest] pushing notify_comments_updated url=${url ?? "(none)"}`);
        try {
          relay.push("notify_comments_updated", url ? { url } : {});
        } catch {
          // push is best-effort; failure must not affect the mutation response
        }
      }

      // Chrome's service-worker expects { threads: HubCommentThread[] } for list actions.
      // comment_list returns a bare array — wrap it so raw.threads is resolvable.
      if (action === "get_comments" || action === "get_all_comments") {
        const threads = Array.isArray(result) ? result : [];
        out.appendLine(`[onRelayRequest] action=${action} → wrapped ${threads.length} thread(s) in { threads }`);
        return { requestId: "", success: true, data: { threads } };
      }
      out.appendLine(`[onRelayRequest] action=${action} → result=${JSON.stringify(result).slice(0, 200)}`);
      return { requestId: "", success: true, data: result };
    },
  });

  try {
    await relay.start();
    writeRelayPort(relayPort);
    out.appendLine(`[accordo-browser] relay listening on ${RELAY_HOST}:${relayPort} (unified tool routing)`);
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  // Register page-understanding MCP tools so AI agents can inspect live browser pages.
  // These tools forward requests through the relay to the Chrome extension content script.
  // B2-SV-004: A single shared store ensures all 4 data-producing paths use coherent
  // 5-slot per-page FIFO retention semantics.
  const snapshotStore = new SnapshotRetentionStore();

  // Security configuration: origin policy, redaction, and audit log.
  const securityConfig: SecurityConfig = {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({
      filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl"),
    }),
  };

  const pageUnderstandingTools = buildPageUnderstandingTools(relay, snapshotStore, securityConfig);

  // M109-WAIT: Register the browser_wait_for tool alongside page-understanding tools.
  // B2-WA-001..007: Agents can wait for text, selector, or layout stability conditions.
  const waitTool = buildWaitForTool(relay);

  // M112-TEXT: Register the browser_get_text_map tool.
  // B2-TX-001..010: Agents can extract structured text with reading order and visibility.
  const textMapTool = buildTextMapTool(relay, snapshotStore, securityConfig);

  // M113-SEM: Register the browser_get_semantic_graph tool.
  // B2-SG-001..015: Agents can extract unified semantic structure (a11y, landmarks, outline, forms).
  const semanticGraphTool = buildSemanticGraphTool(relay, snapshotStore, securityConfig);

  // M101-DIFF: Register the browser_diff_snapshots tool.
  // B2-DE-001..007: Agents can compare two page snapshots and see what changed.
  const diffTool = buildDiffSnapshotsTool(relay, snapshotStore);

  // GAP-H1: browser_health tool for connection observability
  const healthTool = buildHealthTool(relay);

  const allBrowserTools = [...pageUnderstandingTools, waitTool, textMapTool, semanticGraphTool, diffTool, healthTool, ...buildControlTools(relay)];

  const toolsDisposable = bridge.registerTools(EXTENSION_ID, allBrowserTools);
  context.subscriptions.push(toolsDisposable);
  out.appendLine(
    `[accordo-browser] registered ${allBrowserTools.length} browser MCP tools ` +
      `(${allBrowserTools.map((t) => t.name).join(", ")})`,
  );

  // Subscribe to accordo-comments mutations so agent-created comments
  // trigger a Chrome popup refresh.
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (commentsExt) {
    const commentsExports = commentsExt.exports as
      | {
          registerBrowserNotifier?: (notifier: {
            addThread(thread: { anchor: { uri: string } }): void;
            updateThread(thread: { anchor: { uri: string } }): void;
            removeThread(threadId: string): void;
          }) => { dispose(): void };
        }
      | undefined;
    if (commentsExports?.registerBrowserNotifier) {
      const sub = commentsExports.registerBrowserNotifier({
        addThread: (thread) => {
          const url = thread.anchor.uri;
          if (!url.startsWith("http://") && !url.startsWith("https://")) return;
          out.appendLine(`[accordo-browser] comment mutation (add) url=${url} — pushing notify_comments_updated`);
          relay.push("notify_comments_updated", { url });
        },
        updateThread: (thread) => {
          const url = thread.anchor.uri;
          if (!url.startsWith("http://") && !url.startsWith("https://")) return;
          out.appendLine(`[accordo-browser] comment mutation (update) url=${url} — pushing notify_comments_updated`);
          relay.push("notify_comments_updated", { url });
        },
        removeThread: (threadId) => {
          // removeThread only has threadId (no URL). Include threadId so Chrome
          // can soft-delete local anchor data for the same thread.
          out.appendLine(`[accordo-browser] comment mutation (remove) threadId=${threadId} — pushing notify_comments_updated(threadId)`);
          relay.push("notify_comments_updated", { threadId });
        },
      });
      context.subscriptions.push(sub);
      out.appendLine("[accordo-browser] registered browser notifier with accordo-comments");
    } else {
      out.appendLine("[accordo-browser] accordo-comments exports.registerBrowserNotifier not available — popup auto-refresh disabled");
    }
  } else {
    out.appendLine("[accordo-browser] accordo-comments extension not found — popup auto-refresh disabled");
  }

  context.subscriptions.push({
    dispose: () => {
      void relay.stop();
    },
  });

  bridge.publishState(EXTENSION_ID, {
    connected: relay.isConnected(),
    relayHost: RELAY_HOST,
    relayPort,
    relayStartError,
  });
  out.appendLine("[accordo-browser] published modality state");
}

export function deactivate(): void {
  // no-op: relay disposed via subscriptions
}
