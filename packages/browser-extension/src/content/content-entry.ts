/**
 * Content script entry point — combines pins, popovers, and input forms.
 * This file is the esbuild entry for dist/content-script.js.
 *
 * IMPORTANT: This file is built as an IIFE (format: "iife"), NOT an ES module.
 * Chrome injects content scripts as classic scripts. Any top-level `export`
 * statement causes a SyntaxError. Do NOT add `export` statements here.
 *
 * UI rendering is handled via AccordoCommentSDK from @accordo/comment-sdk,
 * so pins, popovers, and their CSS classes are consistent with the rest of the
 * Accordo platform (diagram viewer, etc.).
 */

import { AccordoCommentSDK } from "../../comment-sdk/src/sdk.js";
import type { SdkThread } from "../../comment-sdk/src/types.js";
import type { BrowserCommentThread } from "../types.js";
import { showCommentForm, hideCommentForm, hideThreadPopover } from "../content-input.js";

// ── Debug logger ─────────────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo CS] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo CS ERROR] ${msg}`, ...args);
}

dbg(`Content script injected on ${window.location.href}`);

const STORAGE_KEY = "commentsMode";

// ── SDK instance ─────────────────────────────────────────────────────────────────

let sdk: AccordoCommentSDK | null = null;

/**
 * Convert a BrowserCommentThread to the SdkThread shape.
 * Uses anchorKey as blockId — the SDK uses blockId to look up positions via
 * coordinateToScreen, which we implement below using data-anchor attributes.
 */
