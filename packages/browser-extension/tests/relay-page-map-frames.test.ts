import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleGetPageMap } from "../src/relay-page-handlers.js";

describe("Feature 11: service-worker frame stitching for get_page_map", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("attaches child frame nodes for same-origin iframe metadata", async () => {
    const request = {
      requestId: "r1",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 7, parentFrameId: 0, url: "https://example.com/child" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 2,
            truncated: false,
            iframes: [
              {
                frameId: "child-frame",
                src: "https://example.com/child",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: true,
              },
            ],
          },
        };
      }

      if (options?.frameId === 7) {
        return {
          data: {
            pageId: "p2",
            frameId: "child",
            snapshotId: "p2:1",
            capturedAt: "2025-01-01T00:00:01Z",
            viewport: { width: 300, height: 200, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/child",
            title: "Child",
            nodes: [{ ref: "c1", tag: "button", nodeId: 0, text: "Inside iframe" }],
            totalElements: 1,
            truncated: false,
          },
        };
      }

      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    // Force service-worker branch (no document in SW context).
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }>; nodes: unknown[] };
    expect(data.nodes).toEqual([]);
    expect(data.iframes[0]?.nodes).toEqual([{ ref: "c1", tag: "button", nodeId: 0, text: "Inside iframe" }]);
  });

  it("leaves cross-origin iframe metadata opaque", async () => {
    const request = {
      requestId: "r2",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 8, parentFrameId: 0, url: "https://other.example/child" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, _message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 1,
            truncated: false,
            iframes: [
              {
                frameId: "cross-frame",
                src: "https://other.example/child",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: false,
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected child frame request: ${JSON.stringify(options)}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }> };
    expect(data.iframes[0]?.nodes).toBeUndefined();
  });

  it("attaches child nodes for inherited-origin about:blank iframe via fallback frame matching", async () => {
    const request = {
      requestId: "r3",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 9, parentFrameId: 0, url: "about:blank" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, _message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 1,
            truncated: false,
            iframes: [
              {
                frameId: "blank-frame",
                src: "about:blank",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: true,
              },
            ],
          },
        };
      }
      if (options?.frameId === 9) {
        return {
          data: {
            nodes: [{ ref: "c2", tag: "input", nodeId: 0, text: "about blank child" }],
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify(options)}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }> };
    expect(data.iframes[0]?.nodes).toEqual([{ ref: "c2", tag: "input", nodeId: 0, text: "about blank child" }]);
  });

  it("does not attach child nodes when normalized URL matching is ambiguous", async () => {
    const request = {
      requestId: "r4",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 10, parentFrameId: 0, url: "https://example.com/child?id=1" },
      { frameId: 11, parentFrameId: 0, url: "https://example.com/child?id=2" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, _message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 2,
            truncated: false,
            iframes: [
              {
                frameId: "dup-frame",
                src: "https://example.com/child",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: true,
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected child frame request: ${JSON.stringify(options)}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }>; nodes: unknown[] };
    expect(data.iframes[0]?.nodes).toBeUndefined();
    expect(data.nodes).toEqual([]);
  });

  it("does not attach child nodes when multiple inherited-origin child frames exist", async () => {
    const request = {
      requestId: "r5",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 12, parentFrameId: 0, url: "about:blank" },
      { frameId: 13, parentFrameId: 0, url: "about:blank" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, _message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 2,
            truncated: false,
            iframes: [
              {
                frameId: "blank-frame",
                src: "about:blank",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: true,
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected child frame request: ${JSON.stringify(options)}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }>; nodes: unknown[] };
    expect(data.iframes[0]?.nodes).toBeUndefined();
    expect(data.nodes).toEqual([]);
  });

  it("attaches child nodes via unique origin-only fallback when exact URL matching is unavailable", async () => {
    const request = {
      requestId: "r6",
      action: "get_page_map" as const,
      payload: { tabId: 1, traverseFrames: true },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 14, parentFrameId: 0, url: "https://example.com/redirected-child?x=1" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, _message, options) => {
      if (options?.frameId === 0) {
        return {
          data: {
            pageId: "p1",
            frameId: "main",
            snapshotId: "p1:1",
            capturedAt: "2025-01-01T00:00:00Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            pageUrl: "https://example.com/parent",
            title: "Parent",
            nodes: [],
            totalElements: 1,
            truncated: false,
            iframes: [
              {
                frameId: "child-frame",
                src: "https://example.com/original-child?x=2",
                bounds: { x: 0, y: 0, width: 300, height: 200 },
                sameOrigin: true,
              },
            ],
          },
        };
      }
      if (options?.frameId === 14) {
        return { data: { nodes: [{ ref: "c3", tag: "div", nodeId: 0, text: "origin fallback child" }] } };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify(options)}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    const response = await handleGetPageMap(request);
    vi.stubGlobal("document", originalDocument);

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }>; nodes: unknown[] };
    expect(data.nodes).toEqual([]);
    expect(data.iframes[0]?.nodes).toEqual([{ ref: "c3", tag: "div", nodeId: 0, text: "origin fallback child" }]);
  });
});
