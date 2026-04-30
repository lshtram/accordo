/**
 * Spatial Relations — Canonical grammar parsing (relay + content shared)
 *
 * Pure functions for parsing snapshotId and UID strings.
 * Single source of truth for both relay routing and content validation.
 *
 * @module
 */

/**
 * Parse a snapshotId "{pageId}:{version}" and extract components.
 * Returns null if the format is invalid.
 */
export function parseSnapshotId(raw: string): { pageId: string; version: number } | null {
  const s = raw as string;
  if (typeof s !== "string" || s.length === 0) return null;
  if (s.includes(" ")) return null;
  const colonIdx = s.indexOf(":");
  if (colonIdx < 0) return null;
  const pageId = s.slice(0, colonIdx);
  const versionStr = s.slice(colonIdx + 1);
  if (pageId.length === 0) return null;
  if (pageId.includes(":")) return null;
  if (versionStr.length === 0) return null;
  if (versionStr !== "0" && versionStr.startsWith("0")) return null;
  const version = parseInt(versionStr, 10);
  if (!Number.isFinite(version) || version < 0 || !Number.isInteger(version)) return null;
  return { pageId, version };
}

/**
 * Canonical UID format: "{frameId}:{nodeId}"
 * Returns null if the format is invalid.
 */
export function parseUid(raw: string): { frameId: string; nodeId: number } | null {
  const s = raw as string;
  if (typeof s !== "string" || s.length === 0) return null;
  if (s.includes(" ")) return null;
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx < 0) return null;
  const frameId = s.slice(0, colonIdx);
  const nodeIdStr = s.slice(colonIdx + 1);
  if (frameId.length === 0) return null;
  if (nodeIdStr.length === 0) return null;
  if (!/^\d+$/.test(nodeIdStr)) return null;
  if (nodeIdStr !== "0" && nodeIdStr.startsWith("0")) return null;
  const nodeId = parseInt(nodeIdStr, 10);
  if (!Number.isFinite(nodeId) || nodeId < 0 || !Number.isInteger(nodeId)) return null;
  return { frameId, nodeId };
}
