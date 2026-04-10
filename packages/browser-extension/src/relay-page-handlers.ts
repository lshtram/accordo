/**
 * relay-page-handlers.ts — Handler implementations for page-understanding relay actions.
 *
 * Handlers: get_page_map, inspect_element, get_dom_excerpt, get_text_map,
 * get_semantic_graph, wait_for.
 *
 * Each handler follows the dual-context pattern: DOM/content-script context
 * runs locally; service-worker context forwards to the content script.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot, actionFailed } from "./relay-definitions.js";
import {
  resolveTargetTabId,
  resolveRequestedUrl,
  forwardToContentScript,
  forwardToFrame,
  NO_CONTENT_SCRIPT,
} from "./relay-forwarder.js";
import { normalizeUrl } from "./store.js";
import { hasErrorField, hasDataField, readBoundsLiteral } from "./relay-type-guards.js";
import {
  isOriginBlockedByPolicy,
  mintAuditId,
  applyRedaction,
  attachRedactionWarning,
  enrichWithAuditLog,
  parseOriginPolicy,
} from "./relay-privacy.js";

// ── Shared forwarding helper ─────────────────────────────────────────────────

/**
 * Shared handler for page-understanding actions that follow the pattern:
 * DOM/content-script → call local handler; service worker → forward to content script.
 *
 * F12: When payload.frameId is present (SW context only), this function resolves
 * the numeric Chrome frameId and routes the action to the correct iframe via
 * forwardToFrame. Cross-origin iframes return relay error "iframe-cross-origin".
 *
 * @param request - The relay action request
 * @param localHandler - Optional function for DOM/content-script context
 * @param saveToStore - Whether to save the result to defaultStore (for diff_snapshots)
 */
async function handlePageUnderstandingAction(
  request: RelayActionRequest,
  localHandler: (() => Promise<unknown>) | null,
  saveToStore: boolean,
): Promise<RelayActionResponse> {
  // ── Content-script / DOM context ─────────────────────────────────────────────
  if (typeof document !== "undefined" && localHandler) {
    // MCP-SEC-001: Check origin before any DOM access in content script context.
    const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
    if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
      const origin = window.location.origin;
      if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
        const auditId = mintAuditId();
        const blockedResp = {
          requestId: request.requestId,
          success: false as const,
          error: "origin-blocked" as const,
          retryable: false as const,
          auditId,
        };
        enrichWithAuditLog({
          auditId,
          toolName: request.action,
          pageId: "",
          origin,
          action: "blocked",
          redacted: false,
          durationMs: 0,
          response: blockedResp,
        });
        return blockedResp;
      }
    }

    const result = await localHandler();
    // Save to defaultStore in the content-script context.
    // In jsdom tests (single module scope): this is the same SnapshotStore that
    // diff_snapshots reads from — necessary for tests to pass.
    // In production Chrome (separate CS/SW scopes): this save goes to CS's
    // SnapshotStore which is never read by diff_snapshots (SW path). The SW-side
    // save below is the authoritative one in production.
    if (saveToStore && isVersionedSnapshot(result)) {
      await defaultStore.save(result.pageId, result);
    }

    // MCP-SEC-004/005: Attach auditId and redactionWarning
    const auditId = mintAuditId();
    const redactPII = request.payload.redactPII === true;
    const response: RelayActionResponse = { requestId: request.requestId, success: true, data: result, auditId };
    attachRedactionWarning(response, redactPII);

    enrichWithAuditLog({
      auditId,
      toolName: request.action,
      pageId: typeof result === "object" && result !== null ? (result as { pageId?: string }).pageId ?? "" : "",
      origin: window.location.origin,
      action: "allowed",
      redacted: false,
      durationMs: 0,
      response: response as unknown as Record<string, unknown>,
    });

    return response;
  }

  // ── Service worker context ───────────────────────────────────────────────────
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  // MCP-SEC-001: Check origin before forwarding in SW context.
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
    // Resolve page origin from the target tab URL
    const pageUrl = await resolveRequestedUrl(request.payload);
    let origin = "unknown";
    if (pageUrl) {
      try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
    }
    if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
      const auditId = mintAuditId();
      const blockedResp: RelayActionResponse = {
        requestId: request.requestId,
        success: false,
        error: "origin-blocked",
        retryable: false,
        auditId,
      };
      enrichWithAuditLog({
        auditId,
        toolName: request.action,
        pageId: `tab-${tabId}`,
        origin,
        action: "blocked",
        redacted: false,
        durationMs: 0,
        response: blockedResp as unknown as Record<string, unknown>,
      });
      return blockedResp;
    }
  }

  // F12: If frameId is provided, resolve the iframe and forward to it
  const frameId = request.payload.frameId as string | undefined;
  if (frameId !== undefined) {
    return handleFrameIdRequest(request, tabId, frameId, saveToStore);
  }

  const startMs = Date.now();
  const data = await forwardToContentScript(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    return actionFailed(request, "no-content-script");
  }
  if (data === null) {
    return actionFailed(request);
  }
  // SW is the authoritative store — save after receiving from CS.
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }

  // MCP-SEC-002: Apply PII redaction if requested
  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  let finalData: unknown = data;
  let redactionApplied = false;

  if (redactPII) {
    try {
      const result = applyRedaction(data);
      finalData = result.data;
      redactionApplied = result.redactionApplied;
      if (finalData !== null && typeof finalData === "object") {
        (finalData as Record<string, unknown>).redactionApplied = redactionApplied;
      }
    } catch {
      // MCP-SEC-003: Fail-closed — do not return unredacted content
      const failResp: RelayActionResponse = {
        requestId: request.requestId,
        success: false,
        error: "redaction-failed",
        retryable: false,
        auditId,
      };
      return failResp;
    }
  }

  const response: RelayActionResponse = {
    requestId: request.requestId,
    success: true,
    data: finalData,
    auditId,
  };
  attachRedactionWarning(response, redactPII);

  // Resolve origin for audit log
  const pageUrl = await resolveRequestedUrl(request.payload);
  let origin = "unknown";
  if (pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  enrichWithAuditLog({
    auditId,
    toolName: request.action,
    pageId: typeof data === "object" && data !== null ? (data as { pageId?: string }).pageId ?? "" : "",
    origin,
    action: "allowed",
    redacted: redactionApplied,
    durationMs: Date.now() - startMs,
    response: response as unknown as Record<string, unknown>,
  });

  return response;
}

