/**
 * Comment UI module — SDK init, pin rendering, floating bar, and Comments Mode.
 * Consumed by content-entry.ts (IIFE bootstrap).
 */

import { AccordoCommentSDK } from "@accordo/comment-sdk";
import type { SdkThread } from "@accordo/comment-sdk";
import type { BrowserCommentThread } from "../types.js";
import { resolveAnchorPagePosition } from "./anchor-position.js";
import { generateAnchorKey } from "./enhanced-anchor.js";
import { openSdkComposerAtAnchor } from "./sdk-convergence.js";

// ── Debug logger ─────────────────────────────────────────────────────────────────

export function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo CS] ${msg}`, ...args);
}
export function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo CS ERROR] ${msg}`, ...args);
}

export function assertMessageSuccess(action: string, response: unknown): void {
  const payload = response as { success?: boolean; error?: string } | undefined;
  if (!payload?.success) {
    throw new Error(payload?.error ?? `${action} failed`);
  }
}

// ── SDK state (module-level, accessed via getters for message-handlers) ──────────

let _fallbackStackIndex = 0;
let _sdk: AccordoCommentSDK | null = null;
const _pendingAnchorContexts = new Map<string, BrowserCommentThread["anchorContext"]>();

export function getSdk(): AccordoCommentSDK | null { return _sdk; }
export function getPendingAnchorContexts(): Map<string, BrowserCommentThread["anchorContext"]> { return _pendingAnchorContexts; }

/**
 * Convert a BrowserCommentThread to the SdkThread shape.
 * Uses anchorKey as blockId — the SDK uses blockId to look up positions via
 * coordinateToScreen, which we implement below using data-anchor attributes.
 */
export function toSdkThread(t: BrowserCommentThread): SdkThread {
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
export function coordinateToScreen(blockId: string): { x: number; y: number } | null {
  const resolved = resolveAnchorPagePosition(blockId);
  if (resolved) return resolved;
  const index = _fallbackStackIndex++;
  return { x: window.innerWidth - 48, y: 48 + index * 40 };
}

// ── SDK lifecycle ───────────────────────────────────────────────────────────────

/**
 * Destroy the SDK instance (called on Comments Mode deactivation).
 */
export function destroySdk(): void {
  if (_sdk) { _sdk.destroy(); _sdk = null; }
}

/**
 * Wire SDK callbacks from message-handlers and initialise (or re-initialise) the SDK.
 * Called once from message-handlers.ts during module load — before any
 * chrome.runtime.onMessage listener or bootstrap code runs.
 *
 * The SDK inserts a `position:absolute; inset:0` overlay layer inside body,
 * so pins are positioned correctly relative to the full scrollable document.
 */
export function wireSdkCallbacks(handlers: {
  onCreate: (blockId: string, body: string, anchorContext?: BrowserCommentThread["anchorContext"]) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onReopen: (threadId: string) => Promise<void>;
  onDelete: (threadId: string, commentId?: string) => Promise<void>;
}): void {
  if (_sdk) _sdk.destroy();
  if (getComputedStyle(document.body).position === "static") {
    document.body.style.position = "relative";
  }
  _sdk = new AccordoCommentSDK();
  _sdk.init({
    container: document.body,
    coordinateToScreen,
    callbacks: {
      onCreate(blockId: string, body: string) {
        dbg(`SDK onCreate: blockId=${blockId}`);
        const context = _pendingAnchorContexts.get(blockId);
        _pendingAnchorContexts.delete(blockId);
        void handlers.onCreate(blockId, body, context);
      },
      onReply: handlers.onReply,
      onResolve: handlers.onResolve,
      onReopen: handlers.onReopen,
      onDelete: handlers.onDelete,
    },
  });
  dbg("wireSdkCallbacks: SDK initialised");
}

// ── Pin rendering ─────────────────────────────────────────────────────────────────

/**
 * Fetch threads from SW and render them via the SDK.
 * Exported for use by message-handlers.ts (LOAD_COMMENTS, etc.).
 */
export async function loadAndRenderPins(): Promise<void> {
  if (!_sdk) return;
  const pageUrl = window.location.href;
  dbg(`loadAndRenderPins: fetching threads for url=${pageUrl}`);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_THREADS", payload: { url: pageUrl } });
    dbg(`loadAndRenderPins: SW responded =`, response);
    if (response?.success && Array.isArray(response.data)) {
      const threads = response.data as BrowserCommentThread[];
      dbg(`loadAndRenderPins: rendering ${threads.length} threads via SDK`);
      _fallbackStackIndex = 0;
      _sdk.loadThreads(threads.map(toSdkThread));
    }
  } catch (err) {
    dbgErr(`loadAndRenderPins: failed — ${(err as Error)?.message ?? err}`);
  }
}

