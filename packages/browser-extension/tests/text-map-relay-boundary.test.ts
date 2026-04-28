/**
 * text-map-relay-boundary.test.ts
 *
 * End-to-end relay-boundary tests for get_text_map.
 * Proves that pagination after `visibleOnly` remains aligned after passing
 * through the real relay handler boundary (handleGetTextMap → collector → relay pagination).
 *
 * Covers residual risk:
 *   "No focused end-to-end test currently proves pagination after `visibleOnly`
 *    through the real relay boundary."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetTextMap } from "../src/relay-page-secondary-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

function makeRequest(overrides: Partial<RelayActionRequest["payload"]> = {}): RelayActionRequest {
  return {
    requestId: "test-req",
    action: "get_text_map",
    payload: {
      visibleOnly: false,
      maxSegments: 500,
      offset: 0,
      limit: 2000,
      ...overrides,
    },
  } as RelayActionRequest;
}

describe("get_text_map relay boundary — visibleOnly + pagination", () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="vis-a" style="position:absolute;top:0;left:0;width:10;height:10">A</div>',
      '<div id="vis-b" style="position:absolute;top:20;left:0;width:10;height:10">B</div>',
      '<div id="vis-c" style="position:absolute;top:40;left:0;width:10;height:10">C</div>',
      '<div id="vis-d" style="position:absolute;top:60;left:0;width:10;height:10">D</div>',
      '<div id="offscreen-a" style="position:absolute;top:0;left:-200;width:10;height:10">OffA</div>',
      '<div id="offscreen-b" style="position:absolute;top:20;left:-200;width:10;height:10">OffB</div>',
      '<div id="hidden-a" style="display:none">HidA</div>',
      '<div id="hidden-b" style="display:none">HidB</div>',
    ].join("");

    vi.stubGlobal("__accordoTestGetBoundingClientRect", function (this: HTMLElement): DOMRect {
      const rects: Record<string, Partial<DOMRect>> = {
        "vis-a": { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        "vis-b": { x: 0, y: 20, width: 10, height: 10, top: 20, right: 10, bottom: 30, left: 0 },
        "vis-c": { x: 0, y: 40, width: 10, height: 10, top: 40, right: 10, bottom: 50, left: 0 },
        "vis-d": { x: 0, y: 60, width: 10, height: 10, top: 60, right: 10, bottom: 70, left: 0 },
        "offscreen-a": { x: -200, y: 0, width: 10, height: 10, top: 0, right: -190, bottom: 10, left: -200 },
        "offscreen-b": { x: -200, y: 20, width: 10, height: 10, top: 20, right: -190, bottom: 30, left: -200 },
        "hidden-a": { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        "hidden-b": { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
      };
      return rects[this.id] as DOMRect;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pagination metadata uses filtered visibleOnly total not full bucket total", async () => {
    // Request page 2 of visible-only segments (limit 1, offset 1)
    // visibleOnly=true → 4 segments (A,B,C,D); page 2 → only "B"
    const response = await handleGetTextMap(makeRequest({ visibleOnly: true, offset: 1, limit: 1 }));
    expect(response.success).toBe(true);

    const data = response as unknown as {
      data: {
        segments: Array<{ textNormalized: string }>;
        totalSegments: number;
        truncated: boolean;
        offset?: number;
        limit?: number;
        hasMore?: boolean;
        nextOffset?: number;
        totalAvailable?: number;
      };
    };

    expect(data.data.segments.map((s) => s.textNormalized)).toEqual(["B"]);
    // totalSegments reflects the filtered (visibleOnly) set = 4
    expect(data.data.totalSegments).toBe(4);
    // truncated reflects collector-side cap (maxSegments=500 > 4 segments → false)
    expect(data.data.truncated).toBe(false);
    // pagination metadata from appendPaginationMetadata
    expect(data.data.totalAvailable).toBe(4);
    expect(data.data.hasMore).toBe(true);
    expect(data.data.nextOffset).toBe(2);
  });

  it("visibleOnly=false relay path returns full ordered set with correct pagination", async () => {
    // Full set = 8 segments; limit=3, offset=2 → C,D,OffA,OffB (4 segments returned)
    const response = await handleGetTextMap(makeRequest({ visibleOnly: false, offset: 2, limit: 3 }));
    expect(response.success).toBe(true);

    const data = response as unknown as {
      data: {
        segments: Array<{ textNormalized: string }>;
        totalSegments: number;
        truncated: boolean;
        totalAvailable?: number;
        hasMore?: boolean;
        nextOffset?: number;
      };
    };

    // Order: visible-first (A,B,C,D) then offscreen (OffA,OffB) then hidden (HidA,HidB)
    // offset=2, limit=3 → C, D, OffA
    expect(data.data.segments.map((s) => s.textNormalized)).toEqual(["C", "D", "OffA"]);
    expect(data.data.totalSegments).toBe(8);
    // truncated reflects collector cap (maxSegments=500 > 8 segments → false)
    expect(data.data.truncated).toBe(false);
    expect(data.data.totalAvailable).toBe(8);
    expect(data.data.hasMore).toBe(true);
    expect(data.data.nextOffset).toBe(5);
  });

  it("visibleOnly with offset beyond filtered set returns empty with correct metadata", async () => {
    // visibleOnly set = 4 segments; offset=10 → beyond range
    const response = await handleGetTextMap(makeRequest({ visibleOnly: true, offset: 10, limit: 5 }));
    expect(response.success).toBe(true);

    const data = response as unknown as {
      data: {
        segments: Array<unknown>;
        totalSegments: number;
        truncated: boolean;
        totalAvailable?: number;
        hasMore?: boolean;
      };
    };

    expect(data.data.segments).toEqual([]);
    expect(data.data.totalSegments).toBe(4);
    expect(data.data.truncated).toBe(false);
    expect(data.data.totalAvailable).toBe(4);
    expect(data.data.hasMore).toBe(false);
  });
});