/**
 * F12: Handle frameId-targeted page-understanding requests.
 *
 * Resolves the numeric Chrome frameId from the iframe metadata (via traverseFrames),
 * then forwards the action to the correct child frame.
 *
 * - If the iframe is not found → action-failed
 * - If the iframe is cross-origin (sameOrigin === false) → iframe-cross-origin
 * - If the iframe is same-origin → forward to child frame via forwardToFrame
 */
async function handleFrameIdRequest(
  request: RelayActionRequest,
  tabId: number,
  frameId: string,
  saveToStore: boolean,
): Promise<RelayActionResponse> {
  // Fetch top-frame page map with iframe metadata.
  // Must target frame 0 explicitly — without frameId, Chrome delivers the message
  // to all frames and the first to respond wins (often an inner iframe), which
  // returns iframes:[] because it has no child frames itself.
  const pageMapData = await forwardToFrame(tabId, 0, "get_page_map", {
    traverseFrames: true,
  });
  if (pageMapData === NO_CONTENT_SCRIPT) {
    return actionFailed(request, "no-content-script");
  }
  if (pageMapData === null) {
    return actionFailed(request);
  }

  const pageMap = pageMapData as Record<string, unknown>;
  const iframes = Array.isArray(pageMap.iframes) ? pageMap.iframes as Array<Record<string, unknown>> : [];

  // Find the matching iframe entry by frameId
  const iframe = iframes.find((f) => f.frameId === frameId);
  if (!iframe) {
    // Frame not found — keep minimal failure behavior
    return actionFailed(request);
  }

  if (iframe.sameOrigin === false) {
    // Cross-origin iframe — cannot access
    return actionFailed(request, "iframe-cross-origin");
  }

  // Same-origin iframe — resolve numeric frameId and forward
  const numericFrameId = await resolveNumericFrameId(tabId, iframe);
  if (numericFrameId === null) {
    return actionFailed(request);
  }

  // Forward to the child frame (strip frameId from payload to avoid recursion)
  const { frameId: _frameId, ...forwardPayload } = request.payload as Record<string, unknown>;
  const data = await forwardToFrame(tabId, numericFrameId, request.action, forwardPayload);
  if (data === NO_CONTENT_SCRIPT) {
    return actionFailed(request, "no-content-script");
  }
  if (data === null) {
    return actionFailed(request);
  }
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return { requestId: request.requestId, success: true, data };
}

/**
 * F12: Resolve the numeric Chrome frameId for a same-origin iframe metadata entry.
 *
 * Uses chrome.webNavigation.getAllFrames() to find the matching child frame,
 * applying the same URL-matching logic as handleGetPageMap for consistency.
 */
