/**
 * comment-notifier.ts — Browser Comment Notifier Registration
 *
 * Extracts the notifier registration and action-to-tool mapping from
 * extension.ts into a focused module. Handles:
 *   - Registering a browser notifier with accordo-comments extension
 *   - Pure mapping from Chrome relay actions to unified comment_* tools
 *
 * Rules:
 *   - `registerBrowserNotifier` performs the runtime comments-availability
 *     guard internally
 *   - pure mapping stays separate from VS Code side effects
 *
 * @module
 */

import * as vscode from "vscode";
import type { BrowserRelayAction } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal relay interface required by the notifier — must be able to push
 * actions to the Chrome extension.
 */
export interface PushableRelay {
  push(action: string, payload: Record<string, unknown>): void;
}

// ── Notifier Registration ────────────────────────────────────────────────────

/**
 * Register a browser notifier with the accordo-comments extension so that
 * agent-created comment mutations trigger Chrome popup refresh without
 * subscribing to every document-change event.
 *
 * SUB-01..SUB-03: registerBrowserNotifier is called during activation when
 * the accordo-comments extension is available and exports the API.
 *
 * @param context - The VS Code extension context (for subscription management)
 * @param out     - Output channel for logging
 * @param relay   - A relay that supports `push()` for sending notifications
 * @returns A disposable if the notifier was registered, `undefined` if
 *          the comments extension is not available
 */
export function registerBrowserNotifier(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  relay: PushableRelay,
): vscode.Disposable | undefined {
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (!commentsExt) {
    out.appendLine("[accordo-browser] accordo-comments not installed — skipping notifier registration");
    return undefined;
  }
  const commentsExports = commentsExt.exports as {
    registerBrowserNotifier?: (notifier: {
      addThread(thread: { anchor: { uri: string } }): void;
      updateThread(thread: { anchor: { uri: string } }): void;
      removeThread(threadId: string): void;
    }) => { dispose(): void };
  } | undefined;
  if (!commentsExports?.registerBrowserNotifier) {
    out.appendLine("[accordo-browser] accordo-comments not installed — no registerBrowserNotifier export");
    return undefined;
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
  return sub;
}

// ── Action-to-Tool Mapping ───────────────────────────────────────────────────

/**
 * Map a Chrome browser relay action to the corresponding unified comment_* tool.
 * Returns `{ toolName, args }` or `null` if the action has no corresponding tool.
 *
 * This is a pure function — no side effects.
 *
 * @param action  - The relay action name from Chrome
 * @param payload - The action payload from Chrome
 */
export function browserActionToUnifiedTool(
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

    case "focus_thread": {
      const threadId = payload["threadId"] as string | undefined;
      if (!threadId) return null;
      return { toolName: "accordo_browser.focusThread", args: { threadId } };
    }

    default:
      return null;
  }
}