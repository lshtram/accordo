import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectTextMap } from "../src/content/text-map-collector.js";

describe("text map visible-first ordering", () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="hidden-top" style="display:none">Hidden top</div>',
      '<div id="offscreen-left">Offscreen left</div>',
      '<div id="visible-a">Visible alpha</div>',
      '<div id="visible-b">Visible beta</div>',
    ].join("");

    vi.stubGlobal("__accordoTestGetBoundingClientRect", function (this: HTMLElement): DOMRect {
      const rects: Record<string, Partial<DOMRect>> = {
        "hidden-top": { x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0 },
        "offscreen-left": { x: -200, y: 10, width: 100, height: 20, top: 10, right: -100, bottom: 30, left: -200 },
        "visible-a": { x: 0, y: 40, width: 100, height: 20, top: 40, right: 100, bottom: 60, left: 0 },
        "visible-b": { x: 0, y: 70, width: 100, height: 20, top: 70, right: 100, bottom: 90, left: 0 },
      };
      return rects[this.id] as DOMRect;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns visible text before offscreen and hidden text even when geometry would sort them first", () => {
    const result = collectTextMap();

    expect(result.segments.map((segment) => segment.textNormalized)).toEqual([
      "Visible alpha",
      "Visible beta",
      "Offscreen left",
      "Hidden top",
    ]);
  });

  it("reassigns readingOrderIndex to match the returned prioritized order", () => {
    const result = collectTextMap();

    expect(result.segments.map((segment) => segment.readingOrderIndex)).toEqual([0, 1, 2, 3]);
  });
});
