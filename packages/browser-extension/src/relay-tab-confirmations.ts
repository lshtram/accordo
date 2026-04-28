/**
 * relay-tab-confirmations.ts — Tab/window confirmation helpers for multi-tab relay.
 *
 * @module
 */

import type { RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";

/**
 * Probes whether a tab still exists by calling chrome.tabs.get.
 * Returns true if the tab is present, false if it is confirmed gone/closed.
 */
export async function probeTabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirms tab activation succeeded by validating chrome.tabs.update result.
 * Returns { ok: true, tabId, windowId } on success.
 * Returns null (caller probes for tab existence) when result is absent or
 *   windowId missing — these may indicate the tab is gone or just un-activatable.
 * Returns action-failed directly for wrong tab id or !active (definitively failed,
 *   no probe needed — the tab is present but wrong state).
 */
export async function confirmTabActivation(
  requestId: string,
  updateResult: chrome.tabs.Tab | undefined,
  requestedTabId: number,
): Promise<{ ok: true; tabId: number; windowId: number } | { ok: false; response?: RelayActionResponse }> {
  if (!updateResult || typeof updateResult.id !== "number") {
    return { ok: false };
  }
  if (updateResult.id !== requestedTabId) {
    return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  }
  if (updateResult.active !== true) {
    return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  }
  const windowId = updateResult.windowId;
  if (typeof windowId !== "number") {
    return { ok: false };
  }
  return { ok: true, tabId: updateResult.id, windowId };
}

/**
 * Confirms window focus succeeded by validating chrome.windows.update result.
 * Returns { ok: true, windowId } on success.
 * Returns null (caller probes for tab existence) when result is absent — may
 *   indicate the tab/window is gone or just unfocusable.
 * Returns action-failed directly for wrong window id or !focused (definitively
 *   failed, no probe needed).
 */
export async function confirmWindowFocus(
  requestId: string,
  updateResult: chrome.windows.Window | undefined,
  expectedWindowId: number,
): Promise<{ ok: true; windowId: number } | { ok: false; response?: RelayActionResponse }> {
  if (!updateResult || typeof updateResult.id !== "number") {
    return { ok: false };
  }
  if (updateResult.id !== expectedWindowId) {
    return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  }
  if (updateResult.focused !== true) {
    return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  }
  return { ok: true, windowId: updateResult.id };
}