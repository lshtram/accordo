import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "node:http";
import { BrowserRelayServer } from "./relay-server.js";
import { SharedBrowserRelayServer } from "./shared-relay-server.js";
import { SharedRelayClient } from "./shared-relay-client.js";
import { buildPageUnderstandingTools } from "./page-understanding-tools.js";
import { buildWaitForTool } from "./wait-tool.js";
import { buildTextMapTool } from "./text-map-tool.js";
import { buildSemanticGraphTool } from "./semantic-graph-tool.js";
import { buildDiffSnapshotsTool } from "./diff-tool.js";
import { buildHealthTool } from "./health-tool.js";
import { buildManageSnapshotsTool } from "./manage-snapshots-tool.js";
import { buildControlTools } from "./control-tool-types.js";
import { buildSpatialRelationsTool } from "./spatial-relations-tool.js";
import { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayLike } from "./types.js";
import { BrowserAuditLog } from "./security/audit-log.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_REDACTION_PATTERNS } from "./security/index.js";
import {
  readSharedRelayInfo,
  writeSharedRelayInfo,
  isRelayAlive,
  acquireRelayLock,
  releaseRelayLock,
  removeSharedRelayInfo,
} from "./relay-discovery.js";
import type { SharedRelayInfo } from "./shared-relay-types.js";
import type { CommentThread } from "@accordo/bridge-types";
import { randomUUID } from "node:crypto";
import { generateRelayToken } from "./relay-auth.js";

const EXTENSION_ID = "accordo.accordo-browser";
const TOKEN_KEY = "browserRelayToken";
const RELAY_BASE_PORT = 40111;
const RELAY_HOST = "127.0.0.1";

// ── Browser Comment Sync ───────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 30_000;

/**
 * Remote browser thread data returned by Chrome relay get_comments action.
 */
interface RemoteBrowserThread {
  id: string;
  anchorKey: string;
  anchorContext?: {
    tagName?: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
  };
  pageUrl: string;
  status: "open" | "resolved";
  comments: RemoteBrowserComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

interface RemoteBrowserComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user"; name: string };
  body: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  deletedAt?: string;
}

interface GetCommentsResponse {
  url: string;
  threads: RemoteBrowserThread[];
}

/**
 * Maps a remote Chrome BrowserCommentThread to the args for comment_create.
 */
function remoteThreadToCreateArgs(
  thread: RemoteBrowserThread,
): Record<string, unknown> {
  const firstComment = thread.comments[0];
  return {
    scope: { modality: "browser", url: thread.pageUrl },
    anchor: { kind: "browser", anchorKey: thread.anchorKey },
    body: firstComment?.body ?? "",
    threadId: thread.id,
    commentId: firstComment?.id,
    context: thread.anchorContext
      ? {
          surfaceMetadata: {
            anchorKey: thread.anchorKey,
            tagName: thread.anchorContext.tagName,
            textSnippet: thread.anchorContext.textSnippet,
            ariaLabel: thread.anchorContext.ariaLabel,
            pageTitle: thread.anchorContext.pageTitle,
          },
        }
      : { surfaceMetadata: { anchorKey: thread.anchorKey } },
    authorKind: firstComment?.author?.kind === "user" ? "user" : "agent",
    authorName: firstComment?.author?.name,
  };
}

/**
 * Maps a remote Chrome BrowserComment to the args for comment_reply.
 */
function remoteCommentToReplyArgs(
  comment: RemoteBrowserComment,
): Record<string, unknown> {
  return {
    threadId: comment.threadId,
    body: comment.body,
    commentId: comment.id,
    authorKind: comment.author?.kind === "user" ? "user" : "agent",
    authorName: comment.author?.name,
  };
}

/**
 * Synchronizes browser comments from Chrome extension storage into the local VSCode
 * comment store, and cleans up local threads that no longer exist remotely.
 *
 * Sync algorithm:
 * 1. Pull all remote pages via relay.request("get_all_comments")
 * 2. Pull remote threads for each page via relay.request("get_comments", { url })
 * 3. Pull all local browser threads via bridge.invokeTool("comment_list", ...)
 * 4. Upsert: create missing threads, add missing replies, sync resolve/reopen status
 * 5. Delete: remove local threads not present in remote (only if full remote fetch succeeded)
 */
