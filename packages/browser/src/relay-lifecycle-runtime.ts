import type * as vscode from "vscode";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { SnapshotRetentionStore } from "./snapshot-retention.js";
import { ScreenshotRetentionStore } from "./screenshot-retention.js";
import { buildBrowserTools } from "./tool-assembly.js";
import { registerBrowserNotifier, browserActionToUnifiedTool } from "./comment-notifier.js";
import { normalizeReadResult } from "./comment-relay-contract.js";
import { BrowserCommentSyncScheduler, syncBrowserComments } from "./comment-sync.js";
import { applyBrowserCommentSyncStateFromRelay } from "./comment-sync-runtime.js";
import { EXTENSION_ID, getSecurityConfig } from "./relay-lifecycle-primitives.js";

const MUTATING = ["create_comment", "reply_comment", "resolve_thread", "reopen_thread", "delete_comment", "delete_thread"] as const;

interface RelayRequestHandlerOptions<TRelay extends BrowserRelayLike> {
  out: vscode.OutputChannel;
  bridge: BrowserBridgeAPI;
  getRelay: () => TRelay;
  logLabel?: string;
  logMappingDetails?: boolean;
  includeInvokeErrorData?: boolean;
  /** Browser comment handler callback. Receives out for use in syncBrowserComments. */
  handleBrowserComment?: (
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    relay: TRelay,
    out?: vscode.OutputChannel,
  ) => Promise<BrowserRelayResponse>;
}

function getLogPrefix(label?: string): string {
  return `[onRelayRequest${label ? `:${label}` : ""}]`;
}

