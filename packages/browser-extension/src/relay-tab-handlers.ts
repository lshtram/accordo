/**
 * relay-tab-handlers.ts — Handler implementations for multi-tab relay actions.
 *
 * Handlers: list_pages, select_page.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, getErrorMeta } from "./relay-definitions.js";
import { getGrantedTabs } from "./control-permission.js";
import { resolveImplicitTargetTabId } from "./relay-implicit-target.js";

// ── Multi-Tab Handlers ───────────────────────────────────────────────────────

export async function handleListPages(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const allTabs = await chrome.tabs.query({});
  const grantedTabs = new Set(await getGrantedTabs());
  const implicitTargetTabId = await resolveImplicitTargetTabId();
  const pages = allTabs.map((tab) => ({
    tabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: tab.active,
    windowId: tab.windowId,
    controlGranted: typeof tab.id === "number" ? grantedTabs.has(tab.id) : false,
    isImplicitTarget: typeof tab.id === "number" && tab.id === implicitTargetTabId,
  }));
  return { requestId: request.requestId, success: true, data: { pages } };
}

export async function handleSelectPage(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const selectTabId = request.payload.tabId;
  if (typeof selectTabId !== "number" || !Number.isInteger(selectTabId)) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const updatedTab = await chrome.tabs.update(selectTabId, { active: true });
  if (!updatedTab || typeof updatedTab.id !== "number") {
    return { requestId: request.requestId, success: false, error: "action-failed", ...getErrorMeta("action-failed") };
  }
  if (typeof updatedTab.windowId === "number") {
    await chrome.windows.update(updatedTab.windowId, { focused: true });
  }
  return {
    requestId: request.requestId,
    success: true,
    data: {
      success: true,
      tabId: updatedTab.id,
      windowId: updatedTab.windowId,
      isImplicitTarget: true,
    },
  };
}

export async function handleManageSnapshots(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const action = request.payload.action;
  if (action !== "list" && action !== "clear") {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }

  if (action === "list") {
    const allPages = defaultStore.listAll();
    const pages = Array.from(allPages.entries(), ([pageId, snapshots]) => ({
      pageId,
      snapshotCount: snapshots.length,
      snapshots: snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        capturedAt: snapshot.capturedAt,
        source: snapshot.source,
      })),
    }));
    return { requestId: request.requestId, success: true, data: { pages } };
  }

  const pageId = typeof request.payload.pageId === "string" ? request.payload.pageId : undefined;
  const allPages = defaultStore.listAll();
  if (pageId !== undefined) {
    const clearedCount = allPages.get(pageId)?.length ?? 0;
    defaultStore.clear(pageId);
    return { requestId: request.requestId, success: true, data: { success: true, clearedPageId: pageId, clearedCount } };
  }

  const clearedCount = Array.from(allPages.values()).reduce((sum, snapshots) => sum + snapshots.length, 0);
  defaultStore.clear();
  return { requestId: request.requestId, success: true, data: { success: true, clearedCount } };
}
