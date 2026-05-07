import type { CommentAnchorSurface } from "@accordo/bridge-types";
import type { CommentThread } from "@accordo/bridge-types";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type {
  DrawingCommentHostMessage,
  DrawingCommentStoreSnapshot,
  DrawingCommentWebviewMessage,
  SdkThread,
} from "../webview/comment-protocol.js";
import type { SceneElement } from "../core/types.js";

type Disposable = { dispose(): void };

/**
 * Canonical persisted drawing-comment anchor prefixes.
 * Phase A decision: keep legacy diagram-node compatibility.
 */
export type DrawingCommentAnchorPrefix = "node" | "edge" | "cluster";

/**
 * Host-owned drawing anchor target.
 * `nodeId` is persisted into CommentAnchorSurface.coordinates.nodeId verbatim.
 */
export interface DrawingCommentAnchorTarget {
  readonly prefix: DrawingCommentAnchorPrefix;
  readonly identity: string;
  readonly nodeId: string;
}

export interface DrawingCommentsSender {
  postMessage(message: DrawingCommentHostMessage): Promise<boolean>;
}

/**
 * Host-side conversion seam: packages/comments store threads are converted to
 * canonical @accordo/comment-sdk SdkThread payloads before posting.
 */
export interface DrawingCommentThreadConverter {
  toSdkThreads(snapshot: DrawingCommentStoreSnapshot): readonly SdkThread[];
}

/**
 * Host/webview comment bridge seam.
 * Implementation is deferred to Phase C; Phase A defines the importable contract.
 */
export class DrawingCommentsBridge {
  private readonly subscription: Disposable | null;
  private disposed = false;

  public constructor(
    private readonly adapter: SurfaceCommentAdapter | null,
    private readonly sender: DrawingCommentsSender,
    private readonly mmdUri: string,
    private readonly converter?: DrawingCommentThreadConverter,
  ) {
    this.subscription = this.adapter?.onChanged((changedUri) => {
      if (this.disposed) return;
      if (sameUri(changedUri, this.mmdUri)) {
        this.loadThreadsForUri();
      }
    }) ?? null;
  }

  /**
   * DRW-C06 — Load threads from the adapter and post canonical SdkThread[] to webview.
   * Phase B stub: throws "not implemented".
   */
  public loadThreadsForUri(): void {
    if (!this.adapter || this.disposed) return;
    const threads = this.adapter.getThreadsForUri(this.mmdUri);
    const sdkThreads = this.converter
      ? this.converter.toSdkThreads({ uri: this.mmdUri, threads })
      : toSdkThreads(threads);
    void this.sender.postMessage({ type: "comments:load", threads: [...sdkThreads] });
  }

  /**
   * DRW-C05 — Handle a webview message (comment:create/reply/resolve/reopen/delete).
   * Phase B stub: throws "not implemented".
   */
  public async handleWebviewMessage(
    _message: DrawingCommentWebviewMessage | unknown,
  ): Promise<void> {
    if (this.disposed) return;
    if (!isObject(_message) || typeof _message.type !== "string") return;

    if (_message.type === "comments:focus" && typeof _message.threadId === "string") {
      this.focusThread(_message.threadId);
      return;
    }

    if (!this.adapter) return;

    if (_message.type === "comment:create" && typeof _message.blockId === "string" && typeof _message.body === "string") {
      await this.adapter.createThread({
        uri: this.mmdUri,
        body: _message.body,
        anchor: this.buildAnchor(_message.blockId),
      });
      return;
    }
    if (_message.type === "comment:reply" && typeof _message.threadId === "string" && typeof _message.body === "string") {
      await this.adapter.reply({ threadId: _message.threadId, body: _message.body });
      return;
    }
    if (_message.type === "comment:resolve" && typeof _message.threadId === "string") {
      await this.adapter.resolve({
        threadId: _message.threadId,
        resolutionNote: typeof _message.resolutionNote === "string" ? _message.resolutionNote : undefined,
      });
      return;
    }
    if (_message.type === "comment:reopen" && typeof _message.threadId === "string") {
      await this.adapter.reopen({ threadId: _message.threadId });
      return;
    }
    if (_message.type === "comment:delete" && typeof _message.threadId === "string") {
      await this.adapter.delete({
        threadId: _message.threadId,
        commentId: typeof _message.commentId === "string" ? _message.commentId : undefined,
      });
    }
  }

  /**
   * DRW-C01 — Build a diagram-node anchor surface for a given prefixed nodeId.
   * Phase B stub: throws "not implemented".
   */
  public buildAnchor(nodeId: string): CommentAnchorSurface {
    return {
      kind: "surface",
      uri: this.mmdUri,
      surfaceType: "diagram",
      coordinates: {
        type: "diagram-node",
        nodeId,
      },
    };
  }

  /**
   * DRW-C08 — Dispose the bridge: unsubscribe from adapter listeners and
   * stop forwarding messages. After dispose, the bridge is inert.
   * Phase B stub: throws "not implemented".
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription?.dispose();
  }

  /**
   * DRW-C07 — Focus a thread in the webview via canonical comments:focus.
   *
   * Called by the extension's focus command handler after opening the panel.
   * Posts `comments:focus { threadId }` to the webview so the overlay opens
   * the correct popover.
   *
   * Phase B stub: throws "not implemented" — the focus path is not wired yet.
   */
  public focusThread(threadId: string): void {
    if (this.disposed) return;
    void this.sender.postMessage({ type: "comments:focus", threadId });
  }
}

export function buildDrawingCommentNodeId(
  target: DrawingCommentAnchorTarget,
): string {
  return `${target.prefix}:${target.identity}`;
}

