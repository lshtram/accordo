import type { BrowserCommentThread } from "./types.js";
import { MESSAGE_TYPES } from "./constants.js";
import { renderPairingSection } from "./popup-pairing.js";
import { renderThreadList } from "./popup-thread-list.js";
import {
  buildActionButtonsSection,
  buildCommentsModeSection,
  buildControlSection,
  buildShortcutSection,
  buildThreadListSection,
} from "./popup-sections.js";

declare const __BUILD_TIME__: string;

export async function initPopup(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  await renderPairingSection(container);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  const pageUrl = tab?.url ?? "";
  await buildCommentsModeSection(container, tabId);
  await buildControlSection(container, tabId);
  buildShortcutSection(container);
  const listContainer = buildThreadListSection(container);
  buildActionButtonsSection(container, tabId, pageUrl, listContainer);

  const refreshThreads = async (): Promise<void> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_THREADS, payload: { url: pageUrl } });
      const threads: BrowserCommentThread[] = response?.success ? (response.data ?? []) : [];
      renderThreadList(listContainer, threads, tabId, pageUrl);
    } catch {
      renderThreadList(listContainer, [], tabId, pageUrl);
    }
  };

  await refreshThreads();
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === MESSAGE_TYPES.COMMENTS_UPDATED) void refreshThreads();
    return false;
  });

  const versionFooter = document.createElement("div");
  versionFooter.style.cssText = "padding: 6px 12px 8px; font-size: 10px; color: #888; text-align: right; border-top: 1px solid #eee; margin-top: 8px;";
  const buildTime = typeof (__BUILD_TIME__ as unknown as string | undefined) === "string"
    ? (__BUILD_TIME__ as string)
    : new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  versionFooter.textContent = `build: ${buildTime}`;
  container.appendChild(versionFooter);
}
