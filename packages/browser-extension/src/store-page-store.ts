import type { BrowserCommentThread, PageCommentStore } from "./types.js";
import { getStorageKey } from "./store-keys.js";

export async function getPageStore(
  normalizedUrl: string,
): Promise<PageCommentStore | null> {
  const key = getStorageKey(normalizedUrl);
  const result = await chrome.storage.local.get(key);
  const store = result[key] as PageCommentStore | undefined;
  return store ?? null;
}

export async function savePageStore(store: PageCommentStore): Promise<void> {
  const key = getStorageKey(store.url);
  await chrome.storage.local.set({ [key]: store });
}

export async function findThreadAndStore(
  threadId: string,
): Promise<{ store: PageCommentStore; thread: BrowserCommentThread } | null> {
  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("comments:")) continue;
    const store = value as PageCommentStore;
    const thread = store.threads?.find((t) => t.id === threadId);
    if (thread) return { store, thread };
  }
  return null;
}
