/**
 * URI normalizer and external fanout notifier interfaces.
 *
 * Source: comments-architecture.md §6
 *
 * NOTIFIER ARCHITECTURE (comments-sync-hardening):
 *   - NativeComments receives store mutations ONLY via the canonical path:
 *     store mutation → store.onChanged → nc.reconcile(store.getAllThreads())
 *   - MCP mutation handlers notify ONLY external observers (e.g. browser relay)
 *     via an ExternalFanoutNotifier — never via direct native widget mutation.
 *   - ExternalFanoutNotifier is constructed WITHOUT NativeComments as primary.
 *   - Browser notifiers are registered via registerBrowserNotifier() and
 *     added to the external fanout only.
 */

import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { CommentThread } from "@accordo/bridge-types";

// ── URI normalizer ────────────────────────────────────────────────────────────

/**
 * Normalize any agent-supplied URI string into a canonical `file:///abs/path` URI.
 *
 * Accepts three input forms:
 *   - `file:///abs/path/to/file.ts`  — already canonical, re-normalized for safety
 *   - `/abs/path/to/file.ts`          — absolute FS path → converted to file URI
 *   - `relative/path/to/file.ts`      — resolved against workspaceRoot, then file URI
 *
 * Exported for unit testing and agent helper use.
 */
export function normalizeCommentUri(input: string, workspaceRoot: string): string {
  if (input.startsWith("file://")) {
    try {
      return pathToFileURL(path.resolve(fileURLToPath(input))).href;
    } catch {
      return input; // malformed URI — pass through unchanged
    }
  }
  if (path.isAbsolute(input)) {
    return pathToFileURL(path.resolve(input)).href;
  }
  // relative path — resolve against workspace root
  const base = workspaceRoot || process.cwd();
  return pathToFileURL(path.resolve(base, input)).href;
}

// ── External fanout notifier interfaces ───────────────────────────────────────

/**
 * External fanout notifier interface for browser sync wakeup.
 *
 * scheduleWakeup is the Phase C seam for full-state browser sync wakeup.
 * After any mutation that affects browser-visible state, the mutation handler
 * calls _external.scheduleWakeup("request_comment_state_sync") to trigger
 * a browser → Accordo full-state sync.
 */
export interface CommentUINotifier {
  addThread(thread: CommentThread): void;
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
  /**
   * Remove multiple CommentThread widgets at once.
   * Used by bulk deleteScope to propagate removals for all deleted threads.
   */
  removeThreads(threadIds: string[]): void;
  /**
   * Schedule a browser full-state sync wakeup.
   * Called by mutation handlers after successful mutations to trigger a
   * full-state sync via the browser extension's request_comment_state_sync
   * control action.
   */
  scheduleWakeup(action: "request_comment_state_sync", payload?: unknown): void;
}

/**
 * Fans out CommentUINotifier calls to multiple registered external notifiers.
 *
 * This notifier is used ONLY for external fanout (browser relay, etc.).
 * It is NEVER constructed with NativeComments as a member — native widget
 * mutation always happens via store.onChanged → nc.reconcile().
 *
 * Usage:
 *   const externalFanout = new ExternalFanoutNotifier();
 *   registerBrowserNotifier(myBrowserRelay) → externalFanout.add(notifier)
 *   createCommentTools(store, externalFanout) → handlers notify externalFanout only
 */
export class ExternalFanoutNotifier implements CommentUINotifier {
  private readonly _notifiers: CommentUINotifier[] = [];

  add(notifier: CommentUINotifier): { dispose(): void } {
    this._notifiers.push(notifier);
    return {
      dispose: () => {
        const i = this._notifiers.indexOf(notifier);
        if (i >= 0) this._notifiers.splice(i, 1);
      },
    };
  }

  addThread(thread: CommentThread): void {
    for (const n of this._notifiers) n.addThread(thread);
  }

  updateThread(thread: CommentThread): void {
    for (const n of this._notifiers) n.updateThread(thread);
  }

  removeThread(threadId: string): void {
    for (const n of this._notifiers) n.removeThread(threadId);
  }

  removeThreads(threadIds: string[]): void {
    for (const n of this._notifiers) n.removeThreads(threadIds);
  }

  scheduleWakeup(action: "request_comment_state_sync", payload?: unknown): void {
    for (const n of this._notifiers) {
      if ("scheduleWakeup" in n && typeof n.scheduleWakeup === "function") {
        n.scheduleWakeup(action, payload);
      }
    }
  }
}
