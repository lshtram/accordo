import type * as vscode from "vscode";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { SnapshotRetentionStore } from "./snapshot-retention.js";
import { ScreenshotRetentionStore } from "./screenshot-retention.js";
import { buildBrowserTools } from "./tool-assembly.js";
import { registerBrowserNotifier, browserActionToUnifiedTool } from "./comment-notifier.js";
import { normalizeReadResult } from "./comment-relay-contract.js";
import { BrowserCommentSyncScheduler } from "./comment-sync.js";
import { EXTENSION_ID, getSecurityConfig } from "./relay-lifecycle-primitives.js";

const MUTATING = ["create_comment", "reply_comment", "resolve_thread", "reopen_thread", "delete_comment", "delete_thread"] as const;

interface RelayRequestHandlerOptions<TRelay extends BrowserRelayLike> {
  out: vscode.OutputChannel;
  bridge: BrowserBridgeAPI;
  getRelay: () => TRelay;
  logLabel?: string;
  logMappingDetails?: boolean;
  includeInvokeErrorData?: boolean;
  handleBrowserComment?: (
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    relay: TRelay,
    correlationId?: string,
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

    if (options.handleBrowserComment) {
      return options.handleBrowserComment(action, payload, options.getRelay());
    }

    const mapped = browserActionToUnifiedTool(action, payload);
    if (!mapped) {
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
        options.getRelay().push("notify_comments_updated", url ? { url } : {});
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
  const allBrowserTools = buildBrowserTools(options.relay, snapshotStore, securityConfig, screenshotStore);

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
