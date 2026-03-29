/**
 * @accordo/comment-sdk — thread-manager
 *
 * Thread state management:
 *   - Storing threads and their corresponding pin elements
 *   - Loading, adding, updating, and removing threads
 *   - Pin-to-thread mapping via a stable threadId key
 *   - Gutter markers (.accordo-block--has-comments)
 *
 * Source: M41 — @accordo/comment-sdk
 */

import type { SdkThread, SdkInitOptions } from "./types.js";
import { createPinElement, resolvePinState } from "./pin-renderer.js";
import type { PinClickHandler } from "./pin-renderer.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Internal map entry: one pin per thread. */
export interface PinEntry {
  thread: SdkThread;
  element: HTMLElement;
}

// ── ThreadManager ─────────────────────────────────────────────────────────────

/**
 * Manages the thread → pin DOM mapping.
 * Does not know about popovers or scroll tracking — those are delegated up.
 */
export class ThreadManager {
  private readonly _pins = new Map<string, PinEntry>();

  /** Iterate all pin entries (for repositioning, etc.). */
  entries(): Iterable<PinEntry> {
    return this._pins.values();
  }

  /** Look up a pin entry by threadId. */
  get(threadId: string): PinEntry | undefined {
    return this._pins.get(threadId);
  }

  /** Clear all stored entries (does NOT remove DOM elements). */
  clear(): void {
    this._pins.clear();
  }

  // ── Thread operations ────────────────────────────────────────────────────

  /**
   * M41-SDK-02
   * Render pins for all provided threads.
   * Clears any existing pin DOM nodes first.
   * Skips threads whose coordinateToScreen returns null (not in viewport).
   *
   * @param onAncestors   Called for each anchored block element so the caller
   *                      can register scroll targets.
   */
  loadThreads(
    threads: SdkThread[],
    opts: SdkInitOptions,
    layer: HTMLElement,
    onPinClick: PinClickHandler,
    onAncestors: (el: Element) => void,
  ): void {
    // Remove gutter markers from block elements
    opts.container.querySelectorAll(".accordo-block--has-comments").forEach((el) => {
      el.classList.remove("accordo-block--has-comments");
    });

    // Remove existing pin DOM nodes
    for (const entry of this._pins.values()) {
      entry.element.remove();
    }
    this._pins.clear();

    for (const thread of threads) {
      const pos = opts.coordinateToScreen(thread.blockId);
      if (!pos) continue;
      const el = createPinElement(thread, pos, onPinClick);
      layer.appendChild(el);
      this._pins.set(thread.id, { thread, element: el });

      // Gutter marker + scroll-target registration
      const blockEl = opts.container.querySelector(`[data-block-id="${thread.blockId}"]`);
      if (blockEl) {
        blockEl.classList.add("accordo-block--has-comments");
        onAncestors(blockEl);
      }
    }
  }

  /**
   * M41-SDK-03
   * Add a single new pin without clearing existing pins.
   */
  addThread(
    thread: SdkThread,
    opts: SdkInitOptions,
    layer: HTMLElement,
    onPinClick: PinClickHandler,
    onAncestors: (el: Element) => void,
  ): void {
    const pos = opts.coordinateToScreen(thread.blockId);
    if (!pos) return;
    const el = createPinElement(thread, pos, onPinClick);
    layer.appendChild(el);
    this._pins.set(thread.id, { thread, element: el });

    const blockEl = opts.container.querySelector(`[data-block-id="${thread.blockId}"]`);
    if (blockEl) {
      onAncestors(blockEl);
    }
  }

  /**
   * M41-SDK-04
   * Update an existing thread's pin appearance.
   * Silently does nothing if the thread is not rendered.
   */
  updateThread(threadId: string, update: Partial<SdkThread>): void {
    const entry = this._pins.get(threadId);
    if (!entry) return;
    Object.assign(entry.thread, update);
    const el = entry.element;
    // Reset class list and re-apply state
    el.className = "accordo-pin";
    const state = resolvePinState(entry.thread);
    el.classList.add(`accordo-pin--${state}`);
    // Update badge
    const badge = el.querySelector(".accordo-pin__badge");
    if (badge) {
      badge.textContent = String(entry.thread.comments.length);
    }
  }

  /**
   * M41-SDK-05
   * Remove a thread's pin from the DOM and from the internal map.
   * Returns true if a pin was removed, false if threadId was unknown.
   */
  removeThread(threadId: string): boolean {
    const entry = this._pins.get(threadId);
    if (!entry) return false;
    entry.element.remove();
    this._pins.delete(threadId);
    return true;
  }
}
