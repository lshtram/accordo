import type { HostMessage, SdkInitOptions, SdkThread, WebviewMessage } from "@accordo/comment-sdk";
import {
  buildManagedElementLookup,
  computePinPosition,
  hitsEdgePolyline,
} from "../comments/drawing-comments-bridge.js";
import type { SceneElement } from "../core/types.js";

export interface CommentSdkLike {
  init(opts: SdkInitOptions): void;
  loadThreads(threads: SdkThread[]): void;
  addThread?(thread: SdkThread): void;
  updateThread?(threadId: string, update: Partial<SdkThread>): void;
  removeThread?(threadId: string): void;
  openPopover(threadId: string): void;
  reposition(): void;
  destroy(): void;
}

export interface DrawingCommentOverlayOptions {
  container: HTMLElement;
  sdk: CommentSdkLike;
  postMessage: (message: WebviewMessage) => void;
  debug?: (event: string, data?: Record<string, unknown>) => void;
  getSceneElements: () => SceneElement[];
  getViewport: () => { scrollX: number; scrollY: number; zoom: number };
}

export class DrawingCommentOverlayController {
  private readonly opts: DrawingCommentOverlayOptions;
  private lookup = new Map<string, SceneElement>();
  private pinSizeStyle: HTMLStyleElement | null = null;

  public constructor(opts: DrawingCommentOverlayOptions) {
    this.opts = opts;
  }

  public init(): void {
    this.refreshScene();
    this.opts.debug?.("overlay:init", { lookupKeys: [...this.lookup.keys()] });
    this.updatePinSizeCss(this.opts.getViewport().zoom);
    this.opts.sdk.init({
      container: this.opts.container,
      coordinateToScreen: (blockId) => computePinPosition(this.lookup, blockId, this.opts.getViewport()),
      blockIdFromEvent: (event) => this.blockIdFromEvent(event),
      callbacks: {
        onCreate: (blockId, body, intent) => {
          this.opts.postMessage({ type: "comment:create", blockId, body, intent });
        },
        onReply: (threadId, body) => {
          this.opts.postMessage({ type: "comment:reply", threadId, body });
        },
        onResolve: (threadId, resolutionNote) => {
          this.opts.postMessage({ type: "comment:resolve", threadId, resolutionNote });
        },
        onReopen: (threadId) => {
          this.opts.postMessage({ type: "comment:reopen", threadId });
        },
        onDelete: (threadId, commentId) => {
          this.opts.postMessage({ type: "comment:delete", threadId, commentId });
        },
      },
    });
  }

  public refreshScene(): void {
    this.lookup = buildManagedElementLookup(this.opts.getSceneElements());
  }

  public onViewportChanged(): void {
    const viewport = this.opts.getViewport();
    this.updatePinSizeCss(viewport.zoom);
    this.opts.debug?.("overlay:viewport-changed", viewport);
    this.opts.sdk.reposition();
  }

  public handleHostMessage(message: unknown): boolean {
    if (!message || typeof message !== "object" || typeof (message as { type?: unknown }).type !== "string") {
      return false;
    }
    const host = message as HostMessage;
    if (host.type === "comments:load") {
      this.refreshScene();
      this.opts.debug?.("overlay:comments-load", {
        threadCount: host.threads.length,
        blockIds: host.threads.map((thread) => thread.blockId),
        lookupKeys: [...this.lookup.keys()],
      });
      this.opts.sdk.loadThreads(host.threads);
      this.opts.sdk.reposition();
      this.opts.debug?.("overlay:comments-load-after-sdk", {
        renderedPins: this.opts.container.querySelectorAll(".accordo-pin").length,
        hasLayer: this.opts.container.querySelector(".accordo-sdk-layer") !== null,
      });
      return true;
    }
    if (host.type === "comments:focus") {
      this.opts.debug?.("overlay:comments-focus", { threadId: host.threadId });
      this.opts.sdk.openPopover(host.threadId);
      return true;
    }
    if (host.type === "comments:add" && this.opts.sdk.addThread) {
      this.opts.sdk.addThread(host.thread);
      this.opts.sdk.reposition();
      return true;
    }
    if (host.type === "comments:update" && this.opts.sdk.updateThread) {
      this.opts.sdk.updateThread(host.threadId, host.update);
      return true;
    }
    if (host.type === "comments:remove" && this.opts.sdk.removeThread) {
      this.opts.sdk.removeThread(host.threadId);
      return true;
    }
    return false;
  }

  public destroy(): void {
    this.pinSizeStyle?.remove();
    this.pinSizeStyle = null;
    this.opts.sdk.destroy();
  }

  private updatePinSizeCss(zoom: number): void {
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    if (!this.pinSizeStyle) {
      this.pinSizeStyle = document.createElement("style");
      this.pinSizeStyle.id = "accordo-drawing-pin-zoom";
      document.head.appendChild(this.pinSizeStyle);
    }
    const size = Math.round(22 * safeZoom);
    const fontSize = Math.round(11 * safeZoom);
    this.pinSizeStyle.textContent = `.accordo-pin{width:${size}px;height:${size}px;font-size:${fontSize}px;}`;
  }

  private blockIdFromEvent(event: MouseEvent): string | null {
    const rect = this.opts.container.getBoundingClientRect();
    const viewport = this.opts.getViewport();
    const sceneX = ((event.clientX - rect.left) / viewport.zoom) - viewport.scrollX;
    const sceneY = ((event.clientY - rect.top) / viewport.zoom) - viewport.scrollY;
    const elements = this.opts.getSceneElements();

    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const element = elements[i]!;
      const accordo = element.customData?.accordo;
      if (!accordo) continue;
      const blockId = `${accordo.entityKind}:${accordo.identity}`;
      if (!this.lookup.has(blockId)) continue;
      const hit = accordo.entityKind === "edge"
        ? hitsEdgePolyline(element, { x: sceneX, y: sceneY }, 8)
        : sceneX >= element.x
          && sceneX <= element.x + (element.width ?? 0)
          && sceneY >= element.y
          && sceneY <= element.y + (element.height ?? 0);
      if (hit) {
        this.opts.debug?.("overlay:alt-click-hit", { blockId, sceneX, sceneY });
        return blockId;
      }
    }
    this.opts.debug?.("overlay:alt-click-miss", { sceneX, sceneY, lookupKeys: [...this.lookup.keys()] });
    return null;
  }
}