async function resolveNumericFrameId(
  tabId: number,
  iframe: Record<string, unknown>,
): Promise<number | null> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || frames.length === 0) {
    return null;
  }

  const childFrames = frames.filter((frame) => frame.frameId !== 0 && frame.parentFrameId === 0);
  const iframeSrc = typeof iframe.src === "string" ? iframe.src : "";
  const inheritedOriginFrame = iframeSrc === "" || iframeSrc === "about:blank" || iframeSrc.startsWith("about:srcdoc");
  const normalizedIframeSrc = iframeSrc ? normalizeUrl(iframeSrc) : null;

  // Match using same logic as handleGetPageMap
  let matchingFrame: chrome.webNavigation.GetAllFrameResultDetails | undefined;

  if (!inheritedOriginFrame && iframeSrc.length > 0) {
    const exactMatches = childFrames.filter((frame) => frame.url === iframeSrc);
    if (exactMatches.length === 1) {
      matchingFrame = exactMatches[0];
    }
  }

  if (!matchingFrame && normalizedIframeSrc !== null) {
    const normalizedMatches = childFrames.filter((frame) => {
      if (!frame.url) return false;
      return normalizeUrl(frame.url) === normalizedIframeSrc;
    });
    if (normalizedMatches.length === 1) {
      matchingFrame = normalizedMatches[0];
    }
  }

  if (!matchingFrame && inheritedOriginFrame) {
    const inheritedCandidates = childFrames.filter((frame) => {
      if (!frame.url) return false;
      return frame.url === "about:blank" || frame.url === "";
    });
    if (inheritedCandidates.length === 1) {
      matchingFrame = inheritedCandidates[0];
    }
  }

  if (!matchingFrame && normalizedIframeSrc !== null) {
    const sameOriginCandidates = childFrames.filter((frame) => {
      if (!frame.url) return false;
      try {
        return new URL(frame.url).origin === new URL(iframeSrc).origin;
      } catch {
        return false;
      }
    });
    if (sameOriginCandidates.length === 1) {
      matchingFrame = sameOriginCandidates[0];
    }
  }

  return matchingFrame?.frameId ?? null;
}

// ── Page-map payload narrowing ───────────────────────────────────────────────

type InspectPayload =
  | { nodeId: number }
  | { ref: string; selector?: string }
  | { selector: string };

function toInspectPayload(raw: Record<string, unknown>): InspectPayload {
  if (typeof raw.ref === "string") {
    return {
      ref: raw.ref,
      selector: typeof raw.selector === "string" ? raw.selector : undefined,
    };
  }
  if (typeof raw.selector === "string" && raw.selector !== "") {
    return { selector: raw.selector };
  }
  if (typeof raw.nodeId === "number") {
    return { nodeId: raw.nodeId };
  }
  return { selector: "" };
}

// ── Page Understanding Handlers ──────────────────────────────────────────────

