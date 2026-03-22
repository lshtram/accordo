/**
 * M80-POP — Popup UI
 *
 * Extension action popup logic.
 * Renders thread list, export buttons, Comments Mode toggle, and badge count.
 */

import type { BrowserCommentThread } from "./types.js";
import { MESSAGE_TYPES } from "./constants.js";

const STORAGE_KEY = "commentsMode";

// ── Debug logger ─────────────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo POP] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo POP ERROR] ${msg}`, ...args);
}

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

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
export function renderThreadList(
  container: HTMLElement,
  threads: BrowserCommentThread[],
  tabId?: number,
  pageUrl?: string
): void {
  container.innerHTML = "";

  if (threads.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No comments on this page";
    empty.style.cssText = "font-size: 13px; color: #999; padding: 10px 0; text-align: center;";
    container.appendChild(empty);
    return;
  }

  for (const thread of threads) {
    const item = document.createElement("div");
    item.setAttribute("data-thread-id", thread.id);
    item.style.cssText = `
      padding: 8px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;
      display: flex; align-items: center; justify-content: space-between;
    `;

    const threadInfo = document.createElement("div");
    threadInfo.style.cssText = "flex: 1;";
    const latestComment = thread.comments[thread.comments.length - 1];
    const previewText = (latestComment?.body ?? "").trim() || "(no comment text)";
    const replyCount = Math.max(0, thread.comments.length - 1);
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;";

    const authorEl = document.createElement("span");
    authorEl.style.cssText = "font-weight:600;font-size:13px;color:#333;";
    authorEl.textContent = latestComment?.author.name ?? "Guest";

    const statusEl = document.createElement("span");
    statusEl.style.cssText = `font-size:11px;padding:2px 7px;border-radius:10px;${thread.status === "resolved" ? "background:#e8f5e9;color:#2e7d32" : "background:#e3f2fd;color:#1565c0"}`;
    statusEl.textContent = thread.status;

    topRow.appendChild(authorEl);
    topRow.appendChild(statusEl);

    const previewEl = document.createElement("div");
    previewEl.style.cssText = "font-size:12px;color:#222;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    previewEl.textContent = previewText;

    const metaEl = document.createElement("div");
    metaEl.style.cssText = "font-size:11px;color:#999;margin-top:2px;";
    metaEl.textContent = `${thread.comments.length} comment${thread.comments.length !== 1 ? "s" : ""}${replyCount > 0 ? ` • ${replyCount} repl${replyCount === 1 ? "y" : "ies"}` : ""}`;

    threadInfo.appendChild(topRow);
    threadInfo.appendChild(previewEl);
    threadInfo.appendChild(metaEl);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "×";
    deleteBtn.style.cssText = `
      background: none; border: none; color: #c0392b; cursor: pointer;
      font-size: 16px; padding: 0 4px; margin-left: 8px;
    `;
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete thread #${thread.id.slice(0, 8)} and all its comments?`)) {
        try {
          await chrome.runtime.sendMessage({
            type: "SOFT_DELETE_THREAD",
            payload: { threadId: thread.id, deletedBy: "User" },
          });
          // Refresh the thread list
          const response = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_THREADS,
            payload: { url: pageUrl },
          });
          const updatedThreads: BrowserCommentThread[] = response?.success ? (response.data ?? []) : [];
          renderThreadList(container, updatedThreads, tabId, pageUrl);
        } catch (err) {
          console.error("Failed to delete thread:", err);
        }
      }
    });

    item.appendChild(threadInfo);
    item.appendChild(deleteBtn);

    // Click: tell the content script to open this thread's popover
    item.addEventListener("click", () => {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: "scroll-to-thread",
          payload: { threadId: thread.id },
        }).catch(() => {/* content script may not be injected */});
      }
    });
    container.appendChild(item);
  }
}

/** Updates the badge element with the thread count. */
export function updateBadgeCount(container: HTMLElement, count: number): void {
  let badge = container.querySelector("[data-accordo-badge]");
  if (!badge) {
    badge = document.createElement("span");
    badge.setAttribute("data-accordo-badge", "");
    container.appendChild(badge);
  }
  badge.textContent = String(count);
}

// ── Private helpers ─────────────────────────────────────────────────────────────

