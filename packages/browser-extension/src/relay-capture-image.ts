import { requestContentScriptEnvelope } from "./relay-forwarder.js";
import { getErrorMeta } from "./relay-definitions.js";

export const MAX_CAPTURE_DIMENSION = 1200;
export const MAX_CAPTURE_BYTES = 500_000;
export const MIN_CAPTURE_DIMENSION = 10;
export const DEFAULT_QUALITY = 70;
export const MIN_QUALITY = 30;
export const MAX_QUALITY = 85;
export const QUALITY_RETRY_STEP = 10;
export const DEFAULT_PADDING = 8;
export const MAX_PADDING = 100;

export async function cropImageToBounds(
  dataUrl: string,
  bounds: { x: number; y: number; width: number; height: number },
  quality: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    const width = Math.min(MAX_CAPTURE_DIMENSION, bounds.width);
    const height = Math.min(MAX_CAPTURE_DIMENSION, bounds.height);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const mimeType = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
    const blob = new Blob([bytes], { type: mimeType });
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    ctx.drawImage(imageBitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, width, height);

    const croppedBlob = await canvas.convertToBlob({ type: mimeType, quality: (format === "jpeg" || format === "webp") ? quality / 100 : undefined });
    const croppedDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = (): void => {
        const result = reader.result;
        if (typeof result === "string") resolve(result);
        else reject(new Error("FileReader result is not a string"));
      };
      reader.readAsDataURL(croppedBlob);
    });

    return { dataUrl: croppedDataUrl, width, height };
  } catch {
    return { dataUrl, width: bounds.width, height: bounds.height };
  }
}

export async function captureVisibleTab(
  quality: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<string> {
  const captureFormat: "jpeg" | "png" = format === "webp" ? "png" : format;
  return chrome.tabs.captureVisibleTab({ format: captureFormat, quality });
}

export function estimateSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Math.round((base64.length * 3) / 4);
}

export async function buildCaptureSuccess(
  dataUrl: string,
  width: number,
  height: number,
  sizeBytes: number,
  anchorSource: string,
  targetTabId?: number,
  originalBounds?: { x: number; y: number; width: number; height: number },
): Promise<Record<string, unknown>> {
  const envelope = await requestContentScriptEnvelope("visual", targetTabId);
  return {
    success: true,
    dataUrl,
    width,
    height,
    sizeBytes,
    anchorSource,
    ...(originalBounds ? { originalBounds } : {}),
    ...envelope,
  };
}

export async function retryCaptureAtReducedQuality(
  fullDataUrl: string,
  paddedBounds: { x: number; y: number; width: number; height: number },
  quality: number,
  anchorSource: string,
  targetTabId?: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Record<string, unknown>> {
  const reducedQuality = Math.max(MIN_QUALITY, quality - QUALITY_RETRY_STEP);
  const envelope = await requestContentScriptEnvelope("visual", targetTabId);
  try {
    const retryCropped = await cropImageToBounds(fullDataUrl, paddedBounds, reducedQuality, format);
    const retrySize = estimateSizeBytes(retryCropped.dataUrl);
    if (retrySize > MAX_CAPTURE_BYTES) {
      return { success: false, error: "image-too-large", ...getErrorMeta("image-too-large"), ...envelope };
    }
    return await buildCaptureSuccess(
      retryCropped.dataUrl,
      retryCropped.width,
      retryCropped.height,
      retrySize,
      anchorSource,
      targetTabId,
      paddedBounds,
    );
  } catch {
    return { success: false, error: "image-too-large", ...getErrorMeta("image-too-large"), ...envelope };
  }
}
