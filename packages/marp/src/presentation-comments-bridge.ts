/**
 * accordo-marp — Presentation Comments Bridge
 *
 * Source: requirements-marp.md §4 M50-CBR
 */

import type { SlideCoordinates, CommentAnchorSurface } from "@accordo/bridge-types";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";

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

export interface WebviewSender {
  postMessage(message: unknown): Thenable<boolean>;
}

export class PresentationCommentsBridge {
  private adapterUnsubscribe: { dispose(): void } | null = null;

  constructor(
    private readonly adapter: SurfaceCommentAdapter | null,
    private readonly sender: WebviewSender,
  ) {}

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
      const threads = this.adapter.getThreadsForUri(deckUri);
      void this.sender.postMessage({ type: "comments:load", threads });
    };
    send();
    this.adapterUnsubscribe = this.adapter.onChanged((_uri: string) => send());
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
