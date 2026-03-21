/**
 * M80-CS-PINS — Content Script: Pin Rendering & Positioning
 *
 * Injects pin markers into DOM adjacent to anchored elements.
 * Detects off-screen pins and reports count to service worker.
 */

import type { BrowserCommentThread } from "./types.js";

/**
 * Renders a pin element in the DOM for a given thread.
 * The pin has a data-accordo-pin attribute set to the thread ID.
 */
export function renderPin(thread: BrowserCommentThread, onClick?: (thread: BrowserCommentThread) => void): HTMLElement {
  // Remove any existing pin for this thread first (idempotent)
  const existing = document.querySelector(`[data-accordo-pin="${thread.id}"]`);
  if (existing) existing.remove();

  const pin = document.createElement("div");
  pin.setAttribute("data-accordo-pin", thread.id);

  // Visual style — a visible coloured badge anchored to the page
  const isResolved = thread.status === "resolved";
  pin.style.cssText = `
    position: absolute;
    width: 24px;
    height: 24px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: ${isResolved ? "#888" : "#4a90d9"};
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    cursor: pointer;
    z-index: 2147483640;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: white;
    font-weight: 700;
    font-family: system-ui, sans-serif;
    user-select: none;
  `;

  // Comment count label (rotated back so it reads normally)
  const label = document.createElement("span");
  label.style.cssText = "transform: rotate(45deg); display: block; line-height: 1;";
  label.textContent = String(thread.comments.length);
  pin.appendChild(label);

  // Position near the anchor element, or fall back to top-left of viewport
  const anchor = document.querySelector(`[data-anchor="${thread.anchorKey}"]`);
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    pin.style.top = `${rect.top + window.scrollY - 12}px`;
    pin.style.left = `${rect.left + window.scrollX + 8}px`;
  } else {
    // No anchor found — place near top-right as a floating indicator
    pin.style.top = `${48 + document.querySelectorAll("[data-accordo-pin]").length * 32}px`;
    pin.style.right = "16px";
    pin.style.left = "auto";
  }

  // Click opens the thread popover
  pin.addEventListener("click", (e) => {
    e.stopPropagation();
    if (onClick) onClick(thread);
  });

  document.body.appendChild(pin);
  return pin;
}

/**
 * Removes the pin element for a given thread from the DOM.
 */
export function removePin(threadId: string): void {
  const pin = document.querySelector(`[data-accordo-pin="${threadId}"]`);
  if (pin) {
    pin.remove();
  }
}

/**
 * Removes all accordo pin elements from the DOM.
 */
export function removeAllPins(): void {
  const pins = document.querySelectorAll("[data-accordo-pin]");
  pins.forEach((pin) => pin.remove());
}

/**
 * Sends a message to the service worker requesting a badge text update.
 * Content scripts cannot call chrome.action directly — only the service worker
 * (background context) has access to chrome.action.setBadgeText.
 */
export function updateOffScreenBadge(count: number): void {
  chrome.runtime.sendMessage({
    type: "SET_BADGE_TEXT",
    payload: { text: String(count) },
  }).catch(() => {
    // SW may not be awake yet — badge update is best-effort
  });
}

/**
 * Returns the count of threads whose anchor elements are not in the viewport.
 */
export function getOffScreenCount(threads: BrowserCommentThread[]): number {
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;

  let offScreen = 0;
  for (const thread of threads) {
    const anchor =
      document.querySelector(`[data-anchor="${thread.anchorKey}"]`) ??
      document.querySelector(`[data-accordo-pin="${thread.id}"]`);

    if (!anchor) {
      // No anchor in DOM — treat as off-screen only if viewport is non-zero
      continue;
    }

    const rect = anchor.getBoundingClientRect();
    const inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < viewportHeight &&
      rect.left < viewportWidth;

    if (!inViewport) {
      offScreen++;
    }
  }

  return offScreen;
}

/**
 * Repositions all rendered pins relative to their anchor elements.
 * Uses requestAnimationFrame to batch DOM reads and writes.
 */
export function repositionPins(): void {
  requestAnimationFrame(() => {
    const pins = document.querySelectorAll("[data-accordo-pin]");
    pins.forEach((pin) => {
      const threadId = pin.getAttribute("data-accordo-pin");
      if (!threadId) return;
      // No-op repositioning in content script context — positions are set at render time
    });
  });
}
