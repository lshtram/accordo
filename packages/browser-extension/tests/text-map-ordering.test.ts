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

  it("preserves geometric reading order within the offscreen bucket", () => {
    // All four must be definitively offscreen: x far outside viewport (JSDOM default 1024x768)
    document.body.innerHTML = [
      '<div id="off-r-top" style="position:absolute;top:0;left:-1100;width:10;height:10">Off R Top</div>',
      '<div id="off-l-mid" style="position:absolute;top:30;left:-500;width:10;height:10">Off L Mid</div>',
      '<div id="off-r-bot" style="position:absolute;top:60;left:-1100;width:10;height:10">Off R Bot</div>',
      '<div id="off-l-top" style="position:absolute;top:0;left:-500;width:10;height:10">Off L Top</div>',
    ].join("");

    vi.stubGlobal("__accordoTestGetBoundingClientRect", function (this: HTMLElement): DOMRect {
      const rects: Record<string, Partial<DOMRect>> = {
        "off-r-top": { x: -1100, y: 0, width: 10, height: 10, top: 0, right: -1090, bottom: 10, left: -1100 },
        "off-l-mid": { x: -500, y: 30, width: 10, height: 10, top: 30, right: -490, bottom: 40, left: -500 },
        "off-r-bot": { x: -1100, y: 60, width: 10, height: 10, top: 60, right: -1090, bottom: 70, left: -1100 },
        "off-l-top": { x: -500, y: 0, width: 10, height: 10, top: 0, right: -490, bottom: 10, left: -500 },
      };
      return rects[this.id] as DOMRect;
    });

    const result = collectTextMap();
    const offscreenSegments = result.segments.filter((s) => s.visibility === "offscreen");

    // assignReadingOrder sorts by y first (top-to-bottom), then by x ascending (left-to-right).
    // In viewport coordinates, x=-1100 is further LEFT than x=-500 (more negative = further left).
    // When isRTL=false: ascending x means numerically ascending (more negative = leftmost = first).
    // Off L Top (x=-500) vs Off R Top (x=-1100): x=-1100 < x=-500, so Off R Top sorts first within y=0 band.
    // y=0 band: Off R Top (x=-1100) → Off L Top (x=-500)
    // y=30 band: Off L Mid (x=-500)
    // y=60 band: Off R Bot (x=-1100)
    expect(offscreenSegments.map((s) => s.textNormalized)).toEqual([
      "Off R Top",
      "Off L Top",
      "Off L Mid",
      "Off R Bot",
    ]);
  });

  it("preserves geometric reading order within the hidden bucket", () => {
    document.body.innerHTML = [
      '<div id="hidden-c" style="display:none">Hidden C</div>',
      '<div id="hidden-a" style="display:none">Hidden A</div>',
      '<div id="hidden-b" style="display:none">Hidden B</div>',
    ].join("");

    vi.stubGlobal("__accordoTestGetBoundingClientRect", function (this: HTMLElement): DOMRect {
      const rects: Record<string, Partial<DOMRect>> = {
        "hidden-c": { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        "hidden-a": { x: 0, y: 20, width: 10, height: 10, top: 20, right: 10, bottom: 30, left: 0 },
        "hidden-b": { x: 0, y: 40, width: 10, height: 10, top: 40, right: 10, bottom: 50, left: 0 },
      };
      return rects[this.id] as DOMRect;
    });

    const result = collectTextMap();
    const hiddenSegments = result.segments.filter((s) => s.visibility === "hidden");

    // Geometric order: top-to-bottom by bbox.y
    expect(hiddenSegments.map((s) => s.textNormalized)).toEqual([
      "Hidden C", // y=0
      "Hidden A", // y=20
      "Hidden B", // y=40
    ]);
  });
});
