import { addComment, createThread, getActiveThreads, getCommentPageSummaries, normalizeUrl, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";
import { captureSnapshotEnvelope, resetDefaultManager, SnapshotStore } from "./snapshot-versioning.js";
import type { SnapshotEnvelope, VersionedSnapshot } from "./snapshot-versioning.js";
import { computeDiff } from "./diff-engine.js";

/**
 * B2-SV-004: Module-level SnapshotStore singleton for runtime snapshot retention.
 * Persists capture_region results (5-slot FIFO per page).
 * B2-SV-005: Cleared on navigation via handleNavigationReset().
 *
 * Exported for direct use in tests (diff_snapshots boundary tests).
 */
export const defaultStore: SnapshotStore = new SnapshotStore();

/**
 * Runtime type guard for VersionedSnapshot.
 * Replaces unsafe `as unknown as VersionedSnapshot` casts — validates all
 * required fields are present with the correct types before narrowing.
 */
function isVersionedSnapshot(val: unknown): val is VersionedSnapshot {
  if (val === null || typeof val !== "object") return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v.pageId === "string" &&
    typeof v.frameId === "string" &&
    typeof v.snapshotId === "string" &&
    typeof v.capturedAt === "string" &&
    typeof v.source === "string" &&
    v.viewport !== null &&
    typeof v.viewport === "object" &&
    Array.isArray(v.nodes)
  );
}

export type RelayAction =
  | "get_all_comments"
  | "get_comments"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread"
  | "notify_comments_updated"
  | "get_page_map"
  | "inspect_element"
  | "get_dom_excerpt"
  | "capture_region"
  | "diff_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page";

export interface RelayActionRequest {
  requestId: string;
  action: RelayAction;
  payload: Record<string, unknown>;
}

export interface RelayActionResponse {
  requestId: string;
  success: boolean;
  /**
   * B2-SV-003: For data-producing tool responses, the full SnapshotEnvelope
   * is included inside `data`. The relay forwards the envelope created by
   * the content script without modification. This top-level `snapshotId`
   * is retained for backward compatibility on error responses only.
   */
  snapshotId?: string;
  data?: unknown;
  error?: "action-failed" | "unsupported-action" | "invalid-request" | "no-target" | "capture-failed" | "image-too-large" | "snapshot-not-found" | "snapshot-stale" | "navigation-interrupted" | "page-closed";
}

async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tabs[0]?.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
  return normalizeUrl(url);
}

async function resolveRequestedUrl(payload: Record<string, unknown>): Promise<string | null> {
  const explicitUrl = payload.url as string | undefined;
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return normalizeUrl(explicitUrl);
  }
  return await getActiveTabUrl();
}

interface CapturePayload {
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
}

/**
 * Navigation reset lifecycle contract (B2-SV-005).
 *
 * **Ownership:** The service worker (relay layer) is responsible for observing
 * navigation events via `chrome.webNavigation.onCommitted` or `chrome.tabs.onUpdated`.
 * When a top-level navigation is detected for a tab, the service worker MUST:
 *
 * 1. Call `resetDefaultManager()` to reset the snapshot version counter.
 * 2. The content script's `SnapshotStore` is inherently reset because the
 *    content script is destroyed and re-injected on navigation.
 *
 * The relay layer does NOT own snapshot ID minting for data-producing tools.
 * It forwards the SnapshotEnvelope produced by the content script's
 * `captureSnapshotEnvelope()` function without modification.
 *
 * For capture_region (which runs in the service worker context), the relay
 * uses `captureSnapshotEnvelope("visual")` from snapshot-versioning.ts.
 */
export function handleNavigationReset(): void {
  resetDefaultManager();
  defaultStore.resetOnNavigation();
}

/**
 * Crop a data URL image to the given bounds using OffscreenCanvas.
 * Falls back to the original data URL if cropping is not available.
 */
