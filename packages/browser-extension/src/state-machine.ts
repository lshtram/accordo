/**
 * M80-SM — Comments Mode State Machine
 *
 * Manages tab-scoped OFF ↔ ON state for Comments Mode.
 * Persists state to chrome.storage.local under key "commentsMode".
 */

const STORAGE_KEY = "commentsMode";

/** In-memory map: tabId → boolean */
const modeMap = new Map<number, boolean>();

/**
 * Returns the current Comments Mode state for a given tab.
 * Defaults to false (OFF) for unknown tabs.
 */
export function getCommentsMode(tabId: number): boolean {
  return modeMap.get(tabId) ?? false;
}

/** Persists the current modeMap to chrome.storage.local */
async function persistToStorage(): Promise<void> {
  const obj: Record<number, boolean> = {};
  for (const [tabId, val] of modeMap.entries()) {
    obj[tabId] = val;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

/**
 * Sets Comments Mode state for a given tab and persists to storage.
 * Syncs with storage first to avoid stale in-memory state.
 */
export async function setCommentsMode(
  tabId: number,
  enabled: boolean
): Promise<void> {
  // Sync in-memory map from storage first, so the map reflects the current
  // persisted state (handles cross-test isolation when storage is cleared)
  await loadCommentsModeFromStorage();
  modeMap.set(tabId, enabled);
  await persistToStorage();
}

/**
 * Toggles Comments Mode for a given tab (ON → OFF, OFF → ON).
 */
export async function toggleCommentsMode(tabId: number): Promise<void> {
  const current = getCommentsMode(tabId);
  await setCommentsMode(tabId, !current);
}

/**
 * Loads Comments Mode state from chrome.storage.local into memory.
 * Called on service worker wake.
 */
export async function loadCommentsModeFromStorage(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  modeMap.clear();
  const stored = result[STORAGE_KEY] as Record<number, boolean> | undefined;
  if (stored) {
    for (const [key, val] of Object.entries(stored)) {
      modeMap.set(Number(key), val as boolean);
    }
  }
}

/**
 * Returns the full in-memory mode map (tabId → boolean).
 */
export function getCommentsModeMap(): Map<number, boolean> {
  return modeMap;
}