/** Gets current Comments Mode state for a tab from storage. */
async function getCommentsModeState(tabId: number): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Record<number, boolean> | undefined;
  const isOn = stored?.[tabId] ?? false;
  dbg(`getCommentsModeState: tabId=${tabId} → isOn=${isOn} (raw storage:`, stored, `)`);
  return isOn;
}

/** Sets Comments Mode state and notifies the content script directly. */
async function setCommentsModeState(tabId: number, enabled: boolean): Promise<void> {
  dbg(`setCommentsModeState: tabId=${tabId} enabled=${enabled}`);
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as Record<number, boolean> | undefined) ?? {};
  stored[tabId] = enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  dbg(`setCommentsModeState: storage written`, stored);

  chrome.action.setBadgeText({ text: enabled ? "ON" : "", tabId });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#4a90d9" : "#888", tabId });
  dbg(`setCommentsModeState: badge updated`);

  const msgType = enabled ? "comments-mode-on" : "comments-mode-off";
  dbg(`setCommentsModeState: sending "${msgType}" to tabId=${tabId} via chrome.tabs.sendMessage`);
  try {
    await chrome.tabs.sendMessage(tabId, { type: msgType });
    dbg(`setCommentsModeState: tabs.sendMessage succeeded`);
  } catch (err) {
    if (isNoReceiverError(err)) {
      dbg(`setCommentsModeState: no content-script receiver yet for tab ${tabId}`);
    } else {
      dbgErr(`setCommentsModeState: tabs.sendMessage FAILED — ${(err as Error)?.message ?? err}`);
    }
    dbg(`setCommentsModeState: content script may not be injected yet; storage.onChanged will trigger sync on next injection`);
  }
}

