/**
 * relay-snapshot-handlers.ts — Snapshot management relay actions.
 *
 * Handler: handleManageSnapshots.
 * Split into list/clear helpers (each <= 30 lines).
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, getErrorMeta } from "./relay-definitions.js";

// ── List handler ────────────────────────────────────────────────────────────

function handleSnapshotList(request: RelayActionRequest): RelayActionResponse {
  const allPages = defaultStore.listAll();
  const pages = Array.from(allPages.entries(), ([pageId, snapshots]) => ({
    pageId,
    snapshotCount: snapshots.length,
    snapshots: snapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      source: snapshot.source,
    })),
  }));
  return { requestId: request.requestId, success: true, data: { pages } };
}

// ── Clear handler ───────────────────────────────────────────────────────────

function handleSnapshotClear(request: RelayActionRequest): RelayActionResponse {
  const pageId = typeof request.payload.pageId === "string" ? request.payload.pageId : undefined;
  const allPages = defaultStore.listAll();
  if (pageId !== undefined) {
    const clearedCount = allPages.get(pageId)?.length ?? 0;
    defaultStore.clear(pageId);
    return { requestId: request.requestId, success: true, data: { success: true, clearedPageId: pageId, clearedCount } };
  }
  const clearedCount = Array.from(allPages.values()).reduce((sum, s) => sum + s.length, 0);
  defaultStore.clear();
  return { requestId: request.requestId, success: true, data: { success: true, clearedCount } };
}

// ── Coordinator (<= 30 lines) ───────────────────────────────────────────────

export async function handleManageSnapshots(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const action = request.payload.action;
  if (action !== "list" && action !== "clear") {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  return action === "list" ? handleSnapshotList(request) : handleSnapshotClear(request);
}