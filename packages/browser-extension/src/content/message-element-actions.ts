import { resolveElementTarget, scrollResolvedElementIntoView, typeIntoResolvedElement } from "./message-action-helpers.js";

export async function handleResolveElementCoordsMessage(
  uid: string | undefined,
  selector: string | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (!uid && !selector) {
    sendResponse({ error: "no-identifier" });
    return;
  }
  const element = await resolveElementTarget(uid, selector);
  if (!element) {
    sendResponse({ error: "not-found" });
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    sendResponse({ error: "zero-size" });
    return;
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const inViewport = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
  sendResponse({ x, y, bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, inViewport });
}

export async function handleFocusElementMessage(
  uid: string | undefined,
  selector: string | undefined,
  clearFirst: boolean | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (!uid && !selector) {
    sendResponse({ error: "no-identifier" });
    return;
  }
  const element = await resolveElementTarget(uid, selector);
  if (!element) {
    sendResponse({ error: "not-found" });
    return;
  }
  const focusable = element as HTMLElement & { focus?: () => void; select?: () => void };
  if (typeof focusable.focus !== "function") {
    sendResponse({ error: "not-focusable" });
    return;
  }
  focusable.focus();
  if (clearFirst === true && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && typeof focusable.select === "function") {
    focusable.select();
  }
  sendResponse({ focused: document.activeElement === element });
}

export async function handleTypeInElementMessage(
  uid: string | undefined,
  selector: string | undefined,
  text: string | undefined,
  clearFirst: boolean | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if ((!uid && !selector) || typeof text !== "string") {
    sendResponse({ error: "no-identifier" });
    return;
  }
  const element = await resolveElementTarget(uid, selector);
  if (!element) {
    sendResponse({ error: "not-found" });
    return;
  }
  sendResponse(typeIntoResolvedElement(element, text, clearFirst === true));
}

export async function handleScrollElementIntoViewMessage(
  uid: string | undefined,
  selector: string | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (!uid && !selector) {
    sendResponse({ error: "no-identifier" });
    return;
  }
  const element = await resolveElementTarget(uid, selector);
  if (!element) {
    sendResponse({ error: "not-found" });
    return;
  }
  sendResponse(scrollResolvedElementIntoView(element));
}
