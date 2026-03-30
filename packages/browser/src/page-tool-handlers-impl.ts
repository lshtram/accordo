/**
 * M91-PU + M91-CR — Page Tool Handler Implementations
 *
 * All handler functions that forward requests through the browser relay
 * to the Chrome extension's content script.
 *
 * @module
 */

import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

import type {
  CaptureRegionArgs,
  CaptureRegionResponse,
  DomExcerptResponse,
  GetDomExcerptArgs,
  GetPageMapArgs,
  GetSemanticGraphArgs,
  GetTextMapArgs,
  InspectElementArgs,
  InspectElementResponse,
  ListPagesArgs,
  ListPagesResponse,
  PageMapResponse,
  PageToolError,
  SelectPageArgs,
  SelectPageResponse,
  WaitForArgs,
} from "./page-tool-types.js";

import {
  CAPTURE_REGION_TIMEOUT_MS,
  classifyRelayError,
  EXCERPT_TIMEOUT_MS,
  INSPECT_TIMEOUT_MS,
  PAGE_MAP_TIMEOUT_MS,
  SEMANTIC_GRAPH_TIMEOUT_MS,
  TAB_MGMT_TIMEOUT_MS,
  TEXT_MAP_TIMEOUT_MS,
  WAIT_FOR_RELAY_TIMEOUT_MS,
} from "./page-tool-types.js";

// ── Tool Handlers ─────────────────────────────────────────────────────────────

/**
 * Handler for browser_get_page_map.
 *
 * Forwards to the Chrome relay's `get_page_map` action and returns
 * the structured page map result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope (pageId, frameId, snapshotId,
 * capturedAt, viewport, source) is embedded inside `response.data` by the
 * content script. This handler validates the envelope is present before
 * returning the data.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention
 * store so agents can retrieve recent snapshots without re-requesting.
 *
 * @see PU-F-50, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
  store: SnapshotRetentionStore,
): Promise<PageMapResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }

  try {
    const response = await relay.request("get_page_map", args as Record<string, unknown>, PAGE_MAP_TIMEOUT_MS);
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "pageUrl" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as PageMapResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

/**
 * Handler for browser_inspect_element.
 *
 * Forwards to the Chrome relay's `inspect_element` action and returns
 * the detailed element inspection result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * B2-SV-006: Supports lookup by `nodeId` from a page map snapshot.
 *
 * @see PU-F-51, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
  store: SnapshotRetentionStore,
): Promise<InspectElementResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", found: false };
  }

  try {
    const response = await relay.request(
      "inspect_element",
      args as Record<string, unknown>,
      INSPECT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as InspectElementResponse;
    }
    return { success: false, error: "action-failed", found: false };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), found: false };
  }
}

/**
 * Handler for browser_get_dom_excerpt.
 *
 * Forwards to the Chrome relay's `get_dom_excerpt` action and returns
 * the sanitized HTML fragment.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see PU-F-52, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetDomExcerpt(
  relay: BrowserRelayLike,
  args: GetDomExcerptArgs,
  store: SnapshotRetentionStore,
): Promise<DomExcerptResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", found: false };
  }

  try {
    const response = await relay.request(
      "get_dom_excerpt",
      args as unknown as Record<string, unknown>,
      EXCERPT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as DomExcerptResponse;
    }
    return { success: false, error: "action-failed", found: false };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), found: false };
  }
}

/**
 * Handler for browser_capture_region (M91-CR).
 *
 * Forwards to the Chrome relay's `capture_region` action. The content
 * script resolves the target element to viewport-relative bounds, the
 * service worker captures `captureVisibleTab()` and crops using
 * `OffscreenCanvas`, then returns the cropped JPEG data URL.
 *
 * B2-SV-003: The relay embeds the SnapshotEnvelope (sourced from the content
 * script) in the capture response. This handler validates its presence,
 * consistent with the other 3 data-producing tool handlers.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see CR-F-01, CR-F-08, CR-F-11, CR-F-12
 */
export async function handleCaptureRegion(
  relay: BrowserRelayLike,
  args: CaptureRegionArgs,
  store: SnapshotRetentionStore,
): Promise<CaptureRegionResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "capture_region",
      args as Record<string, unknown>,
      CAPTURE_REGION_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "success" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as CaptureRegionResponse;
    }
    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_wait_for (inlined into buildPageUnderstandingTools).
 */
export async function handleWaitForInline(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, WAIT_FOR_RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) {
      return response.data;
    }
    const errCode = response.error ?? "timeout";
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs: 0 };
    }
    return response.data ?? { met: false, error: "timeout", elapsedMs: 0 };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_text_map (inlined into buildPageUnderstandingTools).
 */
export async function handleGetTextMapInline(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const response = await relay.request("get_text_map", args as Record<string, unknown>, TEXT_MAP_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      return { success: false, error: response.error ?? "action-failed" };
    }
    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data);
    }
    return response.data;
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_semantic_graph (inlined into buildPageUnderstandingTools).
 */
export async function handleGetSemanticGraphInline(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
    if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;

    const response = await relay.request("get_semantic_graph", payload, SEMANTIC_GRAPH_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      return { success: false, error: response.error ?? "action-failed" };
    }
    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }
    return response.data;
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_list_pages (B2-CTX-001).
 * Forwards to relay's "list_pages" action.
 */
export async function handleListPages(
  relay: BrowserRelayLike,
  args: ListPagesArgs,
): Promise<ListPagesResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("list_pages", args as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "pages" in response.data) {
      return response.data as ListPagesResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

/**
 * Handler for browser_select_page (B2-CTX-001).
 * Forwards to relay's "select_page" action.
 */
export async function handleSelectPage(
  relay: BrowserRelayLike,
  args: SelectPageArgs,
): Promise<SelectPageResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("select_page", args as unknown as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return { success: false, error: response.error ?? "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}