/**
 * DRW-C02 — Returns true only for managed primary nodes and edges.
 * Helper, label, container, orphaned, and unmanaged elements are NOT commentable.
 *
 * Phase B stub: throws "not implemented" — test defines correct contract.
 */
export function isCommentableTarget(el: SceneElement): boolean {
  const accordo = el.customData?.accordo;
  if (!accordo) return false;
  if (accordo.sceneRole !== "primary") return false;
  if (accordo.status !== "active") return false;
  if (!accordo.identity) return false;
  return accordo.entityKind === "node" || accordo.entityKind === "edge" || accordo.entityKind === "cluster";
}

/**
 * DRW-C03 — Edge geometry: midpoint of a polyline.
 *
 * Computes the geometric center of all polyline point coordinates,
 * NOT the center of the element's bounding box.
 *
 * Returns null for elements without at least 2 points.
 *
 * Phase B stub: throws "not implemented" — test defines correct contract.
 */
export function edgePolylineMidpoint(
  el: SceneElement,
): { x: number; y: number } | null {
  const points = el.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [px, py] of points) {
    sx += el.x + px;
    sy += el.y + py;
  }
  return {
    x: sx / points.length,
    y: sy / points.length,
  };
}

/**
 * DRW-C03 — Edge geometry: hit test for a point near a polyline.
 *
 * Returns true when the given screen point is within `threshold` scene-units
 * of any line segment in the polyline.
 *
 * This is used to detect click targets for edge comment pins.
 *
 * Phase B stub: throws "not implemented" — test defines correct contract.
 */
export function hitsEdgePolyline(
  el: SceneElement,
  pt: { x: number; y: number },
  threshold: number,
): boolean {
  const points = el.points;
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const a = { x: el.x + ax, y: el.y + ay };
    const b = { x: el.x + bx, y: el.y + by };
    if (pointToSegmentDistance(pt, a, b) <= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * DRW-C03 — Build a lookup map from blockId → managed scene element.
 *
 * Only active managed elements (nodes and edges) are included.
 * Orphaned, helper, label, and unmanaged elements are excluded.
 *
 * The returned Map uses prefixed blockIds as keys:
 * - "node:{identity}" for managed node elements
 * - "edge:{identity}" for managed edge elements
 *
 * Phase B stub: throws "not implemented" — test defines correct contract.
 */
export function buildManagedElementLookup(
  elements: SceneElement[],
): Map<string, SceneElement> {
  const lookup = new Map<string, SceneElement>();
  for (const el of elements) {
    if (!isCommentableTarget(el)) continue;
    const accordo = el.customData?.accordo;
    if (!accordo) continue;
    const prefix = accordo.entityKind;
    if (prefix !== "node" && prefix !== "edge" && prefix !== "cluster") continue;
    lookup.set(`${prefix}:${accordo.identity}`, el);
  }
  return lookup;
}

/**
 * DRW-C04 — Compute the screen position of a comment pin for a given blockId.
 *
 * Combines element geometry (from the managed element lookup) with live
 * Excalidraw viewport state (scrollX, scrollY, zoom) to produce a screen position.
 *
 * For nodes: center of the element bounding box.
 * For edges: midpoint of the polyline.
 *
 * Returns null if the blockId is not in the lookup or refers to a non-commentable
 * element (helper, label, orphaned, unmanaged).
 *
 * Phase B stub: throws "not implemented" — test defines correct contract.
 */
export function computePinPosition(
  lookup: Map<string, SceneElement>,
  blockId: string,
  viewport: { scrollX: number; scrollY: number; zoom: number },
): { x: number; y: number } | null {
  const el = lookup.get(blockId);
  if (!el || !isCommentableTarget(el)) return null;

  const center = blockId.startsWith("edge:")
    ? edgePolylineMidpoint(el)
    : {
        x: el.x + ((el.width ?? 0) / 2),
        y: el.y + ((el.height ?? 0) / 2),
      };
  if (!center) return null;
  return {
    x: (center.x + viewport.scrollX) * viewport.zoom,
    y: (center.y + viewport.scrollY) * viewport.zoom,
  };
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = (abx * abx) + (aby * aby);
  if (lenSq === 0) return Math.hypot(apx, apy);
  const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / lenSq));
  const qx = a.x + (abx * t);
  const qy = a.y + (aby * t);
  return Math.hypot(p.x - qx, p.y - qy);
}

function toSdkThreads(threads: readonly CommentThread[]): readonly SdkThread[] {
  const sdkThreads: SdkThread[] = [];
  for (const thread of threads) {
    const nodeId = thread.anchor.kind === "surface" && thread.anchor.surfaceType === "diagram"
      && thread.anchor.coordinates.type === "diagram-node"
      ? thread.anchor.coordinates.nodeId
      : null;
    if (!nodeId) continue;
    sdkThreads.push({
      id: thread.id,
      blockId: nodeId,
      status: thread.status === "resolved" ? "resolved" : "open",
      hasUnread: false,
      comments: thread.comments.map((comment) => ({
        id: comment.id,
        author: comment.author,
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    });
  }
  return sdkThreads;
}

function sameUri(a: string, b: string): boolean {
  const na = normalizeFileUri(a);
  const nb = normalizeFileUri(b);
  return na === nb || toPairBase(na) === toPairBase(nb);
}

function normalizeFileUri(value: string): string {
  return value.startsWith("file://") ? value.slice("file://".length) : value;
}

function toPairBase(value: string): string {
  return value.replace(/\.mmd$/i, "").replace(/\.excalidraw$/i, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
