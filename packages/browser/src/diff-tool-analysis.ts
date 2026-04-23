import { RETENTION_SLOTS, type SnapshotRetentionStore } from "./snapshot-retention.js";
import type { EvictionHint } from "./diff-tool-contracts.js";

export function extractRelayErrorCode(
  data: unknown,
  topLevelError?: unknown,
): "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" | undefined {
  const isKnownCode = (
    code: unknown,
  ): code is "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" =>
    code === "snapshot-not-found" || code === "snapshot-stale" || code === "implicit-snapshot-resolution-required";

  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error: unknown }).error;
    if (isKnownCode(code)) return code;
  }
  if (isKnownCode(topLevelError)) return topLevelError;
  return undefined;
}

export function findMissingSnapshotId(
  store: SnapshotRetentionStore,
  fromSnapshotId: string,
  toSnapshotId: string,
): string {
  const hasFrom = store.get(fromSnapshotId) !== undefined;
  const hasTo = store.get(toSnapshotId) !== undefined;
  if (!hasFrom && hasTo) return fromSnapshotId;
  if (!hasTo && hasFrom) return toSnapshotId;
  return fromSnapshotId;
}

export function listAvailableSnapshotIds(
  store: SnapshotRetentionStore,
  snapshotId: string,
): string[] {
  const lastColon = snapshotId.lastIndexOf(":");
  if (lastColon === -1) return [];
  const pageId = snapshotId.slice(0, lastColon);
  return store.list(pageId).map((e) => e.snapshotId);
}

export function analyzeEviction(
  store: SnapshotRetentionStore,
  requestedId: string,
): EvictionHint | undefined {
  const lastColon = requestedId.lastIndexOf(":");
  if (lastColon === -1) return undefined;
  const pageId = requestedId.slice(0, lastColon);
  const requestedVersion = parseInt(requestedId.slice(lastColon + 1), 10);
  if (isNaN(requestedVersion)) return undefined;

  const slots = store.list(pageId);
  if (slots.length === 0) return undefined;

  const versions = slots
    .map((s) => {
      const lc = s.snapshotId.lastIndexOf(":");
      return lc === -1 ? -1 : parseInt(s.snapshotId.slice(lc + 1), 10);
    })
    .filter((v) => v >= 0);

  if (versions.length === 0) return undefined;

  const oldestVersion = Math.min(...versions);
  const wasEvicted = slots.length >= RETENTION_SLOTS && requestedVersion < oldestVersion;
  const suggestedAction = wasEvicted
    ? `Snapshot ${requestedId} was evicted (retention window: ${RETENTION_SLOTS} snapshots). Capture a fresh snapshot and retry the diff.`
    : `Snapshot ${requestedId} was not found in retention store. Check the snapshot ID spelling, or capture a fresh snapshot.`;

  return {
    requestedSnapshotId: requestedId,
    retentionWindow: RETENTION_SLOTS,
    wasEvicted,
    suggestedAction,
  };
}
