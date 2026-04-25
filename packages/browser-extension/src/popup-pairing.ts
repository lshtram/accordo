import { MESSAGE_TYPES } from "./constants.js";

const RELAY_TOKEN_STORAGE_KEY = "relayToken";
const RELAY_PAIR_URL = "http://127.0.0.1:40111/pair/confirm";

export async function renderPairingSection(container: HTMLElement): Promise<void> {
  const result = await chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]);
  const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
  const existing = container.querySelector("[data-accordo-pair]");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.setAttribute("data-accordo-pair", "");
  banner.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #eee; gap: 8px;";

  if (token) {
    const label = document.createElement("span");
    label.style.cssText = "font-size: 12px; font-weight: 600; color: #2a7a2a;";
    label.textContent = "VS Code: Connected";

    const disconnectBtn = document.createElement("button");
    disconnectBtn.textContent = "Disconnect";
    disconnectBtn.style.cssText = "background: none; border: 1px solid #ccc; border-radius: 10px; padding: 2px 10px; font-size: 11px; cursor: pointer; color: #666;";
    disconnectBtn.addEventListener("click", () => {
      void chrome.storage.local.remove(RELAY_TOKEN_STORAGE_KEY).then(() => {
        void renderPairingSection(container);
      });
    });

    banner.appendChild(label);
    banner.appendChild(disconnectBtn);
  } else {
    const label = document.createElement("span");
    label.style.cssText = "font-size: 12px; color: #888; white-space: nowrap;";
    label.textContent = "VS Code code:";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "1234-5678";
    input.maxLength = 9;
    input.style.cssText = "flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 3px 7px; font-size: 12px; font-family: monospace; width: 80px;";

    const connectBtn = document.createElement("button");
    connectBtn.textContent = "Connect";
    connectBtn.style.cssText = "background: #4a90d9; color: white; border: none; border-radius: 10px; padding: 3px 12px; font-size: 12px; cursor: pointer; font-weight: 600; white-space: nowrap;";

    const errorEl = document.createElement("span");
    errorEl.style.cssText = "font-size: 11px; color: #e53e3e; display: none;";
    errorEl.textContent = "Invalid code";

    const doConnect = (): void => {
      const code = input.value.trim();
      if (!code) return;
      errorEl.style.display = "none";
      connectBtn.disabled = true;
      connectBtn.textContent = "...";
      void fetch(RELAY_PAIR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).then(async (res) => {
        if (!res.ok) throw new Error("rejected");
        const body = await res.json() as { token?: string };
        if (!body.token) throw new Error("no-token");
        await chrome.storage.local.set({ [RELAY_TOKEN_STORAGE_KEY]: body.token });
        void chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RELAY_RECONNECT });
        void renderPairingSection(container);
      }).catch(() => {
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
        errorEl.style.display = "inline";
      });
    };

    connectBtn.addEventListener("click", doConnect);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doConnect();
    });

    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;";
    inputRow.appendChild(input);
    inputRow.appendChild(connectBtn);
    inputRow.appendChild(errorEl);

    banner.appendChild(label);
    banner.appendChild(inputRow);
  }

  container.insertBefore(banner, container.firstChild);
}
