/**
 * native-comment-controller — CommentController lifecycle.
 *
 * Creates and disposes the vscode.CommentController, registers gutter
 * icons, and owns the widget map (threadId → CommentThread widget).
 *
 * Source: comments-architecture.md §2.1, §9, §10.1
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
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";

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

/**
 * Callbacks from command handlers back into the sync layer.
 * Decouples the controller (which registers commands) from NativeCommentSync
 * (which owns the widget map).
 */
export interface SyncCallbacks {
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
  getThread(threadId: string): CommentThread | undefined;
  removeThreads(threadIds: string[]): void;
}

// ── Controller lifecycle ─────────────────────────────────────────────────────

export class NativeCommentController {
  private _controller: vscode.CommentController | undefined;
  /** Maps threadId → VSCode CommentThread widget */
  readonly widgets = new Map<string, vscode.CommentThread>();

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
   * Get the underlying CommentController.
   */
  getController(): vscode.CommentController {
    if (!this._controller) throw new Error("NativeComments not initialized — call init() first");
    return this._controller;
  }

  /**
   * Register comment-related commands (resolve, reopen, delete, deleteComment).
   */
  registerCommands(
    store: CommentStore,
    context: { subscriptions: Array<{ dispose(): void }> },
    sync: SyncCallbacks,
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
          const updated = sync.getThread(threadId);
          if (updated) sync.updateThread(updated);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.reopenThread",
        async (vsThread: vscode.CommentThread) => {
          const threadId = this._getThreadIdForWidget(vsThread);
          if (!threadId) return;
          await store.reopen(threadId, { kind: "user", name: "User" });
          const updated = sync.getThread(threadId);
          if (updated) sync.updateThread(updated);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.deleteThread",
        async (vsThread: vscode.CommentThread) => {
          const threadId = this._getThreadIdForWidget(vsThread);
          if (!threadId) return;
          await store.delete({ threadId });
          sync.removeThread(threadId);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.deleteComment",
        async (vsComment: vscode.Comment) => {
          const threadId = (vsComment as unknown as { threadId?: string }).threadId;
          const commentId = (vsComment as unknown as { commentId?: string }).commentId;
          if (!threadId || !commentId) return;
          await store.delete({ threadId, commentId });
          const updated = sync.getThread(threadId);
          if (updated) {
            sync.updateThread(updated);
          } else {
            sync.removeThread(threadId);
          }
        },
      ),
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
          const updated = sync.getThread(threadId);
          if (updated) sync.updateThread(updated);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.reopenFromComment",
        async (vsComment: vscode.Comment) => {
          const threadId = (vsComment as unknown as { threadId?: string }).threadId;
          if (!threadId) return;
          await store.reopen(threadId, { kind: "user", name: "User" });
          const updated = sync.getThread(threadId);
          if (updated) sync.updateThread(updated);
        },
      ),
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
          sync.removeThreads(removed);
          void vscode.window.showInformationMessage(
            removed.length === 0
              ? "No stale comment threads found."
              : `Removed ${removed.length} stale comment thread${removed.length === 1 ? "" : "s"}.`,
          );
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.replyFromPanel",
        async (arg: unknown) => {
          const threadId = this._resolveThreadId(arg);
          if (!threadId) return;
          const thread = sync.getThread(threadId);
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
          const updated = sync.getThread(threadId);
          if (updated) sync.updateThread(updated);
        },
      ),
      vscode.commands.registerCommand(
        "accordo.comments.focusInPreview",
        async (arg: unknown) => {
          const threadId = this._resolveThreadId(arg);
          if (!threadId) return;
          const thread = sync.getThread(threadId);
          if (!thread) return;
          const uri = thread.anchor.uri;

          let blockId: string | undefined;
          if (thread.anchor.kind === "surface") {
            const surf = thread.anchor as CommentAnchorSurface;
            if (surf.coordinates.type === "block") {
              blockId = surf.coordinates.blockId;
            }
          }

          const focused: boolean = await vscode.commands.executeCommand(
            CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
            uri,
            threadId,
            blockId,
          );
          if (focused) return;

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

          try {
            await vscode.commands.executeCommand(
              "vscode.openWith",
              vscode.Uri.parse(uri),
              "accordo.markdownPreview",
            );
          } catch {
            // File may already be open — proceed to focus anyway
          }
          await new Promise<void>((r) => setTimeout(r, 300));
          await vscode.commands.executeCommand(
            CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
            uri,
            threadId,
            blockId,
          );
        },
      ),
      vscode.commands.registerCommand(
        CAPABILITY_COMMANDS.COMMENTS_EXPAND_THREAD,
        (threadId: string): boolean => {
          const widget = this.widgets.get(threadId);
          if (widget) {
            widget.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
          }
          return !!widget;
        },
      ),
    );
  }

  // ── Widget construction helpers ─────────────────────────────────────────────

  /** Build a VSCode Comment from an AccordoComment. */
  buildVsComment(c: AccordoComment, _threadStatus: string): vscode.Comment {
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

  /** Create a VSCode CommentThread widget from a CommentThread. */
  createWidget(thread: CommentThread): void {
    if (!this._controller) return;

    const uri = vscode.Uri.parse(thread.anchor.uri);
    let range: vscode.Range;

    if (thread.anchor.kind === "text") {
      const { startLine, startChar, endLine, endChar } = (thread.anchor as CommentAnchorText).range;
      range = new vscode.Range(startLine, startChar, endLine, endChar);
    } else {
      range = new vscode.Range(0, 0, 0, 0);
    }

    const vsComments = thread.comments.map(c => this.buildVsComment(c, thread.status));
    const intent = thread.comments[0]?.intent;
    const slideTag = this._getSurfaceSlideTag(thread.anchor);

    const widget = this._controller.createCommentThread(uri, range, vsComments);
    widget.contextValue = thread.status;
    if (thread.status === "resolved") {
      widget.state = vscode.CommentThreadState.Resolved;
      const parts = ["✓ Resolved"];
      if (slideTag) parts.push(slideTag);
      if (intent) parts.push(INTENT_LABEL[intent] ?? intent);
      widget.label = parts.join("  ·  ");
      widget.canReply = false;
      widget.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    } else {
      widget.state = vscode.CommentThreadState.Unresolved;
      const parts: string[] = [];
      if (slideTag) parts.push(slideTag);
      if (intent) parts.push(INTENT_LABEL[intent] ?? intent);
      widget.label = parts.length > 0 ? parts.join("  ·  ") : undefined;
      widget.canReply = { name: "You" };
      widget.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
    this.widgets.set(thread.id, widget);
  }

  /** Extract a "Slide N" tag from a surface anchor if it has slide coordinates. */
  private _getSurfaceSlideTag(anchor: CommentAnchor): string | null {
    if (anchor.kind !== "surface") return null;
    const surface = anchor as CommentAnchorSurface;
    if (surface.coordinates.type === "slide") {
      return `Slide ${(surface.coordinates as SlideCoordinates).slideIndex + 1}`;
    }
    return surface.surfaceType === "slide" ? "Slide" : null;
  }

  // ── Widget lookup ───────────────────────────────────────────────────────────

  /** Look up the store threadId for a VSCode widget. */
  getThreadIdForWidget(widget: vscode.CommentThread): string | undefined {
    for (const [id, w] of this.widgets) {
      if (w === widget) return id;
    }
    return undefined;
  }

  private _getThreadIdForWidget(widget: vscode.CommentThread): string | undefined {
    return this.getThreadIdForWidget(widget);
  }

  /** Extract store threadId from a command argument. */
  private _resolveThreadId(arg: unknown): string | undefined {
    if (!arg || typeof arg !== "object") return undefined;
    const fromWidget = this._getThreadIdForWidget(arg as vscode.CommentThread);
    if (fromWidget) return fromWidget;
    const embedded = (arg as Record<string, unknown>).threadId;
    if (typeof embedded === "string") return embedded;
    return undefined;
  }
}
