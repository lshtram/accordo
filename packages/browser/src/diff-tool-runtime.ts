import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import { RETENTION_SLOTS, type SnapshotRetentionStore } from "./snapshot-retention.js";
import { DIFF_TIMEOUT_MS, type DiffToolError, type EvictionHint } from "./diff-tool-contracts.js";

export function normalizeSnapshotId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const trimmed = id.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseSnapshotId(id: string): { pageId: string; version: number } | null {
  const lastColon = id.lastIndexOf(":");
  if (lastColon === -1) return null;
  const pageId = id.slice(0, lastColon);
  const version = parseInt(id.slice(lastColon + 1), 10);
  if (isNaN(version)) return null;
  return { pageId, version };
}

export function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

export function extractRelayErrorCode(
  data: unknown,
  topLevelError?: unknown,
): "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" | undefined {
  const isKnownCode = (
    code: unknown,
  ): code is "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" =>
    code === "snapshot-not-found" ||
    code === "snapshot-stale" ||
    code === "implicit-snapshot-resolution-required";

  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error: unknown }).error;
    if (isKnownCode(code)) return code;
  }
  if (isKnownCode(topLevelError)) return topLevelError;
  return undefined;
}

export function buildTransientRelayError(topLevelError?: unknown): DiffToolError | undefined {
  if (topLevelError === "browser-not-connected") {
    return { success: false, error: "browser-not-connected", retryable: true, retryAfterMs: 2000 };
  }
  if (topLevelError === "timeout") {
    return { success: false, error: "timeout", retryable: true, retryAfterMs: 1000 };
  }
  return undefined;
}

export async function resolveFreshSnapshot(
  relay: BrowserRelayLike,
  tabId?: number,
): Promise<string | DiffToolError> {
  const payload: Record<string, unknown> = {};
  if (tabId !== undefined) payload.tabId = tabId;
  let freshResponse: Awaited<ReturnType<BrowserRelayLike["request"]>>;
  try {
    freshResponse = await relay.request("get_page_map", payload, DIFF_TIMEOUT_MS);
  } catch (err: unknown) {
    const error = classifyRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: error === "browser-not-connected" ? 2000 : 1000 };
  }

  if (!freshResponse.success) {
    const code = extractRelayErrorCode(freshResponse.data, freshResponse.error);
    if (code !== undefined) return { success: false, error: code, retryable: false };
    const transient = buildTransientRelayError(freshResponse.error);
    if (transient !== undefined) return transient;
    return { success: false, error: "action-failed", retryable: false };
  }

  if (hasSnapshotEnvelope(freshResponse.data)) {
    return freshResponse.data.snapshotId;
  }

  return { success: false, error: "action-failed", retryable: false };
}

export async function resolveFromSnapshot(
  relay: BrowserRelayLike,
  toSnapshotId: string,
  tabId?: number,
): Promise<string | DiffToolError> {
  const preflightPayload: Record<string, unknown> = {};
  if (tabId !== undefined) preflightPayload.tabId = tabId;
  try {
    const preflightResponse = await relay.request("get_page_map", preflightPayload, DIFF_TIMEOUT_MS);
    if (!preflightResponse.success) {
      const code = extractRelayErrorCode(preflightResponse.data, preflightResponse.error);
      if (code !== undefined) return { success: false, error: code, retryable: false };
      const transient = buildTransientRelayError(preflightResponse.error);
      if (transient !== undefined) return transient;
      return { success: false, error: "action-failed", retryable: false };
    }
  } catch (err: unknown) {
    const error = classifyRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: error === "browser-not-connected" ? 2000 : 1000 };
  }

  const lastColon = toSnapshotId.lastIndexOf(":");
  if (lastColon === -1) return { success: false, error: "action-failed", retryable: false };
  const pageId = toSnapshotId.slice(0, lastColon);
  const version = parseInt(toSnapshotId.slice(lastColon + 1), 10);
  if (isNaN(version)) return { success: false, error: "action-failed", retryable: false };
  if (version <= 0) {
    return {
      success: false,
      error: "snapshot-not-found",
      retryable: false,
      recoveryHints:
        "No prior snapshot exists for this page (the current snapshot is the first one). " +
        "To capture a diff, first call get_page_map to record a baseline, then perform the action " +
        "you want to observe, then call diff_snapshots again — the second call will have a prior snapshot to compare against.",
      details: {
        reason: `Snapshot '${toSnapshotId}' is the first snapshot on this page (version 0). There is no prior snapshot to use as a baseline.`,
        recoveryHints:
          "No prior snapshot exists for this page (the current snapshot is the first one). " +
          "To capture a diff, first call get_page_map to record a baseline, then perform the action " +
          "you want to observe, then call diff_snapshots again — the second call will have a prior snapshot to compare against.",
      },
    };
  }
  return `${pageId}:${version - 1}`;
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
