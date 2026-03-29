/**
 * relay-tab-handlers.ts — Handler implementations for multi-tab relay actions.
 *
 * Handlers: list_pages, select_page.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

// ── Multi-Tab Handlers ───────────────────────────────────────────────────────

export async function handleListPages(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const allTabs = await chrome.tabs.query({});
  const pages = allTabs.map((tab) => ({
    tabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: tab.active,
  }));
  return { requestId: request.requestId, success: true, data: { pages } };
}

export async function handleSelectPage(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const selectTabId = request.payload.tabId;
  if (typeof selectTabId !== "number" || !Number.isInteger(selectTabId)) {
    return { requestId: request.requestId, success: false, error: "invalid-request" };
  }
  await chrome.tabs.update(selectTabId, { active: true });
  return { requestId: request.requestId, success: true };
}
