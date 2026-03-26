import { addComment, createThread, getActiveThreads, getCommentPageSummaries, normalizeUrl, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";

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
  | "capture_region";

export interface RelayActionRequest {
  requestId: string;
  action: RelayAction;
  payload: Record<string, unknown>;
}

export interface RelayActionResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: "action-failed" | "unsupported-action" | "invalid-request";
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

async function handleCaptureRegion(
  payload: CapturePayload,
): Promise<Record<string, unknown>> {
  const quality = Math.min(85, Math.max(30, payload.quality ?? 70));
  const source: string = payload.anchorKey ?? payload.nodeRef ?? "rect";
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
    return { success: false, error: "no-target" };
  }

  // Capture visible tab
  let fullDataUrl: string;
  try {
    fullDataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality });
  } catch {
    return { success: false, error: "capture-failed" };
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
      if (retrySize > 500_000) {
        return { success: false, error: "image-too-large" };
      }
      return {
        success: true,
        dataUrl: retryCropped.dataUrl,
        width: retryCropped.width,
        height: retryCropped.height,
        sizeBytes: retrySize,
        source,
      };
    } catch {
      return { success: false, error: "image-too-large" };
    }
  }

  return {
    success: true,
    dataUrl,
    width,
    height,
    sizeBytes,
    source,
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
      // In the service worker context these would forward to the content script.
      // In test (jsdom) context the DOM functions are called directly.

      case "get_page_map": {
        const { collectPageMap } = await import("./content/page-map-collector.js");
        const pageMapPayload = request.payload as {
          maxDepth?: number;
          maxNodes?: number;
          includeBounds?: boolean;
          viewportOnly?: boolean;
        };
        const pageMapResult = collectPageMap(pageMapPayload);
        return {
          requestId: request.requestId,
          success: true,
          data: pageMapResult,
        };
      }

      case "inspect_element": {
        const { inspectElement } = await import("./content/element-inspector.js");
        const inspectPayload = request.payload as {
          ref?: string;
          selector?: string;
        };
        const inspectResult = inspectElement(inspectPayload);
        return {
          requestId: request.requestId,
          success: true,
          data: inspectResult,
        };
      }

      case "get_dom_excerpt": {
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

      case "capture_region": {
        const capturePayload = request.payload as {
          anchorKey?: string;
          nodeRef?: string;
          rect?: { x: number; y: number; width: number; height: number };
          padding?: number;
          quality?: number;
        };
        const captureResult = await handleCaptureRegion(capturePayload);
        return {
          requestId: request.requestId,
          success: true,
          data: captureResult,
        };
      }

      default:
        return { requestId: request.requestId, success: false, error: "unsupported-action" };
    }
  } catch (error: unknown) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
}
