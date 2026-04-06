/**
 * M100-SNAP — Snapshot Versioning
 *
 * Snapshot version manager for content script — monotonic IDs, SnapshotEnvelope
 * on all responses, SnapshotManager singleton.
 *
 * Implements B2-SV-001..B2-SV-007.
 *
 * SnapshotStore has been split into snapshot-store.ts (imported below).
 *
 * @module
 */

export { SnapshotStore } from "./snapshot-store.js";
export type { SnapshotNotFound } from "./snapshot-store.js";

/**
 * Default number of snapshots to retain per page.
 * After 7 data-producing calls on the same page, only the last 5 are retrievable.
 */
export const DEFAULT_RETENTION_SIZE = 5;

/**
 * Valid source types for a snapshot.
 */
export type SnapshotSource = "dom" | "a11y" | "visual" | "layout" | "network";

/**
 * Canonical metadata envelope included in all data-producing tool responses.
 */
export interface SnapshotEnvelope {
  /** Opaque page-session identifier minted by the content script. */
  pageId: string;
  /** Frame identifier. Top-level frame = "main". */
  frameId: string;
  /** Monotonically increasing snapshot version (per pageId). Format: {pageId}:{version} */
  snapshotId: string;
  /** ISO 8601 timestamp when snapshot was captured. */
  capturedAt: string;
  /** Viewport state at capture time. */
  viewport: Viewport;
  /** Data source type. */
  source: SnapshotSource;
}

/**
 * Viewport dimensions and scroll position.
 */
export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

/**
 * Node identity within a snapshot. Also used as the page map node shape.
 */
export interface NodeIdentity {
  /** HTML tag name (lowercase). */
  tag: string;
  /** Element id attribute. */
  id?: string;
  /** Visible text content. */
  text?: string;
  /** ARIA role or similar. */
  role?: string;
  /** Child nodes in document order (optional for leaf nodes). */
  children?: NodeIdentity[];
  /** Stable within a single snapshot. Integer index from DFS traversal. */
  nodeId: number;
  /** Experimental: stable across snapshots for unchanged elements. */
  persistentId?: string;
}

/**
 * Input for creating a snapshot.
 */
export interface CreateSnapshotInput {
  pageUrl: string;
  title: string;
  nodes: NodeIdentity[];
  totalElements: number;
}

/**
 * A complete versioned snapshot with envelope.
 */
export interface VersionedSnapshot extends SnapshotEnvelope {
  nodes: NodeIdentity[];
  totalElements: number;
}

/**
 * Alias for VersionedSnapshot — same shape, used by consumers expecting PageMapSnapshot.
 */
export type PageMapSnapshot = VersionedSnapshot;

// ── Page session ID generation ─────────────────────────────────────────────────

/**
 * Generate an opaque per-document-session pageId.
 *
 * Uses crypto.randomUUID() stripped of hyphens, prefixed with "pg_" to avoid
 * collision with any legacy "page" IDs and to make the format obvious.
 *
 * Must NOT contain ":" since that is the snapshotId separator (BR-F-150).
 * Format: `pg_` + 32 hex chars (no hyphens, no colons).
 */
