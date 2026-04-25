import type { BrowserCommentThread } from "./types.js";
import { MESSAGE_TYPES } from "./constants.js";

export function renderThreadList(
  container: HTMLElement,
  threads: BrowserCommentThread[],
  tabId?: number,
  pageUrl?: string,
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
    item.style.cssText = "padding: 8px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer; display: flex; align-items: center; justify-content: space-between;";

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
    deleteBtn.style.cssText = "background: none; border: none; color: #c0392b; cursor: pointer; font-size: 16px; padding: 0 4px; margin-left: 8px;";
    deleteBtn.addEventListener("click", (e) => {
      void (async (): Promise<void> => {
        e.stopPropagation();
        if (confirm(`Delete thread #${thread.id.slice(0, 8)} and all its comments?`)) {
          try {
            await chrome.runtime.sendMessage({ type: "SOFT_DELETE_THREAD", payload: { threadId: thread.id, deletedBy: "User" } });
            const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_THREADS, payload: { url: pageUrl } });
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
    item.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FOCUS_THREAD, payload: { threadId: thread.id } }).catch(() => {});
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "scroll-to-thread", payload: { threadId: thread.id } }).catch(() => {});
      }
    });
    container.appendChild(item);
  }
}

export function updateBadgeCount(container: HTMLElement, count: number): void {
  let badge = container.querySelector("[data-accordo-badge]");
  if (!badge) {
    badge = document.createElement("span");
    badge.setAttribute("data-accordo-badge", "");
    container.appendChild(badge);
  }
  badge.textContent = String(count);
}
