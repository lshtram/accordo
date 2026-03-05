/**
 * NativeComments — VSCode Comments API adapter.
 *
 * Creates and manages the CommentController, gutter icons, inline thread
 * widgets, Comments panel entries. Syncs bidirectionally with CommentStore.
 *
 * Source: comments-architecture.md §2.1, §9, §10.1
 */

import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { CommentThread, CommentAnchor, CommentAnchorText, CommentAnchorSurface, AccordoComment } from "@accordo/bridge-types";

// ── Intent label map ──────────────────────────────────────────────────────────

const INTENT_LABEL: Record<string, string> = {
  fix: "🔧 fix",
  explain: "💡 explain",
  refactor: "♻️ refactor",
  review: "👀 review",
  design: "🎨 design",
  question: "❓ question",
};

// ── Public types ─────────────────────────────────────────────────────────────

/** Opaque handle to the native comment system. */
export interface NativeCommentsHandle {
  controller: vscode.CommentController;
  dispose(): void;
}

// ── NativeComments class ─────────────────────────────────────────────────────

export class NativeComments {
  private _controller: vscode.CommentController | undefined;
  /** Maps threadId → VSCode CommentThread widget */
  private readonly _widgets = new Map<string, vscode.CommentThread>();

  /**
   * Initialize the native Comments API integration.
   * Creates the CommentController and enables gutter "+" icons on all files.
   */
  init(
    _store: CommentStore,
    context: { subscriptions: Array<{ dispose(): void }> },
  ): NativeCommentsHandle {
    const controller = vscode.comments.createCommentController(
      "accordo-comments",
      "Accordo Comments",
    );

    // Input box UX: collapsed label + focused placeholder
    controller.options = {
      prompt: "Add a comment…",
      placeHolder: "Write a comment (Markdown supported). Press ⌘↩ / Ctrl+Enter to save.",
    };

    controller.commentingRangeProvider = {
      provideCommentingRanges(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
      ): vscode.Range[] {
        return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
      },
    };

    this._controller = controller;
    context.subscriptions.push(controller);

    return {
      controller,
      dispose: () => controller.dispose(),
    };
  }

  /**
   * Restore persisted text-anchored threads as VSCode CommentThread widgets.
   * Skips surface-anchored threads (handled by Comment SDK when webview opens).
   */
  restoreThreads(threads: CommentThread[]): void {
    for (const thread of threads) {
      this._createWidget(thread);
    }
  }

  /**
   * Create a VSCode CommentThread widget for a new thread.
   */
  addThread(thread: CommentThread): void {
    this._createWidget(thread);
  }

