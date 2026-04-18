/**
 * M80-POP — Popup UI
 *
 * Extension action popup logic.
 * Renders thread list, export buttons, Comments Mode toggle, and badge count.
 */

import type { BrowserCommentThread } from "./types.js";
import { MESSAGE_TYPES } from "./constants.js";
import { hasPermission, grant, revoke } from "./control-permission.js";

const RELAY_TOKEN_STORAGE_KEY = "relayToken";
const RELAY_PAIR_URL = "http://127.0.0.1:40111/pair/confirm";

const STORAGE_KEY = "commentsMode";

// ── Debug logger ─────────────────────────────────────────────────────────────────

/** Set DEBUG=true to enable verbose popup logging in the browser console. */
const DEBUG = false;

function dbg(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.warn(`[Accordo POP] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  // dbgErr is for real failures — always log in debug mode only (noisy in normal paths)
  if (DEBUG) console.error(`[Accordo POP ERROR] ${msg}`, ...args);
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
    deleteBtn.addEventListener("click", (e) => {
      void (async (): Promise<void> => {
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
      })();
    });

    item.appendChild(threadInfo);
    item.appendChild(deleteBtn);

    // Click: focus the thread in VS Code's Comments Panel via the relay bridge.
    // Also scroll the in-page popover into view as a secondary UX signal.
    item.addEventListener("click", () => {
      // Primary: notify VS Code to focus the thread in the Comments Panel.
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.FOCUS_THREAD,
        payload: { threadId: thread.id },
      }).catch(() => {/* non-fatal — VS Code may be disconnected */});
      // Secondary: scroll the browser popover into view if content script is active.
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

// ── Public API for tests ────────────────────────────────────────────────────────

/** Sets Comments Mode state and notifies the content script directly. Exported for unit testing. */
export async function setCommentsModeState(tabId: number, enabled: boolean): Promise<void> {
  dbg(`setCommentsModeState: tabId=${tabId} enabled=${enabled}`);
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as Record<number, boolean> | undefined) ?? {};
  stored[tabId] = enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  dbg(`setCommentsModeState: storage written`, stored);

  void chrome.action.setBadgeText({ text: enabled ? "ON" : "", tabId });
  void chrome.action.setBadgeBackgroundColor({ color: enabled ? "#4a90d9" : "#888", tabId });
  dbg(`setCommentsModeState: badge updated`);

  const msgType = enabled ? "comments-mode-on" : "comments-mode-off";
  dbg(`setCommentsModeState: sending "${msgType}" to tabId=${tabId} via chrome.tabs.sendMessage`);
  try {
    await chrome.tabs.sendMessage(tabId, { type: msgType });
    dbg(`setCommentsModeState: tabs.sendMessage succeeded`);
  } catch (err) {
    if (isNoReceiverError(err)) {
      dbg(`setCommentsModeState: no content-script receiver yet for tab ${tabId}, attempting injection recovery`);
      try {
        await ensureContentScriptInjected(tabId);
        // Retry once after injection
        await chrome.tabs.sendMessage(tabId, { type: msgType });
        dbg(`setCommentsModeState: tabs.sendMessage succeeded after injection retry`);
      } catch (injectErr) {
        dbg(`setCommentsModeState: injection recovery failed for tab ${tabId} — keeping graceful behavior`);
      }
    } else {
      dbgErr(`setCommentsModeState: tabs.sendMessage FAILED — ${(err as Error)?.message ?? err}`);
      dbg(`setCommentsModeState: content script may not be injected yet; storage.onChanged will trigger sync on next injection`);
    }
  }
}

// ── Private helpers ─────────────────────────────────────────────────────────────

/**
 * Injects content-script.js and content-styles.css into a tab via chrome.scripting.
 * Used as a recovery step when setCommentsModeState finds no content-script receiver.
 *
 * Restricted tabs (e.g., chrome:// URLs) will throw; caller must handle gracefully.
 */
async function ensureContentScriptInjected(tabId: number): Promise<void> {
  dbg(`ensureContentScriptInjected: injecting into tabId=${tabId}`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
    dbg(`ensureContentScriptInjected: executeScript succeeded for tabId=${tabId}`);
  } catch (err) {
    // e.g. restricted URL scheme — debug log and fail silently per constraints
    dbgErr(`ensureContentScriptInjected: executeScript failed for tabId=${tabId} — ${(err as Error)?.message ?? err}`);
    throw err;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content-styles.css"],
    });
    dbg(`ensureContentScriptInjected: insertCSS succeeded for tabId=${tabId}`);
  } catch (err) {
    // CSS injection failure is non-fatal but log for debug visibility
    dbgErr(`ensureContentScriptInjected: insertCSS failed for tabId=${tabId} — ${(err as Error)?.message ?? err}`);
    // Do NOT throw — CSS is secondary; the JS injection succeeded
  }
}

/** Gets current Comments Mode state for a tab from storage. */
async function getCommentsModeState(tabId: number): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Record<number, boolean> | undefined;
  const isOn = stored?.[tabId] ?? false;
  dbg(`getCommentsModeState: tabId=${tabId} → isOn=${isOn} (raw storage:`, stored, `)`);
  return isOn;
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

// ── Pairing UI ─────────────────────────────────────────────────────────────────

/**
 * Renders a VS Code connection status banner at the top of the popup.
 *
 * - Unpaired: shows a code input + "Connect" button so the user can paste the
 *   pairing code provided by the VS Code agent tool.
 * - Paired: shows a green "Connected to VS Code" indicator.
 *
 * The banner is re-rendered in place after a successful pair or manual disconnect.
 */
async function renderPairingSection(container: HTMLElement): Promise<void> {
  const result = await chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]);
  const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;

  // Clear any existing pairing banner
  const existing = container.querySelector("[data-accordo-pair]");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.setAttribute("data-accordo-pair", "");
  banner.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border-bottom: 1px solid #eee; gap: 8px;
  `;

  if (token) {
    // Paired state
    const label = document.createElement("span");
    label.style.cssText = "font-size: 12px; font-weight: 600; color: #2a7a2a;";
    label.textContent = "VS Code: Connected";

    const disconnectBtn = document.createElement("button");
    disconnectBtn.textContent = "Disconnect";
    disconnectBtn.style.cssText = `
      background: none; border: 1px solid #ccc; border-radius: 10px;
      padding: 2px 10px; font-size: 11px; cursor: pointer; color: #666;
    `;
    disconnectBtn.addEventListener("click", () => {
      void chrome.storage.local.remove(RELAY_TOKEN_STORAGE_KEY).then(() => {
        void renderPairingSection(container);
      });
    });

    banner.appendChild(label);
    banner.appendChild(disconnectBtn);
  } else {
    // Unpaired state — show code input
    const label = document.createElement("span");
    label.style.cssText = "font-size: 12px; color: #888; white-space: nowrap;";
    label.textContent = "VS Code code:";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "1234-5678";
    input.maxLength = 9;
    input.style.cssText = `
      flex: 1; border: 1px solid #ccc; border-radius: 6px;
      padding: 3px 7px; font-size: 12px; font-family: monospace; width: 80px;
    `;

    const connectBtn = document.createElement("button");
    connectBtn.textContent = "Connect";
    connectBtn.style.cssText = `
      background: #4a90d9; color: white; border: none; border-radius: 10px;
      padding: 3px 12px; font-size: 12px; cursor: pointer; font-weight: 600;
      white-space: nowrap;
    `;

    const errorEl = document.createElement("span");
    errorEl.style.cssText = "font-size: 11px; color: #e53e3e; display: none;";
    errorEl.textContent = "Invalid code";

    const doConnect = (): void => {
      const code = input.value.trim();
      if (!code) return;
      errorEl.style.display = "none";
      connectBtn.disabled = true;
      connectBtn.textContent = "...";
      void fetch(RELAY_PAIR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).then(async (res) => {
        if (!res.ok) {
          throw new Error("rejected");
        }
        const body = await res.json() as { token?: string };
        if (!body.token) throw new Error("no-token");
        await chrome.storage.local.set({ [RELAY_TOKEN_STORAGE_KEY]: body.token });
        // Trigger an immediate reconnect — don't wait for the next token-poll cycle.
        void chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RELAY_RECONNECT });
        void renderPairingSection(container);
      }).catch(() => {
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
        errorEl.style.display = "inline";
      });
    };

    connectBtn.addEventListener("click", doConnect);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doConnect();
    });

    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;";
    inputRow.appendChild(input);
    inputRow.appendChild(connectBtn);
    inputRow.appendChild(errorEl);

    banner.appendChild(label);
    banner.appendChild(inputRow);
  }

  // Insert at the very top of the container
  container.insertBefore(banner, container.firstChild);
}