export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<"success" | "partial"> {
  // Step 1: Pull remote page list
  const pagesResult = await relay.request("get_all_comments", {}, 5000);
  if (!pagesResult.success) {
    out.appendLine("[accordo-browser:comment-sync] get_all_comments failed — skipping sync");
    return "partial";
  }

  const pagesData = pagesResult.data as { pages: Array<{ url: string }> };
  const pages = pagesData.pages ?? [];
  if (pages.length === 0) {
    out.appendLine("[accordo-browser:comment-sync] no remote browser pages returned");
  }

  // Step 2: Pull threads for each page (collect all remote threads)
  const remoteThreads: RemoteBrowserThread[] = [];
  let anyPageFailed = false;

  for (const page of pages) {
    const pageResult = await relay.request("get_comments", { url: page.url }, 5000);
    if (!pageResult.success) {
      out.appendLine(
        `[accordo-browser:comment-sync] get_comments failed for ${page.url} — continuing`,
      );
      anyPageFailed = true;
      continue;
    }
    const pageData = pageResult.data as GetCommentsResponse;
    if (pageData.threads) {
      remoteThreads.push(...pageData.threads);
    }
  }

  // Build set of remote thread IDs (only non-deleted)
  const remoteThreadIds = new Set<string>(
    remoteThreads
      .filter((t) => !t.deletedAt)
      .map((t) => t.id),
  );

  // Step 3: Pull all local browser threads
  let localThreads: CommentThread[];
  try {
    const localResult = await bridge.invokeTool(
      "comment_list",
      { scope: { modality: "browser" }, detail: true },
    );
    localThreads = (localResult as CommentThread[]) ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser:comment-sync] comment_list failed: ${msg} — skipping sync`);
    return "partial";
  }

  // Step 4: Upsert remote threads into local store
  for (const remoteThread of remoteThreads) {
    if (remoteThread.deletedAt) continue;

    const existingThread = localThreads.find((t) => t.id === remoteThread.id);
    let localStatus: "open" | "resolved" = existingThread?.status ?? "open";
    const localCommentIds = new Set<string>(existingThread?.comments.map((c) => c.id) ?? []);

    if (!existingThread) {
      // Create missing thread
      try {
        await bridge.invokeTool("comment_create", remoteThreadToCreateArgs(remoteThread));
        const firstCommentId = remoteThread.comments[0]?.id;
        if (firstCommentId) localCommentIds.add(firstCommentId);
        out.appendLine(
          `[accordo-browser:comment-sync] created thread ${remoteThread.id} on ${remoteThread.pageUrl}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] comment_create failed for ${remoteThread.id}: ${msg}`,
        );
      }
    }

    // Sync status if needed (covers both existing + newly created threads)
    const remoteStatus = remoteThread.status;
    if (localStatus !== remoteStatus) {
      try {
        if (remoteStatus === "resolved") {
          await bridge.invokeTool("comment_resolve", {
            threadId: remoteThread.id,
            resolutionNote: "Synced from browser",
          });
        } else {
          await bridge.invokeTool("comment_reopen", { threadId: remoteThread.id });
        }
        localStatus = remoteStatus;
        out.appendLine(
          `[accordo-browser:comment-sync] synced status for thread ${remoteThread.id} → ${remoteStatus}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] status sync failed for ${remoteThread.id}: ${msg}`,
        );
      }
    }

    // Sync replies: add missing comments (covers both existing + newly created)
    for (const remoteComment of remoteThread.comments) {
      if (remoteComment.deletedAt) continue;
      if (!localCommentIds.has(remoteComment.id)) {
        try {
          await bridge.invokeTool("comment_reply", remoteCommentToReplyArgs(remoteComment));
          localCommentIds.add(remoteComment.id);
          out.appendLine(
            `[accordo-browser:comment-sync] added reply ${remoteComment.id} to thread ${remoteThread.id}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          out.appendLine(
            `[accordo-browser:comment-sync] comment_reply failed for ${remoteComment.id}: ${msg}`,
          );
        }
      }
    }
  }

  // Step 5: Delete local-only threads (only if no page fetch failed)
  if (anyPageFailed) {
    out.appendLine(
      "[accordo-browser:comment-sync] partial remote fetch — skipping deletions",
    );
    return "partial";
  }

  for (const localThread of localThreads) {
    if (!remoteThreadIds.has(localThread.id)) {
      try {
        await bridge.invokeTool("comment_delete", { threadId: localThread.id });
        out.appendLine(
          `[accordo-browser:comment-sync] deleted local-only thread ${localThread.id}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] comment_delete failed for ${localThread.id}: ${msg}`,
        );
      }
    }
  }

  return anyPageFailed ? "partial" : "success";
}