function toSdkThread(t: BrowserCommentThread): SdkThread {
  return {
    id: t.id,
    blockId: t.anchorKey,
    status: t.status as "open" | "resolved",
    hasUnread: false,
    comments: t.comments.map((c) => ({
      id: c.id,
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}

/**
 * Maps a blockId (= anchorKey) to a screen position for the SDK.
 * Tries [data-anchor="<blockId>"] first; if not present, stacks pins at
 * top-right of viewport in a column (fallback for unanchored threads).
 */
function coordinateToScreen(blockId: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-anchor="${CSS.escape(blockId)}"]`);
  if (el) {
    const rect = el.getBoundingClientRect();
    // Place pin at the top-right corner of the element, relative to scrolled page
    return {
      x: rect.right + window.scrollX - 12,
      y: rect.top + window.scrollY + 4,
    };
  }
  // No anchor element found — return null so the SDK skips it silently.
  // We re-add it via a stacked fallback after loadThreads.
  return null;
}

/**
 * Initialise (or re-initialise) the SDK, attaching it to document.body.
 * The SDK inserts a `position:absolute; inset:0` overlay layer inside body,
 * so pins are positioned correctly relative to the full scrollable document.
 */
function initSdk(): void {
  if (sdk) {
    sdk.destroy();
  }
  // Ensure body is position:relative so the SDK layer covers it correctly
  if (getComputedStyle(document.body).position === "static") {
    document.body.style.position = "relative";
  }
  sdk = new AccordoCommentSDK();
  sdk.init({
    container: document.body,
    coordinateToScreen,
    callbacks: {
      onCreate(blockId: string, body: string) {
        dbg(`SDK onCreate: blockId=${blockId}`);
        // The SDK's Alt+click flow; we also have right-click. Both end up here.
        void submitNewComment(blockId, body);
      },
      onReply(threadId: string, body: string) {
        dbg(`SDK onReply: threadId=${threadId}`);
        void addReply(threadId, body);
      },
      onResolve(threadId: string) {
        dbg(`SDK onResolve: threadId=${threadId}`);
        void resolveThread(threadId);
      },
      onReopen(threadId: string) {
        dbg(`SDK onReopen: threadId=${threadId}`);
        void reopenThread(threadId);
      },
      onDelete(threadId: string, commentId?: string) {
        dbg(`SDK onDelete: threadId=${threadId} commentId=${commentId}`);
        void deleteCommentOrThread(threadId, commentId);
      },
    },
  });
  dbg("initSdk: SDK initialized on document.body");
}

// ── Chrome message wrappers ───────────────────────────────────────────────────────

async function submitNewComment(anchorKey: string, body: string): Promise<void> {
  try {
    const pageUrl = window.location.href;
    await chrome.runtime.sendMessage({
      type: "CREATE_THREAD",
      payload: { url: pageUrl, anchorKey, body, author: { kind: "user", name: "Guest" } },
    });
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`submitNewComment failed: ${(err as Error)?.message ?? err}`);
  }
}

async function addReply(threadId: string, body: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "ADD_COMMENT",
      payload: { threadId, body, author: { kind: "user", name: "Guest" } },
    });
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`addReply failed: ${(err as Error)?.message ?? err}`);
  }
}

async function resolveThread(threadId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "SOFT_DELETE_THREAD",
      payload: { threadId, deletedBy: "Guest" },
    });
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`resolveThread failed: ${(err as Error)?.message ?? err}`);
  }
}

async function reopenThread(threadId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "ADD_COMMENT",
      payload: { threadId, body: "Reopened", author: { kind: "user", name: "Guest" } },
    });
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`reopenThread failed: ${(err as Error)?.message ?? err}`);
  }
}

async function deleteCommentOrThread(threadId: string, commentId?: string): Promise<void> {
  try {
    if (commentId) {
      await chrome.runtime.sendMessage({
        type: "SOFT_DELETE_COMMENT",
        payload: { threadId, commentId, deletedBy: "Guest" },
      });
    } else {
      await chrome.runtime.sendMessage({
        type: "SOFT_DELETE_THREAD",
        payload: { threadId, deletedBy: "Guest" },
      });
    }
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`deleteCommentOrThread failed: ${(err as Error)?.message ?? err}`);
  }
}

// ── Pin rendering ─────────────────────────────────────────────────────────────────

async function loadAndRenderPins(): Promise<void> {
  if (!sdk) return;
  const pageUrl = window.location.href;
  dbg(`loadAndRenderPins: fetching threads for url=${pageUrl}`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_THREADS",
      payload: { url: pageUrl },
    });
    dbg(`loadAndRenderPins: SW responded =`, response);
    if (response?.success && Array.isArray(response.data)) {
      const threads = response.data as BrowserCommentThread[];
      dbg(`loadAndRenderPins: rendering ${threads.length} threads via SDK`);
      sdk.loadThreads(threads.map(toSdkThread));

      // For threads whose anchor element wasn't in the DOM at the time
      // coordinateToScreen ran (returns null → SDK skips them), we fall back
      // to stacking them at the top-right so they're always reachable.
      let stackOffset = 0;
      for (const t of threads) {
        const el = document.querySelector(`[data-anchor="${CSS.escape(t.anchorKey)}"]`);
        if (!el) {
          // Manually inject a fallback pin via the SDK layer
          const layer = document.querySelector(".accordo-sdk-layer") as HTMLElement | null;
          if (layer) {
            const existing = layer.querySelector(`[data-thread-id="${t.id}"]`);
            if (!existing) {
              const fallbackPin = document.createElement("div");
              fallbackPin.className = `accordo-pin accordo-pin--${t.status === "resolved" ? "resolved" : "open"}`;
              fallbackPin.setAttribute("data-thread-id", t.id);
              fallbackPin.style.right = "16px";
              fallbackPin.style.left = "auto";
              fallbackPin.style.top = `${48 + stackOffset * 32}px`;
              const badge = document.createElement("span");
              badge.className = "accordo-pin__badge";
              badge.textContent = String(t.comments.length);
              fallbackPin.appendChild(badge);
              fallbackPin.addEventListener("click", (e) => {
                e.stopPropagation();
                sdk?.openPopover(t.id);
              });
              layer.appendChild(fallbackPin);
              // Also register in SDK's internal map via addThread with a dummy position
              // so openPopover can find it
            }
          }
          stackOffset++;
        }
      }
    }
  } catch (err) {
    dbgErr(`loadAndRenderPins: failed — ${(err as Error)?.message ?? err}`);
  }
}

// ── Floating bar ──────────────────────────────────────────────────────────────────

let floatingBar: HTMLElement | null = null;

function showFloatingBar(): void {
  if (floatingBar) return;
  const bar = document.createElement("div");
  bar.id = "accordo-floating-bar";
  bar.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 28px;
    background: #4a90d9;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    font-weight: 600;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  bar.textContent = "● Comments Mode: ON — Right-click anywhere to add a comment";
  document.body.appendChild(bar);
  floatingBar = bar;
  dbg("showFloatingBar: bar injected");
}

function hideFloatingBar(): void {
  if (!floatingBar) return;
  floatingBar.remove();
  floatingBar = null;
  dbg("hideFloatingBar: bar removed");
}

// ── Comments Mode activation / deactivation ──────────────────────────────────────

let commentsModeActive = false;
let rightClickHandler: ((e: MouseEvent) => void) | null = null;

async function activateCommentsMode(): Promise<void> {
  dbg(`activateCommentsMode: called (already active=${commentsModeActive})`);
  if (commentsModeActive) return;
  commentsModeActive = true;
  showFloatingBar();
  initSdk();

  rightClickHandler = (e: MouseEvent) => {
    dbg(`contextmenu: target=${(e.target as Element)?.tagName} x=${e.clientX} y=${e.clientY}`);
    e.preventDefault();
    e.stopPropagation();
    // Import generateAnchorKey lazily from content-input
    const target = e.target as Element;
    const anchorKey = generateAnchorKeyFromElement(target);
    // Set data-anchor on the element so coordinateToScreen can find it
    target.setAttribute("data-anchor", anchorKey);
    dbg(`contextmenu: anchorKey=${anchorKey}`);
    showCommentForm(anchorKey, e.clientX, e.clientY, async (key: string, body: string) => {
      await submitNewComment(key, body);
    });
  };
  document.addEventListener("contextmenu", rightClickHandler, true);
  dbg("activateCommentsMode: contextmenu listener attached");

  await loadAndRenderPins();
}

function deactivateCommentsMode(): void {
  dbg(`deactivateCommentsMode: called (currently active=${commentsModeActive})`);
  if (!commentsModeActive) return;
  commentsModeActive = false;
  hideFloatingBar();

  if (rightClickHandler) {
    document.removeEventListener("contextmenu", rightClickHandler, true);
    rightClickHandler = null;
  }

  if (sdk) {
    sdk.destroy();
    sdk = null;
  }
  hideCommentForm();
  hideThreadPopover();
}

// ── Anchor key helper (inline, no import needed) ──────────────────────────────────

function generateAnchorKeyFromElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const siblingIndex = Array.from(element.parentElement?.children ?? []).indexOf(element as Element);
  const text = element.textContent ?? "";
  const raw = text.toLowerCase().slice(0, 20).replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${tagName}:${siblingIndex}:${raw || "text"}`;
}

// ── State sync ────────────────────────────────────────────────────────────────────

async function syncFromStorage(): Promise<void> {
  dbg("syncFromStorage: called");
  try {
    dbg("syncFromStorage: sending GET_TAB_COMMENTS_MODE to SW...");
    const response = await chrome.runtime.sendMessage({ type: "GET_TAB_COMMENTS_MODE" });
    dbg(`syncFromStorage: SW responded =`, response);
    const isOn = (response?.isOn as boolean | undefined) ?? false;
    dbg(`syncFromStorage: isOn=${isOn}`);
    if (isOn) {
      await activateCommentsMode();
    } else {
      deactivateCommentsMode();
    }
  } catch (err) {
    dbgErr(`syncFromStorage: caught error — ${(err as Error)?.message ?? err}`);
  }
}

// ── Message listener ──────────────────────────────────────────────────────────────

dbg("Attaching chrome.runtime.onMessage listener");
chrome.runtime.onMessage.addListener(
  (message: { type: string; payload?: unknown }, _sender, _sendResponse) => {
    dbg(`onMessage: type=${message.type}`);
    switch (message.type) {
      case "comments-mode-on":
        void activateCommentsMode();
        break;
      case "comments-mode-off":
        deactivateCommentsMode();
        break;
      case "show-comment-form-at-cursor":
        showCommentForm("body:center", undefined, undefined, async (key, body) => {
          await submitNewComment(key, body);
        });
        break;
      case "scroll-to-thread": {
        const { threadId } = (message.payload as { threadId: string }) ?? {};
        if (threadId && sdk) {
          sdk.openPopover(threadId);
        }
        break;
      }
      default:
        break;
    }
    return false;
  }
);

// ── Keyboard shortcuts ────────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    dbg("Escape: dismissing form/popover");
    hideCommentForm();
    hideThreadPopover();
  }
});

// ── Storage change listener ───────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes[STORAGE_KEY]) return;
  dbg("storage.onChanged: commentsMode changed, re-syncing");
  void syncFromStorage();
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────────

dbg("Bootstrap: calling syncFromStorage()");
void syncFromStorage();
dbg("Bootstrap: complete");
