import { MESSAGE_TYPES } from "./constants.js";

const STORAGE_KEY = "commentsMode";
const DEBUG = false;

export function dbg(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.warn(`[Accordo POP] ${msg}`, ...args);
}

export function dbgErr(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.error(`[Accordo POP ERROR] ${msg}`, ...args);
}

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  dbg(`ensureContentScriptInjected: injecting into tabId=${tabId}`);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
  } catch (err) {
    dbgErr(`ensureContentScriptInjected: executeScript failed for tabId=${tabId} — ${(err as Error)?.message ?? err}`);
    throw err;
  }

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content-styles.css"] });
  } catch (err) {
    dbgErr(`ensureContentScriptInjected: insertCSS failed for tabId=${tabId} — ${(err as Error)?.message ?? err}`);
  }
}

export async function setCommentsModeState(tabId: number, enabled: boolean): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as Record<number, boolean> | undefined) ?? {};
  stored[tabId] = enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });

  void chrome.action.setBadgeText({ text: enabled ? "ON" : "", tabId });
  void chrome.action.setBadgeBackgroundColor({ color: enabled ? "#4a90d9" : "#888", tabId });

  const msgType = enabled ? "comments-mode-on" : "comments-mode-off";
  try {
    await chrome.tabs.sendMessage(tabId, { type: msgType });
  } catch (err) {
    if (isNoReceiverError(err)) {
      try {
        await ensureContentScriptInjected(tabId);
        await chrome.tabs.sendMessage(tabId, { type: msgType });
      } catch {
        dbg(`setCommentsModeState: injection recovery failed for tab ${tabId} — keeping graceful behavior`);
      }
    } else {
      dbgErr(`setCommentsModeState: tabs.sendMessage FAILED — ${(err as Error)?.message ?? err}`);
    }
  }
}

export async function getCommentsModeState(tabId: number): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Record<number, boolean> | undefined;
  return stored?.[tabId] ?? false;
}

export function showToast(msg: string): void {
  document.querySelectorAll("#accordo-toast").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.id = "accordo-toast";
  toast.textContent = msg;
  toast.style.cssText = "position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: white; padding: 8px 16px; border-radius: 20px; font-size: 13px; z-index: 99999; opacity: 0.9; pointer-events: none;";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