// ── Main popup init ─────────────────────────────────────────────────────────────

export async function initPopup(container: HTMLElement): Promise<void> {
  dbg("initPopup: start");
  container.innerHTML = "";

  // ── Pairing / VS Code connection banner ─────────────────────────────────────
  await renderPairingSection(container);

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

  toggleBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const currentState = await getCommentsModeState(tabId);
      const newState = !currentState;
      dbg(`toggleBtn click: currentState=${currentState} → newState=${newState}`);
      await setCommentsModeState(tabId, newState);
      await renderState();
    })();
  });

  header.appendChild(stateLabel);
  header.appendChild(toggleBtn);
  container.appendChild(header);
  await renderState();

  // ── Control Mode: Grant/Revoke browser control ─────────────────────────────────
  const controlSection = document.createElement("div");
  controlSection.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid #eee;
  `;

  const controlLabel = document.createElement("span");
  controlLabel.id = "accordo-control-label";
  controlLabel.style.cssText = "font-size: 13px; font-weight: 600;";

  const controlBtn = document.createElement("button");
  controlBtn.id = "accordo-control-btn";
  controlBtn.style.cssText = `
    background: #ff6600; color: white; border: none; border-radius: 14px;
    padding: 4px 14px; font-size: 12px; cursor: pointer; font-weight: 600;
  `;

  const renderControlState = async (): Promise<void> => {
    const isGranted = await hasPermission(tabId);
    controlLabel.textContent = `Browser Control: ${isGranted ? "ON" : "OFF"}`;
    controlLabel.style.color = isGranted ? "#2a7a2a" : "#888";
    controlBtn.textContent = isGranted ? "Revoke" : "Grant";
    controlBtn.style.background = isGranted ? "#e53e3e" : "#ff6600";
    dbg(`renderControlState: isGranted=${isGranted}`);
  };

  controlBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const isGranted = await hasPermission(tabId);
      if (isGranted) {
        dbg(`controlBtn click: revoking control for tabId=${tabId}`);
        await revoke(tabId);
      } else {
        dbg(`controlBtn click: granting control for tabId=${tabId}`);
        await grant(tabId);
      }
      await renderControlState();
    })();
  });

  controlSection.appendChild(controlLabel);
  controlSection.appendChild(controlBtn);
  container.appendChild(controlSection);
  await renderControlState();

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

  const exportMdBtn = document.getElementById("accordo-export-md");
  exportMdBtn?.addEventListener("click", () => {
    void (async (): Promise<void> => {
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
    })();
  });

  const deleteAllBtn = document.getElementById("accordo-delete-all");
  deleteAllBtn?.addEventListener("click", () => {
    void (async (): Promise<void> => {
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
    })();
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

  // ── Build version footer ────────────────────────────────────────────────────
  const versionFooter = document.createElement("div");
  versionFooter.style.cssText = "padding: 6px 12px 8px; font-size: 10px; color: #888; text-align: right; border-top: 1px solid #eee; margin-top: 8px;";
  // __BUILD_TIME__ is injected by esbuild via define (scripts/build.ts).
  // Use a safe fallback for environments where the global is not defined (e.g. tests).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildTime = typeof (__BUILD_TIME__ as unknown as string | undefined) === "string"
    ? (__BUILD_TIME__ as string)
    : new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  versionFooter.textContent = `build: ${buildTime}`;
  container.appendChild(versionFooter);
}

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
