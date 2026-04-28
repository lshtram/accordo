import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { stitchFrameNodesIntoPageMap } from "./relay-page-frame-tree.js";
import { forwardFrameAction, loadFrameBootstrap, resolveFrameTarget } from "./relay-page-frame-runtime.js";

export async function handleFrameIdRequest(
  request: RelayActionRequest,
  tabId: number,
  frameId: string,
  saveToStore: boolean,
): Promise<RelayActionResponse> {
  const pageMap = await loadFrameBootstrap(request, tabId);
  if (isRelayActionResponse(pageMap)) return pageMap;
  const numericFrameId = await resolveFrameTarget(request, tabId, frameId, pageMap);
  if (typeof numericFrameId !== "number") return numericFrameId;
  return forwardFrameAction(request, tabId, numericFrameId, frameId, saveToStore);
}

function isRelayActionResponse(value: unknown): value is RelayActionResponse {
  return typeof value === "object" && value !== null
    && typeof (value as { requestId?: unknown }).requestId === "string"
    && typeof (value as { success?: unknown }).success === "boolean";
}
