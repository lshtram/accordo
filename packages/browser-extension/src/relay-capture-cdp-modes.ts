import type { CapturePayload } from "./relay-definitions.js";
import { getErrorMeta } from "./relay-definitions.js";
import { requestContentScriptEnvelope } from "./relay-forwarder.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import { DEFAULT_QUALITY, MAX_QUALITY, MIN_QUALITY } from "./relay-capture-image.js";
import { prepareCaptureTab, restoreCaptureTab } from "./relay-capture-tab-target.js";

function classifyCdpError(err: unknown, envelope?: Record<string, unknown>): Record<string, unknown> {
  const errorMsg = err instanceof Error ? err.message : "capture-failed";
  if (errorMsg.includes("not attached") || errorMsg.includes("disconnected")) {
    return { success: false, error: "browser-not-connected", ...getErrorMeta("browser-not-connected"), ...(envelope ?? {}) };
  }
  if (errorMsg.includes("unsupported-page")) {
    return { success: false, error: "unsupported-page", ...getErrorMeta("unsupported-page"), ...(envelope ?? {}) };
  }
  return { success: false, error: "capture-failed", ...getErrorMeta("capture-failed"), ...(envelope ?? {}) };
}

export async function executeCaptureFullPage(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const context = await prepareCaptureTab(payload.tabId);
  if (context.targetTabId === undefined) {
    await restoreCaptureTab(context);
    return { success: false, error: "browser-not-connected", ...getErrorMeta("browser-not-connected") };
  }

  try {
    const envelope = await requestContentScriptEnvelope("visual", context.targetTabId);
    await ensureAttached(context.targetTabId);
    const format: "jpeg" | "png" | "webp" = payload.format ?? "jpeg";
    const cdpResult = await sendCommand<{ data: string; width: number; height: number }>(
      context.targetTabId,
      "Page.captureScreenshot",
      { captureBeyondViewport: true, format },
    );
    const mimeType = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${cdpResult.data}`;
    const sizeBytes = Math.round((cdpResult.data.length * 3) / 4);
    await restoreCaptureTab(context);
    return {
      success: true,
      dataUrl,
      width: cdpResult.width,
      height: cdpResult.height,
      sizeBytes,
      anchorSource: "fullPage",
      mode: "fullPage",
      originalBounds: {
        x: 0,
        y: 0,
        width: envelope.viewport.width > 0 ? envelope.viewport.width : cdpResult.width,
        height: envelope.viewport.height > 0 ? envelope.viewport.height : cdpResult.height,
      },
      ...envelope,
    };
  } catch (err) {
    await restoreCaptureTab(context);
    let envelope: Awaited<ReturnType<typeof requestContentScriptEnvelope>> | undefined;
    try {
      envelope = await requestContentScriptEnvelope("visual", context.targetTabId);
    } catch {
      envelope = undefined;
    }
    return classifyCdpError(err, envelope as unknown as Record<string, unknown> | undefined);
  }
}

export async function executeCaptureViewport(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const context = await prepareCaptureTab(payload.tabId);
  if (context.targetTabId === undefined) {
    await restoreCaptureTab(context);
    return { success: false, error: "browser-not-connected", ...getErrorMeta("browser-not-connected") };
  }

  try {
    const envelope = await requestContentScriptEnvelope("visual", context.targetTabId);
    await ensureAttached(context.targetTabId);
    const format: "jpeg" | "png" | "webp" = payload.format ?? "jpeg";
    const quality = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, payload.quality ?? DEFAULT_QUALITY));
    const screenshotParams: Record<string, unknown> = { captureBeyondViewport: false, format };
    if (format === "jpeg" || format === "webp") screenshotParams.quality = quality;
    const cdpResult = await sendCommand<{ data: string; width: number; height: number }>(
      context.targetTabId,
      "Page.captureScreenshot",
      screenshotParams,
    );
    const mimeType = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${cdpResult.data}`;
    const sizeBytes = Math.round((cdpResult.data.length * 3) / 4);
    await restoreCaptureTab(context);
    const cssViewportWidth = envelope.viewport.width > 0 ? envelope.viewport.width : cdpResult.width;
    const cssViewportHeight = envelope.viewport.height > 0 ? envelope.viewport.height : cdpResult.height;
    return {
      success: true,
      dataUrl,
      width: cdpResult.width,
      height: cdpResult.height,
      sizeBytes,
      anchorSource: "viewport",
      mode: "viewport",
      originalBounds: { x: 0, y: 0, width: cssViewportWidth, height: cssViewportHeight },
      ...envelope,
    };
  } catch (err) {
    await restoreCaptureTab(context);
    let envelope: Awaited<ReturnType<typeof requestContentScriptEnvelope>> | undefined;
    try {
      envelope = await requestContentScriptEnvelope("visual", context.targetTabId);
    } catch {
      envelope = undefined;
    }
    return classifyCdpError(err, envelope as unknown as Record<string, unknown> | undefined);
  }
}