function createPageSessionId(): string {
  return `pg_${crypto.randomUUID().replace(/-/g, "")}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute a stable string hash for a node's identity based on tag + id + text.
 * Deterministic — same inputs always produce the same output.
 *
 * Exported for use by page-map-collector to attach persistentId to PageNode (B2-SV-007).
 */
export function computePersistentId(tag: string, id: string | undefined, text: string | undefined): string {
  const raw = `${tag}:${id ?? ""}:${text ?? ""}`;
  return btoa(unescape(encodeURIComponent(raw)));
}

/**
 * Enrich a node by attaching a deterministic persistentId.
 */
function enrichNode(node: NodeIdentity): NodeIdentity {
  const persistentId = computePersistentId(node.tag, node.id, node.text);
  const children = (node.children ?? []).map(enrichNode);
  return { ...node, persistentId, children };
}

/**
 * Capture the current viewport dimensions from window globals.
 * Falls back to sane defaults for non-browser environments (e.g., jsdom).
 */
function captureViewport(): Viewport {
  return {
    width: (typeof window !== "undefined" ? window.innerWidth : 0) || 1280,
    height: (typeof window !== "undefined" ? window.innerHeight : 0) || 800,
    scrollX: typeof window !== "undefined" ? (window.scrollX ?? 0) : 0,
    scrollY: typeof window !== "undefined" ? (window.scrollY ?? 0) : 0,
    devicePixelRatio: (typeof window !== "undefined" ? window.devicePixelRatio : 0) || 1,
  };
}

/**
 * Find first node matching a tag in a flat DFS walk of the node tree.
 */
function findNodeByTag(nodes: readonly NodeIdentity[], tag: string): NodeIdentity | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const found = findNodeByTag(node.children ?? [], tag);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ── SnapshotManager ───────────────────────────────────────────────────────────

/**
 * Snapshot manager — maintains a monotonic version counter and creates
 * versioned snapshots with full SnapshotEnvelope metadata.
 *
 * Each `createSnapshot` call increments the version by 1.
 * `resetOnNavigation` resets the counter back to 0.
 */
export class SnapshotManager {
  private readonly _pageId: string;
  private version: number;

  constructor(pageId: string) {
    if (pageId.length === 0 || pageId.includes(":")) {
      throw new Error("pageId must be non-empty and must not contain ':'");
    }
    this._pageId = pageId;
    this.version = 0;
  }

  /**
   * The pageId for this manager's document session.
   * Exposed for use by captureSnapshotEnvelope() to mint stable envelopes.
   */
  get pageId(): string {
    return this._pageId;
  }

  /**
   * Create a new snapshot with the next monotonic version.
   *
   * B2-SV-001: snapshotId format is `{pageId}:{version}`.
   * B2-SV-002: version increments by 1 on each call.
   * B2-SV-003: envelope fields are fully populated.
   * B2-SV-007: each node receives a deterministic persistentId.
   */
  async createSnapshot(input: CreateSnapshotInput): Promise<VersionedSnapshot> {
    const version = this.version++;
    const snapshotId = `${this.pageId}:${version}`;
    const capturedAt = new Date().toISOString();
    const viewport = captureViewport();
    const nodes = input.nodes.map(enrichNode);

    return {
      pageId: this.pageId,
      frameId: "main",
      snapshotId,
      capturedAt,
      viewport,
      source: "dom",
      nodes,
      totalElements: input.totalElements,
    };
  }

  /**
   * Increment the version counter and return the new snapshotId.
   * Lighter-weight than createSnapshot — no full snapshot data required.
   *
   * B2-SV-002: version increments by 1 on each call.
   */
  nextId(): string {
    const version = this.version++;
    return `${this.pageId}:${version}`;
  }

  /**
   * Reset the version counter to 0 on navigation (B2-SV-005).
   */
  resetOnNavigation(): void {
    this.version = 0;
  }

  /**
   * Get the nodeId for the first node in the snapshot matching the given tag.
   *
   * B2-SV-006: returns a non-negative integer for a valid node, or -1 if not found.
   */
  getNodeIdForElement(snapshot: VersionedSnapshot, tag: string): number {
    const node = findNodeByTag(snapshot.nodes, tag);
    return node !== undefined ? node.nodeId : -1;
  }

  /**
   * Get the first node matching the given tag from the snapshot.
   *
   * B2-SV-007: returns the node including its persistentId if present.
   */
  getNodeByTag(snapshot: VersionedSnapshot, tag: string): NodeIdentity | undefined {
    return findNodeByTag(snapshot.nodes, tag);
  }
}

// ── Module-level singleton for tool injection ─────────────────────────────────

/**
 * Module-level SnapshotManager singleton used by collectPageMap, inspectElement,
 * and getDomExcerpt to inject snapshotId into their responses (B2-SV-001).
 *
 * The pageId is generated once per document session via createPageSessionId().
 * resetDefaultManager() is called on top-level navigation to mint a new pageId
 * and reset the snapshot version counter (BR-F-153).
 */
let defaultManager: SnapshotManager = new SnapshotManager(createPageSessionId());

/**
 * Get the next snapshotId from the default manager, incrementing the version.
 * Returns a fresh, monotonically increasing snapshotId in `{pageId}:{version}` format.
 *
 * **Ownership contract (B2-SV-002):** The content script is the single authoritative
 * owner of snapshot sequencing. The default manager runs in the content script's
 * page session scope. The service worker relay MUST NOT call this function — it
 * MUST forward the envelope produced by the content script without minting
 * additional IDs. This prevents divergent counters across runtime contexts.
 *
 * B2-SV-002: each call increments the version counter.
 * Used to inject snapshotId into collectPageMap, inspectElement, getDomExcerpt,
 * and captureRegion responses.
 */
export function getCurrentSnapshotId(): string {
  return defaultManager.nextId();
}

/**
 * Capture a full SnapshotEnvelope from the content script's default manager.
 *
 * **Ownership contract (B2-SV-003):** This is the single authoritative source
 * for snapshot metadata. All data-producing content script functions (collectPageMap,
 * inspectElement, getDomExcerpt) MUST call this to create their envelope. The
 * relay layer MUST pass through the returned envelope fields without overriding.
 *
 * @param source — The data source type for this snapshot
 * @returns A full SnapshotEnvelope with all required fields
 */
export function captureSnapshotEnvelope(source: SnapshotSource = "dom"): SnapshotEnvelope {
  const snapshotId = defaultManager.nextId();
  return {
    pageId: defaultManager.pageId,
    frameId: "main",
    snapshotId,
    capturedAt: new Date().toISOString(),
    viewport: captureViewport(),
    source,
  };
}

/**
 * Reset the default manager (called on navigation or in tests).
 * Mints a NEW pageId for the new document session (BR-F-153).
 */
export function resetDefaultManager(): void {
  defaultManager = new SnapshotManager(createPageSessionId());
}

/**
 * Get the default SnapshotManager singleton.
 * Exposed for use by content script modules needing snapshotId injection.
 */
export function getDefaultManager(): SnapshotManager {
  return defaultManager;
}
