import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { forwardToFrame, NO_CONTENT_SCRIPT } from "./relay-forwarder.js";

async function buildFramePathIndex(tabId: number): Promise<Map<string, number>> {
  const pathIndex = new Map<string, number>([["main", 0]]);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || frames.length === 0) {
    return pathIndex;
  }

  await Promise.all(
    frames
      .filter((frame) => frame.frameId !== 0)
      .map(async (frame) => {
        const framePath = await forwardToFrame(tabId, frame.frameId, "get_frame_path", {});
        if (framePath && typeof framePath === "object" && typeof (framePath as { frameId?: unknown }).frameId === "string") {
          pathIndex.set((framePath as { frameId: string }).frameId, frame.frameId);
        }
      }),
  );

  return pathIndex;
}

function findIframeMetadataByPath(
  iframes: Array<Record<string, unknown>>,
  frameId: string,
): Record<string, unknown> | undefined {
  for (const iframe of iframes) {
    if (iframe.frameId === frameId) {
      return iframe;
    }
    const nested = Array.isArray(iframe.iframes)
      ? findIframeMetadataByPath(iframe.iframes as Array<Record<string, unknown>>, frameId)
      : undefined;
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

async function stitchIframeNodes(
  tabId: number,
  iframes: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
  framePathIndex: Map<string, number>,
): Promise<void> {
  await Promise.all(
    iframes.map(async (iframe) => {
      const logicalFrameId = typeof iframe.frameId === "string" ? iframe.frameId : undefined;
      if (logicalFrameId === undefined || iframe.sameOrigin !== true) {
        return;
      }

      const numericFrameId = framePathIndex.get(logicalFrameId);
      if (numericFrameId === undefined) {
        return;
      }

      const fresh = await forwardToFrame(
        tabId,
        numericFrameId,
        "get_page_map",
        { ...payload, traverseFrames: true, logicalFrameId },
      );

      if (fresh && typeof fresh === "object") {
        if (Array.isArray((fresh as { nodes?: unknown[] }).nodes)) {
          iframe.nodes = (fresh as { nodes: unknown[] }).nodes;
        }
        if (Array.isArray((fresh as { iframes?: unknown[] }).iframes)) {
          iframe.iframes = (fresh as { iframes: unknown[] }).iframes;
          await stitchIframeNodes(
            tabId,
            iframe.iframes as Array<Record<string, unknown>>,
            payload,
            framePathIndex,
          );
        }
      }
    }),
  );
}

export async function handleFrameIdRequest(
  request: RelayActionRequest,
  tabId: number,
  frameId: string,
  saveToStore: boolean,
): Promise<RelayActionResponse> {
  const pageMapData = await forwardToFrame(tabId, 0, "get_page_map", {
    traverseFrames: true,
    allowedOrigins: (request.payload as Record<string, unknown>).allowedOrigins,
    deniedOrigins: (request.payload as Record<string, unknown>).deniedOrigins,
    redactPII: (request.payload as Record<string, unknown>).redactPII,
  });
  if (pageMapData === NO_CONTENT_SCRIPT) {
    return actionFailed(request, "no-content-script");
  }
  if (pageMapData === null) {
    return actionFailed(request);
  }

  const pageMap = pageMapData as Record<string, unknown>;
  const iframes = Array.isArray(pageMap.iframes) ? pageMap.iframes as Array<Record<string, unknown>> : [];

  const framePathIndex = await buildFramePathIndex(tabId);
  await stitchIframeNodes(tabId, iframes, request.payload as Record<string, unknown>, framePathIndex);

  const iframe = findIframeMetadataByPath(iframes, frameId);
  if (!iframe) {
    return actionFailed(request);
  }

  if (iframe.sameOrigin === false) {
    return actionFailed(request, "iframe-cross-origin");
  }

  const numericFrameId = framePathIndex.get(frameId);
  if (numericFrameId === undefined) {
    return actionFailed(request);
  }

  const { frameId: _frameId, ...forwardPayload } = request.payload as Record<string, unknown>;
  const data = await forwardToFrame(tabId, numericFrameId, request.action, {
    ...forwardPayload,
    logicalFrameId: frameId,
  });
  if (data === NO_CONTENT_SCRIPT) {
    return actionFailed(request, "no-content-script");
  }
  if (data === null) {
    return actionFailed(request);
  }
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return { requestId: request.requestId, success: true, data };
}

export async function stitchFrameNodesIntoPageMap(
  tabId: number,
  result: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!Array.isArray(result.iframes)) {
    return;
  }
  const framePathIndex = await buildFramePathIndex(tabId);
  await stitchIframeNodes(tabId, result.iframes as Array<Record<string, unknown>>, payload, framePathIndex);
}
