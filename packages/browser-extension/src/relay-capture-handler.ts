/**
 * relay-capture-handler.ts — Handler implementations for capture_region and diff_snapshots.
 *
 * capture_region: resolve bounds → capture tab → crop/retry → envelope.
 * diff_snapshots: retrieve two snapshots from the store and compute diff.
 *
 * @module
 */

import type { VersionedSnapshot } from "./snapshot-versioning.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, getErrorMeta, isVersionedSnapshot } from "./relay-definitions.js";
import { toCapturePayload, toCaptureStoreRecord } from "./relay-type-guards.js";
export { handleDiffSnapshots } from "./relay-diff-snapshots-handler.js";
export { cropImageToBounds } from "./relay-capture-image.js";
import { executeCaptureRegion } from "./relay-capture-execution.js";
import { executeCaptureFullPage, executeCaptureViewport } from "./relay-capture-cdp-modes.js";
import { resolveImplicitTargetTabId } from "./relay-implicit-target.js";


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

/**
 * GAP-I1: Collect text map from the content script for the given tab.
 * Returns null if the text map cannot be collected.
 */
async function collectTextMapForTab(tabId: number): Promise<unknown> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_UNDERSTANDING_ACTION",
      action: "get_text_map",
      payload: {},
    });
    // Response format: { data: TextMapResult }
    const typedResponse = response as { data?: unknown; error?: string };
    if (typedResponse.error) return null;
    return typedResponse.data ?? null;
  } catch {
    return null;
  }
}

export async function handleCaptureRegion(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const capturePayload = toCapturePayload(request.payload);

  // Explicit capture modes take precedence over region target fields.
  let captureResult: Record<string, unknown>;
  if (capturePayload.mode === "fullPage") {
    captureResult = await executeCaptureFullPage(capturePayload);
  } else if (capturePayload.mode === "viewport") {
    captureResult = await executeCaptureViewport(capturePayload);
  } else {
    captureResult = await executeCaptureRegion(capturePayload);
  }

  // GAP-I1: Apply screenshot redaction if redactPatterns are provided
  if (
    capturePayload.redactPatterns !== undefined &&
    capturePayload.redactPatterns.length > 0 &&
    captureResult.success === true &&
    captureResult.dataUrl !== undefined
  ) {
    const targetTabId = capturePayload.tabId ?? await resolveImplicitTargetTabId();

    if (targetTabId !== undefined) {
      const textMapResult = await collectTextMapForTab(targetTabId);
      const originalBounds = captureResult.originalBounds as
        | { x: number; y: number; width: number; height: number }
        | undefined;

      if (textMapResult && originalBounds) {
        // Dynamic import to avoid circular dependency
        const { applyScreenshotRedaction } = await import("./screenshot-redaction.js");
        const textMap = textMapResult as { segments?: Array<{ textRaw: string; textNormalized: string; bbox: { x: number; y: number; width: number; height: number } }> };

        if (textMap?.segments) {
          const redactionResult = await applyScreenshotRedaction(
            {
              dataUrl: captureResult.dataUrl as string,
              width: captureResult.width as number,
              height: captureResult.height as number,
              originalBounds,
            },
            capturePayload.redactPatterns,
            { segments: textMap.segments, pageUrl: "" },
          );

          captureResult = {
            ...captureResult,
            dataUrl: redactionResult.redactedDataUrl,
            width: redactionResult.width,
            height: redactionResult.height,
            sizeBytes: Math.round((redactionResult.redactedDataUrl.length * 3) / 4),
            screenshotRedactionApplied: redactionResult.screenshotRedactionApplied,
            redactedSegmentCount: redactionResult.redactedSegmentCount,
          };
        }
      }
    }
  }

  // B2-SV-004: persist successful captures in the store for retention.
  if (captureResult.success === true) {
    captureResult.ocrRedactionOutOfScope = true;
  }
  await persistCaptureResult(captureResult);

  return { requestId: request.requestId, success: true, data: captureResult };
}
