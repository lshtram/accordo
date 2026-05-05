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
import type { AccordoComment, CommentThread } from "@accordo/bridge-types";
import type { BrowserRelayAction } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal relay interface required by the notifier — must be able to push
 * actions to the Chrome extension.
 */
export interface PushableRelay {
  push(action: string, payload: Record<string, unknown>): void;
}

type BrowserNotifierSource = "accordo-browser-notifier";

function isHttpUri(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

function getAnchorKey(comment: AccordoComment): string {
  return comment.context?.surfaceMetadata?.["anchorKey"] ?? "body:center";
}

function pushBestEffort(relay: PushableRelay, action: string, payload: Record<string, unknown>): void {
  try {
    relay.push(action, payload);
  } catch {
    // push is best-effort
  }
}

function pushBrowserThreadCreate(relay: PushableRelay, thread: CommentThread, comment: AccordoComment): void {
  pushBestEffort(relay, "create_comment", {
    source: "accordo-browser-notifier" satisfies BrowserNotifierSource,
    url: thread.anchor.uri,
    threadId: thread.id,
    commentId: comment.id,
    body: comment.body,
    authorName: comment.author.name,
    anchorKey: getAnchorKey(comment),
  });
}

function pushBrowserThreadReply(relay: PushableRelay, thread: CommentThread, comment: AccordoComment): void {
  pushBestEffort(relay, "reply_comment", {
    source: "accordo-browser-notifier" satisfies BrowserNotifierSource,
    threadId: thread.id,
    commentId: comment.id,
    body: comment.body,
    authorName: comment.author.name,
  });
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
      addThread(thread: CommentThread): void;
      updateThread(thread: CommentThread): void;
      removeThread(threadId: string): void;
      scheduleWakeup?(action: "request_comment_state_sync", payload?: unknown): void;
    }) => { dispose(): void };
  } | undefined;
  if (!commentsExports?.registerBrowserNotifier) {
    out.appendLine("[accordo-browser] accordo-comments not installed — no registerBrowserNotifier export");
    return undefined;
  }
  const sub = commentsExports.registerBrowserNotifier({
    addThread(thread: CommentThread) {
      const url = thread.anchor.uri;
      if (!isHttpUri(url)) return;
      // Full-state sync wakeup — browser extension will do sync_comment_state
      pushBestEffort(relay, "request_comment_state_sync", { url });
    },
    updateThread(thread: CommentThread) {
      const url = thread.anchor.uri;
      if (!isHttpUri(url)) return;
      // Full-state sync wakeup — browser extension will do sync_comment_state
      pushBestEffort(relay, "request_comment_state_sync", { url });
    },
    removeThread(threadId: string) {
      // Full-state sync wakeup — browser extension will do sync_comment_state
      pushBestEffort(relay, "request_comment_state_sync", { threadId });
    },
    scheduleWakeup(action: "request_comment_state_sync", payload?: unknown) {
      // Immediate browser full-state sync — browser extension will do sync_comment_state
      pushBestEffort(relay, "request_comment_state_sync", (payload as Record<string, unknown>) ?? {});
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
      return { toolName: "comment_list", args: { scope: { modality: "browser" } } };

    case "get_comments": {
      const url = payload["url"] as string | undefined;
      return {
        toolName: "comment_list",
        args: url
          ? { scope: { modality: "browser", url } }
          : { scope: { modality: "browser" } },
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
                    ...(payload["anchorContext"] && typeof payload["anchorContext"] === "object"
                      ? Object.fromEntries(
                          Object.entries(payload["anchorContext"] as Record<string, unknown>).flatMap(([key, value]) =>
                            typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                              ? [[key, String(value)]]
                              : [],
                          ),
                        )
                      : {}),
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