/**
 * Scheduler that runs periodic browser comment sync.
 * Runs every SYNC_INTERVAL_MS milliseconds, with an in-flight guard
 * to prevent overlapping sync runs.
 */
export class BrowserCommentSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private readonly relay: BrowserRelayLike;
  private readonly bridge: BrowserBridgeAPI;
  private readonly out: vscode.OutputChannel;

  constructor(relay: BrowserRelayLike, bridge: BrowserBridgeAPI, out: vscode.OutputChannel) {
    this.relay = relay;
    this.bridge = bridge;
    this.out = out;
  }

  /**
   * Schedule the periodic sync loop.
   */
  start(): void {
    if (this.timer !== null) return;
    this.out.appendLine(
      `[accordo-browser:comment-sync] starting periodic sync every ${SYNC_INTERVAL_MS / 1000}s`,
    );
    this.timer = setInterval(() => {
      void this.runSync();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Immediately trigger a sync (no-op if one is already in-flight).
   */
  async syncNow(): Promise<void> {
    await this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.syncing) {
      this.out.appendLine("[accordo-browser:comment-sync] sync already in-flight — skipping");
      return;
    }
    this.syncing = true;
    try {
      this.out.appendLine("[accordo-browser:comment-sync] starting sync...");
      const result = await syncBrowserComments(this.relay, this.bridge, this.out);
      this.out.appendLine(
        `[accordo-browser:comment-sync] sync complete: ${result}`,
      );
    } catch (err) {
      // Never throw from periodic task — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      this.out.appendLine(`[accordo-browser:comment-sync] unexpected error: ${msg}`);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Stop the scheduler and clear the timer.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.out.appendLine("[accordo-browser:comment-sync] scheduler stopped");
    }
  }
}

/**
 * Build security config once — used in both shared and per-window activation paths.
 */
function getSecurityConfig(): SecurityConfig {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({ filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl") }),
    snapshotRetention: { maxAgeMs: 0 },
  };
}

/**
 * Build all browser tools for a given relay (BrowserRelayLike).
 * Used for both per-window (BrowserRelayServer) and shared mode (SharedRelayClient / SharedBrowserRelayServer).
 */
/**
 * Build the accordo_browser_pair tool.
 *
 * Calls GET /pair/code on the shared relay server to issue a one-time pairing
 * code. The agent displays this code to the user, who copies it into the
 * browser extension popup to complete pairing.
 *
 * @see PAIR-04 — MCP tool issues a pairing code
 */
function buildPairTool() {
  return {
    name: "accordo_browser_pair",
    description:
      "Issue a one-time pairing code so the user can connect the Accordo browser extension to VS Code. " +
      "Returns a short code (e.g. '1234-5678') that the user should paste into the browser extension popup. " +
      "The code expires in 5 minutes.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    dangerLevel: "safe" as const,
    idempotent: false,
    handler: async (): Promise<unknown> => {
      return new Promise((resolve) => {
        const req = http.get(`http://${RELAY_HOST}:${RELAY_BASE_PORT}/pair/code`, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { code?: string; expiresIn?: number };
              if (parsed.code) {
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `Pairing code: **${parsed.code}**\n\nAsk the user to open the Accordo browser extension popup, enter this code in the "VS Code code:" field, and click Connect. The code expires in ${Math.round((parsed.expiresIn ?? 300000) / 1000)} seconds.`,
                    },
                  ],
                });
              } else {
                resolve({ content: [{ type: "text", text: "Failed to generate pairing code — relay may not be running." }] });
              }
            } catch {
              resolve({ content: [{ type: "text", text: "Failed to parse pairing code response." }] });
            }
          });
        });
        req.on("error", (err: Error) => {
          resolve({ content: [{ type: "text", text: `Failed to reach relay: ${err.message}` }] });
        });
        req.end();
      });
    },
  };
}

