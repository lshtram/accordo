import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectTextMap } from "../src/content/text-map-collector.js";

describe("text map visibleOnly and truncation", () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="hidden-top" style="display:none">Hidden top</div>',
      '<div id="offscreen-left">Offscreen left</div>',
      '<div id="visible-a">Visible alpha</div>',
      '<div id="visible-b">Visible beta</div>',
      '<div id="visible-c">Visible gamma</div>',
    ].join("");

    vi.stubGlobal("__accordoTestGetBoundingClientRect", function (this: HTMLElement): DOMRect {
      const rects: Record<string, Partial<DOMRect>> = {
        "hidden-top": { x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0 },
        "offscreen-left": { x: -200, y: 10, width: 100, height: 20, top: 10, right: -100, bottom: 30, left: -200 },
        "visible-a": { x: 0, y: 40, width: 100, height: 20, top: 40, right: 100, bottom: 60, left: 0 },
        "visible-b": { x: 0, y: 70, width: 100, height: 20, top: 70, right: 100, bottom: 90, left: 0 },
        "visible-c": { x: 0, y: 100, width: 100, height: 20, top: 100, right: 100, bottom: 120, left: 0 },
      };
      return rects[this.id] as DOMRect;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("visibleOnly returns only visible segments and counts the filtered set", () => {
    const result = collectTextMap({ visibleOnly: true });

    expect(result.segments.map((segment) => segment.textNormalized)).toEqual([
      "Visible alpha",
      "Visible beta",
      "Visible gamma",
    ]);
    expect(result.totalSegments).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("maxSegments prioritizes visible content before non-visible segments", () => {
    const result = collectTextMap({ maxSegments: 2 });

    expect(result.segments.map((segment) => segment.textNormalized)).toEqual([
      "Visible alpha",
      "Visible beta",
    ]);
    expect(result.totalSegments).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("visibleOnly truncation metadata is computed against the filtered ordered set", () => {
    const result = collectTextMap({ visibleOnly: true, maxSegments: 2 });

    expect(result.segments.map((segment) => segment.textNormalized)).toEqual([
      "Visible alpha",
      "Visible beta",
    ]);
    expect(result.totalSegments).toBe(3);
    expect(result.truncated).toBe(true);
  });
});
