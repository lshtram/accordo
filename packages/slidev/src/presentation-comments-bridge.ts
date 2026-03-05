/**
 * accordo-slidev — Presentation Comments Bridge
 *
 * Bridges webview comment SDK messages to the accordo-comments
 * SurfaceCommentAdapter. Handles blockId ↔ SlideCoordinates encoding.
 *
 * Source: requirements-slidev.md §4 M44-CBR
 *
 * Requirements:
 *   M44-CBR-01  Receives webview comment messages, forwards to surface adapter
 *   M44-CBR-02  Constructs slide surface anchors: { kind:"surface", uri, surfaceType:"slide", coordinates:{...} }
 *   M44-CBR-03  Subscribes to adapter store changes, pushes comments:load to webview
 *   M44-CBR-04  Handles missing comments extension gracefully (no throw)
 *   M44-CBR-05  blockId = "slide:{slideIndex}:{x}:{y}" (x,y as 4-decimal-place floats)
 */

import type { SlideCoordinates, CommentAnchorSurface } from "@accordo/bridge-types";
import type { SurfaceAdapterLike } from "./types.js";

// ── Block ID encoding / decoding ─────────────────────────────────────────────

/**
 * M44-CBR-05
 * Encodes SlideCoordinates into an opaque blockId string.
 * Format: "slide:{slideIndex}:{x.4f}:{y.4f}"
 * Example: "slide:3:0.5000:0.3000"
 */
export function encodeBlockId(coords: SlideCoordinates): string {
  return `slide:${coords.slideIndex}:${coords.x.toFixed(4)}:${coords.y.toFixed(4)}`;
}

/**
 * M44-CBR-05
 * Decodes an opaque blockId string back into SlideCoordinates.
 * Returns null if the string does not match the slide blockId format.
 */
export function parseBlockId(blockId: string): SlideCoordinates | null {
  const match = /^slide:(\d+):([\d.]+):([\d.]+)$/.exec(blockId);
  if (!match) return null;
  const slideIndex = parseInt(match[1], 10);
  const x = parseFloat(match[2]);
  const y = parseFloat(match[3]);
  if (isNaN(slideIndex) || isNaN(x) || isNaN(y)) return null;
  return { type: "slide", slideIndex, x, y };
}

// ── Webview message sender interface ─────────────────────────────────────────

/**
 * Minimal interface for sending messages back to the webview.
 * Injected to keep PresentationCommentsBridge VS Code-agnostic and testable.
 */
export interface WebviewSender {
  postMessage(message: unknown): Thenable<boolean>;
}

// ── PresentationCommentsBridge ────────────────────────────────────────────────

/**
 * M44-CBR — Connects the slide webview's Comment SDK to accordo-comments.
 *
 * Lifecycle: one instance per open presentation session, disposed on close.
 */
export class PresentationCommentsBridge {
  private adapterUnsubscribe: { dispose(): void } | null = null;

  /**
   * @param adapter   Surface adapter from getSurfaceAdapter (null = comments disabled)
   * @param sender    Webview message sender
   */
  constructor(
    private readonly adapter: SurfaceAdapterLike | null,
    private readonly sender: WebviewSender,
  ) {}

  /**
   * M44-CBR-01
   * Handles an incoming message from the webview (comment:create / reply / resolve / delete).
   * No-ops when adapter is null (M44-CBR-04).
   *
   * @param message  Raw webview message object.
   * @param deckUri  URI of the open deck (used as thread URI).
   */
  async handleWebviewMessage(message: unknown, deckUri: string): Promise<void> {
    if (!this.adapter) return;
    // Narrow unknown → object before accessing fields
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
      case "comment:delete":
        await this.adapter.delete({ threadId: msg["threadId"] as string });
        break;
      default:
        // Unknown message type — ignore
        break;
    }
  }

  /**
   * M44-CBR-03
   * Loads current threads for the given URI and sends `comments:load` to webview.
   * Subscribes to future changes and pushes updates automatically.
   * No-ops when adapter is null (M44-CBR-04).
   */
  loadThreadsForUri(deckUri: string): void {
    if (!this.adapter) return;
    const send = () => {
      // adapter is readonly; the null-check above guarantees it is non-null here
      const threads = this.adapter!.getThreadsForUri(deckUri);
      void this.sender.postMessage({ type: "comments:load", threads });
    };
    send();
    this.adapterUnsubscribe = this.adapter.onChanged((_uri: string) => send());
  }

  /**
   * M44-CBR-02
   * Builds a surface anchor from a blockId string.
   * Returns null if blockId is not a valid slide blockId.
   */
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

  /** Tear down store subscription. */
  dispose(): void {
    this.adapterUnsubscribe?.dispose();
    this.adapterUnsubscribe = null;
  }
}
