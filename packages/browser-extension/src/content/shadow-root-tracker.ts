const CLOSED_SHADOW_ATTR = "data-accordo-shadow-root";
let shadowTrackingInstalled = false;

export function ensureShadowTrackingInstalled(): void {
  if (shadowTrackingInstalled || typeof Element === "undefined") return;
  const proto = Element.prototype as Element & {
    attachShadow?: (init: ShadowRootInit) => ShadowRoot;
  };
  const originalAttachShadow = proto.attachShadow;
  if (typeof originalAttachShadow !== "function") {
    shadowTrackingInstalled = true;
    return;
  }

  proto.attachShadow = function patchedAttachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
    const root = originalAttachShadow.call(this, init);
    if (init.mode === "closed") {
      this.setAttribute(CLOSED_SHADOW_ATTR, "closed");
    }
    return root;
  };
  shadowTrackingInstalled = true;
}

export function getShadowRootState(element: Element): ShadowRoot | "closed" | null {
  const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadowRoot) return shadowRoot;
  return element.getAttribute(CLOSED_SHADOW_ATTR) === "closed" ? "closed" : null;
}
