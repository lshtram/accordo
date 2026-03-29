/**
 * @accordo/comment-sdk — popover-renderer
 *
 * Popover / tooltip rendering:
 *   - Building the thread popover DOM (comments list, reply input, action buttons)
 *   - Showing / hiding the popover
 *   - Clamping popover into the viewport after insertion
 *   - Highlighting / de-highlighting the active anchor block element
 *
 * Source: M41 — @accordo/comment-sdk
 */

import type { SdkThread, SdkInitOptions } from "./types.js";

// ── PopoverRenderer ───────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of the floating comment popover and the Alt+click
 * inline input form. One instance per SDK lifecycle (init → destroy).
 */
export class PopoverRenderer {
  private _activePopover: HTMLElement | undefined;
  private _activeBlockEl: HTMLElement | undefined;

  // ── Popover ────────────────────────────────────────────────────────────────

  /**
   * Build and display the thread popover next to the given pin element.
   * Closes any existing popover first (M41-SDK-11).
   */
  openPopover(
    thread: SdkThread,
    pinEl: HTMLElement,
    opts: SdkInitOptions,
  ): void {
    this.closePopover();

    const { callbacks } = opts;
    const threadId = thread.id;

    const popover = document.createElement("div");
    popover.className = "accordo-popover";
    popover.setAttribute("data-thread-id", threadId);

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "accordo-popover__header";
    const statusLabel = document.createElement("span");
    statusLabel.textContent = thread.status === "resolved" ? "✓ Resolved" : "Comment";
    header.appendChild(statusLabel);
    const closeBtn = document.createElement("button");
    closeBtn.className = "accordo-popover__close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closePopover();
    });
    header.appendChild(closeBtn);
    popover.appendChild(header);

    // ── Comments list ────────────────────────────────────────────────────────
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

    // ── Reply / action section ───────────────────────────────────────────────
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
        this.closePopover();
      });
      actions.appendChild(resolveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "accordo-btn accordo-btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onDelete(threadId, undefined);
        this.closePopover();
      });
      actions.appendChild(deleteBtn);

      const replyBtn = document.createElement("button");
      replyBtn.className = "accordo-btn accordo-btn--primary";
      replyBtn.textContent = "Reply";
      replyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (replyTextarea.value.trim()) {
          callbacks.onReply(threadId, replyTextarea.value);
          this.closePopover();
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

      const reopenBtn = document.createElement("button");
      reopenBtn.className = "accordo-btn accordo-btn--secondary";
      reopenBtn.textContent = "Reopen";
      reopenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onReopen(threadId);
        this.closePopover();
      });
      actions.appendChild(reopenBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "accordo-btn accordo-btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onDelete(threadId, undefined);
        this.closePopover();
      });
      actions.appendChild(deleteBtn);
      popover.appendChild(actions);
    }

    // Stop propagation on popover to prevent outside-click handler
    popover.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Initial position near pin
    const pinLeft = parseFloat(pinEl.style.left || "0");
    const pinTop = parseFloat(pinEl.style.top || "0");
    popover.style.left = `${pinLeft + 16}px`;
    popover.style.top = `${pinTop + 16}px`;

    opts.container.appendChild(popover);
    this._activePopover = popover;

    // Highlight the anchor block element
    const anchorEl = opts.container.querySelector(
      `[data-block-id="${thread.blockId}"]`,
    );
    if (anchorEl) {
      anchorEl.classList.add("accordo-block--active-comment");
      this._activeBlockEl = anchorEl as HTMLElement;
    }

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
  closePopover(): void {
    if (this._activePopover) {
      this._activePopover.remove();
      this._activePopover = undefined;
    }
    if (this._activeBlockEl) {
      this._activeBlockEl.classList.remove("accordo-block--active-comment");
      this._activeBlockEl = undefined;
    }
  }

  /** Returns true when a popover is currently open. */
  isOpen(): boolean {
    return this._activePopover !== undefined;
  }

  /**
   * Returns the thread-id of the currently open popover, or undefined.
   * Used by removeThread to decide whether to close before removing.
   */
  activeThreadId(): string | undefined {
    return this._activePopover?.getAttribute("data-thread-id") ?? undefined;
  }

}
