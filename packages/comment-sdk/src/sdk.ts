/**
 * @accordo/comment-sdk — AccordoCommentSDK
 *
 * Vanilla JS/CSS library for rendering spatial comment pins on any webview surface.
 * Requires no framework. Communicates with the extension host via caller-provided callbacks.
 *
 * Pin states:
 *   open     — blue   — thread is open, no new activity since load
 *   updated  — amber  — thread has new activity (reply/create) since preview loaded
 *   resolved — green  — thread is resolved
 *
 * Usage:
 *   const sdk = new AccordoCommentSDK();
 *   sdk.init({ container, coordinateToScreen, callbacks });
 *   sdk.loadThreads(threads);
 *
 * Source: M41 — @accordo/comment-sdk
 */

import type { SdkThread, SdkInitOptions, PinState } from "./types.js";
import { resolvePinState, PinPositioner } from "./pin-renderer.js";
import { PopoverRenderer } from "./popover-renderer.js";
import { showInlineInput } from "./inline-input.js";
import { ThreadManager } from "./thread-manager.js";

// Re-export all types so consumers can import from "@accordo/comment-sdk" directly
export type {
  SdkThread,
  SdkComment,
  SdkInitOptions,
  SdkCallbacks,
  PinState,
  ScreenPosition,
  CoordinateToScreen,
  WebviewMessage,
  HostMessage,
} from "./types.js";

// ── AccordoCommentSDK ─────────────────────────────────────────────────────────

/**
 * The main SDK class. One instance per webview surface.
 *
 * Requirements:
 *   M41-SDK-01  init() — attaches to container, enables Alt+click, inserts layer div
 *   M41-SDK-02  loadThreads() — renders a pin for every thread
 *   M41-SDK-03  addThread() — adds one pin without re-rendering all
 *   M41-SDK-04  updateThread() — updates pin visual state on status/reply change
 *   M41-SDK-05  removeThread() — removes pin from DOM
 *   M41-SDK-06  Pin CSS classes: pin--open, pin--updated, pin--resolved
 *   M41-SDK-07  Alt+click → onCreate callback after input submission
 *   M41-SDK-08  Click pin → thread popover with comment list
 *   M41-SDK-09  Popover: reply input, resolve/reopen button
 *   M41-SDK-10  Popover actions → onReply / onResolve / onDelete callbacks
 *   M41-SDK-11  Only one popover open at a time
 *   M41-SDK-12  Click outside popover → close it
 *   M41-SDK-13  destroy() — removes all pins, event listeners, layer div
 */
export class AccordoCommentSDK {
  private _opts: SdkInitOptions | undefined;
  private _layer: HTMLElement | undefined;
  private _clickHandler: ((e: MouseEvent) => void) | undefined;
  private _outsideClickHandler: ((e: MouseEvent) => void) | undefined;

  private readonly _threads = new ThreadManager();
  private readonly _positioner = new PinPositioner();
  private readonly _popover = new PopoverRenderer();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * M41-SDK-01
   * Initialize the SDK. Must be called before any other method.
   */
  init(opts: SdkInitOptions): void {
    this._opts = opts;

    // Create the overlay layer — CSS class handles all positioning
    const layer = document.createElement("div");
    layer.className = "accordo-sdk-layer";
    opts.container.appendChild(layer);
    this._layer = layer;

    // Start scroll/resize tracking
    this._positioner.start(
      opts,
      () => this._threads.entries(),
      [window, opts.container],
    );

    // Alt+click handler on the container
    this._clickHandler = (e: MouseEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const target = (e.target as Element).closest("[data-block-id]");
      if (!target) return;
      const blockId = target.getAttribute("data-block-id") ?? "";
      if (!blockId) return;
      showInlineInput(e, blockId, opts);
    };
    opts.container.addEventListener("click", this._clickHandler);

    // Outside-click handler to close popover
    this._outsideClickHandler = (e: MouseEvent) => {
      if (
        this._popover.isOpen() &&
        !(e.target instanceof Node && this._getActivePopoverEl()?.contains(e.target))
      ) {
        this._popover.closePopover();
      }
    };
    document.body.addEventListener("click", this._outsideClickHandler);
  }

  /**
   * M41-SDK-13
   * Remove all pins, popovers, event listeners, and the layer element.
   */
  destroy(): void {
    this._popover.closePopover();
    if (this._layer) {
      this._layer.remove();
      this._layer = undefined;
    }
    if (this._opts && this._clickHandler) {
      this._opts.container.removeEventListener("click", this._clickHandler);
    }
    if (this._outsideClickHandler) {
      document.body.removeEventListener("click", this._outsideClickHandler);
    }
    this._positioner.stop();
    this._threads.clear();
    this._opts = undefined;
    this._clickHandler = undefined;
    this._outsideClickHandler = undefined;
  }

  // ── Thread management ───────────────────────────────────────────────────────

  /** M41-SDK-02 — Render pins for all provided threads. Clears existing pins first. */
  loadThreads(threads: SdkThread[]): void {
    if (!this._opts || !this._layer) return;
    this._threads.loadThreads(
      threads,
      this._opts,
      this._layer,
      (id) => this._openPopover(id),
      (el) => this._positioner.registerAncestorScrollTargets(el),
    );
  }

  /** M41-SDK-03 — Add a single new pin without clearing existing pins. */
  addThread(thread: SdkThread): void {
    if (!this._opts || !this._layer) return;
    this._threads.addThread(
      thread,
      this._opts,
      this._layer,
      (id) => this._openPopover(id),
      (el) => this._positioner.registerAncestorScrollTargets(el),
    );
  }

  /** M41-SDK-04 — Update an existing thread's pin appearance. */
  updateThread(threadId: string, update: Partial<SdkThread>): void {
    this._threads.updateThread(threadId, update);
  }

  /** Open the popover for a specific thread programmatically. */
  openPopover(threadId: string): void {
    this._openPopover(threadId);
  }

  /** M41-SDK-05 — Remove a thread's pin from the DOM. */
  removeThread(threadId: string): void {
    // Close popover if it belongs to this thread
    if (this._popover.activeThreadId() === threadId) {
      this._popover.closePopover();
    }
    this._threads.removeThread(threadId);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Compute the pin state for a thread (tested directly via resolvePinState). */
  resolvePinState(thread: SdkThread): PinState {
    return resolvePinState(thread);
  }

  private _openPopover(threadId: string): void {
    const entry = this._threads.get(threadId);
    if (!entry || !this._opts) return;
    this._popover.openPopover(entry.thread, entry.element, this._opts);
  }

  /** Returns the active popover DOM element (for outside-click detection). */
  private _getActivePopoverEl(): HTMLElement | null {
    if (!this._opts) return null;
    // The popover is appended to opts.container, look it up by class
    return this._opts.container.querySelector<HTMLElement>(".accordo-popover");
  }
}
