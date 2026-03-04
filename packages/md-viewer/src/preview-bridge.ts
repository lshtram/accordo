/**
 * PreviewBridge — wires the webview's postMessage channel to the CommentStore.
 *
 * Responsibilities:
 *   - On construction: subscribe to store's onChanged event
 *   - loadThreadsForUri(): push comments:load to the webview on open
 *   - handleMessage(): route incoming webview messages to store mutations
 *   - On store change: push updated threads to the webview
 *   - dispose(): clean up store subscription
 *
 * Source: M41b — PreviewBridge
 *
 * Requirements:
 *   M41b-PBR-01  Subscribes to store.onChanged on construction
 *   M41b-PBR-02  loadThreadsForUri() sends comments:load to webview
 *   M41b-PBR-03  comment:create message → store.createThread() + push add
 *   M41b-PBR-04  comment:reply message → store.reply() + push update
 *   M41b-PBR-05  comment:resolve message → store.resolve() + push update
 *   M41b-PBR-06  comment:delete message → store.delete() + push remove
 *   M41b-PBR-07  store onChanged → push updated threads for current URI
 *   M41b-PBR-08  dispose() unregisters from store events
 *   M41b-PBR-09  Unknown message type → no throw (error logged)
 */

import type { CommentThread } from "@accordo/bridge-types";
import type { BlockCoordinates } from "@accordo/bridge-types";

// ── CommentStoreLike — minimal interface needed from accordo-comments ─────────

export interface CommentStoreLike {
  createThread(args: { uri: string; blockId: string; body: string; intent?: string }): Promise<CommentThread>;
  reply(args: { threadId: string; body: string }): Promise<void>;
  resolve(args: { threadId: string; resolutionNote?: string }): Promise<void>;
  reopen(args: { threadId: string }): Promise<void>;
  delete(args: { threadId: string; commentId?: string }): Promise<void>;
  getThreadsForUri(uri: string): CommentThread[];
  /** Listener fires after a mutation for the specified URI. */
  onChanged(listener: (uri: string) => void): { dispose(): void };
}
import type { SdkThread, WebviewMessage, HostMessage } from "@accordo/comment-sdk";

// ── WebviewPanel interface (injected, avoids hard VSCode dep in tests) ────────

export interface WebviewLike {
  /** Post a message into the webview. */
  postMessage(message: HostMessage): void;
  /** Receive a message sent from the webview via vscode.postMessage(). */
  onDidReceiveMessage: OnDidReceiveMessageEvent;
}

export interface OnDidReceiveMessageEvent {
  (listener: (msg: WebviewMessage) => void): { dispose(): void };
}

// ── SdkThread conversion helper (exported for testing) ───────────────────────

/**
 * Convert a CommentStore thread into the slim SdkThread model the SDK expects.
 * @param thread       Full CommentThread from the store
 * @param loadedAt     ISO 8601 timestamp when the preview was opened (for hasUnread)
 */
export function toSdkThread(thread: CommentThread, loadedAt: string): SdkThread {
  const anchor = thread.anchor;
  // Extract blockId from surface-type block-coordinate anchor
  const blockId =
    anchor.kind === "surface"
      ? ((anchor.coordinates as BlockCoordinates).blockId ?? "")
      : "";

  return {
    id: thread.id,
    blockId,
    status: thread.status,
    hasUnread: thread.lastActivity > loadedAt,
    comments: thread.comments.map((c) => ({
      id: c.id,
      author: c.author
        ? { kind: c.author.kind, name: c.author.name }
        : { kind: "user" as const, name: "" },
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}

// ── PreviewBridge class ───────────────────────────────────────────────────────

export class PreviewBridge {
  private readonly _store: CommentStoreLike;
  private readonly _webview: WebviewLike;
  private readonly _uri: string;
  private readonly _loadedAt: string;
  private _storeDisposable: { dispose(): void } | undefined;
  private _msgDisposable: { dispose(): void } | undefined;

  constructor(store: CommentStoreLike, webview: WebviewLike, uri: string) {
    this._store = store;
    this._webview = webview;
    this._uri = uri;
    this._loadedAt = new Date().toISOString();
    this._init();
  }

  /** M41b-PBR-01 — subscribe to store changes during construction */
  private _init(): void {
    this._storeDisposable = this._store.onChanged((changedUri: string) => {
      if (changedUri === this._uri) this._pushLoad();
    });
    this._msgDisposable = this._webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg);
    });
  }

  /** Push the current threads for this URI to the webview. */
  private _pushLoad(): void {
    const rawThreads = this._store.getThreadsForUri(this._uri);
    const threads = rawThreads.map((t) => toSdkThread(t, this._loadedAt));
    this._webview.postMessage({ type: "comments:load", threads });
  }

  /**
   * M41b-PBR-02
   * Send all existing threads for the current URI to the webview via comments:load.
   * Call this when the webview first becomes ready.
   */
  loadThreadsForUri(): void {
    this._pushLoad();
  }

  /**
   * M41b-PBR-03 through M41b-PBR-09
   * Route an incoming webview message to the appropriate store operation.
   * Returns a promise that resolves when the store mutation (if any) completes.
   */
  async handleMessage(msg: WebviewMessage): Promise<void> {
    try {
      if (msg.type === "comment:create") {
        await this._store.createThread({
          uri: this._uri,
          blockId: msg.blockId,
          body: msg.body,
          intent: msg.intent,
        });
      } else if (msg.type === "comment:reply") {
        await this._store.reply({ threadId: msg.threadId, body: msg.body });
      } else if (msg.type === "comment:resolve") {
        await this._store.resolve({
          threadId: msg.threadId,
          resolutionNote: msg.resolutionNote,
        });
      } else if (msg.type === "comment:reopen") {
        await this._store.reopen({ threadId: msg.threadId });
      } else if (msg.type === "comment:delete") {
        await this._store.delete({ threadId: msg.threadId, commentId: msg.commentId });
      }
      // else: unknown message type — silently ignore (M41b-PBR-09)
    } catch (err) {
      console.error("[PreviewBridge] handleMessage error:", err);
    }
  }

  /**
   * M41b-PBR-08
   * Unsubscribe from store events and webview message listener.
   */
  dispose(): void {
    this._storeDisposable?.dispose();
    this._msgDisposable?.dispose();
  }
}
