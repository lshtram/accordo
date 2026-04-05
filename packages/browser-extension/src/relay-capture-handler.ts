/**
 * relay-capture-handler.ts — Handler implementations for capture_region and diff_snapshots.
 *
 * capture_region: resolve bounds → capture tab → crop/retry → envelope.
 * diff_snapshots: retrieve two snapshots from the store and compute diff.
 *
 * @module
 */

import { computeDiff } from "./diff-engine.js";
import type { VersionedSnapshot } from "./snapshot-versioning.js";
import type { RelayActionRequest, RelayActionResponse, CapturePayload } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { requestContentScriptEnvelope } from "./relay-forwarder.js";
import { toCapturePayload, resolveBoundsFromMessage, toCaptureStoreRecord, readOptionalString } from "./relay-type-guards.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";

// ── Image Capture Constants ──────────────────────────────────────────────────

/** Maximum output dimension in pixels (width or height). */
const MAX_CAPTURE_DIMENSION = 1200;
/** Maximum output size in bytes before retry. */
const MAX_CAPTURE_BYTES = 500_000;
/** Minimum output dimension in pixels (width and height). */
const MIN_CAPTURE_DIMENSION = 10;
/** Default quality for JPEG capture (range 30–85). */
const DEFAULT_QUALITY = 70;
/** Minimum allowed JPEG quality. */
const MIN_QUALITY = 30;
/** Maximum allowed JPEG quality. */
const MAX_QUALITY = 85;
/** Quality reduction step for retry. */
const QUALITY_RETRY_STEP = 10;
/** Default padding around captured region. */
const DEFAULT_PADDING = 8;
/** Maximum padding. */
const MAX_PADDING = 100;

// ── Image Cropping ───────────────────────────────────────────────────────────

/**
 * Crop a data URL image to the given bounds using OffscreenCanvas.
 * Falls back to the original data URL if cropping is not available.
 */
export async function cropImageToBounds(
  dataUrl: string,
  bounds: { x: number; y: number; width: number; height: number },
  quality: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    const width = Math.min(MAX_CAPTURE_DIMENSION, bounds.width);
    const height = Math.min(MAX_CAPTURE_DIMENSION, bounds.height);

    // Decode base64 to ArrayBuffer
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob and use createImageBitmap for async decoding
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    const blob = new Blob([bytes], { type: mimeType });
    const imageBitmap = await createImageBitmap(blob);

    // Create offscreen canvas and crop
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    ctx.drawImage(
      imageBitmap,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, width, height,
    );

    const croppedBlob = await canvas.convertToBlob({ type: mimeType, quality: format === "jpeg" ? quality / 100 : undefined });
    const croppedDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = (): void => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result);
        } else {
          reject(new Error("FileReader result is not a string"));
        }
      };
      reader.readAsDataURL(croppedBlob);
    });

    return { dataUrl: croppedDataUrl, width, height };
  } catch {
    // Cropping not available (e.g. test environment) — return original
    return { dataUrl, width: bounds.width, height: bounds.height };
  }
}

// ── Capture subroutines ──────────────────────────────────────────────────────

/** Resolve padded bounds from payload (rect, anchorKey/nodeRef, or full-viewport fallback).
 *
 * B2-CTX-003: When targetTabId is provided, RESOLVE_ANCHOR_BOUNDS message is sent
 * to that tab instead of querying for the active tab.
 */
async function resolvePaddedBounds(
  payload: CapturePayload,
  padding: number,
  targetTabId?: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let bounds: { x: number; y: number; width: number; height: number } | null = null;

  if (payload.rect) {
    bounds = { ...payload.rect };
  } else if (payload.anchorKey !== undefined || payload.nodeRef !== undefined) {
    // B2-CTX-003: Use targetTabId if provided, otherwise query for active tab
    const tabId = targetTabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId !== undefined) {
      try {
        const resolved = await chrome.tabs.sendMessage(tabId, {
          type: "RESOLVE_ANCHOR_BOUNDS",
          anchorKey: payload.anchorKey,
          nodeRef: payload.nodeRef,
          padding,
        });
        bounds = resolveBoundsFromMessage(resolved);
      } catch {
        // Message delivery failed (no listener) — fall through to full viewport fallback
      }
    }
  }

  if (!bounds) {
    bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  }

  return {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/** Capture the visible tab as JPEG or PNG. Returns dataUrl or throws. */
async function captureVisibleTab(quality: number, format: "jpeg" | "png" = "jpeg"): Promise<string> {
  return chrome.tabs.captureVisibleTab({ format, quality });
}

/** Estimate size in bytes from a data URL base64 string. */
function estimateSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Math.round((base64.length * 3) / 4);
}

/** Build the success result object for a capture. */
async function buildCaptureSuccess(
  dataUrl: string,
  width: number,
  height: number,
  sizeBytes: number,
  anchorSource: string,
  targetTabId?: number,
): Promise<Record<string, unknown>> {
  const envelope = await requestContentScriptEnvelope("visual", targetTabId);
  return {
    success: true,
    dataUrl,
    width,
    height,
    sizeBytes,
    anchorSource,
    ...envelope,
  };
}

