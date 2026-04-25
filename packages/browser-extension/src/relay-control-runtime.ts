export { createFrameNavigatedWaiter, createLifecycleWaiter, getNavigateTimeoutMs, toLifecycleEventName, type WaitUntil } from "./relay-control-waiters.js";
export { resolveControlFrameTarget, type ControlFrameTarget } from "./relay-control-frame-target.js";

export async function resolveTargetTabId(payload: Record<string, unknown>): Promise<number | undefined> {
  if (typeof payload.tabId === "number") {
    return payload.tabId;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

export async function tabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

export async function resolveElementCoords(
  tabId: number,
  frameId: number,
  uid?: string,
  selector?: string,
): Promise<{ x: number; y: number; bounds: { x: number; y: number; width: number; height: number }; inViewport: boolean } | { error: string }> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "RESOLVE_ELEMENT_COORDS",
    uid,
    selector,
  }, { frameId });
  return response as { x: number; y: number; bounds: { x: number; y: number; width: number; height: number }; inViewport: boolean } | { error: string };
}

export async function focusElement(
  tabId: number,
  frameId: number,
  uid?: string,
  selector?: string,
  clearFirst?: boolean,
): Promise<{ focused: boolean } | { error: string }> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "FOCUS_ELEMENT",
    uid,
    selector,
    clearFirst,
  }, { frameId });
  return response as { focused: boolean } | { error: string };
}

export async function scrollElementIntoView(
  tabId: number,
  frameId: number,
  uid?: string,
  selector?: string,
): Promise<{ scrolled: true } | { error: string }> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "SCROLL_ELEMENT_INTO_VIEW",
    uid,
    selector,
  }, { frameId });
  return response as { scrolled: true } | { error: string };
}

export async function typeInElement(
  tabId: number,
  frameId: number,
  text: string,
  uid?: string,
  selector?: string,
  clearFirst?: boolean,
): Promise<{ typed: true } | { error: string }> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "TYPE_IN_ELEMENT",
    uid,
    selector,
    text,
    clearFirst,
  }, { frameId });
  return response as { typed: true } | { error: string };
}
