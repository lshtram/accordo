/**
 * relay-select-page.ts — Select-page activation, focus, and probe helpers.
 *
 * Exports:
 *   probeTabExists    — confirms tab presence via chrome.tabs.get
 *   confirmTabActivation  — validates tabs.update result
 *   confirmWindowFocus   — validates windows.update result
 *
 * @module
 */

import type { RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";

/** Probes whether a tab still exists via chrome.tabs.get. */
export async function probeTabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a chrome.tabs.update result.
 * Returns { ok, tabId, windowId } on full confirmation.
 * Returns { ok: false } with no response when result is indeterminate
 *   (tab likely gone — caller probes to classify).
 * Returns { ok: false, response } for definitively wrong states
 *   (wrong id, !active) — no probe needed.
 */
export async function confirmTabActivation(
  requestId: string,
  updateResult: chrome.tabs.Tab | undefined,
  requestedTabId: number,
): Promise<{ ok: true; tabId: number; windowId: number } | { ok: false; response?: RelayActionResponse }> {
  if (!updateResult || typeof updateResult.id !== "number") return { ok: false };
  if (updateResult.id !== requestedTabId) return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  if (typeof updateResult.windowId !== "number") return { ok: false };
  return { ok: true, tabId: updateResult.id, windowId: updateResult.windowId };
}

/**
 * Validates a chrome.windows.update result.
 * Returns { ok, windowId } on full confirmation.
 * Returns { ok: false } with no response when result is indeterminate
 *   (window likely gone — caller probes to classify).
 * Returns { ok: false, response } for definitively wrong states
 *   (wrong id, !focused) — no probe needed.
 */
export async function confirmWindowFocus(
  requestId: string,
  updateResult: chrome.windows.Window | undefined,
  expectedWindowId: number,
): Promise<{ ok: true; windowId: number } | { ok: false; response?: RelayActionResponse }> {
  if (!updateResult || typeof updateResult.id !== "number") return { ok: false };
  if (updateResult.id !== expectedWindowId) return { ok: false, response: actionFailed({ requestId }, "action-failed") };
  return { ok: true, windowId: updateResult.id };
}
