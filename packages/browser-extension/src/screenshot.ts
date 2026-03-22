/**
 * M80-SCREEN — Screenshot Capture
 *
 * Captures visible tab screenshot via chrome.tabs.captureVisibleTab().
 * Stores one ScreenshotRecord per URL in chrome.storage.local.
 */

import type { ScreenshotRecord } from "./types.js";
import { normalizeUrl } from "./store.js";

const QUOTA_THRESHOLD = 8 * 1024 * 1024; // 8MB in bytes

/**
 * Returns the storage key for a screenshot.
 * Format: "screenshot:{normalizedUrl}"
 */
export function getScreenshotKey(normalizedUrl: string): string {
  return `screenshot:${normalizedUrl}`;
}

/**
 * Captures the visible tab screenshot and stores it keyed by the tab's URL.
 * Overwrites any previous screenshot for that URL.
 * Checks quota after storing and warns + purges if over 8MB.
 */
export async function captureScreenshot(
  tabId: number
): Promise<ScreenshotRecord & { pageUrl: string }> {
  // Get the tab's URL
  const tab = await chrome.tabs.get(tabId);
  const rawUrl = tab.url ?? "https://unknown.com/";
  const pageUrl = normalizeUrl(rawUrl);

  // Capture visible tab as JPEG at quality 0.7 (BR-F-81 / BR-NF-11)
  // Signature: captureVisibleTab(windowId?: number, options?: CaptureVisibleTabOptions)
  // The options object must be the SECOND argument, not the first.
  const dataUrl: string = await chrome.tabs.captureVisibleTab({
    format: "jpeg",
    quality: 70,
  });

  const record = {
    dataUrl,
    capturedAt: Date.now(),
    width: 1280,
    height: 720,
    pageUrl,
  } satisfies ScreenshotRecord & { pageUrl: string };

  const key = getScreenshotKey(pageUrl);
  await chrome.storage.local.set({ [key]: record });

  // Check quota
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  if (bytesInUse >= QUOTA_THRESHOLD) {
    console.warn(`[Accordo] Storage quota warning: ${bytesInUse} bytes used (threshold: 8MB). Purging oldest screenshot.`);
    await purgeOldestScreenshot(key);
  }

  return record;
}

/**
 * Purges the oldest screenshot record from storage (excluding the just-captured one).
 */
async function purgeOldestScreenshot(keepKey: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith("screenshot:") || k === keepKey) continue;
    const rec = v as ScreenshotRecord;
    if (rec.capturedAt < oldestTime) {
      oldestTime = rec.capturedAt;
      oldestKey = k;
    }
  }

  if (oldestKey) {
    await chrome.storage.local.remove(oldestKey);
  }
}

/**
 * Retrieves a stored screenshot by normalized URL.
 * Returns null if none exists.
 */
export async function getScreenshot(
  normalizedUrl: string
): Promise<ScreenshotRecord | null> {
  const normalized = normalizeUrl(normalizedUrl);
  const key = getScreenshotKey(normalized);
  const result = await chrome.storage.local.get(key);
  const record = result[key] as ScreenshotRecord | undefined;
  return record ?? null;
}
