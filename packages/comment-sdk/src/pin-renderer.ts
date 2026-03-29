/**
 * @accordo/comment-sdk — pin-renderer
 *
 * DOM-level pin creation and positioning:
 *   - Creating pin elements with correct CSS state classes
 *   - Computing and applying screen coordinates from logical block IDs
 *   - Repositioning pins on scroll / resize
 *   - Registering scroll targets (including shadow-DOM ancestors)
 *
 * Source: M41 — @accordo/comment-sdk
 */

import type { SdkThread, SdkInitOptions, ScreenPosition, PinState } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Callback invoked when a pin is clicked. */
export type PinClickHandler = (threadId: string) => void;

// ── State resolution ──────────────────────────────────────────────────────────

/** Compute the visual pin state for a thread. */
export function resolvePinState(thread: SdkThread): PinState {
  if (thread.status === "resolved") return "resolved";
  if (thread.hasUnread) return "updated";
  return "open";
}

// ── Pin element creation ──────────────────────────────────────────────────────

/** Create a pin <div> element for a thread at the given screen position. */
export function createPinElement(
  thread: SdkThread,
  pos: ScreenPosition,
  onClick: PinClickHandler,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "accordo-pin";
  const state = resolvePinState(thread);
  el.classList.add(`accordo-pin--${state}`);
  el.setAttribute("data-thread-id", thread.id);
  // Only left/top are dynamic — all other styles come from CSS
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;

  // Badge showing comment count
  const badge = document.createElement("span");
  badge.className = "accordo-pin__badge";
  badge.textContent = String(thread.comments.length);
  el.appendChild(badge);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(thread.id);
  });

  return el;
}

// ── PinPositioner — manages scroll targets and repositioning ──────────────────

/**
 * Manages scroll/resize listeners and repositions pins when the layout changes.
 * One instance per SDK lifecycle (init → destroy).
 */
export class PinPositioner {
  private readonly _scrollTargets = new Set<EventTarget>();
  private _repositionHandler: (() => void) | undefined;

  /**
   * Start listening for scroll/resize events. Call from SDK.init().
   * @param opts        SDK init options (for coordinateToScreen)
   * @param getPins     Supplier that returns the current pin map (entries have .thread and .element)
   * @param initialTargets  Additional targets to register immediately (e.g. container, window)
   */
  start(
    opts: SdkInitOptions,
    getPins: () => Iterable<{ thread: SdkThread; element: HTMLElement }>,
    initialTargets: EventTarget[],
  ): void {
    this._repositionHandler = () => {
      for (const entry of getPins()) {
        const pos = opts.coordinateToScreen(entry.thread.blockId);
        if (!pos) continue;
        entry.element.style.left = `${pos.x}px`;
        entry.element.style.top = `${pos.y}px`;
      }
    };

    for (const target of initialTargets) {
      this._registerScrollTarget(target);
    }
    window.addEventListener("resize", this._repositionHandler);
  }

  /** Register all scroll-container ancestors of a block element. */
  registerAncestorScrollTargets(element: Element): void {
    let current: Element | null = element;
    while (current) {
      this._registerScrollTarget(current);
      current = current.parentElement;
    }

    const root = element.getRootNode();
    if (root && root !== document) {
      this._registerScrollTarget(root);
      if (root instanceof ShadowRoot && root.host) {
        this.registerAncestorScrollTargets(root.host);
      }
    }
  }

  /** Tear down all scroll/resize listeners. Call from SDK.destroy(). */
  stop(): void {
    if (!this._repositionHandler) return;
    for (const target of this._scrollTargets) {
      if (
        typeof (target as { removeEventListener?: unknown }).removeEventListener === "function"
      ) {
        target.removeEventListener("scroll", this._repositionHandler, true);
      }
    }
    window.removeEventListener("resize", this._repositionHandler);
    this._scrollTargets.clear();
    this._repositionHandler = undefined;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _registerScrollTarget(target: EventTarget): void {
    if (!this._repositionHandler) return;
    if (this._scrollTargets.has(target)) return;
    if (
      typeof (target as { addEventListener?: unknown }).addEventListener !== "function"
    ) return;

    target.addEventListener("scroll", this._repositionHandler, true);
    this._scrollTargets.add(target);
  }
}
