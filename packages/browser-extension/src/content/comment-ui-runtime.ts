import { AccordoCommentSDK } from "@accordo/comment-sdk";
import type { SdkThread } from "@accordo/comment-sdk";
import type { BrowserCommentThread } from "../types.js";
import { resolveAnchorPagePosition } from "./anchor-position.js";

const DEBUG = false;

export function dbg(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.warn(`[Accordo CS] ${msg}`, ...args);
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

let fallbackStackIndex = 0;
let sdk: AccordoCommentSDK | null = null;
const pendingAnchorContexts = new Map<string, BrowserCommentThread["anchorContext"]>();

export function getSdk(): AccordoCommentSDK | null { return sdk; }
export function getPendingAnchorContexts(): Map<string, BrowserCommentThread["anchorContext"]> { return pendingAnchorContexts; }

export function toSdkThread(t: BrowserCommentThread): SdkThread {
  return {
    id: t.id,
    blockId: t.anchorKey,
    status: t.status as "open" | "resolved",
    hasUnread: false,
    comments: t.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt })),
  };
}

export function coordinateToScreen(blockId: string): { x: number; y: number } | null {
  const resolved = resolveAnchorPagePosition(blockId);
  if (resolved) return resolved;
  const index = fallbackStackIndex++;
  return { x: window.innerWidth - 48, y: 48 + index * 40 };
}

export function destroySdk(): void {
  if (sdk) { sdk.destroy(); sdk = null; }
}

export function wireSdkCallbacks(handlers: {
  onCreate: (blockId: string, body: string, anchorContext?: BrowserCommentThread["anchorContext"]) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onReopen: (threadId: string) => Promise<void>;
  onDelete: (threadId: string, commentId?: string) => Promise<void>;
}): void {
  if (sdk) sdk.destroy();
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
        void handlers.onCreate(blockId, body, context);
      },
      onReply: (threadId: string, body: string) => { void handlers.onReply(threadId, body).catch(() => {}); },
      onResolve: (threadId: string) => { void handlers.onResolve(threadId).catch(() => {}); },
      onReopen: (threadId: string) => { void handlers.onReopen(threadId).catch(() => {}); },
      onDelete: (threadId: string, commentId?: string) => { void handlers.onDelete(threadId, commentId).catch(() => {}); },
    },
  });
  dbg("wireSdkCallbacks: SDK initialised");
}

export async function loadAndRenderPins(): Promise<void> {
  const activeSdk = sdk;
  if (!activeSdk) return;
  const pageUrl = window.location.href;
  dbg(`loadAndRenderPins: fetching threads for url=${pageUrl}`);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_THREADS", payload: { url: pageUrl } });
    if (response?.success && Array.isArray(response.data)) {
      const threads = response.data as BrowserCommentThread[];
      fallbackStackIndex = 0;
      if (sdk !== activeSdk) return;
      activeSdk.loadThreads(threads.map(toSdkThread));
    }
  } catch (err) {
    dbgErr(`loadAndRenderPins: failed — ${(err as Error)?.message ?? err}`);
  }
}
