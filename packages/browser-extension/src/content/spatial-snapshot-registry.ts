/**
 * GAP-D1 — Spatial Relations Snapshot Registry (content-script)
 *
 * Tracks the page-map-owner snapshot state model:
 * - current page-map ref-index owner tagged with owning snapshotId
 * - registry/set of snapshotIds minted only by get_page_map in this content-script context
 * - get_spatial_relations responses do NOT mint/register page-map-owner snapshots
 *
 * Implements snapshot classification:
 * - current owner -> continue
 * - known owner but not current -> snapshot-stale
 * - not in page-map-owner set -> snapshot-not-found
 *
 * Owner-frame is stored per snapshotId (not a singleton):
 * - `registerPageMapOwner(snapshotId, frameId)` atomically records both
 * - `getOwnerFrameIdForSnapshot(snapshotId)` returns exact frame or undefined
 * - No implicit defaulting to "main"; no fallback to current-owner state
 *
 * @module
 */

/**
 * The current owner snapshotId for the page-map ref-index.
 * Undefined until the first get_page_map call in this content-script context.
 */
let currentOwnerSnapshotId: string | undefined;

/**
 * Registry of all snapshotIds minted by get_page_map in this content-script context.
 * Stored as a Set for O(1) lookup.
 */
const pageMapSnapshotRegistry: Set<string> = new Set();

/**
 * Per-snapshot owner frameId registry.
 * Maps snapshotId -> its owner logicalFrameId at registration time.
 */
const snapshotFrameRegistry: Map<string, string> = new Map();

/**
 * Register a snapshotId as a page-map-owner (minted by get_page_map).
 * The owner frame is tracked atomically with the snapshotId.
 *
 * Only call this from the get_page_map handler in this content-script context
 * or from the relay coordination point for forwarded responses.
 */
export function registerPageMapOwner(snapshotId: string, frameId: string = "main"): void {
  pageMapSnapshotRegistry.add(snapshotId);
  currentOwnerSnapshotId = snapshotId;
  snapshotFrameRegistry.set(snapshotId, frameId);
}

/**
 * Check if a snapshotId is the current page-map owner.
 */
export function isCurrentOwner(snapshotId: string): boolean {
  return currentOwnerSnapshotId === snapshotId;
}

/**
 * Check if a snapshotId is a known page-map owner (minted by get_page_map).
 */
export function isKnownPageMapOwner(snapshotId: string): boolean {
  return pageMapSnapshotRegistry.has(snapshotId);
}

/**
 * Get the owner frameId for a specific snapshotId.
 * Returns undefined if the snapshotId is not a known page-map owner.
 * No implicit defaulting to "main"; no fallback to current-owner state.
 */
export function getOwnerFrameIdForSnapshot(snapshotId: string): string | undefined {
  return snapshotFrameRegistry.get(snapshotId);
}

/**
 * Classify a snapshotId for spatial-relations purposes:
 * - current owner -> "current"
 * - known but not current -> "stale"
 * - not in registry -> "not-found"
 */
export function classifySnapshotId(
  snapshotId: string,
): "current" | "stale" | "not-found" {
  if (currentOwnerSnapshotId === snapshotId) return "current";
  if (pageMapSnapshotRegistry.has(snapshotId)) return "stale";
  return "not-found";
}

/**
 * Reset the registry on navigation.
 * Called when the content script detects a new page session.
 */
export function resetSnapshotRegistry(): void {
  currentOwnerSnapshotId = undefined;
  pageMapSnapshotRegistry.clear();
  snapshotFrameRegistry.clear();
}

/**
 * Get the current owner snapshotId.
 */
export function getOwnerSnapshotId(): string | undefined {
  return currentOwnerSnapshotId;
}
