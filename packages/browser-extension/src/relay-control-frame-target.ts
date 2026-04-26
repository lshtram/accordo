import { NO_CONTENT_SCRIPT, forwardToFrame, forwardToMainFrame } from "./relay-forwarder.js";

function parseUidFrameKey(uid?: string): string | undefined {
  if (!uid) return undefined;
  const colonIdx = uid.indexOf(":");
  if (colonIdx <= 0) return undefined;
  return uid.slice(0, colonIdx);
}

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

async function buildFramePathIndexResult(tabId: number): Promise<{ pathIndex: Map<string, number>; noContentScript: boolean }> {
  const pathIndex = new Map<string, number>([["main", 0]]);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || frames.length === 0) {
    return { pathIndex, noContentScript: false };
  }

  let noContentScript = false;
  await Promise.all(
    frames.filter((frame) => frame.frameId !== 0).map(async (frame) => {
      const framePath = await forwardToFrame(tabId, frame.frameId, "get_frame_path", {});
      if (framePath === NO_CONTENT_SCRIPT || framePath === null) {
        noContentScript = true;
        return;
      }
      if (framePath && typeof framePath === "object" && typeof (framePath as { frameId?: unknown }).frameId === "string") {
        pathIndex.set((framePath as { frameId: string }).frameId, frame.frameId);
      }
    }),
  );
  return { pathIndex, noContentScript };
}

function findIframeByPath(
  iframes: Array<Record<string, unknown>>,
  frameId: string,
  accumulatedOffsetX: number = 0,
  accumulatedOffsetY: number = 0,
): { iframe: Record<string, unknown>; offsetX: number; offsetY: number } | null {
  for (const iframe of iframes) {
    const rawBounds = typeof iframe.bounds === "object" && iframe.bounds !== null
      ? iframe.bounds as Record<string, unknown>
      : {};
    const nextOffsetX = accumulatedOffsetX + (typeof rawBounds.x === "number" ? rawBounds.x : 0);
    const nextOffsetY = accumulatedOffsetY + (typeof rawBounds.y === "number" ? rawBounds.y : 0);

    if (iframe.frameId === frameId) {
      return { iframe, offsetX: nextOffsetX, offsetY: nextOffsetY };
    }

    if (Array.isArray(iframe.iframes)) {
      const nested = findIframeByPath(iframe.iframes as Array<Record<string, unknown>>, frameId, nextOffsetX, nextOffsetY);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export type ControlFrameTarget = {
  frameId: number;
  offsetX: number;
  offsetY: number;
};

export type ControlFrameTargetResult =
  | { ok: true; target: ControlFrameTarget }
  | { ok: false; error: "iframe-cross-origin" | "element-not-found" | "no-content-script" | "action-failed" };

export async function resolveControlFrameTarget(tabId: number, uid?: string): Promise<ControlFrameTargetResult> {
  const frameKey = parseUidFrameKey(uid);
  if (!frameKey || frameKey === "main") {
    return { ok: true, target: { frameId: 0, offsetX: 0, offsetY: 0 } };
  }

  const pageMapData = await forwardToMainFrame(tabId, "get_page_map", { traverseFrames: true });
  if (pageMapData === NO_CONTENT_SCRIPT || pageMapData === null) {
    return { ok: false, error: pageMapData === NO_CONTENT_SCRIPT ? "no-content-script" : "action-failed" };
  }

  const pageMap = pageMapData as Record<string, unknown>;
  const iframes = Array.isArray(pageMap.iframes) ? pageMap.iframes as Array<Record<string, unknown>> : [];
  const match = findIframeByPath(iframes, frameKey);
  if (!match) {
    return { ok: false, error: "element-not-found" };
  }
  if (match.iframe.sameOrigin === false) {
    return { ok: false, error: "iframe-cross-origin" };
  }

  const { pathIndex: framePathIndex, noContentScript } = await buildFramePathIndexResult(tabId);
  const frameId = framePathIndex.get(frameKey);
  if (frameId === undefined) {
    return { ok: false, error: noContentScript ? "no-content-script" : "element-not-found" };
  }

  return { ok: true, target: { frameId, offsetX: match.offsetX, offsetY: match.offsetY } };
}
