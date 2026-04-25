import { MESSAGE_TYPES } from "./constants.js";
import { hasPermission, grant, revoke } from "./control-permission.js";
import type { BrowserCommentThread } from "./types.js";
import { getCommentsModeState, setCommentsModeState, showToast } from "./popup-state.js";
import { renderThreadList } from "./popup-thread-list.js";

export async function buildCommentsModeSection(container: HTMLElement, tabId: number): Promise<void> {
  const header = document.createElement("div");
  header.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #eee;";
  const stateLabel = document.createElement("span");
  stateLabel.id = "accordo-state-label";
  stateLabel.style.cssText = "font-size: 13px; font-weight: 600;";
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "accordo-toggle";
  toggleBtn.style.cssText = "background: #4a90d9; color: white; border: none; border-radius: 14px; padding: 4px 14px; font-size: 12px; cursor: pointer; font-weight: 600;";

  const renderState = async (): Promise<void> => {
    const isOn = await getCommentsModeState(tabId);
    stateLabel.textContent = `Comments Mode: ${isOn ? "ON" : "OFF"}`;
    stateLabel.style.color = isOn ? "#2a7a2a" : "#888";
    toggleBtn.textContent = isOn ? "Turn OFF" : "Turn ON";
    toggleBtn.style.background = isOn ? "#e53e3e" : "#4a90d9";
  };

  toggleBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const currentState = await getCommentsModeState(tabId);
      await setCommentsModeState(tabId, !currentState);
      await renderState();
    })();
  });

  header.appendChild(stateLabel);
  header.appendChild(toggleBtn);
  container.appendChild(header);
  await renderState();
}

export async function buildControlSection(container: HTMLElement, tabId: number): Promise<void> {
  const controlSection = document.createElement("div");
  controlSection.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #eee;";
  const controlLabel = document.createElement("span");
  controlLabel.id = "accordo-control-label";
  controlLabel.style.cssText = "font-size: 13px; font-weight: 600;";
  const controlBtn = document.createElement("button");
  controlBtn.id = "accordo-control-btn";
  controlBtn.style.cssText = "background: #ff6600; color: white; border: none; border-radius: 14px; padding: 4px 14px; font-size: 12px; cursor: pointer; font-weight: 600;";

  const renderControlState = async (): Promise<void> => {
    const isGranted = await hasPermission(tabId);
    controlLabel.textContent = `Browser Control: ${isGranted ? "ON" : "OFF"}`;
    controlLabel.style.color = isGranted ? "#2a7a2a" : "#888";
    controlBtn.textContent = isGranted ? "Revoke" : "Grant";
    controlBtn.style.background = isGranted ? "#e53e3e" : "#ff6600";
  };

  controlBtn.addEventListener("click", () => {
    void (async (): Promise<void> => {
      const isGranted = await hasPermission(tabId);
      if (isGranted) await revoke(tabId);
      else await grant(tabId);
      await renderControlState();
    })();
  });

  controlSection.appendChild(controlLabel);
  controlSection.appendChild(controlBtn);
  container.appendChild(controlSection);
  await renderControlState();
}

export function buildShortcutSection(container: HTMLElement): void {
  const hint = document.createElement("div");
  hint.style.cssText = "padding: 6px 12px; font-size: 11px; color: #888; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 8px;";
  const shortcut = document.createElement("span");
  shortcut.textContent = "Shortcut: Alt+Shift+C";
  hint.appendChild(shortcut);
  const shortcutBtn = document.createElement("button");
  shortcutBtn.textContent = "Configure";
  shortcutBtn.style.cssText = "background:none;border:none;color:#4a90d9;cursor:pointer;font-size:11px;padding:0;";
  shortcutBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(() => showToast("Open chrome://extensions/shortcuts"));
  });
  hint.appendChild(shortcutBtn);
  if (chrome.commands?.getAll) {
    chrome.commands.getAll().then((commands) => {
      const toggleCommand = commands.find((c) => c.name === "toggle-comments-mode");
      const assigned = toggleCommand?.shortcut?.trim();
      shortcut.textContent = assigned ? `Shortcut: ${assigned}` : "Shortcut not assigned";
    }).catch(() => {});
  }
  container.appendChild(hint);
}

export function buildThreadListSection(container: HTMLElement): HTMLDivElement {
  const listLabel = document.createElement("div");
  listLabel.textContent = "THREADS";
  listLabel.style.cssText = "padding: 8px 12px 4px; font-size: 11px; font-weight: 700; color: #999; letter-spacing: 0.5px;";
  container.appendChild(listLabel);
  const listContainer = document.createElement("div");
  listContainer.id = "accordo-thread-list";
  listContainer.style.cssText = "padding: 0 12px; min-height: 40px;";
  container.appendChild(listContainer);
  return listContainer;
}

export function buildActionButtonsSection(container: HTMLElement, tabId: number, pageUrl: string, listContainer: HTMLElement): void {
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; padding: 10px 12px 14px;";
  btnRow.innerHTML = `
    <button id="accordo-export-md" style="flex:1;padding:8px;background:#4a90d9;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Copy Markdown</button>
    <button id="accordo-export-json" style="flex:1;padding:8px;background:#6b7280;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Copy JSON</button>
    <button id="accordo-delete-all" style="flex:1;padding:8px;background:#e53e3e;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Delete All</button>
  `;
  container.appendChild(btnRow);

  document.getElementById("accordo-export-md")?.addEventListener("click", () => {
    void (async (): Promise<void> => {
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.EXPORT, payload: { format: "markdown", tabId, url: pageUrl } });
        if (response?.success && response.data?.text) await navigator.clipboard.writeText(response.data.text as string);
        showToast("Markdown copied!");
      } catch {
        showToast("Export failed");
      }
    })();
  });

  document.getElementById("accordo-delete-all")?.addEventListener("click", () => {
    void (async (): Promise<void> => {
      if (confirm("Delete ALL threads and comments on this page? This cannot be undone.")) {
        try {
          const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_THREADS, payload: { url: pageUrl } });
          const threads: BrowserCommentThread[] = response?.success ? (response.data ?? []) : [];
          for (const thread of threads) {
            await chrome.runtime.sendMessage({ type: "SOFT_DELETE_THREAD", payload: { threadId: thread.id, deletedBy: "User" } });
          }
          renderThreadList(listContainer, [], tabId, pageUrl);
          showToast("All threads deleted");
        } catch {
          showToast("Delete failed");
        }
      }
    })();
  });
}
