import type { BrowserRelayLike } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { DiffSnapshotsArgs, DiffSnapshotsResponse, DiffToolError } from "./diff-tool-contracts.js";
import { DIFF_TIMEOUT_MS } from "./diff-tool-contracts.js";
import { classifyThrownRelayError, getRelayRetryAfterMs } from "./relay-error-policy.js";
import { extractRelayErrorCode } from "./diff-tool-analysis.js";
import { buildTransientRelayError, normalizeSnapshotId, parseSnapshotId, resolveFreshSnapshot, resolveFromSnapshot } from "./diff-tool-resolution.js";
import { resolveBothOmittedFromStore } from "./diff-snapshots-retained-pair.js";
import { shapeSnapshotNotFoundError } from "./diff-snapshots-error.js";

export async function handleDiffSnapshots(
  relay: BrowserRelayLike,
  args: DiffSnapshotsArgs,
  store: SnapshotRetentionStore,
): Promise<DiffSnapshotsResponse | DiffToolError> {
  if (!relay.isConnected()) {
    return {
      success: false,
      error: "browser-not-connected",
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("browser-not-connected"),
    };
  }

  let resolvedToSnapshotId = normalizeSnapshotId(args.toSnapshotId);
  let resolvedFromSnapshotId = normalizeSnapshotId(args.fromSnapshotId);

if (resolvedFromSnapshotId === undefined && resolvedToSnapshotId === undefined) {
    // Design point 4: both IDs omitted → resolve from retained pair (no fresh capture)
    const result = resolveBothOmittedFromStore(store);
    if (!("fromSnapshotId" in result)) return result;
    resolvedFromSnapshotId = result.fromSnapshotId;
    resolvedToSnapshotId = result.toSnapshotId;
  } else if (resolvedToSnapshotId === undefined) {
    // Design point 5: only from supplied → capture fresh, persist locally, diff from+new
    const resolved = await resolveFreshSnapshot(relay, args.tabId);
    if (!("snapshotId" in resolved)) return resolved;
    resolvedToSnapshotId = resolved.snapshotId;
    store.save(resolved.envelope.pageId, resolved.envelope, args.tabId);
  } else if (resolvedFromSnapshotId === undefined) {
    // Only to supplied → derive previous from local store (existing behavior)
    const resolved = resolveFromSnapshot(store, resolvedToSnapshotId);
    if (typeof resolved !== "string") return resolved;
    resolvedFromSnapshotId = resolved;
  }

  // Both IDs are guaranteed to be defined after the resolution branches above.
  // TypeScript cannot track the reassignment through the conditional branches,
  // so we use type casts (safe because control flow is explicit).
  const fromId = resolvedFromSnapshotId as string;
  const toId = resolvedToSnapshotId as string;

  let orderingWarning: string | undefined;
  const fromParsed = parseSnapshotId(fromId);
  const toParsed = parseSnapshotId(toId);
  if (fromParsed !== null && toParsed !== null && fromParsed.pageId === toParsed.pageId && fromParsed.version > toParsed.version) {
    orderingWarning = `fromSnapshotId (version ${fromParsed.version}) is newer than toSnapshotId (version ${toParsed.version}). The diff may show additions as removals and vice versa.`;
  }

  try {
    const diffPayload: Record<string, unknown> = {
      fromSnapshotId: fromId,
      toSnapshotId: toId,
    };
    // B2-CTX-002 / design point 3: recover tabId only when both explicit IDs
    // are provided, belong to the SAME page (cross-page diffs do NOT get recovery),
    // and the caller omitted tabId. Otherwise relay uses active tab.
    if (
      args.tabId === undefined &&
      fromParsed !== null &&
      toParsed !== null &&
      fromParsed.pageId === toParsed.pageId
    ) {
      const recoveredTabId = store.getTabId(fromParsed.pageId);
      if (recoveredTabId !== undefined) diffPayload.tabId = recoveredTabId;
    } else if (args.tabId !== undefined) {
      diffPayload.tabId = args.tabId;
    }
    const response = await relay.request("diff_snapshots", diffPayload, DIFF_TIMEOUT_MS);

    if (response.success && response.data && typeof response.data === "object" && "added" in response.data && "removed" in response.data && "changed" in response.data && hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data);
      return { ...response.data, orderingWarning } as DiffSnapshotsResponse;
    }

    if (!response.success) {
      const code = extractRelayErrorCode(response.data, response.error);
      if (code !== undefined) {
        if (code === "snapshot-not-found") {
          // Design point 6: use extracted helper for mismatch vs. normal missing
          return shapeSnapshotNotFoundError(fromId, toId, store);
        }
        if (code === "snapshot-stale") {
          const recoveryHints = "Call get_page_map (or another read tool) on the current page to capture a fresh snapshot, then call diff_snapshots with the new snapshotId. To diff two different pages, capture a snapshot on each page separately and use diff_snapshots with explicit fromSnapshotId and toSnapshotId.";
          return {
            success: false,
            error: code,
            retryable: false,
            recoveryHints,
            details: {
              reason: "The requested snapshot belongs to a previous navigation and cannot be diffed against the current page state. Snapshots are scoped to a single navigation — they become stale when the page navigates away.",
              recoveryHints,
            },
          };
        }
        return { success: false, error: code, retryable: false };
      }
      const transient = buildTransientRelayError(response.error);
      if (transient !== undefined) return transient;
    }

    return { success: false, error: "action-failed", retryable: false };
  } catch (err: unknown) {
    const error = classifyThrownRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: getRelayRetryAfterMs(error) };
  }
}