/** Shows a brief toast at the bottom of the popup. */
function showToast(msg: string): void {
  document.querySelectorAll("#accordo-toast").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.id = "accordo-toast";
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; color: white; padding: 8px 16px; border-radius: 20px;
    font-size: 13px; z-index: 99999; opacity: 0.9; pointer-events: none;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

// ── Main popup init ─────────────────────────────────────────────────────────────

export async function initPopup(container: HTMLElement): Promise<void> {
  dbg("initPopup: start");
  container.innerHTML = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  const pageUrl = tab?.url ?? "";
  dbg(`initPopup: active tab id=${tabId} url=${pageUrl}`);

  // ── Header: state label + toggle ────────────────────────────────────────────
  const header = document.createElement("div");
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid #eee;
  `;

  const stateLabel = document.createElement("span");
  stateLabel.id = "accordo-state-label";
  stateLabel.style.cssText = "font-size: 13px; font-weight: 600;";

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "accordo-toggle";
  toggleBtn.style.cssText = `
    background: #4a90d9; color: white; border: none; border-radius: 14px;
    padding: 4px 14px; font-size: 12px; cursor: pointer; font-weight: 600;
  `;

  const renderState = async (): Promise<void> => {
    const isOn = await getCommentsModeState(tabId);
    stateLabel.textContent = `Comments Mode: ${isOn ? "ON" : "OFF"}`;
    stateLabel.style.color = isOn ? "#2a7a2a" : "#888";
    toggleBtn.textContent = isOn ? "Turn OFF" : "Turn ON";
    toggleBtn.style.background = isOn ? "#e53e3e" : "#4a90d9";
    dbg(`renderState: displayed isOn=${isOn}`);
  };

  toggleBtn.addEventListener("click", async () => {
    const currentState = await getCommentsModeState(tabId);
    const newState = !currentState;
    dbg(`toggleBtn click: currentState=${currentState} → newState=${newState}`);
    await setCommentsModeState(tabId, newState);
    await renderState();
  });

  header.appendChild(stateLabel);
  header.appendChild(toggleBtn);
  container.appendChild(header);
  await renderState();

  // ── Shortcut hint ──────────────────────────────────────────────────────────
  const hint = document.createElement("div");
  hint.style.cssText = "padding: 6px 12px; font-size: 11px; color: #888; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 8px;";
  const shortcut = document.createElement("span");
  shortcut.textContent = "Shortcut: Alt+Shift+C";
  hint.appendChild(shortcut);

  const shortcutBtn = document.createElement("button");
  shortcutBtn.textContent = "Configure";
  shortcutBtn.style.cssText = "background:none;border:none;color:#4a90d9;cursor:pointer;font-size:11px;padding:0;";
  shortcutBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(() => {
      showToast("Open chrome://extensions/shortcuts");
    });
  });
  hint.appendChild(shortcutBtn);

  if (chrome.commands?.getAll) {
    chrome.commands.getAll().then((commands) => {
      const toggleCommand = commands.find((c) => c.name === "toggle-comments-mode");
      const assigned = toggleCommand?.shortcut?.trim();
      if (assigned) {
        shortcut.textContent = `Shortcut: ${assigned}`;
      } else {
        shortcut.textContent = "Shortcut not assigned";
      }
    }).catch(() => {
      // Keep default hint text
    });
  }
  container.appendChild(hint);

  // ── Thread list ────────────────────────────────────────────────────────────
  const listLabel = document.createElement("div");
  listLabel.textContent = "THREADS";
  listLabel.style.cssText = "padding: 8px 12px 4px; font-size: 11px; font-weight: 700; color: #999; letter-spacing: 0.5px;";
  container.appendChild(listLabel);

  const listContainer = document.createElement("div");
  listContainer.id = "accordo-thread-list";
  listContainer.style.cssText = "padding: 0 12px; min-height: 40px;";
  container.appendChild(listContainer);

  // ── Export buttons ──────────────────────────────────────────────────────────
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; padding: 10px 12px 14px;";
  btnRow.innerHTML = `
    <button id="accordo-export-md" style="flex:1;padding:8px;background:#4a90d9;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Copy Markdown</button>
    <button id="accordo-export-json" style="flex:1;padding:8px;background:#6b7280;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Copy JSON</button>
    <button id="accordo-delete-all" style="flex:1;padding:8px;background:#e53e3e;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Delete All</button>
  `;
  container.appendChild(btnRow);

  document.getElementById("accordo-export-md")!.addEventListener("click", async () => {
    dbg(`export-md click: tabId=${tabId} url=${pageUrl}`);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.EXPORT,
        payload: { format: "markdown", tabId, url: pageUrl },
      });
      dbg(`export-md: SW response =`, response);
      if (response?.success && response.data?.text) {
        await navigator.clipboard.writeText(response.data.text as string);
        dbg(`export-md: clipboard write succeeded`);
      }
      showToast("Markdown copied!");
    } catch (err) {
      dbgErr(`export-md: failed — ${err}`);
      showToast("Export failed");
    }
  });

  document.getElementById("accordo-delete-all")!.addEventListener("click", async () => {
    if (confirm("Delete ALL threads and comments on this page? This cannot be undone.")) {
      try {
        // Get all threads and delete them one by one
        const response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.GET_THREADS,
          payload: { url: pageUrl },
        });
        const threads: BrowserCommentThread[] = response?.success ? (response.data ?? []) : [];
        for (const thread of threads) {
          await chrome.runtime.sendMessage({
            type: "SOFT_DELETE_THREAD",
            payload: { threadId: thread.id, deletedBy: "User" },
          });
        }
        // Refresh the thread list
        renderThreadList(listContainer, [], tabId, pageUrl);
        showToast("All threads deleted");
      } catch (err) {
        console.error("Failed to delete all threads:", err);
        showToast("Delete failed");
      }
    }
  });

  // ── Load threads ────────────────────────────────────────────────────────────
  const refreshThreads = async (): Promise<void> => {
    dbg(`initPopup: loading threads for url=${pageUrl}`);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_THREADS,
        payload: { url: pageUrl },
      });
      dbg(`initPopup: GET_THREADS response =`, response);
      const threads: BrowserCommentThread[] = response?.success ? (response.data ?? []) : [];
      renderThreadList(listContainer, threads, tabId, pageUrl);
    } catch (err) {
      dbgErr(`initPopup: GET_THREADS failed — ${err}`);
      renderThreadList(listContainer, [], tabId, pageUrl);
    }
  };

  await refreshThreads();

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === MESSAGE_TYPES.COMMENTS_UPDATED) {
      void refreshThreads();
    }
    return false;
  });

  dbg("initPopup: complete");
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
dbg("Popup script loaded — waiting for DOMContentLoaded");
document.addEventListener("DOMContentLoaded", () => {
  dbg("DOMContentLoaded: finding #accordo-popup-root");
  const root = document.getElementById("accordo-popup-root");
  if (root) {
    dbg("DOMContentLoaded: root found, calling initPopup");
    initPopup(root);
  } else {
    dbgErr("DOMContentLoaded: #accordo-popup-root NOT FOUND in DOM");
  }
});