  /**
   * Update a VSCode CommentThread widget (e.g. after reply, resolve).
   */
  updateThread(thread: CommentThread): void {
    const widget = this._widgets.get(thread.id);
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

  /**
   * Remove a VSCode CommentThread widget.
   */
  removeThread(threadId: string): void {
    const widget = this._widgets.get(threadId);
    if (widget) {
      widget.dispose();
      this._widgets.delete(threadId);
    }
  }

  /**
   * Mark a thread's widget as visually stale.
   * Source: comments-architecture.md §9.2
   */
  markStale(threadId: string): void {
    const widget = this._widgets.get(threadId);
    if (widget) {
      widget.label = "⚠ Context may have changed";
    }
  }

  /**
   * Update thread widget range after a line-shift adjustment.
   */
  updateThreadRange(threadId: string, anchor: CommentAnchor): void {
    const widget = this._widgets.get(threadId);
    if (!widget) return;
    if (anchor.kind !== "text") return;
    const { startLine, startChar, endLine, endChar } = (anchor as CommentAnchorText).range;
    widget.range = new vscode.Range(startLine, startChar, endLine, endChar);
  }

  /**
   * Register comment-related commands (resolve, reopen, delete, deleteComment).
   */
  registerCommands(
    store: CommentStore,
    context: { subscriptions: Array<{ dispose(): void }> },
  ): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "accordo.comments.resolveThread",
        async (vsThread: vscode.CommentThread) => {
          const threadId = this._getThreadIdForWidget(vsThread);
          if (!threadId) return;
          await store.resolve({
            threadId,
            resolutionNote: "Resolved via UI",
            author: { kind: "user", name: "User" },
          });
          this.updateThread(store.getThread(threadId)!);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.reopenThread",
        async (vsThread: vscode.CommentThread) => {
          const threadId = this._getThreadIdForWidget(vsThread);
          if (!threadId) return;
          await store.reopen(threadId, { kind: "user", name: "User" });
          this.updateThread(store.getThread(threadId)!);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.deleteThread",
        async (vsThread: vscode.CommentThread) => {
          const threadId = this._getThreadIdForWidget(vsThread);
          if (!threadId) return;
          await store.delete({ threadId });
          this.removeThread(threadId);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.deleteComment",
        async (vsComment: vscode.Comment) => {
          const threadId = (vsComment as unknown as { threadId?: string }).threadId;
          const commentId = (vsComment as unknown as { commentId?: string }).commentId;
          if (!threadId || !commentId) return;
          await store.delete({ threadId, commentId });
          // Refresh widget: if the thread still exists update it, otherwise remove it.
          const updated = store.getThread(threadId);
          if (updated) {
            this.updateThread(updated);
          } else {
            this.removeThread(threadId);
          }
        },
      ),
      // ── Comment-level resolve / reopen (for right-click in Comments panel) ────
      // comments/comment/context passes a vscode.Comment, not a CommentThread.
      // We read the threadId we embedded in _buildVsComment to find the store thread.
      vscode.commands.registerCommand(
        "accordo.comments.resolveFromComment",
        async (vsComment: vscode.Comment) => {
          const threadId = (vsComment as unknown as { threadId?: string }).threadId;
          if (!threadId) return;
          await store.resolve({
            threadId,
            resolutionNote: "Resolved via UI",
            author: { kind: "user", name: "User" },
          });
          const updated = store.getThread(threadId);
          if (updated) this.updateThread(updated);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.reopenFromComment",
        async (vsComment: vscode.Comment) => {
          const threadId = (vsComment as unknown as { threadId?: string }).threadId;
          if (!threadId) return;
          await store.reopen(threadId, { kind: "user", name: "User" });
          const updated = store.getThread(threadId);
          if (updated) this.updateThread(updated);
        },
      ),
      // ── Clean stale threads (files no longer exist on disk) ───────────────
      vscode.commands.registerCommand(
        "accordo.comments.cleanStale",
        async () => {
          const removed = await store.pruneStaleThreads(async (uri) => {
            try {
              await vscode.workspace.fs.stat(vscode.Uri.parse(uri));
              return true;
            } catch {
              return false;
            }
          });
          for (const id of removed) {
            this.removeThread(id);
          }
          void vscode.window.showInformationMessage(
            removed.length === 0
              ? "No stale comment threads found."
              : `Removed ${removed.length} stale comment thread${removed.length === 1 ? "" : "s"}.`,
          );
        },
      ),
      // ── Reply from Comments panel (uses input box) ─────────────────────────
      vscode.commands.registerCommand(
        "accordo.comments.replyFromPanel",
        async (arg: unknown) => {
          const threadId = this._resolveThreadId(arg);
          if (!threadId) return;
          const thread = store.getThread(threadId);
          if (!thread || thread.status === "resolved") return;
          const text = await vscode.window.showInputBox({
            prompt: "Reply to comment thread",
            placeHolder: "Write your reply…",
          });
          if (!text?.trim()) return;
          await store.reply({
            threadId,
            body: text,
            author: { kind: "user", name: "User" },
          });
          this.updateThread(store.getThread(threadId)!);
        },
      ),
      // ── Focus a comment thread in the Accordo Markdown Preview ─────────────
      vscode.commands.registerCommand(
        "accordo.comments.focusInPreview",
        async (arg: unknown) => {
          const threadId = this._resolveThreadId(arg);
          if (!threadId) return;
          const thread = store.getThread(threadId);
          if (!thread) return;
          const uri = thread.anchor.uri;

          // Extract blockId for surface anchors (markdown preview block comments)
          let blockId: string | undefined;
          if (thread.anchor.kind === "surface") {
            const surf = thread.anchor as CommentAnchorSurface;
            if (surf.coordinates.type === "block") {
              blockId = surf.coordinates.blockId;
            }
          }

          // Try the live webview panel first (works for ALL anchor types).
          // If a preview panel is already open the internal command returns true
          // and posts comments:focus — the webview will scroll to blockId or to
          // the pin element and open the popover.
          const focused: boolean = await vscode.commands.executeCommand(
            "accordo.preview.internal.focusThread",
            uri,
            threadId,
            blockId,
          );
          if (focused) return;

          // No live preview panel — for text-anchored threads fall back to the
          // text editor so the user still lands on the right line.
          if (thread.anchor.kind === "text") {
            const anchor = thread.anchor as CommentAnchorText;
            const lineRange = new vscode.Range(
              anchor.range.startLine, 0,
              anchor.range.startLine, 0,
            );
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
              const editor = await vscode.window.showTextDocument(doc, {
                selection: lineRange,
                preserveFocus: false,
              });
              editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            } catch {
              // Fall through to preview open below
            }
            return;
          }

          // Surface/file anchor with no live panel — open the preview and focus
          try {
            await vscode.commands.executeCommand(
              "vscode.openWith",
              vscode.Uri.parse(uri),
              "accordo.markdownPreview",
            );
          } catch {
            // File may already be open — proceed to focus anyway
          }
          // Allow the panel to initialize before sending the focus message
          await new Promise<void>((r) => setTimeout(r, 300));
          await vscode.commands.executeCommand(
            "accordo.preview.internal.focusThread",
            uri,
            threadId,
            blockId,
          );
        },
      ),
    );
  }

  /**
   * Get the underlying CommentController.
   */
  getController(): vscode.CommentController {
    if (!this._controller) throw new Error("NativeComments not initialized — call init() first");
    return this._controller;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build a VSCode Comment from an AccordoComment.
   * @param threadStatus  "open" | "resolved" — encoded into contextValue so
   *                      `view/item/context` `when` clauses can distinguish
   *                      between comments in open vs resolved threads.
   */
  private _buildVsComment(c: AccordoComment, threadStatus: string): vscode.Comment {
    const isAgent = c.author.kind === "agent";
    return {
      // Markdown body — code blocks, bold, links render in the panel
      body: new vscode.MarkdownString(c.body),
      mode: vscode.CommentMode.Preview,
      author: {
        name: c.author.name,
        // ThemeIcon is accepted at runtime in VS Code ≥1.100; @types/vscode@1.109 only
        // declares Uri, so we cast. "robot" for agent, "person" for human.
        iconPath: new vscode.ThemeIcon(isAgent ? "robot" : "person") as unknown as vscode.Uri,
      },
      // Intent as a per-comment badge label (fix / review / explain …)
      label: c.intent ? (INTENT_LABEL[c.intent] ?? c.intent) : undefined,
      // Timestamp shows "3 minutes ago" hover tooltip in the panel
      timestamp: new Date(c.createdAt),
      // contextValue enables per-comment menu items in the Comments panel.
      // Encode thread status so view/item/context can show Resolve vs Reopen.
      contextValue: threadStatus === "resolved" ? "comment-resolved" : "comment-open",
      // Embedded so VS Code round-trips them back to the deleteComment command handler.
      // vscode.Comment is a plain interface — extra properties survive the round-trip.
      threadId: c.threadId,
      commentId: c.id,
    } as vscode.Comment;
  }

  private _createWidget(thread: CommentThread): void {
    if (!this._controller) return;

    const uri = vscode.Uri.parse(thread.anchor.uri);
    let range: vscode.Range;

    if (thread.anchor.kind === "text") {
      const { startLine, startChar, endLine, endChar } = (thread.anchor as CommentAnchorText).range;
      range = new vscode.Range(startLine, startChar, endLine, endChar);
    } else {
      // file-level or surface anchor — use start-of-file range so VS Code
      // can navigate to the document from the Comments panel.
      range = new vscode.Range(0, 0, 0, 0);
    }

    const vsComments = thread.comments.map(c => this._buildVsComment(c, thread.status));
    const intent = thread.comments[0]?.intent;

    const widget = this._controller.createCommentThread(uri, range, vsComments);
    widget.contextValue = thread.status;
    if (thread.status === "resolved") {
      widget.state = vscode.CommentThreadState.Resolved;
      widget.label = intent ? `✓ Resolved  ·  ${INTENT_LABEL[intent] ?? intent}` : "✓ Resolved";
      widget.canReply = false;
      widget.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    } else {
      widget.state = vscode.CommentThreadState.Unresolved;
      widget.label = intent ? INTENT_LABEL[intent] ?? intent : undefined;
      widget.canReply = { name: "You" };
      widget.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
    this._widgets.set(thread.id, widget);
  }

  /** Look up the store threadId for a VSCode widget. Returns undefined for unsaved draft threads. */
  getThreadIdForWidget(widget: vscode.CommentThread): string | undefined {
    for (const [id, w] of this._widgets) {
      if (w === widget) return id;
    }
    return undefined;
  }

  private _getThreadIdForWidget(widget: vscode.CommentThread): string | undefined {
    return this.getThreadIdForWidget(widget);
  }

  /**
   * Extract store threadId from a command argument that may be either a
   * `vscode.CommentThread` (from thread-level tree items) or a
   * `vscode.Comment` (from comment-level tree items in the Comments panel).
   */
  private _resolveThreadId(arg: unknown): string | undefined {
    if (!arg || typeof arg !== "object") return undefined;
    // Case 1: it's a CommentThread in our widget map
    const fromWidget = this._getThreadIdForWidget(arg as vscode.CommentThread);
    if (fromWidget) return fromWidget;
    // Case 2: it's a Comment with embedded threadId
    const embedded = (arg as Record<string, unknown>).threadId;
    if (typeof embedded === "string") return embedded;
    return undefined;
  }
}
