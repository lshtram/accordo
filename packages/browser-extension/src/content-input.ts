/**
 * M80-CS-INPUT — Content Script: Comment Input & Popovers
 *
 * Manages comment input forms, context menu injection, and thread popovers.
 */

import type { BrowserCommentThread } from "./types.js";

/**
 * Generates an anchor key for a DOM element.
 * Format: {tagName}:{siblingIndex}:{textFingerprint}
 *
 * textFingerprint = first 20 chars of textContent, lowercased,
 * with non-alphanumeric chars replaced by underscores.
 *
 * @param element - The DOM element to generate a key for
 * @returns Deterministic anchor key string
 */
export function generateAnchorKey(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const siblingIndex = Array.from(element.parentElement?.children ?? []).indexOf(element as Element);
  const text = element.textContent ?? "";
  // textFingerprint: lowercase, max 20 chars, non-alphanumeric → underscore
  const raw = text.toLowerCase().slice(0, 20).replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const fingerprint = raw || "text";
  return `${tagName}:${siblingIndex}:${fingerprint}`;
}

/**
 * Gets the anchor key for the element that was right-clicked.
 * Reads the anchor key from the element's data attribute (set by the content script
 * when it captured the click event), or generates one from the element itself.
 */
export function getAnchorKeyFromEvent(event: MouseEvent): string {
  const target = event.target as Element;
  // If element already has an anchor key data attribute, use it
  const existing = target.getAttribute("data-anchor-key");
  if (existing) return existing;
  // Otherwise generate from the element
  return generateAnchorKey(target);
}

/**
 * Injects a context menu item into the DOM for right-click comment creation.
 * Idempotent — calling twice does not create two menus.
 */
export function injectContextMenu(): void {
  if (document.querySelector("[data-accordo-context-menu]")) return;
  const menu = document.createElement("div");
  menu.setAttribute("data-accordo-context-menu", "");
  menu.textContent = "Add Comment";
  document.body.appendChild(menu);
}

/**
 * Removes the injected context menu item from the DOM.
 */
export function removeContextMenu(): void {
  const menu = document.querySelector("[data-accordo-context-menu]");
  if (menu) menu.remove();
}

/**
 * Shows the inline comment input form near the anchor element.
 * Uses .accordo-comment-form / .accordo-btn CSS classes from content-styles.css
 * for visual consistency with the rest of the Accordo UI.
 *
 * @param anchorKey - The anchor key for this comment
 * @param x - Optional x coordinate (viewport) to position the form near cursor
 * @param y - Optional y coordinate (viewport) to position the form near cursor
 * @param onSubmit - Optional async callback invoked with (anchorKey, body) on submit.
 *                   If omitted, falls back to sending CREATE_THREAD directly.
 */
export function showCommentForm(
  anchorKey: string,
  x?: number,
  y?: number,
  onSubmit?: (anchorKey: string, body: string) => Promise<void>
): void {
  hideCommentForm();

  const form = document.createElement("div");
  form.setAttribute("data-accordo-comment-form", anchorKey);
  form.className = "accordo-comment-form";

  // Position near cursor (fixed coords), or centered if no coords
  if (x !== undefined && y !== undefined) {
    form.style.left = `${Math.min(x, window.innerWidth - 320)}px`;
    form.style.top = `${Math.min(y + 8, window.innerHeight - 180)}px`;
    form.style.position = "fixed";
  } else {
    form.style.left = `${window.innerWidth / 2 - 150}px`;
    form.style.top = `${window.innerHeight / 2 - 90}px`;
    form.style.position = "fixed";
  }

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Add a comment… (Ctrl+Enter to submit)";
  form.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "accordo-form-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "accordo-btn accordo-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCommentForm();
  });
  actions.appendChild(cancelBtn);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "accordo-btn";
  submitBtn.textContent = "Add Comment";
  submitBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const body = textarea.value.trim();
    if (!body) return;
    hideCommentForm();
    try {
      if (onSubmit) {
        await onSubmit(anchorKey, body);
      } else {
        // Fallback: send directly (used when called outside the SDK flow)
        const pageUrl = window.location.href;
        await chrome.runtime.sendMessage({
          type: "CREATE_THREAD",
          payload: { url: pageUrl, anchorKey, body, author: { kind: "user", name: "Guest" } },
        });
      }
    } catch (err) {
      console.error("[Accordo] Failed to create comment:", err);
    }
  });
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  // Ctrl+Enter submits
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitBtn.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideCommentForm();
    }
  });

  document.body.appendChild(form);
  textarea.focus();
}

/**
 * Removes the comment input form from the DOM.
 */
export function hideCommentForm(): void {
  const form = document.querySelector("[data-accordo-comment-form]");
  if (form) form.remove();
}