export function createRelayRequestHandler<TRelay extends BrowserRelayLike>(
  options: RelayRequestHandlerOptions<TRelay>,
): (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse> {
  const prefix = getLogPrefix(options.logLabel);
  return async (action, payload) => {
    options.out.appendLine(`${prefix} action=${action} payload=${JSON.stringify(payload)}`);

    // ── Full-state sync actions ─────────────────────────────────────────────────
    // Protocol (canonical, Accordo-initiated):
    //   1. VSCode calls syncBrowserComments() → sends request_comment_state_sync to browser
    //   2. Browser handler reads canonical store, calls back via sync_comment_state (request())
    //   3. VSCode applies browser's full state via applyBrowserCommentSyncStateFromRelay()
    //   4. VSCode returns merged BrowserCommentSyncState in sync_comment_state response
    //   5. Browser handler receives merged state in request() response, persists it
    //   6. syncBrowserComments() returns merged state to caller
    //
    // sync_comment_state also arrives from the browser (step 2 above) — it applies state
    // and returns merged. This path NEVER calls syncBrowserComments() (would cause recursion).
    //
    if (action === "request_comment_state_sync") {
      // VSCode initiates sync: calls syncBrowserComments() which sends request_comment_state_sync.
      // Browser handler reads canonical store, calls back via sync_comment_state.
      // The merged state is returned in the request() response data.
      // DEBUG: instrument sync cycle
      const requestId = (payload["requestId"] as string | undefined) ?? "(none)";
      options.out.appendLine(`[SYNC-A] request_comment_state_sync received requestId=${requestId}`);
      try {
        const syncResult = await syncBrowserComments(options.getRelay(), options.bridge, options.out);
        // Return the merged BrowserCommentSyncState in response data so the browser persists it.
        const data = syncResult.syncResult ?? { synced: syncResult.status === "success" };
        return {
          requestId: "",
          success: syncResult.status === "success",
          error: syncResult.status === "partial" ? "action-failed" : undefined,
          data,
        };
      } catch {
        return { requestId: "", success: false, error: "action-failed" };
      }
    }

    if (action === "sync_comment_state") {
      // Browser calls back with its full canonical state (in response to request_comment_state_sync).
      // Apply the incoming state — do NOT call syncBrowserComments() here, which would
      // cause recursion: sync_comment_state → syncBrowserComments() → request_comment_state_sync
      // → this handler again.
      // DEBUG: instrument sync cycle
      const schemaVersion = (payload["schemaVersion"] as string | undefined) ?? "(none)";
      const emittedBy = (payload["emittedBy"] as string | undefined) ?? "(none)";
      const pages = payload["pages"] as Array<unknown> | undefined;
      const pageCount = pages?.length ?? 0;
      let threadCount = 0;
      let commentCount = 0;
      for (const page of pages ?? []) {
        const p = page as { threads?: Array<unknown> };
        for (const thread of p.threads ?? []) {
          threadCount++;
          const t = thread as { comments?: Array<unknown> };
          commentCount += t.comments?.length ?? 0;
        }
      }
      options.out.appendLine(
        `[SYNC-F] sync_comment_state received from browser schemaVersion=${schemaVersion} pageCount=${pageCount} threadCount=${threadCount} commentCount=${commentCount} emittedBy=${emittedBy}`,
      );
      let applyResult: "success" | "partial" = "partial";
      try {
        applyResult = await applyBrowserCommentSyncStateFromRelay(payload, options.out);
        const dataPageCount = pages?.length ?? 0;
        let dataThreadCount = 0;
        let dataCommentCount = 0;
        for (const page of pages ?? []) {
          const p = page as { threads?: Array<unknown> };
          for (const thread of p.threads ?? []) {
            dataThreadCount++;
            const t = thread as { comments?: Array<unknown> };
            dataCommentCount += t.comments?.length ?? 0;
          }
        }
        options.out.appendLine(
          `[SYNC-F2] sync_comment_state returning success=${applyResult === "success"} applyResult=${applyResult} dataPageCount=${dataPageCount} dataThreadCount=${dataThreadCount} dataCommentCount=${dataCommentCount}`,
        );
        // Return the merged state so the browser can persist it.
        // The merged state IS the payload (browser's state, now reconciled by VSCode).
        return {
          requestId: "",
          success: applyResult === "success",
          error: applyResult === "partial" ? "action-failed" : undefined,
          data: payload,
        };
      } catch {
        options.out.appendLine(`[SYNC-F2] sync_comment_state returning success=false applyResult=threw`);
        return { requestId: "", success: false, error: "action-failed" };
      }
    }

    const mapped = browserActionToUnifiedTool(action, payload);
    if (!mapped) {
      if (options.handleBrowserComment) {
        return options.handleBrowserComment(action, payload, options.getRelay(), options.out);
      }
      if (options.logMappingDetails) {
        options.out.appendLine(`${prefix} action=${action} → no tool mapping, returning error`);
      }
      return { requestId: "", success: false, error: "action-failed" };
    }

    if (options.logMappingDetails) {
      options.out.appendLine(`${prefix} → invoking tool=${mapped.toolName} args=${JSON.stringify(mapped.args)}`);
    }

    let result: unknown;
    try {
      result = await options.bridge.invokeTool(mapped.toolName, mapped.args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.logMappingDetails) {
        options.out.appendLine(`${prefix} action=${action} → ERROR: ${msg}`);
      }
      return {
        requestId: "",
        success: false,
        error: "action-failed",
        ...(options.includeInvokeErrorData ? { data: msg } : {}),
      };
    }

    if ((MUTATING as readonly string[]).includes(action)) {
      const url = payload["url"] as string | undefined;
      try {
        options.getRelay().push("request_comment_state_sync", url ? { url } : {});
      } catch {
        // push is best-effort
      }
    }

    if (action === "get_comments" || action === "get_all_comments") {
      return { requestId: "", success: true, data: normalizeReadResult(result) };
    }
    return { requestId: "", success: true, data: result };
  };
}

interface RegisterRelayRuntimeOptions {
  context: vscode.ExtensionContext;
  out: vscode.OutputChannel;
  bridge: BrowserBridgeAPI;
  relay: BrowserRelayLike;
  modeLabel?: string;
}

export function registerRelayRuntime(options: RegisterRelayRuntimeOptions): void {
  const securityConfig = getSecurityConfig();
  const snapshotStore = new SnapshotRetentionStore(securityConfig.snapshotRetention?.maxAgeMs ?? 0);
  const screenshotStore = new ScreenshotRetentionStore();
  const allBrowserTools = buildBrowserTools(options.bridge, options.relay, snapshotStore, securityConfig, screenshotStore);

  const toolsDisposable = options.bridge.registerTools(EXTENSION_ID, allBrowserTools);
  options.context.subscriptions.push(toolsDisposable);
  options.out.appendLine(
    `[accordo-browser] registered ${allBrowserTools.length} browser MCP tools${options.modeLabel ? ` (${options.modeLabel})` : ""}`,
  );

  registerBrowserNotifier(options.context, options.out, options.relay);

  const scheduler = new BrowserCommentSyncScheduler(options.relay, options.bridge, options.out);
  scheduler.start();
  options.context.subscriptions.push({ dispose: () => scheduler.stop() });
}
