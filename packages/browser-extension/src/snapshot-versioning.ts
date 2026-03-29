/**
 * M100-SNAP — Snapshot Versioning
 *
 * Snapshot version manager for content script — monotonic IDs, SnapshotEnvelope
 * on all responses, SnapshotStore (in-memory, 5-slot retention).
 *
 * Implements B2-SV-001..B2-SV-007.
 *
 * @module
 */

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
  /** Stable page identifier (matches chrome-devtools page ID). */
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

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute a stable string hash for a node's identity based on tag + id + text.
 * Deterministic — same inputs always produce the same output.
 *
 * Exported for use by page-map-collector to attach persistentId to PageNode (B2-SV-007).
 */
export function computePersistentId(tag: string, id: string | undefined, text: string | undefined): string {
  const raw = `${tag}:${id ?? ""}:${text ?? ""}`;
  // Use btoa for a compact, stable, URL-safe representation
  // encodeURIComponent + unescape handles multi-byte chars safely
  return btoa(unescape(encodeURIComponent(raw)));
}

/**
 * Enrich a node by attaching a deterministic persistentId.
 */
function enrichNode(node: NodeIdentity): NodeIdentity {
  const persistentId = computePersistentId(node.tag, node.id, node.text);
  // children may be omitted in caller-constructed nodes — default to empty array
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
  private readonly pageId: string;
  private version: number;

  constructor(pageId: string) {
    this.pageId = pageId;
    this.version = 0;
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

// ── SnapshotStore ─────────────────────────────────────────────────────────────

/** Sentinel returned when a snapshotId is not found or has been evicted. */
export type SnapshotNotFound = { error: "snapshot-not-found" };

/**
 * In-memory snapshot store with configurable retention (default 5 slots per page).
 *
 * B2-SV-004: oldest snapshots are evicted when the limit is exceeded.
 * B2-SV-005: resetOnNavigation clears all stored snapshots.
 */
export class SnapshotStore {
  private readonly retentionSize: number;
  /** Stores snapshots per pageId, ordered oldest→newest. */
  private pageSnapshots: Map<string, VersionedSnapshot[]>;
  /** Fast lookup by snapshotId. */
  private bySnapshotId: Map<string, VersionedSnapshot>;
  /**
   * B2-DE-007: Snapshot IDs that were cleared by navigation reset.
   * Used to distinguish "snapshot-stale" (existed before navigation)
   * from "snapshot-not-found" (never existed or FIFO-evicted).
   * Cleared on the *next* navigation reset to avoid unbounded growth.
   */
  private staleSnapshotIds: Set<string>;

  constructor(retentionSize: number = DEFAULT_RETENTION_SIZE) {
    this.retentionSize = retentionSize;
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
    this.staleSnapshotIds = new Set();
  }

  /**
   * Save a snapshot for the given pageId.
   *
   * If the store already holds `retentionSize` snapshots for this page,
   * the oldest is evicted (FIFO).
   */
  async save(pageId: string, snapshot: VersionedSnapshot): Promise<void> {
    const list = this.pageSnapshots.get(pageId) ?? [];
    list.push(snapshot);
    this.bySnapshotId.set(snapshot.snapshotId, snapshot);

    // Evict oldest when over capacity
    while (list.length > this.retentionSize) {
      const evicted = list.shift();
      if (evicted !== undefined) {
        this.bySnapshotId.delete(evicted.snapshotId);
      }
    }

    this.pageSnapshots.set(pageId, list);
  }

  /**
   * Retrieve a specific snapshot by snapshotId.
   *
   * Returns `{ error: "snapshot-not-found" }` when the snapshotId is unknown
   * or has been evicted (B2-SV-004, B2-SV-005).
   */
  async get(snapshotId: string): Promise<VersionedSnapshot | SnapshotNotFound> {
    const snapshot = this.bySnapshotId.get(snapshotId);
    if (snapshot === undefined) {
      return { error: "snapshot-not-found" };
    }
    return snapshot;
  }

  /**
   * Get the most recent snapshot for the given pageId.
   *
   * Returns `undefined` if no snapshots exist for that page.
   */
  async getLatest(pageId: string): Promise<VersionedSnapshot | undefined> {
    const list = this.pageSnapshots.get(pageId);
    if (list === undefined || list.length === 0) return undefined;
    // Last element is the newest (appended in save())
    return list[list.length - 1];
  }

  /**
   * List all snapshots for the given pageId, newest first (B2-SV-004).
   *
   * Returns at most `retentionSize` items.
   */
  async list(pageId: string): Promise<VersionedSnapshot[]> {
    const list = this.pageSnapshots.get(pageId) ?? [];
    // Return a copy in descending order (newest first)
    return list.slice().reverse();
  }

  /**
   * Clear all stored snapshots on navigation (B2-SV-005).
   *
   * B2-DE-007: Moves current snapshot IDs to `staleSnapshotIds` so that
   * subsequent `get()` calls for pre-navigation IDs can distinguish
   * "snapshot-stale" from "snapshot-not-found".
   */
  resetOnNavigation(): void {
    // Move all current snapshot IDs to stale set (replace previous stale set)
    this.staleSnapshotIds = new Set(this.bySnapshotId.keys());
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
  }

  /**
   * Check whether a snapshot ID is from a previous navigation session.
   *
   * B2-DE-007: Returns `true` if the snapshot existed before the last
   * `resetOnNavigation()` call, enabling callers to return a
   * `"snapshot-stale"` error instead of `"snapshot-not-found"`.
   */
  isStale(snapshotId: string): boolean {
    return this.staleSnapshotIds.has(snapshotId);
  }

  /**
   * Get the snapshot immediately before the given snapshotId in the same page.
   *
   * B2-DE-004: Used to resolve the implicit `from` when only `toSnapshotId`
   * is provided. Returns `undefined` if there is no prior snapshot (i.e.,
   * the given snapshot is the first one for its page).
   */
  async getPrevious(snapshotId: string): Promise<VersionedSnapshot | undefined> {
    const target = this.bySnapshotId.get(snapshotId);
    if (target === undefined) return undefined;

    const list = this.pageSnapshots.get(target.pageId);
    if (list === undefined) return undefined;

    const idx = list.findIndex((s) => s.snapshotId === snapshotId);
    if (idx <= 0) return undefined;
    return list[idx - 1];
  }
}

// ── Module-level singleton for tool injection ─────────────────────────────────

/**
 * Module-level SnapshotManager singleton used by collectPageMap, inspectElement,
 * and getDomExcerpt to inject snapshotId into their responses (B2-SV-001).
 *
 * Uses a simple "page" identifier to avoid URL-derived IDs that contain colons
 * and would break the {pageId}:{version} format regex /^[^:]+:\d+$/.
 */
const DEFAULT_PAGE_ID = "page";

/**
 * Default singleton — created once at module load time.
 * Reset via resetDefaultManager() for testing or navigation events.
 */
let defaultManager: SnapshotManager = new SnapshotManager(DEFAULT_PAGE_ID);

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
    pageId: DEFAULT_PAGE_ID,
    frameId: "main",
    snapshotId,
    capturedAt: new Date().toISOString(),
    viewport: captureViewport(),
    source,
  };
}

/**
 * Reset the default manager (called on navigation or in tests).
 */
export function resetDefaultManager(): void {
  defaultManager = new SnapshotManager(DEFAULT_PAGE_ID);
}

/**
 * Get the default SnapshotManager singleton.
 * Exposed for use by content script modules needing snapshotId injection.
 */
export function getDefaultManager(): SnapshotManager {
  return defaultManager;
}