/**
 * Shows the thread popover for an existing thread (click on a pin).
 * Shows all comments, a reply box, resolve/reopen, and delete per-comment.
 */
export function showThreadPopover(thread: BrowserCommentThread, anchorEl?: Element): void {
  hideThreadPopover();

  const popover = document.createElement("div");
  popover.setAttribute("data-accordo-popover", thread.id);

  // Position near anchor element or center of viewport
  let top = window.innerHeight / 2 - 120;
  let left = window.innerWidth / 2 - 150;
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    top = Math.min(rect.bottom + 8, window.innerHeight - 260);
    left = Math.min(rect.left, window.innerWidth - 320);
  }

  popover.style.cssText = `
    position: fixed;
    z-index: 2147483645;
    background: white;
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: 12px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    min-width: 280px;
    max-width: 320px;
    max-height: 400px;
    overflow-y: auto;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    top: ${top}px;
    left: ${left}px;
  `;

  // Header with close button
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
  const title = document.createElement("span");
  title.style.cssText = "font-weight:700;font-size:13px;color:#333;";
  title.textContent = `Thread (${thread.comments.length} comment${thread.comments.length !== 1 ? "s" : ""})`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:14px;color:#888;padding:0 4px;";
  closeBtn.addEventListener("click", hideThreadPopover);
  header.appendChild(title);
  header.appendChild(closeBtn);
  popover.appendChild(header);

  // Comment list
  for (const comment of thread.comments) {
    const commentEl = document.createElement("div");
    commentEl.style.cssText = "padding:6px 0;border-bottom:1px solid #f0f0f0;";
    commentEl.innerHTML = `
      <div style="font-weight:600;color:#555;font-size:11px;margin-bottom:2px;">${comment.author.name}</div>
      <div style="color:#222;">${comment.body}</div>
    `;

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("data-action", "delete");
    deleteBtn.style.cssText = "margin-top:4px;background:none;border:1px solid #ddd;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;color:#c00;";
    deleteBtn.addEventListener("click", async () => {
      try {
        await chrome.runtime.sendMessage({
          type: "SOFT_DELETE_COMMENT",
          payload: { threadId: thread.id, commentId: comment.id, deletedBy: "Guest" },
        });
        deleteBtn.textContent = "Deleted";
        deleteBtn.disabled = true;
        commentEl.style.opacity = "0.4";
      } catch (err) {
        console.error("[Accordo] delete comment failed:", err);
      }
    });
    commentEl.appendChild(deleteBtn);
    popover.appendChild(commentEl);
  }

  // Reply input
  const replyInput = document.createElement("textarea");
  replyInput.placeholder = "Reply...";
  replyInput.style.cssText = "width:100%;min-height:50px;margin-top:8px;padding:6px;border:1px solid #ddd;border-radius:4px;resize:vertical;font-size:13px;";
  popover.appendChild(replyInput);

  const replyBtn = document.createElement("button");
  replyBtn.textContent = "Reply";
  replyBtn.style.cssText = "margin-top:6px;background:#4a90d9;color:white;border:none;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:13px;";
  replyBtn.addEventListener("click", async () => {
    const body = replyInput.value.trim();
    if (!body) return;
    try {
      await chrome.runtime.sendMessage({
        type: "ADD_COMMENT",
        payload: { threadId: thread.id, body, author: { kind: "user", name: "Guest" } },
      });
      hideThreadPopover();
    } catch (err) {
      console.error("[Accordo] reply failed:", err);
    }
  });
  popover.appendChild(replyBtn);

  // Resolve/reopen button
  const actionBtn = document.createElement("button");
  const isResolved = thread.status === "resolved";
  actionBtn.textContent = isResolved ? "Reopen" : "Resolve";
  actionBtn.setAttribute("data-action", isResolved ? "reopen" : "resolve");
  actionBtn.style.cssText = `margin-top:6px;margin-left:6px;background:${isResolved ? "#4a90d9" : "#2e7d32"};color:white;border:none;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:13px;`;
  actionBtn.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({
        type: isResolved ? "ADD_COMMENT" : "SOFT_DELETE_THREAD",
        payload: isResolved
          ? { threadId: thread.id, body: "Reopened", author: { kind: "user", name: "Guest" } }
          : { threadId: thread.id, deletedBy: "Guest" },
      });
      hideThreadPopover();
    } catch (err) {
      console.error("[Accordo] resolve/reopen failed:", err);
    }
  });
  popover.appendChild(actionBtn);

  document.body.appendChild(popover);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", function outsideClick(e) {
      if (!popover.contains(e.target as Node)) {
        hideThreadPopover();
        document.removeEventListener("click", outsideClick);
      }
    });
  }, 0);
}

/**
 * Removes the thread popover from the DOM.
 */
export function hideThreadPopover(): void {
  const popover = document.querySelector("[data-accordo-popover]");
  if (popover) popover.remove();
}
