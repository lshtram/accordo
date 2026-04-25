export function generateAnchorKey(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const siblingIndex = Array.from(element.parentElement?.children ?? []).indexOf(element as Element);
  const text = element.textContent ?? "";
  const raw = text.toLowerCase().slice(0, 20).replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const fingerprint = raw || "text";
  return `${tagName}:${siblingIndex}:${fingerprint}`;
}

export function getAnchorKeyFromEvent(event: MouseEvent): string {
  const target = event.target as Element;
  const existing = target.getAttribute("data-anchor-key");
  if (existing) return existing;
  return generateAnchorKey(target);
}

export function injectContextMenu(): void {
  if (document.querySelector("[data-accordo-context-menu]")) return;
  const menu = document.createElement("div");
  menu.setAttribute("data-accordo-context-menu", "");
  menu.textContent = "Add Comment";
  document.body.appendChild(menu);
}

export function removeContextMenu(): void {
  const menu = document.querySelector("[data-accordo-context-menu]");
  if (menu) menu.remove();
}

export function hideCommentForm(): void {
  const form = document.querySelector("[data-accordo-comment-form]");
  if (form) form.remove();
}

export function showCommentForm(
  anchorKey: string,
  x?: number,
  y?: number,
  onSubmit?: (anchorKey: string, body: string) => Promise<void>,
): void {
  hideCommentForm();

  const form = document.createElement("div");
  form.setAttribute("data-accordo-comment-form", anchorKey);
  form.className = "accordo-comment-form";

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
  submitBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const body = textarea.value.trim();
      if (!body) return;
      hideCommentForm();
      try {
        if (onSubmit) {
          await onSubmit(anchorKey, body);
        } else {
          await chrome.runtime.sendMessage({
            type: "CREATE_THREAD",
            payload: { url: window.location.href, anchorKey, body, author: { kind: "user", name: "Guest" } },
          });
        }
      } catch (err) {
        console.error("[Accordo] Failed to create comment:", err);
      }
    })();
  });
  actions.appendChild(submitBtn);
  form.appendChild(actions);

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
