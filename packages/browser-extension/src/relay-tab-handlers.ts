/**
 * relay-tab-handlers.ts — Thin coordinator for multi-tab relay actions.
 *
 * Handlers: list_pages, select_page.
 * Helpers live in:
 *   relay-select-page.ts     — activation / focus / probe helpers
 *   relay-snapshot-handlers.ts — snapshot list/clear handling
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import { getGrantedTabs } from "./control-permission.js";
import { resolveImplicitTargetTabId } from "./relay-implicit-target.js";
import { probeTabExists, confirmTabActivation, confirmWindowFocus } from "./relay-select-page.js";

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

/**
 * Applies chrome.tabs.update + confirms result.
 * Returns { ok, tabId, windowId } on success.
 * Returns { ok: false, response } on any failure (definitive or probed classification).
 */
async function applyTabActivation(
  requestId: string,
  tabId: number,
): Promise<{ ok: true; tabId: number; windowId: number } | { ok: false; response: RelayActionResponse }> {
  let updatedTab: chrome.tabs.Tab | undefined;
  let updateFailed = false;
  try { updatedTab = await chrome.tabs.update(tabId, { active: true }); }
  catch { updateFailed = true; }
  const activation = await confirmTabActivation(requestId, updatedTab, tabId);
  if (!activation.ok) {
    if (activation.response) return { ok: false, response: activation.response };
    const tabGone = updateFailed ? !(await probeTabExists(tabId)) : !(await probeTabExists(tabId));
    return { ok: false, response: actionFailed({ requestId }, tabGone ? "tab-not-found" : "action-failed") };
  }
  return { ok: true, tabId: activation.tabId, windowId: activation.windowId };
}

/**
 * Applies chrome.windows.update + confirms result.
 * Returns { ok, windowId } on success.
 * Returns { ok: false, response } on any failure.
 */
async function applyWindowFocus(
  requestId: string,
  windowId: number,
  tabId: number,
): Promise<{ ok: true; windowId: number } | { ok: false; response: RelayActionResponse }> {
  let winUpdate: chrome.windows.Window | undefined;
  let winUpdateFailed = false;
  try { winUpdate = await chrome.windows.update(windowId, { focused: true }); }
  catch { winUpdateFailed = true; }
  const windowFocus = await confirmWindowFocus(requestId, winUpdate, windowId);
  if (!windowFocus.ok) {
    if (windowFocus.response) return { ok: false, response: windowFocus.response };
    const tabGone = winUpdateFailed ? !(await probeTabExists(tabId)) : !(await probeTabExists(tabId));
    return { ok: false, response: actionFailed({ requestId }, tabGone ? "tab-not-found" : "action-failed") };
  }
  return { ok: true, windowId };
}

export async function handleSelectPage(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const tabId = request.payload.tabId;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId <= 0) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const tab = await applyTabActivation(request.requestId, tabId);
  if (!tab.ok) return tab.response;
  const win = await applyWindowFocus(request.requestId, tab.windowId, tabId);
  if (!win.ok) return win.response;
  return { requestId: request.requestId, success: true, data: { success: true, tabId: tab.tabId, windowId: tab.windowId, isImplicitTarget: true } };
}
