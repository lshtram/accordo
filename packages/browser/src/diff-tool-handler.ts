import type { BrowserRelayLike } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import { RETENTION_SLOTS } from "./snapshot-retention.js";
import type { DiffSnapshotsArgs, DiffSnapshotsResponse, DiffToolError } from "./diff-tool-contracts.js";
import { DIFF_TIMEOUT_MS } from "./diff-tool-contracts.js";
import {
  analyzeEviction,
  extractRelayErrorCode,
  findMissingSnapshotId,
  listAvailableSnapshotIds,
} from "./diff-tool-analysis.js";
import {
  buildTransientRelayError,
  classifyRelayError,
  normalizeSnapshotId,
  parseSnapshotId,
  resolveFreshSnapshot,
  resolveFromSnapshot,
} from "./diff-tool-resolution.js";

export async function handleDiffSnapshots(
  relay: BrowserRelayLike,
  args: DiffSnapshotsArgs,
  store: SnapshotRetentionStore,
): Promise<DiffSnapshotsResponse | DiffToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", retryable: true, retryAfterMs: 2000 };
  }

  let resolvedToSnapshotId = normalizeSnapshotId(args.toSnapshotId);
  let resolvedFromSnapshotId = normalizeSnapshotId(args.fromSnapshotId);

  if (resolvedFromSnapshotId === undefined && resolvedToSnapshotId === undefined) {
    const from = await resolveFreshSnapshot(relay, args.tabId);
    if (typeof from !== "string") return from;
    const to = await resolveFreshSnapshot(relay, args.tabId);
    if (typeof to !== "string") return to;
    resolvedFromSnapshotId = from;
    resolvedToSnapshotId = to;
  } else {
    if (resolvedToSnapshotId === undefined) {
      const resolved = await resolveFreshSnapshot(relay, args.tabId);
      if (typeof resolved !== "string") return resolved;
      resolvedToSnapshotId = resolved;
    }
    if (resolvedFromSnapshotId === undefined) {
      const resolved = await resolveFromSnapshot(relay, resolvedToSnapshotId, args.tabId);
      if (typeof resolved !== "string") return resolved;
      resolvedFromSnapshotId = resolved;
    }
  }

  let orderingWarning: string | undefined;
  const fromParsed = parseSnapshotId(resolvedFromSnapshotId);
  const toParsed = parseSnapshotId(resolvedToSnapshotId);
  if (fromParsed !== null && toParsed !== null && fromParsed.pageId === toParsed.pageId && fromParsed.version > toParsed.version) {
    orderingWarning = `fromSnapshotId (version ${fromParsed.version}) is newer than toSnapshotId (version ${toParsed.version}). The diff may show additions as removals and vice versa.`;
  }

  try {
    const diffPayload: Record<string, unknown> = {
      fromSnapshotId: resolvedFromSnapshotId,
      toSnapshotId: resolvedToSnapshotId,
    };
    if (args.tabId !== undefined) diffPayload.tabId = args.tabId;
    const response = await relay.request("diff_snapshots", diffPayload, DIFF_TIMEOUT_MS);

    if (response.success && response.data && typeof response.data === "object" && "added" in response.data && "removed" in response.data && "changed" in response.data && hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data);
      return { ...response.data, orderingWarning } as DiffSnapshotsResponse;
    }

    if (!response.success) {
      const code = extractRelayErrorCode(response.data, response.error);
      if (code !== undefined) {
        if (code === "snapshot-not-found") {
          const snapshotIdForAnalysis = findMissingSnapshotId(store, resolvedFromSnapshotId, resolvedToSnapshotId);
          const eviction = analyzeEviction(store, snapshotIdForAnalysis);
          const available = listAvailableSnapshotIds(store, snapshotIdForAnalysis);
          const recoveryHints = eviction?.wasEvicted
            ? `The snapshot was evicted because the ${RETENTION_SLOTS}-slot FIFO store is full. Re-capture a fresh snapshot by calling get_page_map (or another read tool) on the target page, then immediately call diff_snapshots with the new snapshotId before capturing more snapshots.`
            : available.length > 0
              ? `Snapshot '${snapshotIdForAnalysis}' does not exist. Available snapshots for this page: [${available.join(", ")}]. Use one of those as fromSnapshotId, or omit fromSnapshotId to auto-derive the previous snapshot.`
              : "The requested snapshot ID does not exist in the retention store. Call get_page_map (or another read tool) to capture a new snapshot, then use the returned snapshotId in diff_snapshots.";
          return {
            success: false,
            error: code,
            retryable: false,
            recoveryHints,
            details: {
              eviction,
              reason: eviction?.wasEvicted
                ? `Snapshot '${eviction.requestedSnapshotId}' was evicted from the ${RETENTION_SLOTS}-slot FIFO retention store.`
                : `Snapshot '${eviction?.requestedSnapshotId ?? snapshotIdForAnalysis}' was not found in the retention store.`,
              recoveryHints,
              availableSnapshotIds: available.length > 0 ? available : undefined,
            },
          };
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
    const error = classifyRelayError(err);
    return { success: false, error, retryable: true, retryAfterMs: error === "browser-not-connected" ? 2000 : 1000 };
  }
}
