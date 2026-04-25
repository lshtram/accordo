import { computeDiff } from "./diff-engine.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, getErrorMeta } from "./relay-definitions.js";
import { readOptionalString } from "./relay-type-guards.js";

async function diffViaContentScript(
  tabId: number,
  fromSnapshotId: string,
  toSnapshotId: string,
  requestId: string,
): Promise<RelayActionResponse | null> {
  try {
    const csResponse = await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_UNDERSTANDING_ACTION",
      action: "diff_snapshots",
      payload: { fromSnapshotId, toSnapshotId },
    });
    if (!csResponse) return null;
    if (typeof csResponse.error === "string") {
      const err = csResponse.error;
      const meta = getErrorMeta(err);
      return {
        requestId,
        success: false,
        error: err as RelayActionResponse["error"],
        ...meta,
      };
    }
    if (csResponse.data !== undefined) {
      return { requestId, success: true, data: csResponse.data };
    }
    return null;
  } catch {
    return null;
  }
}

export async function handleDiffSnapshots(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const fromSnapshotId = readOptionalString(request.payload, "fromSnapshotId");
  const toSnapshotId = readOptionalString(request.payload, "toSnapshotId");

  if (fromSnapshotId === undefined || toSnapshotId === undefined) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }

  const explicitTabId = typeof request.payload.tabId === "number" ? request.payload.tabId : undefined;

  let fromResult: Awaited<ReturnType<typeof defaultStore.get>> | undefined;
  let toResult: Awaited<ReturnType<typeof defaultStore.get>> | undefined;

  if (explicitTabId === undefined) {
    fromResult = await defaultStore.get(fromSnapshotId);
    toResult = await defaultStore.get(toSnapshotId);
    if (!("error" in fromResult) && !("error" in toResult)) {
      const diffResult = computeDiff(fromResult, toResult);
      return { requestId: request.requestId, success: true, data: diffResult };
    }
  }

  const activeTabResult = explicitTabId === undefined
    ? await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[])
    : [];
  const tabId = explicitTabId ?? activeTabResult[0]?.id;

  if (tabId !== undefined) {
    const csResult = await diffViaContentScript(tabId, fromSnapshotId, toSnapshotId, request.requestId);
    if (csResult !== null) return csResult;
  }

  if (fromResult !== undefined && "error" in fromResult) {
    const errorCode = defaultStore.isStale(fromSnapshotId) ? "snapshot-stale" : "snapshot-not-found";
    return { requestId: request.requestId, success: false, error: errorCode, ...getErrorMeta(errorCode) };
  }
  if (toResult !== undefined && "error" in toResult) {
    const errorCode = defaultStore.isStale(toSnapshotId) ? "snapshot-stale" : "snapshot-not-found";
    return { requestId: request.requestId, success: false, error: errorCode, ...getErrorMeta(errorCode) };
  }
  return { requestId: request.requestId, success: false, error: "snapshot-not-found", ...getErrorMeta("snapshot-not-found") };
}
