/**
 * M80-POP — Popup UI
 *
 * Extension action popup logic.
 * Renders thread list, export buttons, Comments Mode toggle, and badge count.
 */

import type { BrowserCommentThread } from "./types.js";
import { MESSAGE_TYPES } from "./constants.js";
import { initPopup } from "./popup-init.js";
import { renderThreadList, updateBadgeCount } from "./popup-thread-list.js";
import { setCommentsModeState, dbg, dbgErr } from "./popup-state.js";

export { initPopup } from "./popup-init.js";
export { renderThreadList, updateBadgeCount } from "./popup-thread-list.js";
export { setCommentsModeState } from "./popup-state.js";

// ── Public API for tests ────────────────────────────────────────────────────────

/** Sends the EXPORT message to the service worker. Exported for testability. */
export async function sendExportMessage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  const url = tab?.url ?? "";
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.EXPORT,
    payload: { format: "markdown", tabId, url },
  });
}

/** Sends JSON export message. Exported for testability. */
export async function sendExportJsonMessage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  const url = tab?.url ?? "";
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.EXPORT,
    payload: { format: "json", tabId, url },
  });
}

/** Sends TOGGLE_COMMENTS_MODE to the service worker. Exported for testability. */
export async function sendToggleMessage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.TOGGLE_COMMENTS_MODE,
    payload: { tabId },
  });
}

/** Renders the thread list. tabId is used for thread-click → open popover. */
// ── Bootstrap ──────────────────────────────────────────────────────────────────
dbg("Popup script loaded — waiting for DOMContentLoaded");
document.addEventListener("DOMContentLoaded", () => {
  dbg("DOMContentLoaded: finding #accordo-popup-root");
  const root = document.getElementById("accordo-popup-root");
  if (root) {
    dbg("DOMContentLoaded: root found, calling initPopup");
    void initPopup(root);
  } else {
    dbgErr("DOMContentLoaded: #accordo-popup-root NOT FOUND in DOM");
  }
});
