/**
 * A18 — DiagramCommentsBridge
 *
 * Bridges the diagram webview's postMessage channel to the accordo-comments
 * SurfaceCommentAdapter. Routes inbound comment messages from the webview to
 * the store and pushes comments:load to the webview via onChanged.
 *
 * Source: requirements-diagram.md §3, diag_arch_v4.2.md §25
 *
 * Requirements: A18-R01..R15
 */

import type { CommentAnchorSurface, CommentThread } from "@accordo/bridge-types";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type { WebviewToHostMessage } from "../webview/protocol.js";

// ── Adapter interface (same shape as SurfaceCommentAdapter) ──────────────────

/** @deprecated Use SurfaceCommentAdapter from @accordo/capabilities instead. */
export type SurfaceAdapterLike = SurfaceCommentAdapter;

// ── Webview sender interface ─────────────────────────────────────────────────

export interface WebviewSender {
  postMessage(message: unknown): Thenable<boolean>;
}

// ── DiagramCommentsBridge ────────────────────────────────────────────────────

/**
 * A18 — Connects the diagram webview's Comment SDK messages to accordo-comments.
 *
 * Lifecycle: one instance per open DiagramPanel, disposed when panel closes.
 */
export class DiagramCommentsBridge {
  private _onChangedSub: { dispose(): void } | null = null;
  private _disposed = false;

  /**
   * @param adapter  Surface adapter from getSurfaceAdapter (null = comments disabled, A18-R11)
   * @param sender   Webview message sender
   * @param mmdUri   File URI of the open .mmd file (host-owned, A18-R02)
   */
  constructor(
    private readonly adapter: SurfaceCommentAdapter | null,
    private readonly sender: WebviewSender,
    private readonly mmdUri: string,
  ) {}

  /**
   * A18-R07, A18-R08
   * Loads current threads for mmdUri and posts comments:load to webview.
   * Subscribes to adapter.onChanged for future full-reloads.
   * Replaces any prior subscription (A18-T09).
   * No-op when adapter is null (A18-R11).
   */
  loadThreadsForUri(): void {
    if (!this.adapter) return;
    const send = () => {
      if (this._disposed) return;
      // adapter is readonly; the null-check above guarantees it is non-null here
      const threads = this.adapter!.getThreadsForUri(this.mmdUri);
      void this.sender.postMessage({ type: "comments:load", threads });
    };
    send();
    this._onChangedSub?.dispose();
    this._onChangedSub = this.adapter.onChanged((_uri: string) => send());
  }

  /**
   * A18-R02..R10
   * Handles an inbound message from the webview.
   * No-op when adapter is null (A18-R11).
   */
  async handleWebviewMessage(message: unknown): Promise<void> {
    if (!this.adapter) return;
    // Narrow unknown → object before accessing fields
    if (typeof message !== "object" || message === null) return;
    const msg = message as WebviewToHostMessage;
    switch (msg.type) {
      case "comment:create":
        await this.adapter.createThread({
          uri: this.mmdUri,
          anchor: this.buildAnchor(msg.blockId),
          body: msg.body,
          intent: msg.intent,
        });
        break;
      case "comment:reply":
        await this.adapter.reply({
          threadId: msg.threadId,
          body: msg.body,
        });
        break;
      case "comment:resolve":
        await this.adapter.resolve({ threadId: msg.threadId });
        break;
      case "comment:reopen":
        await this.adapter.reopen({ threadId: msg.threadId });
        break;
      case "comment:delete":
        await this.adapter.delete({ threadId: msg.threadId });
        break;
      default:
        // Unknown/unhandled message type — ignore
        break;
    }
  }

  /**
   * A18-R13
   * Builds a CommentAnchorSurface for the given blockId.
   * blockId is stored verbatim as DiagramNodeCoordinates.nodeId (A18-R13).
   */
  buildAnchor(blockId: string): CommentAnchorSurface {
    return {
      kind: "surface",
      uri: this.mmdUri,
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: blockId },
    };
  }

  /**
   * A18-R12
   * Disposes the onChanged subscription. No further messages forwarded.
   */
  dispose(): void {
    this._disposed = true;
    this._onChangedSub?.dispose();
    this._onChangedSub = null;
  }
}
