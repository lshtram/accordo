import { getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import type { RelayBridgeClient } from "./relay-bridge.js";
import { relayBridge } from "./sw-lifecycle-bridge.js";

const SYNC_INTERVAL_MS = 30_000;
const SYNC_STORAGE_KEY = "commentsSyncState";

interface SyncState {
  version: number;
  lastSyncedAt: string;
}

async function getStoredSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const stored = result[SYNC_STORAGE_KEY] as SyncState | undefined;
  return stored ?? { version: -1, lastSyncedAt: new Date(0).toISOString() };
}

async function setStoredSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}

export async function checkAndSync(activeRelayBridge: RelayBridgeClient = relayBridge): Promise<void> {
  try {
    await loadCommentsModeFromStorage();
    const result = await activeRelayBridge.send("get_comments_version", {}, 5000);
    if (!result.success || typeof result.data !== "object") return;

    const { version } = result.data as { version: number };
    const prev = await getStoredSyncState();
    if (version !== prev.version) {
      await setStoredSyncState({ version, lastSyncedAt: new Date().toISOString() });
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id || !tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) continue;
        const isOn = getCommentsMode(tab.id);
        if (!isOn) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "COMMENTS_UPDATED", payload: { url: tab.url } });
        } catch {
          // non-fatal
        }
      }
    }
  } catch {
    // non-fatal
  }
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSync(activeRelayBridge: RelayBridgeClient = relayBridge): void {
  if (syncIntervalId) return;
  void checkAndSync(activeRelayBridge);
  syncIntervalId = setInterval(() => { void checkAndSync(activeRelayBridge); }, SYNC_INTERVAL_MS);
}

export function stopPeriodicSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}
