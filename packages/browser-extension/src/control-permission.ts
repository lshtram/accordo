/**
 * M110-TC — Control Permission API
 *
 * Per-tab control permission state management.
 * Uses chrome.storage.local for persistent storage.
 *
 * REQ-TC-016: PERMISSION_REQUIRED when hasPermission(tabId) returns false.
 * REQ-TC-017: TAB_NOT_FOUND when tabId refers to non-existent tab.
 *
 * @module
 */

const STORAGE_KEY = "controlGrantedTabs";

/**
 * Check if agent control is granted for a tab.
 */
export async function hasPermission(tabId: number): Promise<boolean> {
  const tabs = await getGrantedTabs();
  return tabs.includes(tabId);
}

/**
 * Grant agent control for a tab.
 * Stores tabId in chrome.storage.local and sets badge.
 */
export async function grant(tabId: number): Promise<void> {
  const tabs = await getGrantedTabs();
  if (!tabs.includes(tabId)) {
    tabs.push(tabId);
    await chrome.storage.local.set({ [STORAGE_KEY]: tabs });
  }

  // Set badge
  await chrome.action.setBadgeText({ text: "CTL", tabId });
  await chrome.action.setBadgeBackgroundColor({ color: "#FF6600", tabId });
}

/**
 * Revoke agent control for a tab.
 * Removes tabId from storage and clears badge.
 */
export async function revoke(tabId: number): Promise<void> {
  const tabs = await getGrantedTabs();
  const idx = tabs.indexOf(tabId);
  if (idx !== -1) {
    tabs.splice(idx, 1);
    await chrome.storage.local.set({ [STORAGE_KEY]: tabs });
  }

  // Clear badge
  await chrome.action.setBadgeText({ text: "", tabId });
}

/**
 * Return all tab IDs currently granted control.
 */
export async function getGrantedTabs(): Promise<number[]> {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const tabs = result[STORAGE_KEY];
  return Array.isArray(tabs) ? tabs : [];
}
