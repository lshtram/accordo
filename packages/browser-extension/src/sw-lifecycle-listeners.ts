import { toggleCommentsMode, getCommentsMode } from "./state-machine.js";
import { MESSAGE_TYPES } from "./constants.js";
import { handleNavigationReset, type RelayActionRequest, type RelayActionResponse, handleRelayAction } from "./relay-actions.js";
import { DEV_BROWSER_PAIRING_BYPASS, RELAY_TOKEN_STORAGE_KEY } from "./relay-bridge-constants.js";
import { normalizeUrl } from "./store.js";
import type { SwMessage, SwResponse } from "./sw-router.js";

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

export async function broadcastCommentsUpdated(url?: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const normalized = url ? normalizeUrl(url) : undefined;
  const httpTabs = tabs.filter((tab): tab is chrome.tabs.Tab & { id: number } => {
    if (!tab.id || !tab.url) return false;
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) return false;
    if (normalized && normalizeUrl(tab.url) !== normalized) return false;
    return true;
  });
  await Promise.all(
    httpTabs.map(async (tab) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.COMMENTS_UPDATED, payload: { url: normalized } }).catch(() => {});
      } catch {
        // ignore
      }
    }),
  );

  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COMMENTS_UPDATED, payload: { url: normalized } });
  } catch {
    // safe to ignore
  }
}

export async function handleRelayActionWithBroadcast(req: RelayActionRequest): Promise<RelayActionResponse> {
  const response = await handleRelayAction(req);
  if (response.success && ["create_comment", "reply_comment", "delete_comment", "delete_thread", "resolve_thread", "reopen_thread", "notify_comments_updated"].includes(req.action)) {
    const pageUrl = (response.data as { pageUrl?: string; url?: string } | undefined)?.pageUrl
      ?? (response.data as { pageUrl?: string; url?: string } | undefined)?.url;
    await broadcastCommentsUpdated(pageUrl);
  }
  return response;
}

export function registerListeners(
  handleMessage: (message: SwMessage, sender: chrome.runtime.MessageSender) => Promise<SwResponse>,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message as SwMessage, sender).then((resp) => {
      sendResponse(resp);
    }).catch((err) => {
      sendResponse({ success: false, error: String(err) });
    });
    return true;
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      handleNavigationReset();
    }
  });

  chrome.commands.onCommand.addListener((command: string): void => {
    if (command === "toggle-comments-mode") {
      void (async (): Promise<void> => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        const tabId = tab.id;
        await toggleCommentsMode(tabId);
        const isOn = getCommentsMode(tabId);
        void chrome.action.setBadgeText({ text: isOn ? "ON" : "", tabId });
        void chrome.action.setBadgeBackgroundColor({ color: isOn ? "#4a90d9" : "#888", tabId });
        const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
        try {
          await chrome.tabs.sendMessage(tabId, { type: msgType });
        } catch (err) {
          if (!isNoReceiverError(err)) {
            // ignore
          }
        }
      })();
    }
  });
}

export function registerRelayTokenReconnect(startRelay: () => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!Object.prototype.hasOwnProperty.call(changes, RELAY_TOKEN_STORAGE_KEY)) return;
    startRelay();
  });
}

/**
 * Registers a startup reconnect trigger for the relay bridge.
 *
 * When DEV_BROWSER_PAIRING_BYPASS is enabled, the relay token storage change
 * listener above never fires (no token is stored), so we need an explicit
 * startup trigger to reconnect after VS Code reload / service worker wakeup.
 *
 * TODO: Remove this alongside DEV_BROWSER_PAIRING_BYPASS.
 */
export function registerStartupReconnect(startRelay: () => void): void {
  // onStartup fires when the service worker first starts, including after a
  // browser upgrade or after returning from an inactive state.
  chrome.runtime.onStartup.addListener(() => {
    startRelay();
  });
  // Alarm as a secondary fallback in case onStartup doesn't fire on reload.
  void chrome.alarms.create("dev-bypass-reconnect", { delayInMinutes: 0.5, periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dev-bypass-reconnect") startRelay();
  });
}

export async function onInstalled(
  _details: chrome.runtime.InstalledDetails,
): Promise<void> {
  await chrome.storage.local.set({ settings: { commentsMode: false, userName: "Guest" } });
}
