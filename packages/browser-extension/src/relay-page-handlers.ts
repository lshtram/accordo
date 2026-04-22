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
  forwardToMainFrame,
  forwardToFrame,
  ensureContentScriptInjected,
  NO_CONTENT_SCRIPT,
} from "./relay-forwarder.js";
import { hasErrorField, hasDataField, readBoundsLiteral } from "./relay-type-guards.js";
import {
  isOriginBlockedByPolicy,
  mintAuditId,
  applyRedaction,
  attachRedactionWarning,
  enrichWithAuditLog,
  parseOriginPolicy,
} from "./relay-privacy.js";

function clampOffsetLimit(
  payload: Record<string, unknown>,
  defaultCap: number,
  maxCap: number,
  userCapField?: "maxNodes" | "maxSegments",
): { offset: number; limit: number; hasPagination: boolean } {
  const hasPagination = payload.offset !== undefined || payload.limit !== undefined;
  const userCapRaw = userCapField ? payload[userCapField] : undefined;
  const userCap = typeof userCapRaw === "number" ? userCapRaw : defaultCap;
  const effectiveCap = Math.min(userCap, maxCap);
  const offset = Math.max(0, typeof payload.offset === "number" ? payload.offset : 0);
  const limit = typeof payload.limit === "number"
    ? Math.min(Math.max(1, payload.limit), effectiveCap)
    : effectiveCap;
  return { offset, limit, hasPagination };
}

