/**
 * accordo-marp — Presentation Comments Bridge
 *
 * Source: requirements-marp.md §4 M50-CBR
 */

import type { SlideCoordinates, CommentAnchorSurface, CommentThread } from "@accordo/bridge-types";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type { SdkThread } from "@accordo/comment-sdk";

export function encodeBlockId(coords: SlideCoordinates): string {
  return `slide:${coords.slideIndex}:${coords.x.toFixed(4)}:${coords.y.toFixed(4)}`;
}

export function parseBlockId(blockId: string): SlideCoordinates | null {
  const match = /^slide:(\d+):([\d.]+):([\d.]+)$/.exec(blockId);
  if (!match) return null;
  const slideIndex = parseInt(match[1], 10);
  const x = parseFloat(match[2]);
  const y = parseFloat(match[3]);
  if (isNaN(slideIndex) || isNaN(x) || isNaN(y)) return null;
  return { type: "slide", slideIndex, x, y };
}

/**
 * Convert a store CommentThread into the SdkThread model the comment SDK webview expects.
 *
 * For surface anchors with slide coordinates → derives blockId via encodeBlockId.
 * For non-slide surface anchors or other anchor types → empty blockId (no pin rendered).
 *
 * hasUnread is derived conservatively: true when lastActivity > loadedAt.
 */
export function toSdkThread(thread: CommentThread, loadedAt: string): SdkThread {
  const anchor = thread.anchor;
  let blockId: string;

  if (anchor.kind === "surface" && anchor.surfaceType === "slide") {
    const coords = anchor.coordinates as SlideCoordinates;
    blockId = encodeBlockId(coords);
  } else {
    // Non-slide anchors (file, text, non-slide surfaces) cannot render pins on Marp slides.
    blockId = "";
  }

  return {
    id: thread.id,
    blockId,
    status: thread.status,
    hasUnread: thread.lastActivity > loadedAt,
    comments: thread.comments.map((c) => ({
      id: c.id,
      author: c.author ? { kind: c.author.kind, name: c.author.name } : { kind: "user" as const, name: "" },
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}

export interface WebviewSender {
  postMessage(message: unknown): Thenable<boolean>;
}

export class PresentationCommentsBridge {
  private adapterUnsubscribe: { dispose(): void } | null = null;
  private _sender: WebviewSender;
  /** ISO timestamp when loadThreadsForUri was first called (for hasUnread derivation) */
  private _loadedAt: string = new Date().toISOString();

  constructor(
    private readonly adapter: SurfaceCommentAdapter | null,
    sender: WebviewSender,
  ) {
    this._sender = sender;
  }

  /**
   * Rebind the message sender after panel creation.
   * Returns `this` so callers can discard the return value.
   */
  bindToSender(sender: WebviewSender): this {
    this._sender = sender;
    return this;
  }

  async handleWebviewMessage(message: unknown, deckUri: string): Promise<void> {
    if (!this.adapter) return;
    if (typeof message !== "object" || message === null) return;
    const msg = message as Record<string, unknown>;
    switch (msg["type"]) {
      case "comment:create": {
        const anchor = this.buildAnchor(msg["blockId"] as string, deckUri);
        if (!anchor) return;
        await this.adapter.createThread({
          uri: deckUri,
          anchor,
          body: msg["body"] as string,
          intent: msg["intent"] as string | undefined,
        });
        break;
      }
      case "comment:reply":
        await this.adapter.reply({ threadId: msg["threadId"] as string, body: msg["body"] as string });
        break;
      case "comment:resolve":
        await this.adapter.resolve({ threadId: msg["threadId"] as string });
        break;
      case "comment:reopen":
        await this.adapter.reopen({ threadId: msg["threadId"] as string });
        break;
      case "comment:delete":
        await this.adapter.delete({ threadId: msg["threadId"] as string });
        break;
      default:
        break;
    }
  }

  loadThreadsForUri(deckUri: string): void {
    if (!this.adapter) return;
    const send = () => {
      if (!this.adapter) return;
      if (typeof this.adapter.getThreadsForUri !== "function") return;
      const rawThreads = this.adapter.getThreadsForUri(deckUri);
      const threads = rawThreads.map((t) => toSdkThread(t, this._loadedAt));
      void this._sender.postMessage({ type: "comments:load", threads });
    };
    send();
    if (typeof this.adapter.onChanged === "function") {
      this.adapterUnsubscribe = this.adapter.onChanged((_uri: string) => send());
    }
  }

  buildAnchor(blockId: string, deckUri: string): CommentAnchorSurface | null {
    const coords = parseBlockId(blockId);
    if (!coords) return null;
    return {
      kind: "surface",
      uri: deckUri,
      surfaceType: "slide",
      coordinates: coords,
    };
  }

  dispose(): void {
    this.adapterUnsubscribe?.dispose();
    this.adapterUnsubscribe = null;
  }
}
