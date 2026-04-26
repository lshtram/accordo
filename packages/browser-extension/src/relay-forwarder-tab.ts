import { normalizeUrl } from "./store.js";
import { readOptionalNumber, readOptionalString } from "./relay-type-guards.js";
import { resolveImplicitTargetTab, resolveImplicitTargetTabId } from "./relay-implicit-target.js";

export async function getActiveTabUrl(): Promise<string | null> {
  const url = (await resolveImplicitTargetTab())?.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
  return normalizeUrl(url);
}

export async function resolveRequestedUrl(payload: Record<string, unknown>): Promise<string | null> {
  const explicitUrl = readOptionalString(payload, "url");
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return normalizeUrl(explicitUrl);
  }
  const tabId = readOptionalNumber(payload, "tabId");
  if (tabId !== undefined) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url) {
      const url = tab.url;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return normalizeUrl(url);
      }
    }
    return null;
  }
  return await getActiveTabUrl();
}

export async function resolveTargetTabId(payload: Record<string, unknown>): Promise<number | undefined> {
  const explicitTabId = readOptionalNumber(payload, "tabId");
  if (explicitTabId !== undefined) {
    return explicitTabId;
  }
  return resolveImplicitTargetTabId();
}
