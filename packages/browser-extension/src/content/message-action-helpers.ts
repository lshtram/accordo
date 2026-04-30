import { parseUid } from "./spatial-relations-grammar.js";

export { toInspectPayload } from "../inspect-payload.js";

export async function resolveElementTarget(uid?: string, selector?: string): Promise<Element | null> {
  let element: Element | null = null;

  if (uid) {
    const { getElementByRef } = await import("./page-map-traversal.js");
    element = getElementByRef(uid) ?? null;
    if (!element) {
      const parsed = parseUid(uid);
      if (parsed !== null) {
        element = getElementByRef(`ref-${parsed.nodeId}`) ?? null;
      }
    }
    if (!element) {
      const { resolveAnchorKey } = await import("./enhanced-anchor.js");
      element = resolveAnchorKey(uid);
    }
  }

  if (!element && selector) {
    element = document.querySelector(selector);
  }

  return element;
}

export function typeIntoResolvedElement(element: Element, text: string, clearFirst: boolean): { typed: true } | { error: string } {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    const start = clearFirst ? 0 : (element.selectionStart ?? element.value.length);
    const end = clearFirst ? element.value.length : (element.selectionEnd ?? element.value.length);
    const nextValue = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
    element.value = nextValue;
    const caret = start + text.length;
    element.setSelectionRange(caret, caret);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { typed: true };
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = clearFirst ? text : `${element.textContent ?? ""}${text}`;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { typed: true };
  }

  return { error: "not-focusable" };
}

export function scrollResolvedElementIntoView(element: Element): { scrolled: true } {
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  return { scrolled: true };
}

function getLocalIframeKey(iframe: HTMLIFrameElement, index: number): string {
  if (iframe.name && iframe.name.trim() !== "") return iframe.name;
  if (iframe.id && iframe.id.trim() !== "") return iframe.id;
  return `iframe-${index}`;
}

export function getLogicalFrameId(): string {
  try {
    if (window.top === window) return "main";

    const parts: string[] = [];
    let currentWindow: Window = window;

    while (currentWindow.top !== currentWindow) {
      const frameElement = currentWindow.frameElement;
      if (!(frameElement instanceof HTMLIFrameElement)) return "main";
      const parentDoc = currentWindow.parent.document;
      const parentFrames = Array.from(parentDoc.querySelectorAll("iframe"));
      const index = parentFrames.indexOf(frameElement);
      parts.unshift(getLocalIframeKey(frameElement, index >= 0 ? index : 0));
      currentWindow = currentWindow.parent;
    }

    return parts.join("/") || "main";
  } catch {
    return "main";
  }
}