function buildBrowserTools(
  relay: BrowserRelayLike,
  snapshotStore: SnapshotRetentionStore,
  securityConfig: SecurityConfig,
) {
  return [
    ...buildPageUnderstandingTools(relay, snapshotStore, securityConfig),
    buildWaitForTool(relay),
    buildTextMapTool(relay, snapshotStore, securityConfig),
    buildSemanticGraphTool(relay, snapshotStore, securityConfig),
    buildDiffSnapshotsTool(relay, snapshotStore),
    buildHealthTool(relay),
    buildManageSnapshotsTool(relay, snapshotStore),
    buildSpatialRelationsTool(relay, snapshotStore, securityConfig),
    ...buildControlTools(relay),
    buildPairTool(),
  ];
}

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
 * AUTH-03 / AUTH-06: Resolve the relay token with SecretStorage primary storage
 * and globalState migration.
 *
 * Resolution order (AUTH-03):
 *  1. secrets.get(TOKEN_KEY) succeeds → return it.
 *  2. secrets returns undefined AND globalState has a token → migrate to SecretStorage,
 *     clean up globalState, return the token.
 *  3. Both absent → generate a fresh cryptographically random token, store in
 *     SecretStorage, return it.
 *
 * Failure semantics (AUTH-03-ERR):
 *  - secrets.get() throws → generate ephemeral token, warn. Do NOT fall back to globalState.
 *  - secrets.store() throws during migration → keep using globalState token, warn. No cleanup.
 *  - globalState.update() throws after successful store → warn. Token now in both stores
 *    (harmless; next activation finds it in SecretStorage).
 *  - secrets.store() throws for fresh token → return the fresh token anyway, warn.
 *
 * @param context - The VS Code extension context
 * @returns A valid non-empty token string. Never throws. Never returns a hardcoded value.
 */
