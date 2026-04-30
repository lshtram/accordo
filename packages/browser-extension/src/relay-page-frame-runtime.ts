import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { forwardToFrame, NO_CONTENT_SCRIPT, reinjectAndForwardToFrame } from "./relay-forwarder.js";
import { buildSpatialErrorResponse, readSpatialError } from "./relay-page-spatial-errors.js";
import { buildFramePathIndex, findIframeMetadataByPath, stitchIframeNodes } from "./relay-page-frame-tree.js";

function pageMapPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    traverseFrames: true,
    allowedOrigins: payload.allowedOrigins,
    deniedOrigins: payload.deniedOrigins,
    redactPII: payload.redactPII,
  };
}

export async function loadFrameBootstrap(
  request: RelayActionRequest,
  tabId: number,
): Promise<Record<string, unknown> | RelayActionResponse> {
  let pageMapData = await forwardToFrame(tabId, 0, "get_page_map", pageMapPayload(request.payload));
  if (pageMapData === NO_CONTENT_SCRIPT) {
    try {
      pageMapData = await reinjectAndForwardToFrame(tabId, 0, "get_page_map", pageMapPayload(request.payload));
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (pageMapData === NO_CONTENT_SCRIPT) return actionFailed(request, "no-content-script");
  }
  return pageMapData === null ? actionFailed(request) : pageMapData as Record<string, unknown>;
}

export async function resolveFrameTarget(
  request: RelayActionRequest,
  tabId: number,
  frameId: string,
  pageMap: Record<string, unknown>,
): Promise<number | RelayActionResponse> {
  const iframes = Array.isArray(pageMap.iframes) ? pageMap.iframes as Array<Record<string, unknown>> : [];
  const framePathIndex = await buildFramePathIndex(tabId);
  await stitchIframeNodes(tabId, iframes, request.payload, framePathIndex);
  const iframe = findIframeMetadataByPath(iframes, frameId);
  if (!iframe) return actionFailed(request);
  if (iframe.sameOrigin === false) return actionFailed(request, "iframe-cross-origin");
  const indexedFrameId = framePathIndex.get(frameId);
  if (indexedFrameId !== undefined) return indexedFrameId;
  const iframeSrc = typeof iframe.src === "string" ? iframe.src : undefined;
  if (iframeSrc !== undefined) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
    const matches = Array.isArray(frames) ? frames.filter((frame) => frame.frameId !== 0 && frame.url === iframeSrc) : [];
    if (matches.length === 1 && matches[0]?.frameId !== undefined) return matches[0].frameId;
  }
  return actionFailed(request);
}

export async function forwardFrameAction(
  request: RelayActionRequest,
  tabId: number,
  numericFrameId: number,
  frameId: string,
  saveToStore: boolean,
): Promise<RelayActionResponse> {
  const { frameId: _frameId, ...forwardPayload } = request.payload as Record<string, unknown>;
  let data = await forwardToFrame(tabId, numericFrameId, request.action, { ...forwardPayload, logicalFrameId: frameId });
  if (data === NO_CONTENT_SCRIPT) {
    try {
      data = await reinjectAndForwardToFrame(tabId, numericFrameId, request.action, { ...forwardPayload, logicalFrameId: frameId });
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (data === NO_CONTENT_SCRIPT) return actionFailed(request, "no-content-script");
  }
  if (data === null) return actionFailed(request);
  const spatialError = readSpatialError(request.action, data);
  if (spatialError) return buildSpatialErrorResponse(request, spatialError);
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return { requestId: request.requestId, success: true, data };
}