export async function handleGetPageMap(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  // Content-script context: delegate to collectPageMap directly
  if (typeof document !== "undefined") {
    // MCP-SEC-001: Check origin before DOM access
    const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
    if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
      const origin = window.location.origin;
      if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
        const auditId = mintAuditId();
        const blockedResp: RelayActionResponse = {
          requestId: request.requestId,
          success: false,
          error: "origin-blocked",
          retryable: false,
          auditId,
        };
        enrichWithAuditLog({
          auditId,
          toolName: request.action,
          pageId: "",
          origin,
          action: "blocked",
          redacted: false,
          durationMs: 0,
          response: blockedResp,
        });
        return blockedResp;
      }
    }

    const { collectPageMap } = await import("./content/page-map-collector.js");
    const p = request.payload;
    const regionFilter = readBoundsLiteral(p.regionFilter);
    const result = collectPageMap({
      maxDepth: typeof p.maxDepth === "number" ? p.maxDepth : undefined,
      maxNodes: typeof p.maxNodes === "number" ? p.maxNodes : undefined,
      includeBounds: typeof p.includeBounds === "boolean" ? p.includeBounds : undefined,
      viewportOnly: typeof p.viewportOnly === "boolean" ? p.viewportOnly : undefined,
      visibleOnly: typeof p.visibleOnly === "boolean" ? p.visibleOnly : undefined,
      interactiveOnly: typeof p.interactiveOnly === "boolean" ? p.interactiveOnly : undefined,
      roles: Array.isArray(p.roles)
        ? p.roles.filter((r): r is string => typeof r === "string")
        : undefined,
      textMatch: typeof p.textMatch === "string" ? p.textMatch : undefined,
      selector: typeof p.selector === "string" ? p.selector : undefined,
      regionFilter,
      piercesShadow: typeof p.piercesShadow === "boolean" ? p.piercesShadow : undefined,
      traverseFrames: typeof p.traverseFrames === "boolean" ? p.traverseFrames : undefined,
    });
    if (isVersionedSnapshot(result)) {
      await defaultStore.save(result.pageId, result);
    }

    // MCP-SEC-004/005: Attach auditId and redactionWarning
    const auditId = mintAuditId();
    const redactPII = request.payload.redactPII === true;
    const response: RelayActionResponse = { requestId: request.requestId, success: true, data: result, auditId };
    attachRedactionWarning(response, redactPII);
    enrichWithAuditLog({
      auditId,
      toolName: request.action,
      pageId: result.pageId ?? "",
      origin: window.location.origin,
      action: "allowed",
      redacted: false,
      durationMs: 0,
      response: response as unknown as Record<string, unknown>,
    });
    return response;
  }

  // Service-worker context — forward to main frame content script first
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  // MCP-SEC-001: Check origin before forwarding
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  const startMs = Date.now();
  if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
    const pageUrl = await resolveRequestedUrl(request.payload);
    let origin = "unknown";
    if (pageUrl) {
      try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
    }
    if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
      const auditId = mintAuditId();
      const blockedResp: RelayActionResponse = {
        requestId: request.requestId,
        success: false,
        error: "origin-blocked",
        retryable: false,
        auditId,
      };
      enrichWithAuditLog({
        auditId,
        toolName: request.action,
        pageId: `tab-${tabId}`,
        origin,
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startMs,
        response: blockedResp as unknown as Record<string, unknown>,
      });
      return blockedResp;
    }
  }

  const traverseFrames = request.payload.traverseFrames === true;

  const data = await forwardToContentScript(tabId, request.action, request.payload);
  if (data === null) {
    return actionFailed(request);
  }

  const result = data as Record<string, unknown>;

  // SW-level frame refresh: for each same-origin iframe, locate the corresponding
  // child frame via chrome.webNavigation.getAllFrames() and fetch child nodes via
  // frame-targeted messaging. Cross-origin frames remain metadata-only.
  if (traverseFrames && Array.isArray(result.iframes)) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
    const childFrames = Array.isArray(frames)
      ? frames.filter((frame) => frame.frameId !== 0 && frame.parentFrameId === 0)
      : [];

    const usedFrameIds = new Set<number>();
    await Promise.all(
      (result.iframes as Array<Record<string, unknown>>).map(async (iframe) => {
        if (iframe.sameOrigin === true) {
          const iframeSrc = typeof iframe.src === "string" ? iframe.src : "";
          const inheritedOriginFrame = iframeSrc === "" || iframeSrc === "about:blank" || iframeSrc.startsWith("about:srcdoc");
          const normalizedIframeSrc = iframeSrc ? normalizeUrl(iframeSrc) : null;

          let matchingFrame = childFrames.find((frame) => {
            if (inheritedOriginFrame) return false;
            if (usedFrameIds.has(frame.frameId) || !frame.url || iframeSrc.length === 0) return false;
            return frame.url === iframeSrc;
          });

          if (!matchingFrame && normalizedIframeSrc !== null) {
            const normalizedMatches = childFrames.filter((frame) => {
              if (usedFrameIds.has(frame.frameId) || !frame.url) return false;
              return normalizeUrl(frame.url) === normalizedIframeSrc;
            });
            if (normalizedMatches.length === 1) {
              matchingFrame = normalizedMatches[0];
            }
          }

          if (!matchingFrame && inheritedOriginFrame) {
            const inheritedCandidates = childFrames.filter((frame) => {
              if (usedFrameIds.has(frame.frameId) || !frame.url) return false;
              return frame.url === "about:blank" || frame.url === "";
            });
            if (inheritedCandidates.length === 1) {
              matchingFrame = inheritedCandidates[0];
            }
          }

          if (!matchingFrame && normalizedIframeSrc !== null) {
            const sameOriginCandidates = childFrames.filter((frame) => {
              if (usedFrameIds.has(frame.frameId) || !frame.url) return false;
              try {
                return new URL(frame.url).origin === new URL(iframeSrc).origin;
              } catch {
                return false;
              }
            });
            if (sameOriginCandidates.length === 1) {
              matchingFrame = sameOriginCandidates[0];
            }
          }

          if (!matchingFrame) return;
          usedFrameIds.add(matchingFrame.frameId);

          const fresh = await forwardToFrame(
            tabId,
            matchingFrame.frameId,
            "get_page_map",
            { ...request.payload, traverseFrames: false },
          );

          if (fresh && typeof fresh === "object" && Array.isArray((fresh as { nodes?: unknown }).nodes)) {
            iframe.nodes = (fresh as { nodes: unknown[] }).nodes;
          }
        }
      }),
    );
  }

  // SW is the authoritative store — save after receiving from CS.
  if (isVersionedSnapshot(result)) {
    await defaultStore.save((result as { pageId: string }).pageId, result as Parameters<typeof defaultStore.save>[1]);
  }

  // MCP-SEC-002: Apply PII redaction if requested
  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  let finalData: unknown = result;
  let redactionApplied = false;

  if (redactPII) {
    try {
      const redactionResult = applyRedaction(result);
      finalData = redactionResult.data;
      redactionApplied = redactionResult.redactionApplied;
      if (finalData !== null && typeof finalData === "object") {
        (finalData as Record<string, unknown>).redactionApplied = redactionApplied;
      }
    } catch {
      // MCP-SEC-003: Fail-closed
      return {
        requestId: request.requestId,
        success: false,
        error: "redaction-failed",
        retryable: false,
        auditId,
      };
    }
  }

  const response: RelayActionResponse = {
    requestId: request.requestId,
    success: true,
    data: finalData,
    auditId,
  };
  attachRedactionWarning(response, redactPII);

  const pageUrl = await resolveRequestedUrl(request.payload);
  let origin = "unknown";
  if (pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  enrichWithAuditLog({
    auditId,
    toolName: request.action,
    pageId: (result as { pageId?: string }).pageId ?? "",
    origin,
    action: "allowed",
    redacted: redactionApplied,
    durationMs: Date.now() - startMs,
    response: response as unknown as Record<string, unknown>,
  });

  return response;
}