function appendPaginationMetadata(
  data: Record<string, unknown>,
  opts: {
    itemsKey: "nodes" | "segments";
    totalAvailable: number;
    offset: number;
    limit: number;
  },
): void {
  const rawItems = data[opts.itemsKey];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sliced = items.slice(opts.offset, opts.offset + opts.limit);
  data[opts.itemsKey] = sliced;

  const nextOffset = opts.offset + sliced.length;
  data.hasMore = nextOffset < opts.totalAvailable;
  data.totalAvailable = opts.totalAvailable;
  if (sliced.length > 0) {
    data.nextOffset = nextOffset;
  }
}

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
  const rawFrameId = request.payload.frameId;
  const frameId = typeof rawFrameId === "string" && rawFrameId.trim().length > 0
    ? rawFrameId
    : undefined;
  if (frameId !== undefined) {
    return handleFrameIdRequest(request, tabId, frameId, saveToStore);
  }

  const startMs = Date.now();
  let data = await forwardToMainFrame(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    try {
      await ensureContentScriptInjected(tabId);
      data = await forwardToMainFrame(tabId, request.action, request.payload);
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (data === NO_CONTENT_SCRIPT) {
      return actionFailed(request, "no-content-script");
    }
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

  const framePathIndex = await buildFramePathIndex(tabId);
  await stitchIframeNodes(tabId, iframes, request.payload as Record<string, unknown>, framePathIndex);

  // Find the matching iframe entry by frameId
  const iframe = findIframeMetadataByPath(iframes, frameId);
  if (!iframe) {
    // Frame not found — keep minimal failure behavior
    return actionFailed(request);
  }

  if (iframe.sameOrigin === false) {
    // Cross-origin iframe — cannot access
    return actionFailed(request, "iframe-cross-origin");
  }

  // Same-origin iframe — resolve numeric frameId and forward
  const numericFrameId = framePathIndex.get(frameId);
  if (numericFrameId === undefined) {
    return actionFailed(request);
  }

  // Forward to the child frame (strip frameId from payload to avoid recursion)
  const { frameId: _frameId, ...forwardPayload } = request.payload as Record<string, unknown>;
  const data = await forwardToFrame(tabId, numericFrameId, request.action, {
    ...forwardPayload,
    logicalFrameId: frameId,
  });
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

async function buildFramePathIndex(tabId: number): Promise<Map<string, number>> {
  const pathIndex = new Map<string, number>([["main", 0]]);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || frames.length === 0) {
    return pathIndex;
  }

  await Promise.all(
    frames
      .filter((frame) => frame.frameId !== 0)
      .map(async (frame) => {
        const framePath = await forwardToFrame(tabId, frame.frameId, "get_frame_path", {});
        if (framePath && typeof framePath === "object" && typeof (framePath as { frameId?: unknown }).frameId === "string") {
          pathIndex.set((framePath as { frameId: string }).frameId, frame.frameId);
        }
      }),
  );

  return pathIndex;
}

function findIframeMetadataByPath(
  iframes: Array<Record<string, unknown>>,
  frameId: string,
): Record<string, unknown> | undefined {
  for (const iframe of iframes) {
    if (iframe.frameId === frameId) {
      return iframe;
    }
    const nested = Array.isArray(iframe.iframes)
      ? findIframeMetadataByPath(iframe.iframes as Array<Record<string, unknown>>, frameId)
      : undefined;
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

async function stitchIframeNodes(
  tabId: number,
  iframes: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
  framePathIndex: Map<string, number>,
): Promise<void> {
  await Promise.all(
    iframes.map(async (iframe) => {
      const logicalFrameId = typeof iframe.frameId === "string" ? iframe.frameId : undefined;
      if (logicalFrameId === undefined || iframe.sameOrigin !== true) {
        return;
      }

      const numericFrameId = framePathIndex.get(logicalFrameId);
      if (numericFrameId === undefined) {
        return;
      }

      const fresh = await forwardToFrame(
        tabId,
        numericFrameId,
        "get_page_map",
        { ...payload, traverseFrames: true, logicalFrameId },
      );

      if (fresh && typeof fresh === "object") {
        if (Array.isArray((fresh as { nodes?: unknown[] }).nodes)) {
          iframe.nodes = (fresh as { nodes: unknown[] }).nodes;
        }
        if (Array.isArray((fresh as { iframes?: unknown[] }).iframes)) {
          iframe.iframes = (fresh as { iframes: unknown[] }).iframes;
          await stitchIframeNodes(
            tabId,
            iframe.iframes as Array<Record<string, unknown>>,
            payload,
            framePathIndex,
          );
        }
      }
    }),
  );
}

// ── Page-map payload narrowing ───────────────────────────────────────────────

type InspectPayload =
  | { uid: string; ref?: string; selector?: string }
  | { nodeId: number }
  | { ref: string; selector?: string }
  | { selector: string };

function toInspectPayload(raw: Record<string, unknown>): InspectPayload {
  const uid = typeof raw.uid === "string" && raw.uid.length > 0
    ? raw.uid
    : undefined;
  const ref = typeof raw.ref === "string" && raw.ref.length > 0
    ? raw.ref
    : undefined;
  const selector = typeof raw.selector === "string" && raw.selector.length > 0
    ? raw.selector
    : undefined;

  // B2-UID-001: uid takes precedence — it unambiguously identifies a node
  if (uid !== undefined) {
    return {
      uid,
      ref,
      selector,
    };
  }
  if (ref !== undefined) {
    return {
      ref,
      selector,
    };
  }
  if (selector !== undefined) {
    return { selector };
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

    const pagination = clampOffsetLimit(p as Record<string, unknown>, 200, 500, "maxNodes");
    if (pagination.hasPagination) {
      const totalAvailable = typeof result.filterSummary?.totalAfterFilter === "number"
        ? result.filterSummary.totalAfterFilter
        : result.totalElements;
      appendPaginationMetadata(result as unknown as Record<string, unknown>, {
        itemsKey: "nodes",
        totalAvailable,
        offset: pagination.offset,
        limit: pagination.limit,
      });
    }

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

  let data = await forwardToMainFrame(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    try {
      await ensureContentScriptInjected(tabId);
      data = await forwardToMainFrame(tabId, request.action, request.payload);
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (data === NO_CONTENT_SCRIPT) {
      return actionFailed(request, "no-content-script");
    }
  }
  if (data === null) {
    return actionFailed(request);
  }

  const result = data as Record<string, unknown>;

  // SW-level frame refresh: for each same-origin iframe, locate the corresponding
  // child frame via chrome.webNavigation.getAllFrames() and fetch child nodes via
  // frame-targeted messaging. Cross-origin frames remain metadata-only.
  if (traverseFrames && Array.isArray(result.iframes)) {
    const framePathIndex = await buildFramePathIndex(tabId);
    await stitchIframeNodes(
      tabId,
      result.iframes as Array<Record<string, unknown>>,
      request.payload as Record<string, unknown>,
      framePathIndex,
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
        const result = collectTextMap({
          maxSegments: typeof p.maxSegments === "number" ? p.maxSegments : undefined,
        });

        const pagination = clampOffsetLimit(p as Record<string, unknown>, 500, 2000, "maxSegments");
        if (pagination.hasPagination) {
          appendPaginationMetadata(result as unknown as Record<string, unknown>, {
            itemsKey: "segments",
            totalAvailable: result.totalSegments,
            offset: pagination.offset,
            limit: pagination.limit,
          });
        }

        return result;
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

  let waitResponse: unknown;
  try {
    waitResponse = await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_UNDERSTANDING_ACTION",
      action: request.action,
      payload: request.payload,
    }, { frameId: 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const noReceiver = msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
    if (!noReceiver) {
      return actionFailed(request);
    }
    try {
      await ensureContentScriptInjected(tabId);
      waitResponse = await chrome.tabs.sendMessage(tabId, {
        type: "PAGE_UNDERSTANDING_ACTION",
        action: request.action,
        payload: request.payload,
      }, { frameId: 0 });
    } catch {
      return actionFailed(request, "no-content-script");
    }
  }

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
