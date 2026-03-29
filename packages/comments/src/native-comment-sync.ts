/**
 * native-comment-sync — Bidirectional sync: CommentStore ↔ VSCode thread widgets.
 *
 * Owns the algorithm for applying store state to VSCode CommentThread widgets
 * (restore, add, update, remove, mark stale, range adjust).
 *
 * Source: comments-architecture.md §9, §10.1
 */

import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type {
  CommentThread,
  CommentAnchor,
  CommentAnchorText,
  CommentAnchorSurface,
  SlideCoordinates,
  AccordoComment,
} from "@accordo/bridge-types";
import type { NativeCommentController } from "./native-comment-controller.js";

const INTENT_LABEL: Record<string, string> = {
  fix: "🔧 fix",
  explain: "💡 explain",
  refactor: "♻️ refactor",
  review: "👀 review",
  design: "🎨 design",
  question: "❓ question",
};

// ── Sync class ────────────────────────────────────────────────────────────────

export class NativeCommentSync {
  constructor(private readonly _ctrl: NativeCommentController) {}

  // ── Public sync API ─────────────────────────────────────────────────────────

  /**
   * Restore persisted text-anchored threads as VSCode CommentThread widgets.
   * Skips surface-anchored threads (handled by Comment SDK when webview opens).
   */
  restoreThreads(threads: CommentThread[]): void {
    for (const thread of threads) {
      this._ctrl.createWidget(thread);
    }
  }

  /** Create a VSCode CommentThread widget for a new thread. */
  addThread(thread: CommentThread): void {
    this._ctrl.createWidget(thread);
  }

  /** Update a VSCode CommentThread widget (e.g. after reply, resolve). */
  updateThread(thread: CommentThread): void {
    const widget = this._ctrl.widgets.get(thread.id);
    if (!widget) return;
    widget.comments = thread.comments.map(c => this._buildVsComment(c, thread.status));
    widget.contextValue = thread.status;
    const intent = thread.comments[0]?.intent;
    if (thread.status === "resolved") {
      widget.state = vscode.CommentThreadState.Resolved;
      widget.label = intent ? `✓ Resolved  ·  ${INTENT_LABEL[intent] ?? intent}` : "✓ Resolved";
      widget.canReply = false;
      widget.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    } else {
      widget.state = vscode.CommentThreadState.Unresolved;
      widget.label = intent ? INTENT_LABEL[intent] ?? intent : undefined;
      widget.canReply = { name: "You" };
    }
  }

  /** Remove a VSCode CommentThread widget. */
  removeThread(threadId: string): void {
    const widget = this._ctrl.widgets.get(threadId);
    if (widget) {
      widget.dispose();
      this._ctrl.widgets.delete(threadId);
    }
  }

  /** Remove multiple VSCode CommentThread widgets. */
  removeThreads(threadIds: string[]): void {
    for (const id of threadIds) {
      this.removeThread(id);
    }
  }

  /**
   * Mark a thread's widget as visually stale.
   * Source: comments-architecture.md §9.2
   */
  markStale(threadId: string): void {
    const widget = this._ctrl.widgets.get(threadId);
    if (widget) {
      widget.label = "⚠ Context may have changed";
    }
  }

  /** Update thread widget range after a line-shift adjustment. */
  updateThreadRange(threadId: string, anchor: CommentAnchor): void {
    const widget = this._ctrl.widgets.get(threadId);
    if (!widget) return;
    if (anchor.kind !== "text") return;
    const { startLine, startChar, endLine, endChar } = (anchor as CommentAnchorText).range;
    widget.range = new vscode.Range(startLine, startChar, endLine, endChar);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _buildVsComment(c: AccordoComment, _threadStatus: string): vscode.Comment {
    const isAgent = c.author.kind === "agent";
    return {
      body: new vscode.MarkdownString(c.body),
      mode: vscode.CommentMode.Preview,
      author: {
        name: c.author.name,
        iconPath: new vscode.ThemeIcon(isAgent ? "robot" : "person") as unknown as vscode.Uri,
      },
      label: c.intent ? (INTENT_LABEL[c.intent] ?? c.intent) : undefined,
      timestamp: new Date(c.createdAt),
      contextValue: "comment",
      threadId: c.threadId,
      commentId: c.id,
    } as vscode.Comment;
  }
}