async function cropImageToBounds(
  dataUrl: string,
  bounds: { x: number; y: number; width: number; height: number },
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    // In service worker context, use offscreen canvas if available
    const width = Math.min(1200, bounds.width);
    const height = Math.min(1200, bounds.height);

    // Decode base64 to ArrayBuffer
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob and use createImageBitmap for async decoding
    const blob = new Blob([bytes], { type: "image/jpeg" });
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

    const croppedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    const croppedDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(croppedBlob);
    });

    return { dataUrl: croppedDataUrl, width, height };
  } catch {
    // Cropping not available (e.g. test environment) — return original
    return { dataUrl, width: bounds.width, height: bounds.height };
  }
}

/**
 * Request a SnapshotEnvelope from the content script.
 *
 * B2-SV-002: The content script is the single authoritative owner of
 * snapshot sequencing. The service worker MUST NOT mint envelopes directly —
 * it delegates to the content script to maintain a single monotonic counter.
 *
 * Falls back to a service-worker-local envelope only when no content script
 * is available (e.g., chrome:// pages, test environments).
 */
async function requestContentScriptEnvelope(source: "dom" | "visual"): Promise<SnapshotEnvelope> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "CAPTURE_SNAPSHOT_ENVELOPE",
        source,
      });
      if (response && typeof response === "object" && "snapshotId" in response) {
        return response as SnapshotEnvelope;
      }
    }
  } catch {
    // Content script not available — fall through to local fallback
  }
  // Fallback: service-worker-local envelope (degraded — counter may diverge)
  return captureSnapshotEnvelope(source);
}

async function handleCaptureRegion(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const quality = Math.min(85, Math.max(30, payload.quality ?? 70));
  const anchorSource: string = payload.anchorKey ?? payload.nodeRef ?? "rect";
  const padding = Math.min(100, Math.max(0, payload.padding ?? 8));

  // Resolve target bounds from rect first (most deterministic)
  let bounds: { x: number; y: number; width: number; height: number } | null = null;

  if (payload.rect) {
    bounds = { ...payload.rect };
  } else if (payload.anchorKey || payload.nodeRef) {
    // Attempt content script resolution for anchorKey/nodeRef
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        const resolved = await chrome.tabs.sendMessage(tab.id, {
          type: "RESOLVE_ANCHOR_BOUNDS",
          anchorKey: payload.anchorKey,
          nodeRef: payload.nodeRef,
          padding,
        });
        // resolved is null/undefined when no listener responded (test env) — fallback
        if (resolved && typeof resolved === "object" && !(resolved as { error?: string }).error) {
          bounds = (resolved as { bounds: { x: number; y: number; width: number; height: number } }).bounds;
        }
        // If resolved is null/undefined (no listener) or has explicit error, fall through to fallback
      } catch {
        // Message delivery failed (no listener) — fall through to full viewport fallback
      }
    }
  }

  if (!bounds) {
    // No rect, anchorKey, or nodeRef provided — use full viewport
    bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  }

  // Apply padding
  const paddedBounds = {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };

  // Minimum size check (10x10)
  if (paddedBounds.width < 10 || paddedBounds.height < 10) {
    const envelope = await requestContentScriptEnvelope("visual");
    return { success: false, error: "no-target", ...envelope };
  }

  // Capture visible tab
  let fullDataUrl: string;
  try {
    fullDataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality });
  } catch {
    const envelope = await requestContentScriptEnvelope("visual");
    return { success: false, error: "capture-failed", ...envelope };
  }

  // Crop to target bounds
  let dataUrl: string;
  let width: number;
  let height: number;
  try {
    const cropped = await cropImageToBounds(fullDataUrl, paddedBounds, quality);
    dataUrl = cropped.dataUrl;
    width = cropped.width;
    height = cropped.height;
  } catch {
    // Crop failed — use full image
    dataUrl = fullDataUrl;
    width = Math.min(1200, paddedBounds.width);
    height = Math.min(1200, paddedBounds.height);
  }

  // Estimate size from data URL
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  let sizeBytes = Math.round((base64.length * 3) / 4);

  // Retry at lower quality if over 500KB
  if (sizeBytes > 500_000 && quality > 30) {
    const reducedQuality = Math.max(30, quality - 10);
    try {
      const retryCropped = await cropImageToBounds(fullDataUrl, paddedBounds, reducedQuality);
      const retryBase64 = retryCropped.dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const retrySize = Math.round((retryBase64.length * 3) / 4);
      const envelope = await requestContentScriptEnvelope("visual");
      if (retrySize > 500_000) {
        return { success: false, error: "image-too-large", ...envelope };
      }
      return {
        success: true,
        dataUrl: retryCropped.dataUrl,
        width: retryCropped.width,
        height: retryCropped.height,
        sizeBytes: retrySize,
        anchorSource,
        ...envelope,
      };
    } catch {
      const envelope = await requestContentScriptEnvelope("visual");
      return { success: false, error: "image-too-large", ...envelope };
    }
  }

  const envelope = await requestContentScriptEnvelope("visual");
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

