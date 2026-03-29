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

import { AccordoCommentSDK } from "@accordo/comment-sdk";
import type { SdkThread } from "@accordo/comment-sdk";
import type { BrowserCommentThread } from "../types.js";
import { resolveAnchorPagePosition } from "./anchor-position.js";
import { generateAnchorKey } from "./enhanced-anchor.js";
import { openSdkComposerAtAnchor } from "./sdk-convergence.js";

// ── Debug logger ─────────────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo CS] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo CS ERROR] ${msg}`, ...args);
}

function assertMessageSuccess(action: string, response: unknown): void {
  const payload = response as { success?: boolean; error?: string } | undefined;
  if (!payload?.success) {
    throw new Error(payload?.error ?? `${action} failed`);
  }
}

dbg(`Content script injected on ${window.location.href}`);

const STORAGE_KEY = "commentsMode";

// ── SDK instance ─────────────────────────────────────────────────────────────────

// Stacking counter — reset before each loadThreads call so fallback pins
// stack consistently from top-right on every refresh.
let _fallbackStackIndex = 0;

let sdk: AccordoCommentSDK | null = null;
const pendingAnchorContexts = new Map<string, BrowserCommentThread["anchorContext"]>();

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
  const resolved = resolveAnchorPagePosition(blockId);
  if (resolved) {
    return resolved;
  }
  // No anchor element found — stack at top-right so the pin is always visible
  // and tracked in the SDK's _pins map (gets properly cleared on next loadThreads).
  const index = _fallbackStackIndex++;
  return {
    x: window.innerWidth - 48,
    y: 48 + index * 40,
  };
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
        const context = pendingAnchorContexts.get(blockId);
        pendingAnchorContexts.delete(blockId);
        void submitNewComment(blockId, body, context);
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

async function submitNewComment(
  anchorKey: string,
  body: string,
  anchorContext?: BrowserCommentThread["anchorContext"],
): Promise<void> {
  try {
    const pageUrl = window.location.href;
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_THREAD",
      payload: { url: pageUrl, anchorKey, body, author: { kind: "user", name: "Guest" }, anchorContext },
    });
    assertMessageSuccess("create thread", response);
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`submitNewComment failed: ${(err as Error)?.message ?? err}`);
  }
}

async function addReply(threadId: string, body: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ADD_COMMENT",
      payload: { threadId, body, author: { kind: "user", name: "Guest" } },
    });
    assertMessageSuccess("add reply", response);
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`addReply failed: ${(err as Error)?.message ?? err}`);
  }
}

async function resolveThread(threadId: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RESOLVE_THREAD",
      payload: { threadId, resolutionNote: "Resolved via browser UI" },
    });
    assertMessageSuccess("resolve thread", response);
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`resolveThread failed: ${(err as Error)?.message ?? err}`);
  }
}

async function reopenThread(threadId: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "REOPEN_THREAD",
      payload: { threadId },
    });
    assertMessageSuccess("reopen thread", response);
    await loadAndRenderPins();
  } catch (err) {
    dbgErr(`reopenThread failed: ${(err as Error)?.message ?? err}`);
  }
}

