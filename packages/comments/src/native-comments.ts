/**
 * NativeComments — Slim facade over NativeCommentController + NativeCommentSync.
 *
 * Preserves the exact same class API so all existing consumers are unaffected.
 * Exported: comments-bootstrap.ts, bridge-integration.ts, panel-bootstrap.ts
 *
 * Source: comments-architecture.md §2.1, §9, §10.1
 */

import type * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { CommentThread, CommentAnchor } from "@accordo/bridge-types";
import { NativeCommentController } from "./native-comment-controller.js";
import type { NativeCommentsHandle } from "./native-comment-controller.js";
import { NativeCommentSync } from "./native-comment-sync.js";

// ── Public re-exports ─────────────────────────────────────────────────────────

export type { NativeCommentsHandle } from "./native-comment-controller.js";

// ── Slim facade ────────────────────────────────────────────────────────────────

export class NativeComments {
  private readonly _ctrl = new NativeCommentController();
  private readonly _sync = new NativeCommentSync(this._ctrl);

  init(
    store: CommentStore,
    context: { subscriptions: Array<{ dispose(): void }> },
  ): NativeCommentsHandle {
    const handle = this._ctrl.init(store, context);
    return handle;
  }

  restoreThreads(threads: CommentThread[]): void {
    this._sync.restoreThreads(threads);
  }

  addThread(thread: CommentThread): void {
    this._sync.addThread(thread);
  }

  updateThread(thread: CommentThread): void {
    this._sync.updateThread(thread);
  }

  removeThread(threadId: string): void {
    this._sync.removeThread(threadId);
  }

  markStale(threadId: string): void {
    this._sync.markStale(threadId);
  }

  updateThreadRange(threadId: string, anchor: CommentAnchor): void {
    this._sync.updateThreadRange(threadId, anchor);
  }

  registerCommands(
    store: CommentStore,
    context: { subscriptions: Array<{ dispose(): void }> },
  ): void {
    this._ctrl.registerCommands(store, context, {
      updateThread: (t) => this._sync.updateThread(t),
      removeThread: (id) => this._sync.removeThread(id),
      getThread: (id) => store.getThread(id),
      removeThreads: (ids) => this._sync.removeThreads(ids),
    });
  }

  getController(): vscode.CommentController {
    return this._ctrl.getController();
  }

  /** Look up the store threadId for a VSCode widget. */
  getThreadIdForWidget(widget: vscode.CommentThread): string | undefined {
    return this._ctrl.getThreadIdForWidget(widget);
  }
}
