import type { BrowserCommentThread } from "./types.js";

export function hideThreadPopover(): void {
  const popover = document.querySelector("[data-accordo-popover]");
  if (popover) popover.remove();
}

export function showThreadPopover(thread: BrowserCommentThread, anchorEl?: Element): void {
  hideThreadPopover();

  const popover = document.createElement("div");
  popover.setAttribute("data-accordo-popover", thread.id);

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
    deleteBtn.addEventListener("click", () => {
      void (async (): Promise<void> => {
        try {
          await chrome.runtime.sendMessage({ type: "SOFT_DELETE_COMMENT", payload: { threadId: thread.id, commentId: comment.id, deletedBy: "Guest" } });
          deleteBtn.textContent = "Deleted";
          deleteBtn.disabled = true;
          commentEl.style.opacity = "0.4";
        } catch (err) {
          console.error("[Accordo] delete comment failed:", err);
        }
      })();
    });
    commentEl.appendChild(deleteBtn);
    popover.appendChild(commentEl);
  }

  const replyInput = document.createElement("textarea");
  replyInput.placeholder = "Reply...";
  replyInput.style.cssText = "width:100%;min-height:50px;margin-top:8px;padding:6px;border:1px solid #ddd;border-radius:4px;resize:vertical;font-size:13px;";
  popover.appendChild(replyInput);

  const replyBtn = document.createElement("button");
  replyBtn.textContent = "Reply";
  replyBtn.style.cssText = "margin-top:6px;background:#4a90d9;color:white;border:none;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:13px;";
  replyBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const body = replyInput.value.trim();
      if (!body) return;
      try {
        await chrome.runtime.sendMessage({ type: "ADD_COMMENT", payload: { threadId: thread.id, body, author: { kind: "user", name: "Guest" } } });
        hideThreadPopover();
      } catch (err) {
        console.error("[Accordo] reply failed:", err);
      }
    })();
  });
  popover.appendChild(replyBtn);

  const actionBtn = document.createElement("button");
  const isResolved = thread.status === "resolved";
  actionBtn.textContent = isResolved ? "Reopen" : "Resolve";
  actionBtn.setAttribute("data-action", isResolved ? "reopen" : "resolve");
  actionBtn.style.cssText = `margin-top:6px;margin-left:6px;background:${isResolved ? "#4a90d9" : "#2e7d32"};color:white;border:none;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:13px;`;
  actionBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
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
    })();
  });
  popover.appendChild(actionBtn);

  document.body.appendChild(popover);
  setTimeout(() => {
    document.addEventListener("click", function outsideClick(e) {
      if (!popover.contains(e.target as Node)) {
        hideThreadPopover();
        document.removeEventListener("click", outsideClick);
      }
    });
  }, 0);
}
