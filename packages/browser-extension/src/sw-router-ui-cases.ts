import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { SwMessage, SwResponse } from "./sw-router.js";

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

export async function handleUiMessage(
  message: SwMessage,
  sender: chrome.runtime.MessageSender,
): Promise<SwResponse | undefined> {
  const payload = message.payload as Record<string, unknown> | undefined;
  switch (message.type) {
    case MESSAGE_TYPES.TOGGLE_COMMENTS_MODE: {
      const tabId = (payload?.tabId as number | undefined) ?? 1;
      await toggleCommentsMode(tabId);
      const isOn = getCommentsMode(tabId);
      if (sender.tab?.id) {
        const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
        chrome.tabs.sendMessage(sender.tab.id, { type: msgType }).catch((err) => {
          if (!isNoReceiverError(err)) {
            // ignore
          }
        });
      }
      return { success: true };
    }
    case MESSAGE_TYPES.GET_TAB_COMMENTS_MODE: {
      const tabId = sender.tab?.id ?? 0;
      await loadCommentsModeFromStorage();
      const isOn = getCommentsMode(tabId);
      return { success: true, isOn };
    }
    case MESSAGE_TYPES.SET_BADGE_TEXT: {
      const text = (payload?.text as string | undefined) ?? "";
      const tabId = sender.tab?.id;
      if (tabId !== undefined) void chrome.action.setBadgeText({ text, tabId });
      else void chrome.action.setBadgeText({ text });
      return { success: true };
    }
    default:
      return undefined;
  }
}