async function resolveRelayToken(context: vscode.ExtensionContext): Promise<string> {
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
 * Register a browser notifier with the accordo-comments extension so that
 * agent-created comment mutations trigger Chrome popup refresh without
 * subscribing to every document-change event.
 *
 * SUB-01..SUB-03: registerBrowserNotifier is called during activation when
 * the accordo-comments extension is available and exports the API.
 */
function registerBrowserNotifier(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  relay: { push(action: string, payload: Record<string, unknown>): void },
): void {
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (!commentsExt) {
    out.appendLine("[accordo-browser] accordo-comments not installed — skipping notifier registration");
    return;
  }
  const commentsExports = commentsExt.exports as {
    registerBrowserNotifier?: (notifier: {
      addThread(thread: { anchor: { uri: string } }): void;
      updateThread(thread: { anchor: { uri: string } }): void;
      removeThread(threadId: string): void;
    }) => { dispose(): void };
  } | undefined;
  if (!commentsExports?.registerBrowserNotifier) {
    out.appendLine("[accordo-browser] accordo-comments has no registerBrowserNotifier — skipping");
    return;
  }
  const sub = commentsExports.registerBrowserNotifier({
    addThread(thread: { anchor: { uri: string } }) {
      const url = thread.anchor.uri;
      if (!url.startsWith("http://") && !url.startsWith("https://")) return;
      try {
        relay.push("notify_comments_updated", { url });
      } catch {
        // push is best-effort
      }
    },
    updateThread(thread: { anchor: { uri: string } }) {
      const url = thread.anchor.uri;
      if (!url.startsWith("http://") && !url.startsWith("https://")) return;
      try {
        relay.push("notify_comments_updated", { url });
      } catch {
        // push is best-effort
      }
    },
    removeThread(threadId: string) {
      try {
        relay.push("notify_comments_updated", { threadId });
      } catch {
        // push is best-effort
      }
    },
  });
  context.subscriptions.push(sub);
  out.appendLine("[accordo-browser] registered browser notifier for accordo-comments");
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

  const token = await resolveRelayToken(context);

  // SBR-F-050: Check the sharedRelay feature flag
  const sharedRelayEnabled = vscode.workspace
    .getConfiguration("accordo.browser")
    .get<boolean>("sharedRelay", true);

  if (sharedRelayEnabled) {
    await activateSharedRelay(context, out, bridge, token);
  } else {
    await activatePerWindowRelay(context, out, bridge, token);
  }

  out.appendLine("[accordo-browser] published modality state");
}

/**
 * SBR-F-030..043: Shared relay activation path.
 *
 * Discovery flow:
 * 1. Read ~/.accordo/shared-relay.json — if valid and relay process is alive → Hub path
 * 2. Otherwise → Owner path: start SharedBrowserRelayServer + write shared-relay.json
 * 3. Fall back to per-window BrowserRelayServer if shared relay fails
 */
async function activateSharedRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
): Promise<void> {
  const ACCORDO_DIR = path.join(os.homedir(), ".accordo");
  const RELAY_INFO_FILE = path.join(ACCORDO_DIR, "shared-relay.json");

  let relayStartError: string | null = null;
  let relayPort = RELAY_BASE_PORT;

  // SBR-F-030: read shared-relay.json on activation
  const existingInfo = readSharedRelayInfo();
  if (existingInfo && isRelayAlive(existingInfo)) {
    // SBR-F-031: Hub path — connect to existing shared relay as client
    out.appendLine(`[accordo-browser] shared relay already running on ${RELAY_BASE_PORT} — connecting as Hub`);
    const hubId = randomUUID();
    const client = new SharedRelayClient({
      host: RELAY_HOST,
      port: RELAY_BASE_PORT,
      hubId,
      token: existingInfo.token, // Use token from discovery file, not session token
      label: "accordo-browser-hub",
      onEvent: (event, details) => {
        out.appendLine(`[accordo-browser:hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      },
      onRelayRequest: async (action, payload) => {
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
    const securityConfig = getSecurityConfig();
    const allBrowserTools = buildBrowserTools(client, snapshotStore, securityConfig);
    const toolsDisposable = bridge.registerTools(EXTENSION_ID, allBrowserTools);
    context.subscriptions.push(toolsDisposable);
    out.appendLine(`[accordo-browser] registered ${allBrowserTools.length} browser MCP tools (shared mode)`);
  } else {
    // SBR-F-032: Owner path — start new SharedBrowserRelayServer and write shared-relay.json
    out.appendLine(`[accordo-browser] no running shared relay found — starting as Owner`);

    const lockAcquired = acquireRelayLock();
    if (!lockAcquired) {
      out.appendLine("[accordo-browser] could not acquire lock — falling back to per-window relay");
      await activatePerWindowRelay(context, out, bridge, token);
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
      const ownerClient = new SharedRelayClient({
        host: RELAY_HOST,
        port: RELAY_BASE_PORT,
        hubId: ownerInfo.ownerHubId,
        token,
        label: "accordo-browser-owner",
        onEvent: (event, details) => {
          out.appendLine(`[accordo-browser:owner-hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
        },
        onRelayRequest: async (action, payload) => {
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
      const ownerSecurityConfig = getSecurityConfig();
      const ownerBrowserTools = buildBrowserTools(ownerClient, ownerSnapshotStore, ownerSecurityConfig);
      const ownerToolsDisposable = bridge.registerTools(EXTENSION_ID, ownerBrowserTools);
      context.subscriptions.push(ownerToolsDisposable);
      out.appendLine(`[accordo-browser] registered ${ownerBrowserTools.length} browser MCP tools (shared mode, owner)`);
    } catch (err) {
      relayStartError = err instanceof Error ? err.message : String(err);
      out.appendLine(`[accordo-browser] SharedBrowserRelayServer start failed: ${relayStartError}`);
      releaseRelayLock();
      // SBR-F-033: Fall back to per-window relay if shared relay fails to start
      await activatePerWindowRelay(context, out, bridge, token);
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
async function activatePerWindowRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
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

  const securityConfig: SecurityConfig = {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({ filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl") }),
    snapshotRetention: { maxAgeMs: 0 },
  };

  const snapshotStore = new SnapshotRetentionStore(securityConfig.snapshotRetention?.maxAgeMs ?? 0);
  const pageUnderstandingTools = buildPageUnderstandingTools(relay, snapshotStore, securityConfig);
  const waitTool = buildWaitForTool(relay);
  const textMapTool = buildTextMapTool(relay, snapshotStore, securityConfig);
  const semanticGraphTool = buildSemanticGraphTool(relay, snapshotStore, securityConfig);
  const diffTool = buildDiffSnapshotsTool(relay, snapshotStore);
  const healthTool = buildHealthTool(relay);
  const manageSnapshotsTool = buildManageSnapshotsTool(relay, snapshotStore);
  const spatialRelationsTool = buildSpatialRelationsTool(relay, snapshotStore, securityConfig);

  const allBrowserTools = [
    ...pageUnderstandingTools,
    waitTool,
    textMapTool,
    semanticGraphTool,
    diffTool,
    healthTool,
    manageSnapshotsTool,
    spatialRelationsTool,
    ...buildControlTools(relay),
  ];

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

export function deactivate(): void {
  // no-op: relay disposed via subscriptions
}