export async function handleInspectElement(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { inspectElement } = await import("./content/element-inspector.js");
        const inspectPayload = toInspectPayload(request.payload);
        return inspectElement(inspectPayload);
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ false);
}

export async function handleGetDomExcerpt(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { getDomExcerpt } = await import("./content/element-inspector.js");
        const selector = typeof request.payload.selector === "string"
          ? request.payload.selector
          : "body";
        const maxDepth = typeof request.payload.maxDepth === "number"
          ? request.payload.maxDepth
          : undefined;
        const maxLength = typeof request.payload.maxLength === "number"
          ? request.payload.maxLength
          : undefined;
        return getDomExcerpt(selector, maxDepth, maxLength);
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ false);
}

export async function handleGetTextMap(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { collectTextMap } = await import("./content/text-map-collector.js");
        const p = request.payload;
        return collectTextMap({
          maxSegments: typeof p.maxSegments === "number" ? p.maxSegments : undefined,
        });
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ false);
}

export async function handleGetSemanticGraph(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { collectSemanticGraph } = await import("./content/semantic-graph-collector.js");
        const p = request.payload;
        return collectSemanticGraph({
          maxDepth: typeof p.maxDepth === "number" ? p.maxDepth : undefined,
          visibleOnly: typeof p.visibleOnly === "boolean" ? p.visibleOnly : undefined,
          piercesShadow: typeof p.piercesShadow === "boolean" ? p.piercesShadow : undefined,
        });
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ false);
}

// ── Spatial Relations Handler ─────────────────────────────────────────────────

export async function handleGetSpatialRelations(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { handleGetSpatialRelationsAction } = await import("./content/spatial-relations-handler.js");
        return handleGetSpatialRelationsAction(request.payload);
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ false);
}

// ── Wait Handler ─────────────────────────────────────────────────────────────

export async function handleWaitFor(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  if (typeof document !== "undefined") {
    // jsdom / content-script context — stub, not implemented yet.
    // In production, wait_for is handled by the SW path (document is undefined there).
    throw new Error("not implemented");
  }

  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  const waitResponse = await chrome.tabs.sendMessage(tabId, {
    type: "PAGE_UNDERSTANDING_ACTION",
    action: request.action,
    payload: request.payload,
  });

  if (!waitResponse || hasErrorField(waitResponse)) {
    const errCode = hasErrorField(waitResponse) ? waitResponse.error : undefined;
    // Pass through known wait outcomes (including timeout) as structured data so the
    // Hub handler can surface elapsedMs, retryable, and recoveryHints to the caller.
    if (
      errCode === "navigation-interrupted" ||
      errCode === "page-closed" ||
      errCode === "timeout"
    ) {
      return { requestId: request.requestId, success: true, data: waitResponse };
    }
    return actionFailed(request);
  }

  const data = hasDataField(waitResponse) ? waitResponse.data : waitResponse;
  return { requestId: request.requestId, success: true, data };
}