export async function handleRelayAction(request: RelayActionRequest): Promise<RelayActionResponse> {
  try {
    switch (request.action) {
      case "get_all_comments": {
        const pages = await getCommentPageSummaries();
        return {
          requestId: request.requestId,
          success: true,
          data: {
            pages,
            totalPages: pages.length,
          },
        };
      }

      case "get_comments": {
        const url = await resolveRequestedUrl(request.payload);
        if (!url) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const threads = await getActiveThreads(url);
        return {
          requestId: request.requestId,
          success: true,
          data: {
            url,
            activeTabUrl: await getActiveTabUrl(),
            threads,
            threadSummaries: threads.map((t) => {
              const latest = t.comments[t.comments.length - 1];
              return {
                threadId: t.id,
                status: t.status,
                anchorKey: t.anchorKey,
                anchorContext: t.anchorContext,
                lastComment: latest?.body ?? "",
                lastAuthor: latest?.author?.name ?? "",
                lastActivity: t.lastActivity,
                commentCount: t.comments.length,
              };
            }),
            totalThreads: threads.length,
            openThreads: threads.filter((t) => t.status === "open").length,
          },
        };
      }

      case "create_comment": {
        const body = request.payload.body as string;
        if (!body || !body.trim()) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const url = await resolveRequestedUrl(request.payload);
        if (!url) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const anchorKey = (request.payload.anchorKey as string | undefined) ?? "body:0:center";
        const authorName = (request.payload.authorName as string | undefined) ?? "Agent";
        const anchorContext = request.payload.anchorContext as {
          tagName: string;
          textSnippet?: string;
          ariaLabel?: string;
          pageTitle?: string;
        } | undefined;

        const thread = await createThread(
          url,
          anchorKey,
          { body, author: { kind: "user", name: authorName } },
          anchorContext,
        );
        return { requestId: request.requestId, success: true, data: { ...thread, pageUrl: thread.pageUrl } };
      }

      case "reply_comment": {
        const threadId = request.payload.threadId as string;
        const body = request.payload.body as string;
        const authorName = (request.payload.authorName as string | undefined) ?? "Agent";
        const commentId = request.payload.commentId as string | undefined;
        const comment = await addComment(threadId, {
          body,
          author: { kind: "user", name: authorName },
          commentId,
        });
        return { requestId: request.requestId, success: true, data: { ...comment, pageUrl: comment.pageUrl } };
      }

      case "delete_comment": {
        const threadId = request.payload.threadId as string;
        const commentId = request.payload.commentId as string;
        const pageUrl = await softDeleteComment(threadId, commentId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "resolve_thread": {
        const threadId = request.payload.threadId as string;
        const resolutionNote = request.payload.resolutionNote as string | undefined;
        const pageUrl = await resolveThread(threadId, resolutionNote);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "reopen_thread": {
        const threadId = request.payload.threadId as string;
        const pageUrl = await reopenThread(threadId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "delete_thread": {
        const threadId = request.payload.threadId as string;
        const pageUrl = await softDeleteThread(threadId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "notify_comments_updated": {
        const url = request.payload.url as string | undefined;
        const threadId = request.payload.threadId as string | undefined;

        // Optional local-delete sync path for VS Code-originated removals where
        // only threadId is known (no URL available at notifier call site).
        let pageUrl: string | null = null;
        if (threadId) {
          pageUrl = await softDeleteThread(threadId);
        }

        // Returns immediately — broadcastCommentsUpdated is triggered by
        // handleRelayActionWithBroadcast in service-worker.ts
        return {
          requestId: request.requestId,
          success: true,
          data: { url: pageUrl ?? url, pageUrl: pageUrl ?? url },
        };
      }

      // ── Page Understanding Actions (M90-ACT) ──────────────────────────
      // In test (jsdom) / content-script context `document` is defined — call
      // DOM functions directly.  In the service worker context `document` is
      // undefined — forward to the active tab's content script via
      // chrome.tabs.sendMessage so the DOM work happens in the right context.

      case "get_page_map": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — call DOM function directly
          const { collectPageMap } = await import("./content/page-map-collector.js");
          const pageMapPayload = request.payload as {
            maxDepth?: number;
            maxNodes?: number;
            includeBounds?: boolean;
            viewportOnly?: boolean;
          };
          const pageMapResult = collectPageMap(pageMapPayload);
          // B2-SV-004: Save to defaultStore so diff_snapshots can retrieve the
          // snapshot by ID. PageMapResult is structurally compatible with
          // VersionedSnapshot (same SnapshotEnvelope fields + nodes array).
          if (isVersionedSnapshot(pageMapResult)) {
            await defaultStore.save(pageMapResult.pageId, pageMapResult);
          }
          return {
            requestId: request.requestId,
            success: true,
            data: pageMapResult,
          };
        }
        // Service worker context — forward to content script.
        // B2-SV-003: The content script embeds the full SnapshotEnvelope in
        // response.data. The relay passes it through without minting IDs.
        // B2-CTX-001: If tabId is provided in payload, use it directly (skip active tab query).
        const explicitTabId = request.payload.tabId as number | undefined;
        let pageMapTabId: number | undefined;
        if (explicitTabId !== undefined) {
          pageMapTabId = explicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          pageMapTabId = tab?.id;
        }
        if (!pageMapTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const response = await chrome.tabs.sendMessage(pageMapTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!response || (response as { error?: string }).error) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const pageMapData = (response as { data: unknown }).data;
        // B2-SV-004: Save to defaultStore so diff_snapshots can retrieve the
        // snapshot by ID. PageMapResult is structurally compatible with
        // VersionedSnapshot (same SnapshotEnvelope fields + nodes array).
        if (isVersionedSnapshot(pageMapData)) {
          await defaultStore.save(pageMapData.pageId, pageMapData);
        }
        return {
          requestId: request.requestId,
          success: true,
          data: pageMapData,
        };
      }

      case "inspect_element": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — call DOM function directly
          const { inspectElement } = await import("./content/element-inspector.js");
          type LocalInspectArgs = Parameters<typeof inspectElement>[0];
          const rawPayload = request.payload as {
            ref?: string;
            selector?: string;
            nodeId?: number;
          };
          // B2-SV-006: Support lookup by nodeId, ref, or selector
          let inspectPayload: LocalInspectArgs;
          if (rawPayload.nodeId !== undefined) {
            inspectPayload = { nodeId: rawPayload.nodeId };
          } else if (rawPayload.ref !== undefined) {
            inspectPayload = { ref: rawPayload.ref, selector: rawPayload.selector };
          } else {
            inspectPayload = { selector: rawPayload.selector ?? "" };
          }
          const inspectResult = inspectElement(inspectPayload);
          return {
            requestId: request.requestId,
            success: true,
            data: inspectResult,
          };
        }
        // Service worker context — forward to content script.
        // B2-SV-003: The content script embeds the full SnapshotEnvelope in
        // response.data. The relay passes it through without minting IDs.
        // B2-CTX-001: If tabId is provided in payload, use it directly (skip active tab query).
        const inspectExplicitTabId = request.payload.tabId as number | undefined;
        let inspectTabId: number | undefined;
        if (inspectExplicitTabId !== undefined) {
          inspectTabId = inspectExplicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          inspectTabId = tab?.id;
        }
        if (!inspectTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const response = await chrome.tabs.sendMessage(inspectTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!response || (response as { error?: string }).error) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return {
          requestId: request.requestId,
          success: true,
          data: (response as { data: unknown }).data,
        };
      }

      case "get_dom_excerpt": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — call DOM function directly
          const { getDomExcerpt } = await import("./content/element-inspector.js");
          const excerptPayload = request.payload as {
            selector?: string;
            maxDepth?: number;
            maxLength?: number;
          };
          const selector = excerptPayload.selector ?? "body";
          const excerptResult = getDomExcerpt(
            selector,
            excerptPayload.maxDepth,
            excerptPayload.maxLength,
          );
          return {
            requestId: request.requestId,
            success: true,
            data: excerptResult,
          };
        }
        // Service worker context — forward to content script.
        // B2-SV-003: The content script embeds the full SnapshotEnvelope in
        // response.data. The relay passes it through without minting IDs.
        // B2-CTX-001: If tabId is provided in payload, use it directly (skip active tab query).
        const excerptExplicitTabId = request.payload.tabId as number | undefined;
        let excerptTabId: number | undefined;
        if (excerptExplicitTabId !== undefined) {
          excerptTabId = excerptExplicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          excerptTabId = tab?.id;
        }
        if (!excerptTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const excerptResponse = await chrome.tabs.sendMessage(excerptTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!excerptResponse || (excerptResponse as { error?: string }).error) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return {
          requestId: request.requestId,
          success: true,
          data: (excerptResponse as { data: unknown }).data,
        };
      }

      case "capture_region": {
        // capture_region runs in service worker context — handleCaptureRegion
        // already embeds the full SnapshotEnvelope via captureSnapshotEnvelope("visual").
        // B2-SV-003: relay passes through the envelope without minting additional IDs.
        const capturePayload = request.payload as {
          anchorKey?: string;
          nodeRef?: string;
          rect?: { x: number; y: number; width: number; height: number };
          padding?: number;
          quality?: number;
        };
        const captureResult = await handleCaptureRegion(capturePayload);

        // B2-SV-004: persist successful captures in the store for retention.
        if (captureResult.success === true && typeof captureResult.pageId === "string") {
          if (isVersionedSnapshot(captureResult)) {
            await defaultStore.save(captureResult.pageId, captureResult);
          } else {
            await defaultStore.save(captureResult.pageId as string, {
              pageId: captureResult.pageId as string,
              frameId: typeof captureResult.frameId === "string" ? captureResult.frameId : "main",
              snapshotId: captureResult.snapshotId as string,
              capturedAt: captureResult.capturedAt as string,
              viewport: captureResult.viewport as VersionedSnapshot["viewport"],
              source: captureResult.source as VersionedSnapshot["source"],
              nodes: [],
              totalElements: typeof captureResult.totalElements === "number" ? captureResult.totalElements : 0,
            });
          }
        }

        return {
          requestId: request.requestId,
          success: true,
          data: captureResult,
        };
      }

      // ── Diff Snapshots (M101-DIFF) ──────────────────────────────────────
      // B2-DE-001..007: Compute structural diff between two snapshots.
      // Runs in service worker context where the SnapshotStore holds full
      // snapshots with NodeIdentity[] data. The diff engine (computeDiff)
      // is a pure function operating on two VersionedSnapshot objects.
      case "diff_snapshots": {
        // B2-DE-001..007: Compute structural diff between two snapshots.
        // B2-DE-003/004 implicit resolution is handled by the caller (diff-tool.ts)
        // before reaching the relay; both IDs must be explicit here.
        const fromSnapshotId = request.payload.fromSnapshotId as string | undefined;
        const toSnapshotId = request.payload.toSnapshotId as string | undefined;

        if (typeof fromSnapshotId !== "string" || typeof toSnapshotId !== "string") {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }

        const fromResult = await defaultStore.get(fromSnapshotId);
        if ("error" in fromResult) {
          // B2-DE-007: distinguish stale (pre-navigation) from missing/evicted
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

      // ── Wait Primitives (M109-WAIT) ────────────────────────────────────
      // B2-WA-001..007: Wait for conditions on the page.
      // The content script runs a 100ms polling loop; the service worker
      // forwards the request and returns the result.
      case "wait_for": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — stub, not implemented yet
          throw new Error("not implemented");
        }
        // Service worker context — forward to content script.
        // B2-CTX-001: If tabId is provided in payload, use it directly (skip active tab query).
        const waitExplicitTabId = request.payload.tabId as number | undefined;
        let waitTabId: number | undefined;
        if (waitExplicitTabId !== undefined) {
          waitTabId = waitExplicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          waitTabId = tab?.id;
        }
        if (!waitTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const waitResponse = await chrome.tabs.sendMessage(waitTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!waitResponse || (waitResponse as { error?: string }).error) {
          const errCode = (waitResponse as { error?: string })?.error;
          if (errCode === "navigation-interrupted" || errCode === "page-closed") {
            return { requestId: request.requestId, success: true, data: waitResponse };
          }
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return {
          requestId: request.requestId,
          success: true,
          data: (waitResponse as { data: unknown }).data ?? waitResponse,
        };
      }

      // ── Text Map (M112-TEXT) ───────────────────────────────────────────────
      // B2-TX-001..010: Extract per-segment text with bbox, reading order, and
      // visibility flags. Content script handles the actual DOM traversal.
      case "get_text_map": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — call collector directly
          const { collectTextMap } = await import("./content/text-map-collector.js");
          const textMapResult = await collectTextMap(request.payload as Parameters<typeof collectTextMap>[0]);
          return {
            requestId: request.requestId,
            success: true,
            data: textMapResult,
          };
        }
        // Service worker context — forward to content script.
        // B2-CTX-001: use explicit tabId if provided, else query active tab.
        const tmExplicitTabId = request.payload.tabId as number | undefined;
        let tmTargetTabId: number | undefined;
        if (tmExplicitTabId !== undefined) {
          tmTargetTabId = tmExplicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tmTargetTabId = tab?.id;
        }
        if (!tmTargetTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const response = await chrome.tabs.sendMessage(tmTargetTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!response || (response as { error?: string }).error) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return {
          requestId: request.requestId,
          success: true,
          data: (response as { data: unknown }).data,
        };
      }

      // ── Semantic Graph (M113-SEM) ──────────────────────────────────────────
      // B2-SG-001..015: Extract unified semantic graph — a11y tree, landmarks,
      // document outline, and form models. Content script handles DOM traversal.
      case "get_semantic_graph": {
        if (typeof document !== "undefined") {
          // jsdom / content-script context — stub until Phase C
          throw new Error("not implemented");
        }
        // Service worker context — forward to content script.
        // B2-CTX-001: use explicit tabId if provided, else query active tab.
        const sgExplicitTabId = request.payload.tabId as number | undefined;
        let sgTargetTabId: number | undefined;
        if (sgExplicitTabId !== undefined) {
          sgTargetTabId = sgExplicitTabId;
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sgTargetTabId = tab?.id;
        }
        if (!sgTargetTabId) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        const response = await chrome.tabs.sendMessage(sgTargetTabId, {
          type: "PAGE_UNDERSTANDING_ACTION",
          action: request.action,
          payload: request.payload,
        });
        if (!response || (response as { error?: string }).error) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return {
          requestId: request.requestId,
          success: true,
          data: (response as { data: unknown }).data,
        };
      }

      // ── Multi-tab support (B2-CTX-001) ────────────────────────────────────

      case "list_pages": {
        // B2-CTX-001: Return all open tabs as { pages: [{ tabId, url, title, active }] }
        const allTabs = await chrome.tabs.query({});
        const pages = allTabs.map((tab) => ({
          tabId: tab.id,
          url: tab.url ?? "",
          title: tab.title ?? "",
          active: tab.active,
        }));
        return {
          requestId: request.requestId,
          success: true,
          data: { pages },
        };
      }

      case "select_page": {
        // B2-CTX-001: Activate the specified tab.
        const selectTabId = request.payload.tabId;
        if (typeof selectTabId !== "number" || !Number.isInteger(selectTabId)) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        await chrome.tabs.update(selectTabId, { active: true });
        return {
          requestId: request.requestId,
          success: true,
        };
      }

      default:

        return { requestId: request.requestId, success: false, error: "unsupported-action" };
    }
  } catch (error: unknown) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
}
