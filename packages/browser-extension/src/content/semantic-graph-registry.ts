export class NodeIdRegistry {
  private readonly elementIds = new Map<Element, number>();
  private counter = 0;
  public frameId: string = "main";

  idFor(el: Element): number {
    const existing = this.elementIds.get(el);
    if (existing !== undefined) return existing;
    const id = this.counter++;
    this.elementIds.set(el, id);
    return id;
  }

  uidFor(el: Element): string | undefined {
    const nodeId = this.elementIds.get(el);
    if (nodeId === undefined) return undefined;
    return `${this.frameId}:${nodeId}`;
  }
}

export function getElementRect(el: HTMLElement): DOMRect {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win["__accordoTestGetBoundingClientRect"] === "function") {
    return (win["__accordoTestGetBoundingClientRect"] as (this: HTMLElement) => DOMRect).call(el);
  }
  return el.getBoundingClientRect();
}

const hiddenCache = new WeakMap<HTMLElement, { signature: string; hidden: boolean }>();

export function isHidden(el: HTMLElement): boolean {
  const signature = `${el.getAttribute("style") ?? ""}|${el.className}|${el.hasAttribute("hidden") ? "1" : "0"}`;
  const cached = hiddenCache.get(el);
  if (cached?.signature === signature) return cached.hidden;

  const style = window.getComputedStyle(el);
  const hidden = (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0" ||
    el.hasAttribute("hidden")
  );
  hiddenCache.set(el, { signature, hidden });
  return hidden;
}
