import type { CapturePayload } from "./relay-definitions.js";
import { resolveBoundsFromMessage } from "./relay-type-guards.js";

class ResolveBoundsError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ResolveBoundsError";
  }
}

export async function resolvePaddedBounds(
  payload: CapturePayload,
  padding: number,
  targetTabId?: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  let bounds: { x: number; y: number; width: number; height: number } | null = null;
  const hasUsableRect = payload.rect !== undefined && payload.rect.width > 0 && payload.rect.height > 0;

  if (hasUsableRect) {
    const rect = payload.rect;
    if (!rect) return null;
    bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } else if (payload.anchorKey !== undefined || payload.nodeRef !== undefined) {
    const tabId = targetTabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId !== undefined) {
      try {
        const resolved = await chrome.tabs.sendMessage(tabId, {
          type: "RESOLVE_ANCHOR_BOUNDS",
          anchorKey: payload.anchorKey,
          nodeRef: payload.nodeRef,
          padding,
        });
        const result = resolveBoundsFromMessage(resolved);
        if (result === null) {
          bounds = null;
        } else if ("error" in result) {
          throw new ResolveBoundsError((result as { error: string }).error);
        } else {
          bounds = result.bounds;
        }
      } catch (err) {
        if ((err as Error)?.name === "ResolveBoundsError") throw err;
      }
    }
  }

  if (!bounds) return null;
  return {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

export function getResolveBoundsErrorCode(err: unknown): string | undefined {
  return err instanceof ResolveBoundsError ? err.code : undefined;
}
