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
import { defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import {
  resolveTargetTabId,
  forwardToContentScript,
} from "./relay-forwarder.js";
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
    if (saveToStore && isVersionedSnapshot(result)) {
      await defaultStore.save(result.pageId, result);
    }
    return { requestId: request.requestId, success: true, data: result };
  }

  // Service worker context — forward to content script
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
  const data = await forwardToContentScript(tabId, request.action, request.payload);
  if (data === null) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save(data.pageId, data);
  }
  return { requestId: request.requestId, success: true, data };
}

// ── Page-map payload narrowing ───────────────────────────────────────────────

type InspectPayload =
  | { nodeId: number }
  | { ref: string; selector?: string }
  | { selector: string };

function toInspectPayload(raw: Record<string, unknown>): InspectPayload {
  if (typeof raw.nodeId === "number") {
    return { nodeId: raw.nodeId };
  }
  if (typeof raw.ref === "string") {
    return {
      ref: raw.ref,
      selector: typeof raw.selector === "string" ? raw.selector : undefined,
    };
  }
  return { selector: typeof raw.selector === "string" ? raw.selector : "" };
}

// ── Page Understanding Handlers ──────────────────────────────────────────────

export async function handleGetPageMap(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { collectPageMap } = await import("./content/page-map-collector.js");
        const p = request.payload;
        const regionFilter = readBoundsLiteral(p.regionFilter);
        return collectPageMap({
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
        });
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, /* saveToStore */ true);
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
  if (typeof document !== "undefined") {
    // jsdom / content-script context — stub until Phase C
    throw new Error("not implemented");
  }
  return handlePageUnderstandingAction(request, null, /* saveToStore */ false);
}

// ── Wait Handler ─────────────────────────────────────────────────────────────

export async function handleWaitFor(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  if (typeof document !== "undefined") {
    // jsdom / content-script context — stub, not implemented yet
    throw new Error("not implemented");
  }

  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
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
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }

  const data = hasDataField(waitResponse) ? waitResponse.data : waitResponse;
  return { requestId: request.requestId, success: true, data };
}