/** Retry capture at reduced quality; returns result object. */
async function retryCaptureAtReducedQuality(
  fullDataUrl: string,
  paddedBounds: { x: number; y: number; width: number; height: number },
  quality: number,
  anchorSource: string,
  targetTabId?: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Record<string, unknown>> {
  const reducedQuality = Math.max(MIN_QUALITY, quality - QUALITY_RETRY_STEP);
  const envelope = await requestContentScriptEnvelope("visual", targetTabId);
  try {
    const retryCropped = await cropImageToBounds(fullDataUrl, paddedBounds, reducedQuality, format);
    const retrySize = estimateSizeBytes(retryCropped.dataUrl);
    if (retrySize > MAX_CAPTURE_BYTES) {
      return { success: false, error: "image-too-large", ...envelope };
    }
    return await buildCaptureSuccess(
      retryCropped.dataUrl,
      retryCropped.width,
      retryCropped.height,
      retrySize,
      anchorSource,
      targetTabId,
    );
  } catch {
    return { success: false, error: "image-too-large", ...envelope };
  }
}

// ── Core capture execution ───────────────────────────────────────────────────

/**
 * Execute the capture_region operation: resolve bounds, capture visible tab,
 * crop to target. Returns the raw capture result with SnapshotEnvelope fields.
 *
 * B2-CTX-004: When payload.tabId is a non-active tab, implements tab-swap:
 * 1. Save current active tab ID
 * 2. Activate target tab via chrome.tabs.update
 * 3. Call resolvePaddedBounds (now uses correct tab) and captureVisibleTab
 * 4. Restore original active tab
 */
async function executeCaptureRegion(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const quality = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, payload.quality ?? DEFAULT_QUALITY));
  const format: "jpeg" | "png" = payload.format ?? "jpeg";
  const anchorSource: string = payload.anchorKey ?? payload.nodeRef ?? "rect";
  const padding = Math.min(MAX_PADDING, Math.max(0, payload.padding ?? DEFAULT_PADDING));

  // B2-CTX-004: Tab-swap logic for non-active tab capture
  const targetTabId = payload.tabId;
  let originalTabId: number | undefined;
  let swapped = false;
  if (targetTabId !== undefined) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    originalTabId = activeTab?.id;
    // Only swap if target is different from current active
    if (originalTabId !== targetTabId) {
      await chrome.tabs.update(targetTabId, { active: true });
      swapped = true;
    }
  }

  // GAP-E2: Check if a target is provided — if not in viewport mode, skip cropping
  const hasTarget = payload.anchorKey !== undefined || payload.nodeRef !== undefined || payload.rect !== undefined;

  if (!hasTarget) {
    // GAP-E2: No target provided in viewport mode — return raw full-viewport capture without cropping
    let fullDataUrl: string;
    try {
      fullDataUrl = await captureVisibleTab(quality, format);
    } catch {
      if (swapped && originalTabId !== undefined) {
        await chrome.tabs.update(originalTabId, { active: true });
      }
      const envelope = await requestContentScriptEnvelope("visual", targetTabId);
      return { success: false, error: "capture-failed", ...envelope };
    }

    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    const sizeBytes = estimateSizeBytes(fullDataUrl);

    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }

    return {
      success: true,
      dataUrl: fullDataUrl,
      width: 1920, // raw viewport width
      height: 1080, // raw viewport height
      sizeBytes,
      anchorSource: "viewport",
      mode: "viewport",
      ...envelope,
    };
  }

  const paddedBounds = await resolvePaddedBounds(payload, padding, targetTabId);

  if (paddedBounds.width < MIN_CAPTURE_DIMENSION || paddedBounds.height < MIN_CAPTURE_DIMENSION) {
    // Restore tab before returning if we swapped
    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: "no-target", ...envelope };
  }

  let fullDataUrl: string;
  try {
    fullDataUrl = await captureVisibleTab(quality, format);
  } catch {
    // Restore tab before returning if we swapped
    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: "capture-failed", ...envelope };
  }

  let dataUrl: string;
  let width: number;
  let height: number;
  try {
    const cropped = await cropImageToBounds(fullDataUrl, paddedBounds, quality, format);
    dataUrl = cropped.dataUrl;
    width = cropped.width;
    height = cropped.height;
  } catch {
    dataUrl = fullDataUrl;
    width = Math.min(MAX_CAPTURE_DIMENSION, paddedBounds.width);
    height = Math.min(MAX_CAPTURE_DIMENSION, paddedBounds.height);
  }

  const sizeBytes = estimateSizeBytes(dataUrl);

  // Restore original tab before any envelope request (envelope should reflect original tab context)
  if (swapped && originalTabId !== undefined) {
    await chrome.tabs.update(originalTabId, { active: true });
  }

  if (sizeBytes > MAX_CAPTURE_BYTES && quality > MIN_QUALITY) {
    return retryCaptureAtReducedQuality(fullDataUrl, paddedBounds, quality, anchorSource, targetTabId, format);
  }

  return buildCaptureSuccess(dataUrl, width, height, sizeBytes, anchorSource, targetTabId);
}