async function deleteCommentOrThread(threadId: string, commentId?: string): Promise<void> {
  try {
    if (commentId) {
      const response = await chrome.runtime.sendMessage({
        type: "SOFT_DELETE_COMMENT",
        payload: { threadId, commentId, deletedBy: "Guest" },
      });
      assertMessageSuccess("delete comment", response);
    } else {
      const response = await chrome.runtime.sendMessage({
        type: "SOFT_DELETE_THREAD",
        payload: { threadId, deletedBy: "Guest" },
      });
      assertMessageSuccess("delete thread", response);
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
      _fallbackStackIndex = 0; // reset before each render so stacking is consistent
      sdk.loadThreads(threads.map(toSdkThread));
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
    const anchorKey = generateAnchorKeyFromClick(target, e.clientX, e.clientY);
    dbg(`contextmenu: anchorKey=${anchorKey}`);
    pendingAnchorContexts.set(anchorKey, getAnchorContext(target));
    openSdkComposerAtAnchor(target, anchorKey, e.clientX, e.clientY);
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
}

// ── Anchor key helper ───────────────────────────────────────────────────────────────

function generateAnchorKeyFromClick(element: Element, clientX: number, clientY: number): string {
  const generated = generateAnchorKey(element);

  // Viewport anchors are already click-proximate and intentionally do not carry
  // element-relative offsets (those offsets are not meaningful after rehydration).
  if (generated.strategy === "viewport-pct") {
    return generated.anchorKey;
  }

  const rect = element.getBoundingClientRect();
  const offsetX = Math.max(0, Math.round(clientX - rect.left));
  const offsetY = Math.max(0, Math.round(clientY - rect.top));
  return `${generated.anchorKey}@${offsetX},${offsetY}`;
}

function getAnchorContext(target: Element): BrowserCommentThread["anchorContext"] {
  const text = (target.textContent ?? "").replace(/\s+/g, " ").trim();
  const ariaLabel = (target as HTMLElement).getAttribute?.("aria-label") ?? undefined;
  return {
    tagName: target.tagName.toLowerCase(),
    ...(text ? { textSnippet: text.slice(0, 180) } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    pageTitle: document.title,
  };
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
  (message: { type: string; payload?: unknown }, _sender, _sendResponse: (response: unknown) => void) => {
    dbg(`onMessage: type=${message.type}`);
    switch (message.type) {
      case "PAGE_UNDERSTANDING_ACTION": {
        const { action, payload } = message as { type: string; action: string; payload: Record<string, unknown> };
        void (async () => {
          try {
            let data: unknown;
            if (action === "get_page_map") {
              const { collectPageMap } = await import("./page-map-collector.js");
              data = collectPageMap(payload as Parameters<typeof collectPageMap>[0]);
            } else if (action === "inspect_element") {
              const { inspectElement } = await import("./element-inspector.js");
              data = inspectElement(payload as Parameters<typeof inspectElement>[0]);
            } else if (action === "get_dom_excerpt") {
              const { getDomExcerpt } = await import("./element-inspector.js");
              const { selector = "body", maxDepth, maxLength } = payload as { selector?: string; maxDepth?: number; maxLength?: number };
              data = getDomExcerpt(selector, maxDepth, maxLength);
            } else if (action === "wait_for") {
              const { handleWaitForAction } = await import("./wait-provider.js");
              data = await handleWaitForAction(payload);
            } else if (action === "get_text_map") {
              const { collectTextMap } = await import("./text-map-collector.js");
              data = collectTextMap(payload as Parameters<typeof collectTextMap>[0]);
            } else if (action === "get_semantic_graph") {
              const { collectSemanticGraph } = await import("./semantic-graph-collector.js");
              data = collectSemanticGraph(payload as Parameters<typeof collectSemanticGraph>[0]);
            } else {
              _sendResponse({ error: "unsupported-action" });
              return;
            }
            _sendResponse({ data });
          } catch {
            _sendResponse({ error: "action-failed" });
          }
        })();
        return true; // keep channel open for async sendResponse
      }
      case "CAPTURE_SNAPSHOT_ENVELOPE": {
        // B2-SV-002: Content script is the single authoritative owner of
        // snapshot sequencing. Service worker delegates envelope minting here
        // to maintain a single monotonic counter across all tool responses.
        const { source } = message as { type: string; source: "dom" | "visual" };
        void (async () => {
          try {
            const { captureSnapshotEnvelope } = await import("../snapshot-versioning.js");
            const envelope = captureSnapshotEnvelope(source ?? "dom");
            _sendResponse(envelope);
          } catch {
            _sendResponse({ error: "envelope-failed" });
          }
        })();
        return true; // keep channel open for async sendResponse
      }
      case "RESOLVE_ANCHOR_BOUNDS": {
        const { anchorKey, nodeRef, padding = 8 } = (message as { type: string; anchorKey?: string; nodeRef?: string; padding?: number });
        void (async () => {
          try {
            const { resolveAnchorKey } = await import("./enhanced-anchor.js");
            const ref = anchorKey ?? nodeRef;
            if (!ref) {
              _sendResponse({ error: "no-ref" });
              return;
            }
            const element = resolveAnchorKey(ref);
            if (!element) {
              _sendResponse({ error: "not-found" });
              return;
            }
            const rect = element.getBoundingClientRect();
            const pad = typeof padding === "number" ? padding : 8;
            _sendResponse({
              bounds: {
                x: Math.max(0, rect.left - pad),
                y: Math.max(0, rect.top + window.scrollY - pad),
                width: rect.width + pad * 2,
                height: rect.height + pad * 2,
              },
            });
          } catch {
            _sendResponse({ error: "action-failed" });
          }
        })();
        return true; // keep channel open for async sendResponse
      }
      case "comments-mode-on":
        void activateCommentsMode();
        break;
      case "comments-mode-off":
        deactivateCommentsMode();
        break;
      case "COMMENTS_UPDATED":
        void loadAndRenderPins();
        break;
      case "show-comment-form-at-cursor":
        openSdkComposerAtAnchor(document.body, "body:0:center", window.innerWidth / 2, 60);
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
