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
  forwardToContentScript,
  forwardToFrame,
} from "./relay-forwarder.js";
import { normalizeUrl } from "./store.js";
import { hasErrorField, hasDataField, readBoundsLiteral } from "./relay-type-guards.js";

// ── Shared forwarding helper ─────────────────────────────────────────────────

/**
 * Shared handler for page-understanding actions that follow the pattern:
 * DOM/content-script → call local handler; service worker → forward to content script.
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
  if (typeof document !== "undefined" && localHandler) {
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
    return { requestId: request.requestId, success: true, data: result };
  }

  // Service worker context — forward to content script
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }
  const data = await forwardToContentScript(tabId, request.action, request.payload);
  if (data === null) {
    return actionFailed(request);
  }
  // SW is the authoritative store — save after receiving from CS.
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return { requestId: request.requestId, success: true, data };
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
    const { collectPageMap } = await import("./content/page-map-collector.js");
    const p = request.payload;
    const regionFilter = readBoundsLiteral(p.regionFilter);
    const result = await collectPageMap({
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
    return { requestId: request.requestId, success: true, data: result };
  }

  // Service-worker context — forward to main frame content script first
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
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
  return { requestId: request.requestId, success: true, data: result };
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
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { requestId: request.requestId, success: true, data: waitResponse };
    }
    return actionFailed(request);
  }

  const data = hasDataField(waitResponse) ? waitResponse.data : waitResponse;
  return { requestId: request.requestId, success: true, data };
}
