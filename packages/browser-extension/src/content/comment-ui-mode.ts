import type { BrowserCommentThread } from "../types.js";
import { generateAnchorKey } from "./enhanced-anchor.js";
import { getLogicalFrameId } from "./message-action-helpers.js";
import { STRATEGY_RESOLVED_TIER } from "./enhanced-anchor.js";
import { openSdkComposerAtAnchor } from "./sdk-convergence.js";
import { dbg, destroySdk, getPendingAnchorContexts, loadAndRenderPins } from "./comment-ui-runtime.js";
import { captureSnapshotEnvelope } from "../snapshot-versioning.js";

let floatingBar: HTMLElement | null = null;
let commentsModeActive = false;
let rightClickHandler: ((e: MouseEvent) => void) | null = null;

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
}

export function hideFloatingBar(): void {
  if (!floatingBar) return;
  floatingBar.remove();
  floatingBar = null;
  dbg("hideFloatingBar: bar removed");
}

export function isCommentsModeActive(): boolean { return commentsModeActive; }

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
  const { strategy, confidence } = generateAnchorKey(target);
  const { snapshotId } = captureSnapshotEnvelope("dom");
  return {
    tagName: target.tagName.toLowerCase(),
    frameId: getLogicalFrameId(),
    ...(text ? { textSnippet: text.slice(0, 180) } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    pageTitle: document.title,
    snapshotId,
    confidence,
    resolvedTier: STRATEGY_RESOLVED_TIER[strategy],
    snapshotDrift: false,
  };
}

export async function activateCommentsMode(): Promise<void> {
  dbg(`activateCommentsMode: called (already active=${commentsModeActive})`);
  if (commentsModeActive) return;
  commentsModeActive = true;
  showFloatingBar();
  rightClickHandler = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    const anchorKey = generateAnchorKeyFromClick(target, e.clientX, e.clientY);
    getPendingAnchorContexts().set(anchorKey, getAnchorContext(target));
    openSdkComposerAtAnchor(target, anchorKey, e.clientX, e.clientY);
  };
  document.addEventListener("contextmenu", rightClickHandler, true);
  await loadAndRenderPins();
}

export function deactivateCommentsMode(): void {
  dbg(`deactivateCommentsMode: called (currently active=${commentsModeActive})`);
  if (!commentsModeActive) return;
  commentsModeActive = false;
  hideFloatingBar();
  if (rightClickHandler) {
    document.removeEventListener("contextmenu", rightClickHandler, true);
    rightClickHandler = null;
  }
  destroySdk();
}
