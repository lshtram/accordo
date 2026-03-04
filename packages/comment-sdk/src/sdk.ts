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

import type {
  SdkThread,
  SdkInitOptions,
  ScreenPosition,
  PinState,
} from "./types.js";

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

// ── Internal state ────────────────────────────────────────────────────────────

interface PinEntry {
  thread: SdkThread;
  element: HTMLElement;
}

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
  private _pins = new Map<string, PinEntry>();
  private _activePopover: HTMLElement | undefined;
  private _clickHandler: ((e: MouseEvent) => void) | undefined;
  private _outsideClickHandler: ((e: MouseEvent) => void) | undefined;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * M41-SDK-01
   * Initialize the SDK. Must be called before any other method.
   * Creates a positioning layer <div> inside container and registers event
   * listeners for Alt+click (new comment) and outside-click (close popover).
   */
  init(opts: SdkInitOptions): void {
    this._opts = opts;
    this._pins = new Map();

    // Create the overlay layer — CSS class handles all positioning
    const layer = document.createElement("div");
    layer.className = "accordo-sdk-layer";
    opts.container.appendChild(layer);
    this._layer = layer;

    // Alt+click handler on the container
    this._clickHandler = (e: MouseEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const target = (e.target as Element).closest("[data-block-id]");
      const blockId = target?.getAttribute("data-block-id") ?? "";
      this._showInlineInput(e, blockId);
    };
    opts.container.addEventListener("click", this._clickHandler);

    // Outside-click handler to close popover
    this._outsideClickHandler = (e: MouseEvent) => {
      if (
        this._activePopover &&
        !this._activePopover.contains(e.target as Node)
      ) {
        this._closePopover();
      }
    };
    document.body.addEventListener("click", this._outsideClickHandler);
  }

  /**
   * M41-SDK-13
   * Remove all pins, popovers, event listeners, and the layer element.
   * After destroy(), init() must be called again before use.
   */
  destroy(): void {
    this._closePopover();
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
    this._pins.clear();
    this._opts = undefined;
    this._clickHandler = undefined;
    this._outsideClickHandler = undefined;
  }

  // ── Thread management ───────────────────────────────────────────────────────

  /**
   * M41-SDK-02
   * Render pins for all provided threads.
   * Clears any existing pins first.
   * Skips threads whose coordinateToScreen returns null (not in viewport).
   */
  loadThreads(threads: SdkThread[]): void {
    if (!this._opts || !this._layer) return;
    // Clear existing pins
    for (const entry of this._pins.values()) {
      entry.element.remove();
    }
    this._pins.clear();

    for (const thread of threads) {
      const pos = this._opts.coordinateToScreen(thread.blockId);
      if (!pos) continue;
      const el = this._createPinElement(thread, pos);
      this._layer.appendChild(el);
      this._pins.set(thread.id, { thread, element: el });
    }
  }

  /**
   * M41-SDK-03
   * Add a single new pin without clearing existing pins.
   */
  addThread(thread: SdkThread): void {
    if (!this._opts || !this._layer) return;
    const pos = this._opts.coordinateToScreen(thread.blockId);
    if (!pos) return;
    const el = this._createPinElement(thread, pos);
    this._layer.appendChild(el);
    this._pins.set(thread.id, { thread, element: el });
  }

  /**
   * M41-SDK-04
   * Update an existing thread's pin appearance (status change, new reply, unread flag).
   * If the thread is not currently rendered, does nothing.
   */
  updateThread(threadId: string, update: Partial<SdkThread>): void {
    const entry = this._pins.get(threadId);
    if (!entry) return;
    Object.assign(entry.thread, update);
    const el = entry.element;
    // Reset class list and re-apply state
    el.className = "accordo-pin";
    const state = this.resolvePinState(entry.thread);
    el.classList.add(`accordo-pin--${state}`);
    // Update badge
    const badge = el.querySelector(".accordo-pin-badge");
    if (badge) {
      badge.textContent = String(entry.thread.comments.length);
    }
  }

  /**
   * M41-SDK-05
   * Remove a thread's pin from the DOM.
   * If a popover for this thread is open, close it first.
   */
  removeThread(threadId: string): void {
    const entry = this._pins.get(threadId);
    if (!entry) return;
    // Close popover if it belongs to this thread
    if (
      this._activePopover &&
      this._activePopover.getAttribute("data-thread-id") === threadId
    ) {
      this._closePopover();
    }
    entry.element.remove();
    this._pins.delete(threadId);
  }

  // ── Internal helpers (tested indirectly) ─────────────────────────────────

  /** Compute the pin state for a thread. */
  resolvePinState(thread: SdkThread): PinState {
    if (thread.status === "resolved") return "resolved";
    if (thread.hasUnread) return "updated";
    return "open";
  }

  /** Create a pin <div> element for a thread. */
  private _createPinElement(thread: SdkThread, pos: ScreenPosition): HTMLElement {
    const el = document.createElement("div");
    el.className = "accordo-pin";
    const state = this.resolvePinState(thread);
    el.classList.add(`accordo-pin--${state}`);
    el.setAttribute("data-thread-id", thread.id);
    // Only left/top are dynamic — all other styles come from CSS
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    // Badge showing comment count
    const badge = document.createElement("span");
    badge.className = "accordo-pin-badge";
    badge.textContent = String(thread.comments.length);
    el.appendChild(badge);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this._openPopover(thread.id);
    });

    return el;
  }

  /** Open the thread popover for a given threadId. */
  private _openPopover(threadId: string): void {
    // Close any existing popover first
    this._closePopover();

    const entry = this._pins.get(threadId);
    if (!entry || !this._opts) return;

    const { thread } = entry;
    const callbacks = this._opts.callbacks;

    const popover = document.createElement("div");
    popover.className = "accordo-popover";
    popover.setAttribute("data-thread-id", threadId);

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "accordo-popover__header";
    const statusLabel = document.createElement("span");
    statusLabel.textContent = thread.status === "resolved" ? "✓ Resolved" : "Comment";
    header.appendChild(statusLabel);
    const closeBtn = document.createElement("button");
    closeBtn.className = "accordo-popover__close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); this._closePopover(); });
    header.appendChild(closeBtn);
    popover.appendChild(header);

    // ── Comments list ─────────────────────────────────────────────────────
    const threadList = document.createElement("div");
    threadList.className = "accordo-thread-list";
    for (const comment of thread.comments) {
      const commentEl = document.createElement("div");
      commentEl.className = "accordo-comment-item";

      const authorLine = document.createElement("div");
      authorLine.className = "accordo-comment__author-line";

      const avatar = document.createElement("div");
      const isAgent = (comment.author as { kind?: string }).kind === "agent";
      avatar.className = `accordo-comment__avatar accordo-comment__avatar--${isAgent ? "agent" : "user"}`;
      avatar.textContent = comment.author.name.charAt(0).toUpperCase();
      authorLine.appendChild(avatar);

      const authorSpan = document.createElement("span");
      authorSpan.className = "accordo-comment__author";
      authorSpan.textContent = comment.author.name;
      authorLine.appendChild(authorSpan);
      commentEl.appendChild(authorLine);

      const bodyEl = document.createElement("p");
      bodyEl.className = "accordo-comment__body";
      bodyEl.textContent = comment.body;
      commentEl.appendChild(bodyEl);

      threadList.appendChild(commentEl);
    }
    popover.appendChild(threadList);

    // ── Reply / action section ─────────────────────────────────────────────
    if (thread.status === "open") {
      const replySection = document.createElement("div");
      replySection.className = "accordo-popover__reply";

      const replyTextarea = document.createElement("textarea");
      replyTextarea.placeholder = "Reply… (Cmd+Enter to submit)";
      replySection.appendChild(replyTextarea);

      const actions = document.createElement("div");
      actions.className = "accordo-popover__actions";

      const resolveBtn = document.createElement("button");
      resolveBtn.className = "accordo-btn accordo-btn--secondary";
      resolveBtn.textContent = "Resolve";
      resolveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onResolve(threadId, "");
        this._closePopover();
      });
      actions.appendChild(resolveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "accordo-btn accordo-btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onDelete(threadId, undefined);
        this._closePopover();
      });
      actions.appendChild(deleteBtn);

      const replyBtn = document.createElement("button");
      replyBtn.className = "accordo-btn accordo-btn--primary";
      replyBtn.textContent = "Reply";
      replyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (replyTextarea.value.trim()) {
          callbacks.onReply(threadId, replyTextarea.value);
          this._closePopover();
        }
      });
      actions.appendChild(replyBtn);

      replyTextarea.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          replyBtn.click();
        }
      });

      replySection.appendChild(actions);
      popover.appendChild(replySection);
    } else {
      const banner = document.createElement("div");
      banner.className = "accordo-resolved-banner";
      banner.textContent = "This thread is resolved";
      popover.appendChild(banner);

      const actions = document.createElement("div");
      actions.className = "accordo-popover__actions";
      (actions as HTMLElement).style.padding = "8px 12px";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "accordo-btn accordo-btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onDelete(threadId, undefined);
        this._closePopover();
      });
      actions.appendChild(deleteBtn);
      popover.appendChild(actions);
    }

    // Stop propagation on popover to prevent outside-click handler
    popover.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Initial position near pin
    const pinEl = entry.element;
    const pinLeft = parseFloat(pinEl.style.left || "0");
    const pinTop = parseFloat(pinEl.style.top || "0");
    popover.style.left = `${pinLeft + 16}px`;
    popover.style.top = `${pinTop + 16}px`;

    this._opts.container.appendChild(popover);
    this._activePopover = popover;

    // Clamp into viewport after DOM insertion (so dimensions are available)
    const POPOVER_W = 320;
    const popoverH = popover.offsetHeight || 240;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    let left = pinLeft + 16;
    let top = pinTop + 16;
    if (left + POPOVER_W > vpW - 8) left = Math.max(8, vpW - POPOVER_W - 8);
    if (top + popoverH > vpH - 8) top = Math.max(8, pinTop - popoverH - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  /** Close the currently open popover, if any. */
  private _closePopover(): void {
    if (this._activePopover) {
      this._activePopover.remove();
      this._activePopover = undefined;
    }
  }

  /** Show the inline comment input form at the click location. */
  private _showInlineInput(e: MouseEvent, blockId: string): void {
    if (!this._opts) return;

    // Remove any existing form
    this._opts.container.querySelector(".accordo-inline-input")?.remove();

    const form = document.createElement("div");
    form.className = "accordo-inline-input";
    // Position near click point
    form.style.left = `${e.clientX + window.scrollX}px`;
    form.style.top = `${e.clientY + window.scrollY + 8}px`;

    const textarea = document.createElement("textarea");
    form.appendChild(textarea);

    const submitBtn = document.createElement("button");
    submitBtn.className = "accordo-btn--primary";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const body = textarea.value;
      console.log("[accordo-sdk] submit — blockId:", JSON.stringify(blockId), "body:", JSON.stringify(body));
      if (body) {
        this._opts?.callbacks.onCreate(blockId || "file", body, undefined);
      }
      form.remove();
    });
    form.appendChild(submitBtn);

    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "accordo-btn--secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      form.remove();
    });
    form.appendChild(cancelBtn);

    this._opts.container.appendChild(form);
  }
}
