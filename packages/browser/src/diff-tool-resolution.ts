import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { DIFF_TIMEOUT_MS, type DiffToolError } from "./diff-tool-contracts.js";
import { extractRelayErrorCode } from "./diff-tool-analysis.js";
import { classifyThrownRelayError, getRelayRecoveryHint, getRelayRetryAfterMs } from "./relay-error-policy.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

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

export function buildTransientRelayError(topLevelError?: unknown): DiffToolError | undefined {
  if (topLevelError === "browser-not-connected") {
    return {
      success: false,
      error: "browser-not-connected",
      errorCode: "browser-not-connected",
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("browser-not-connected"),
      recoveryHints: getRelayRecoveryHint("browser-not-connected"),
    };
  }
  if (topLevelError === "timeout") {
    return {
      success: false,
      error: "timeout",
      errorCode: "timeout",
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("timeout"),
      recoveryHints: getRelayRecoveryHint("timeout"),
    };
  }
  return undefined;
}

/**
 * B2-CTX-002 + design point 5: Capture a fresh snapshot and persist its envelope.
 * Returns both the snapshotId (for diff resolution) and the full envelope
 * (so the caller can persist it to the local store before diffing).
 *
 * This replaces the old resolveFreshSnapshot which only returned snapshotId
 * and let the envelope go unused — breaking the "persist fresh snapshot locally"
 * requirement for the from+omitted-to path.
 */
export async function resolveFreshSnapshot(
  relay: BrowserRelayLike,
  tabId?: number,
): Promise<{ snapshotId: string; envelope: SnapshotEnvelopeFields } | DiffToolError> {
  const payload: Record<string, unknown> = {};
  if (tabId !== undefined) payload.tabId = tabId;
  let freshResponse: Awaited<ReturnType<BrowserRelayLike["request"]>>;
  try {
    freshResponse = await relay.request("get_page_map", payload, DIFF_TIMEOUT_MS);
  } catch (err: unknown) {
    const error = classifyThrownRelayError(err);
    return { success: false, error, errorCode: error, retryable: true, retryAfterMs: getRelayRetryAfterMs(error), recoveryHints: getRelayRecoveryHint(error) };
  }

  if (!freshResponse.success) {
    const code = extractRelayErrorCode(freshResponse.data, freshResponse.error);
    if (code !== undefined) return { success: false, error: code, errorCode: code, retryable: false };
    const transient = buildTransientRelayError(freshResponse.error);
    if (transient !== undefined) return transient;
    return { success: false, error: "action-failed", errorCode: "action-failed", retryable: false };
  }

  if (hasSnapshotEnvelope(freshResponse.data)) {
    return { snapshotId: freshResponse.data.snapshotId, envelope: freshResponse.data };
  }

  return { success: false, error: "action-failed", errorCode: "action-failed", retryable: false };
}

export function resolveFromSnapshot(
  store: SnapshotRetentionStore,
  toSnapshotId: string,
): string | DiffToolError {
  const parsed = parseSnapshotId(toSnapshotId);
  if (parsed === null) return { success: false, error: "action-failed", errorCode: "action-failed", retryable: false };

  const retainedSnapshots = store.list(parsed.pageId);
  const targetIndex = retainedSnapshots.findIndex((snapshot) => snapshot.snapshotId === toSnapshotId);
  if (targetIndex === -1) {
    return {
      success: false,
      error: "snapshot-not-found",
      errorCode: "snapshot-not-found",
      retryable: false,
      recoveryHints:
        `Snapshot '${toSnapshotId}' is not retained in the local snapshot store. ` +
        "Call get_page_map (or another read tool) to capture a fresh snapshot, then use that returned snapshotId in diff_snapshots.",
      details: {
        reason: `Snapshot '${toSnapshotId}' was not found in the local retention store, so its previous snapshot could not be resolved.`,
        recoveryHints:
          `Snapshot '${toSnapshotId}' is not retained in the local snapshot store. ` +
          "Call get_page_map (or another read tool) to capture a fresh snapshot, then use that returned snapshotId in diff_snapshots.",
      },
    };
  }

  if (targetIndex === 0) {
    return {
      success: false,
      error: "snapshot-not-found",
      errorCode: "snapshot-not-found",
      retryable: false,
      recoveryHints:
        `No prior retained snapshot exists before '${toSnapshotId}' in local history. ` +
        "Capture a fresh baseline with get_page_map (or another read tool), then perform the action you want to observe and diff against that newer snapshot.",
      details: {
        reason: `Snapshot '${toSnapshotId}' is the earliest retained snapshot for this page in local history. There is no prior retained snapshot to use as a baseline.`,
        recoveryHints:
          `No prior retained snapshot exists before '${toSnapshotId}' in local history. ` +
          "Capture a fresh baseline with get_page_map (or another read tool), then perform the action you want to observe and diff against that newer snapshot.",
      },
    };
  }

  const previous = retainedSnapshots[targetIndex - 1];
  if (previous === undefined) return buildNoPriorSnapshotError(toSnapshotId);
  return previous.snapshotId;
}

function buildNoPriorSnapshotError(toSnapshotId: string): DiffToolError {
  return {
    success: false,
    error: "snapshot-not-found",
    errorCode: "snapshot-not-found",
    retryable: false,
    recoveryHints:
      `No prior retained snapshot exists before '${toSnapshotId}' in local history. ` +
      "Capture a fresh baseline with get_page_map (or another read tool), then perform the action you want to observe and diff against that newer snapshot.",
    details: {
      reason: `Snapshot '${toSnapshotId}' is the earliest retained snapshot for this page in local history. There is no prior retained snapshot to use as a baseline.`,
      recoveryHints:
        `No prior retained snapshot exists before '${toSnapshotId}' in local history. ` +
        "Capture a fresh baseline with get_page_map (or another read tool), then perform the action you want to observe and diff against that newer snapshot.",
    },
  };
}