// ── Floating bar ──────────────────────────────────────────────────────────────────

let floatingBar: HTMLElement | null = null;

export function showFloatingBar(): void {
  if (floatingBar) return;
  const bar = document.createElement("div");
  bar.id = "accordo-floating-bar";
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; height: 28px;
    background: #4a90d9; color: white; display: flex; align-items: center;
    justify-content: center; font-family: system-ui, sans-serif; font-size: 12px;
    font-weight: 600; z-index: 2147483647; pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  bar.textContent = "● Comments Mode: ON — Right-click anywhere to add a comment";
  document.body.appendChild(bar);
  floatingBar = bar;
  dbg("showFloatingBar: bar injected");
}

export function hideFloatingBar(): void {
  if (!floatingBar) return;
  floatingBar.remove();
  floatingBar = null;
  dbg("hideFloatingBar: bar removed");
}

// ── Comments Mode activation / deactivation ─────────────────────────────────────

let commentsModeActive = false;
let rightClickHandler: ((e: MouseEvent) => void) | null = null;

export function isCommentsModeActive(): boolean { return commentsModeActive; }

export async function activateCommentsMode(): Promise<void> {
  dbg(`activateCommentsMode: called (already active=${commentsModeActive})`);
  if (commentsModeActive) return;
  commentsModeActive = true;
  showFloatingBar();
  rightClickHandler = (e: MouseEvent) => {
    dbg(`contextmenu: target=${(e.target as Element)?.tagName} x=${e.clientX} y=${e.clientY}`);
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    const anchorKey = generateAnchorKeyFromClick(target, e.clientX, e.clientY);
    dbg(`contextmenu: anchorKey=${anchorKey}`);
    _pendingAnchorContexts.set(anchorKey, getAnchorContext(target));
    openSdkComposerAtAnchor(target, anchorKey, e.clientX, e.clientY);
  };
  document.addEventListener("contextmenu", rightClickHandler, true);
  dbg("activateCommentsMode: contextmenu listener attached");
  await loadAndRenderPins();
}

export function deactivateCommentsMode(): void {
  dbg(`deactivateCommentsMode: called (currently active=${commentsModeActive})`);
  if (!commentsModeActive) return;
  commentsModeActive = false;
  hideFloatingBar();
  if (rightClickHandler) { document.removeEventListener("contextmenu", rightClickHandler, true); rightClickHandler = null; }
  destroySdk();
}

// ── Anchor helpers ───────────────────────────────────────────────────────────────

export function generateAnchorKeyFromClick(element: Element, clientX: number, clientY: number): string {
  const generated = generateAnchorKey(element);
  if (generated.strategy === "viewport-pct") return generated.anchorKey;
  const rect = element.getBoundingClientRect();
  const offsetX = Math.max(0, Math.round(clientX - rect.left));
  const offsetY = Math.max(0, Math.round(clientY - rect.top));
  return `${generated.anchorKey}@${offsetX},${offsetY}`;
}

export function getAnchorContext(target: Element): BrowserCommentThread["anchorContext"] {
  const text = (target.textContent ?? "").replace(/\s+/g, " ").trim();
  const ariaLabel = (target as HTMLElement).getAttribute?.("aria-label") ?? undefined;
  return {
    tagName: target.tagName.toLowerCase(),
    ...(text ? { textSnippet: text.slice(0, 180) } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    pageTitle: document.title,
  };
}
