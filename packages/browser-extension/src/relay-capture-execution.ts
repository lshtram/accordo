import type { CapturePayload } from "./relay-definitions.js";
import { getErrorMeta } from "./relay-definitions.js";
import { requestContentScriptEnvelope } from "./relay-forwarder.js";
import {
  buildCaptureSuccess,
  captureVisibleTab,
  cropImageToBounds,
  DEFAULT_PADDING,
  DEFAULT_QUALITY,
  estimateSizeBytes,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_DIMENSION,
  MAX_PADDING,
  MAX_QUALITY,
  MIN_CAPTURE_DIMENSION,
  MIN_QUALITY,
  retryCaptureAtReducedQuality,
} from "./relay-capture-image.js";
import { getResolveBoundsErrorCode, resolvePaddedBounds } from "./relay-capture-bounds.js";
import { executeCaptureFullPage, executeCaptureViewport } from "./relay-capture-cdp-modes.js";
import { prepareCaptureTab, restoreCaptureTab } from "./relay-capture-tab-target.js";

export async function executeCaptureRegion(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const quality = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, payload.quality ?? DEFAULT_QUALITY));
  const format: "jpeg" | "png" | "webp" = payload.format ?? "jpeg";
  const anchorSource: string = payload.anchorKey ?? payload.nodeRef ?? "rect";
  const padding = Math.min(MAX_PADDING, Math.max(0, payload.padding ?? DEFAULT_PADDING));

  const context = await prepareCaptureTab(payload.tabId);
  const targetTabId = context.targetTabId;

  const hasTarget = payload.anchorKey !== undefined || payload.nodeRef !== undefined || payload.rect !== undefined;
  if (!hasTarget) {
    await restoreCaptureTab(context);
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: "no-target", ...getErrorMeta("no-target"), ...envelope };
  }

  let resolveError: string | undefined;
  let paddedBounds: { x: number; y: number; width: number; height: number } | null = null;
  try {
    paddedBounds = await resolvePaddedBounds(payload, padding, targetTabId);
  } catch (err) {
    resolveError = getResolveBoundsErrorCode(err);
  }

  if (resolveError !== undefined) {
    await restoreCaptureTab(context);
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: resolveError, ...getErrorMeta(resolveError), ...envelope };
  }

  if (!paddedBounds || paddedBounds.width < MIN_CAPTURE_DIMENSION || paddedBounds.height < MIN_CAPTURE_DIMENSION) {
    await restoreCaptureTab(context);
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: "no-target", ...getErrorMeta("no-target"), ...envelope };
  }

  let fullDataUrl: string;
  try {
    fullDataUrl = await captureVisibleTab(quality, format);
  } catch {
    console.warn("[Accordo SW] captureVisibleTab failed", { targetTabId, format, quality });
    await restoreCaptureTab(context);
    const envelope = await requestContentScriptEnvelope("visual", targetTabId);
    return { success: false, error: "capture-failed", ...getErrorMeta("capture-failed"), ...envelope };
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
    console.warn("[Accordo SW] cropImageToBounds failed, using full screenshot", { targetTabId, format, quality });
    dataUrl = fullDataUrl;
    width = Math.min(MAX_CAPTURE_DIMENSION, paddedBounds.width);
    height = Math.min(MAX_CAPTURE_DIMENSION, paddedBounds.height);
  }

  const sizeBytes = estimateSizeBytes(dataUrl);
  await restoreCaptureTab(context);

  if (sizeBytes > MAX_CAPTURE_BYTES && quality > MIN_QUALITY) {
    return retryCaptureAtReducedQuality(fullDataUrl, paddedBounds, quality, anchorSource, targetTabId, format);
  }

  return buildCaptureSuccess(dataUrl, width, height, sizeBytes, anchorSource, targetTabId, paddedBounds);
}
