import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import { DIFF_TIMEOUT_MS, type DiffToolError } from "./diff-tool-contracts.js";
import { extractRelayErrorCode } from "./diff-tool-analysis.js";
import { classifyThrownRelayError, getRelayRetryAfterMs } from "./relay-error-policy.js";

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
    return { success: false, error: "browser-not-connected", retryable: true, retryAfterMs: getRelayRetryAfterMs("browser-not-connected") };
  }
  if (topLevelError === "timeout") {
    return { success: false, error: "timeout", retryable: true, retryAfterMs: getRelayRetryAfterMs("timeout") };
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
    const error = classifyThrownRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: getRelayRetryAfterMs(error) };
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
    const error = classifyThrownRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: getRelayRetryAfterMs(error) };
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
