/**
 * @accordo/comment-sdk — inline-input
 *
 * Alt+click inline comment-creation form.
 *   - Builds and appends the floating textarea form to the container
 *   - Wires up Submit (calls onCreate callback) and Cancel buttons
 *   - Supports Cmd/Ctrl+Enter keyboard shortcut to submit
 *
 * Source: M41 — @accordo/comment-sdk
 */

import type { SdkInitOptions } from "./types.js";

// ── showInlineInput ───────────────────────────────────────────────────────────

/**
 * Show the inline comment-creation form at the given mouse event location.
 * Triggered by Alt+click on a block element (M41-SDK-07).
 * Any previously open form is removed first.
 */
export function showInlineInput(
  e: MouseEvent,
  blockId: string,
  opts: SdkInitOptions,
): void {
  // Remove any existing form
  opts.container.querySelector(".accordo-inline-input")?.remove();

  const form = document.createElement("div");
  form.className = "accordo-inline-input";
  // Position near click point
  form.style.left = `${e.clientX + window.scrollX}px`;
  form.style.top = `${e.clientY + window.scrollY + 8}px`;

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Add comment… (Cmd+Enter to submit)";
  form.appendChild(textarea);

  const submitBtn = document.createElement("button");
  submitBtn.className = "accordo-btn accordo-btn--primary";
  submitBtn.textContent = "Add Comment";
  submitBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const body = textarea.value.trim();
    if (body) {
      opts.callbacks.onCreate(blockId, body, undefined);
    }
    form.remove();
  });

  textarea.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      submitBtn.click();
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "accordo-btn accordo-btn--secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    form.remove();
  });

  const actions = document.createElement("div");
  actions.className = "accordo-inline-input__actions";
  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  opts.container.appendChild(form);
}
