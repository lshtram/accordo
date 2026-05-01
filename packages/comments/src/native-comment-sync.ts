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

// ── Stable error vocabulary (M36-CS-13) ────────────────────────────────────

export type MutationErrorCode =
  | "invalid-thread-id"
  | "invalid-comment-id"
  | "duplicate-thread-id"
  | "duplicate-comment-id"
  | "thread-not-found"
  | "comment-not-found"
  | "thread-already-resolved"
  | "thread-not-resolved";

// ── Public types ─────────────────────────────────────────────────────────────

export interface NativeCommentSyncState {
  readonly storeThreadIds: readonly string[];
  readonly nativeWidgetIds: readonly string[];
  readonly missingWidgetIds: readonly string[];
  readonly orphanWidgetIds: readonly string[];
  readonly inSync: boolean;
}

export interface NativeCommentReconcileReport extends NativeCommentSyncState {
  readonly createdWidgetIds: readonly string[];
  readonly updatedWidgetIds: readonly string[];
  readonly removedWidgetIds: readonly string[];
}

const INTENT_LABEL: Record<string, string> = {
  fix: "🔧 fix",
  explain: "💡 explain",
  refactor: "♻️ refactor",
  review: "👀 review",
  design: "🎨 design",
  question: "❓ question",
};

// ── ID validation helpers ─────────────────────────────────────────────────────

/** Trim then check — "" or whitespace-only is invalid. */
function isValidId(id: string | undefined): boolean {
  if (id === undefined) return true; // optional, not provided
  return id.trim().length > 0;
}

/** Normalize empty/whitespace optional ID to undefined for caller-supplied IDs. */
function normalizeOptionalId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (id.trim().length === 0) return undefined;
  return id;
}

// ── Sync class ────────────────────────────────────────────────────────────────

export class NativeCommentSync {
  constructor(private readonly _ctrl: NativeCommentController) {}

  reconcile(storeThreads: readonly CommentThread[]): NativeCommentReconcileReport {
    const storeIdSet = new Set(storeThreads.map((t) => t.id));
    const widgetIds = Array.from(this._ctrl.widgets.keys());
    const widgetIdSet = new Set(widgetIds);

    // ── Classify each widget ────────────────────────────────────────────────
    const missingWidgetIds: string[] = [];
    const orphanWidgetIds: string[] = [];
    const updatedWidgetIds: string[] = [];
    const createdWidgetIds: string[] = [];

    // Orphans: widget IDs not in store
    for (const wId of widgetIds) {
      if (!storeIdSet.has(wId)) {
        orphanWidgetIds.push(wId);
      }
    }

    // Store threads: create missing, update changed
    for (const thread of storeThreads) {
      const existingWidget = this._ctrl.widgets.get(thread.id);

      if (!existingWidget) {
        // Missing widget — create it
        missingWidgetIds.push(thread.id);
        createdWidgetIds.push(thread.id);
        this._ctrl.createWidget(thread);
      } else {
        // Existing widget — check if it needs updating
        const needsUpdate = this._widgetNeedsUpdate(existingWidget, thread);
        if (needsUpdate) {
          updatedWidgetIds.push(thread.id);
          this._ctrl.createWidget(thread); // dispose+recreate with new state
        }
      }
    }

    // Remove orphan widgets
    for (const orphanId of orphanWidgetIds) {
      const widget = this._ctrl.widgets.get(orphanId);
      if (widget) {
        widget.dispose();
        this._ctrl.widgets.delete(orphanId);
      }
    }

    const remainingWidgetIds = Array.from(this._ctrl.widgets.keys());
    const inSync =
      this.getSyncState(storeThreads).inSync;

    return {
      storeThreadIds: storeThreads.map((t) => t.id),
      nativeWidgetIds: remainingWidgetIds,
      missingWidgetIds,
      orphanWidgetIds,
      inSync,
      createdWidgetIds,
      updatedWidgetIds,
      removedWidgetIds: orphanWidgetIds,
    };
  }

  getSyncState(storeThreads: readonly CommentThread[]): NativeCommentSyncState {
    const storeIdSet = new Set(storeThreads.map((t) => t.id));
    const widgetIds = Array.from(this._ctrl.widgets.keys());

    const missingWidgetIds: string[] = [];
    const orphanWidgetIds: string[] = [];

    for (const thread of storeThreads) {
      if (!this._ctrl.widgets.has(thread.id)) {
        missingWidgetIds.push(thread.id);
      }
    }

    for (const wId of widgetIds) {
      if (!storeIdSet.has(wId)) {
        orphanWidgetIds.push(wId);
      }
    }

    return {
      storeThreadIds: storeThreads.map((t) => t.id),
      nativeWidgetIds: widgetIds,
      missingWidgetIds,
      orphanWidgetIds,
      inSync: missingWidgetIds.length === 0 && orphanWidgetIds.length === 0,
    };
  }

  // ── Widget comparison ─────────────────────────────────────────────────────

  private _widgetNeedsUpdate(widget: vscode.CommentThread, thread: CommentThread): boolean {
    // Comment count changed
    if (widget.comments.length !== thread.comments.length) return true;

    // Status/state changed
    const expectedState =
      thread.status === "resolved"
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
    if (widget.state !== expectedState) return true;

    // Comment content changed (compare last-comment body as proxy for any change)
    const lastComment = thread.comments[thread.comments.length - 1];
    const lastWidgetComment = widget.comments[widget.comments.length - 1];
    if (!lastComment || !lastWidgetComment) return true;
    // widget.comments[].body is vscode.MarkdownString (set by buildVsComment), not a plain
    // string. Extract .value before comparing to the store's plain string body, otherwise
    // the comparison is always string !== object → always true → infinite dispose+recreate loop.
    const widgetBody =
      typeof lastWidgetComment.body === "string"
        ? lastWidgetComment.body
        : (lastWidgetComment.body as { value: string }).value;
    if (lastComment.body !== widgetBody) return true;

    // Range changed
    if (thread.anchor.kind === "text") {
      const expectedRange = new vscode.Range(
        (thread.anchor as CommentAnchorText).range.startLine,
        (thread.anchor as CommentAnchorText).range.startChar,
        (thread.anchor as CommentAnchorText).range.endLine,
        (thread.anchor as CommentAnchorText).range.endChar,
      );
      if (
        widget.range?.start.line !== expectedRange.start.line ||
        widget.range?.end.line !== expectedRange.end.line
      ) {
        return true;
      }
    }

    return false;
  }

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
