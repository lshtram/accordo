import { forwardToFrame } from "./relay-forwarder.js";

export async function buildFramePathIndex(tabId: number): Promise<Map<string, number>> {
  const pathIndex = new Map<string, number>([["main", 0]]);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || frames.length === 0) return pathIndex;
  await Promise.all(frames.filter((frame) => frame.frameId !== 0).map(async (frame) => {
    const framePath = await forwardToFrame(tabId, frame.frameId, "get_frame_path", {});
    const logical = framePath && typeof framePath === "object"
      ? (framePath as { frameId?: unknown }).frameId
      : undefined;
    if (typeof logical === "string") pathIndex.set(logical, frame.frameId);
  }));
  return pathIndex;
}

export function findIframeMetadataByPath(
  iframes: Array<Record<string, unknown>>,
  frameId: string,
): Record<string, unknown> | undefined {
  for (const iframe of iframes) {
    if (iframe.frameId === frameId) return iframe;
    const nested = Array.isArray(iframe.iframes)
      ? findIframeMetadataByPath(iframe.iframes as Array<Record<string, unknown>>, frameId)
      : undefined;
    if (nested) return nested;
  }
  return undefined;
}

export async function stitchIframeNodes(
  tabId: number,
  iframes: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
  framePathIndex: Map<string, number>,
): Promise<void> {
  await Promise.all(iframes.map(async (iframe) => {
    const logicalFrameId = typeof iframe.frameId === "string" ? iframe.frameId : undefined;
    if (logicalFrameId === undefined || iframe.sameOrigin !== true) return;
    const numericFrameId = framePathIndex.get(logicalFrameId);
    if (numericFrameId === undefined) return;
    const fresh = await forwardToFrame(tabId, numericFrameId, "get_page_map", {
      ...payload,
      traverseFrames: true,
      logicalFrameId,
    });
    if (!fresh || typeof fresh !== "object") return;
    if (Array.isArray((fresh as { nodes?: unknown[] }).nodes)) {
      iframe.nodes = (fresh as { nodes: unknown[] }).nodes;
    }
    if (Array.isArray((fresh as { iframes?: unknown[] }).iframes)) {
      iframe.iframes = (fresh as { iframes: unknown[] }).iframes;
      await stitchIframeNodes(tabId, iframe.iframes as Array<Record<string, unknown>>, payload, framePathIndex);
    }
  }));
}

export async function stitchFrameNodesIntoPageMap(
  tabId: number,
  result: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!Array.isArray(result.iframes)) return;
  const framePathIndex = await buildFramePathIndex(tabId);
  await stitchIframeNodes(tabId, result.iframes as Array<Record<string, unknown>>, payload, framePathIndex);
}