// ── Full-Page Capture (P4-CR) ───────────────────────────────────────────────

/**
 * Execute a full-page screenshot capture via CDP.
 *
 * When mode === "fullPage", this function is called instead of executeCaptureRegion.
 * It uses chrome.debugger (via DebuggerManager) to execute CDP Page.captureScreenshot
 * with captureBeyondViewport: true, which captures the entire scrollable page.
 *
 * B2-CTX-004: Tab-swap logic applies for non-active tab targeting.
 */
async function executeCaptureFullPage(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const targetTabId = payload.tabId;
  let originalTabId: number | undefined;
  let swapped = false;
  if (targetTabId !== undefined) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    originalTabId = activeTab?.id;
    if (originalTabId !== targetTabId) {
      await chrome.tabs.update(targetTabId, { active: true });
      swapped = true;
    }
  }

  const envelope = await requestContentScriptEnvelope("visual", targetTabId);

  if (targetTabId === undefined) {
    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }
    return { success: false, error: "browser-not-connected", ...envelope };
  }

  try {
    // Ensure debugger is attached to the target tab
    await ensureAttached(targetTabId);

    // Capture full page via CDP
    const format: "jpeg" | "png" = payload.format ?? "jpeg";
    const cdpResult = await sendCommand<{ data: string; width: number; height: number }>(
      targetTabId,
      "Page.captureScreenshot",
      { captureBeyondViewport: true, format },
    );

    // Convert base64 image to data URL with correct mime type
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = `data:${mimeType};base64,${cdpResult.data}`;
    const sizeBytes = Math.round((cdpResult.data.length * 3) / 4);

    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }

    return {
      success: true,
      dataUrl,
      width: cdpResult.width,
      height: cdpResult.height,
      sizeBytes,
      anchorSource: "fullPage",
      mode: "fullPage",
      ...envelope,
    };
  } catch (err) {
    if (swapped && originalTabId !== undefined) {
      await chrome.tabs.update(originalTabId, { active: true });
    }
    const errorMsg = err instanceof Error ? err.message : "capture-failed";
    // Classify common CDP errors
    if (errorMsg.includes("not attached") || errorMsg.includes("disconnected")) {
      return { success: false, error: "browser-not-connected", ...envelope };
    }
    if (errorMsg.includes("unsupported-page")) {
      return { success: false, error: "unsupported-page", ...envelope };
    }
    return { success: false, error: "capture-failed", ...envelope };
  }
}

// ── Capture Region Handler ───────────────────────────────────────────────────

/** Persist a successful capture result to the snapshot store. */
async function persistCaptureResult(captureResult: Record<string, unknown>): Promise<void> {
  if (captureResult.success !== true || typeof captureResult.pageId !== "string") {
    return;
  }
  if (isVersionedSnapshot(captureResult)) {
    await defaultStore.save(captureResult.pageId, captureResult);
    return;
  }
  const record = toCaptureStoreRecord(captureResult);
  if (record) {
    await defaultStore.save(record.pageId, record);
  }
}

export async function handleCaptureRegion(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const capturePayload = toCapturePayload(request.payload);

  // P4-CR: Route to full-page capture when mode is "fullPage"
  let captureResult: Record<string, unknown>;
  if (capturePayload.mode === "fullPage") {
    captureResult = await executeCaptureFullPage(capturePayload);
  } else {
    captureResult = await executeCaptureRegion(capturePayload);
  }

  // B2-SV-004: persist successful captures in the store for retention.
  await persistCaptureResult(captureResult);

  return { requestId: request.requestId, success: true, data: captureResult };
}

// ── Diff Snapshots Handler ───────────────────────────────────────────────────

export async function handleDiffSnapshots(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const fromSnapshotId = readOptionalString(request.payload, "fromSnapshotId");
  const toSnapshotId = readOptionalString(request.payload, "toSnapshotId");

  if (fromSnapshotId === undefined || toSnapshotId === undefined) {
    return { requestId: request.requestId, success: false, error: "invalid-request" };
  }

  const fromResult = await defaultStore.get(fromSnapshotId);
  if ("error" in fromResult) {
    const errorCode = defaultStore.isStale(fromSnapshotId) ? "snapshot-stale" : "snapshot-not-found";
    return { requestId: request.requestId, success: false, error: errorCode };
  }

  const toResult = await defaultStore.get(toSnapshotId);
  if ("error" in toResult) {
    const errorCode = defaultStore.isStale(toSnapshotId) ? "snapshot-stale" : "snapshot-not-found";
    return { requestId: request.requestId, success: false, error: errorCode };
  }

  const diffResult = computeDiff(fromResult, toResult);
  return { requestId: request.requestId, success: true, data: diffResult };
}
