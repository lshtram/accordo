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
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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

      if (options?.frameId === 7 && (message as { action?: string }).action === "get_page_map") {
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
    vi.stubGlobal("document", undefined);
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

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

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

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

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
      if (options?.frameId === 9 && (message as { action?: string }).action === "get_page_map") {
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
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

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

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

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

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

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

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
    let response;
    try {
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    const data = response.data as { iframes: Array<{ nodes?: unknown[] }>; nodes: unknown[] };
    expect(data.nodes).toEqual([]);
    expect(data.iframes[0]?.nodes).toEqual([{ ref: "c3", tag: "div", nodeId: 0, text: "origin fallback child" }]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Feature 12: iframe-cross-origin contract for frame-targeted page-understanding
// ════════════════════════════════════════════════════════════════════════════════

describe("Feature 12: iframe-cross-origin contract for frameId-targeted requests", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * F12: When frameId targets a cross-origin iframe, the relay returns
   * error "iframe-cross-origin" (not generic "action-failed").
   */
  it("F12: inspect_element with cross-origin frameId returns iframe-cross-origin error", async () => {
    const request = {
      requestId: "f12-1",
      action: "inspect_element" as const,
      payload: { tabId: 1, ref: "btn", frameId: "cross-frame" },
    };

    // Mock: get_page_map returns cross-origin iframe metadata
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleInspectElement } = await import("../src/relay-page-handlers.js");
      response = await handleInspectElement(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(false);
    expect(response.error).toBe("iframe-cross-origin");
  });

  /**
   * F12: When frameId targets a same-origin iframe, the action is forwarded
   * to the child frame without error.
   */
  it("F12: inspect_element with same-origin frameId forwards to child frame", async () => {
    const request = {
      requestId: "f12-2",
      action: "inspect_element" as const,
      payload: { tabId: 1, ref: "btn", frameId: "child-frame" },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 7, parentFrameId: 0, url: "https://example.com/child" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
                  src: "https://example.com/child",
                  bounds: { x: 0, y: 0, width: 300, height: 200 },
                  sameOrigin: true,
                },
              ],
            },
          };
        }
      }
      if (options?.frameId === 7 && (message as { action?: string }).action === "inspect_element") {
        return {
          data: {
            found: true,
            anchorKey: "btn:50%x50%",
            anchorStrategy: "ref",
            anchorConfidence: "high",
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleInspectElement } = await import("../src/relay-page-handlers.js");
      response = await handleInspectElement(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found", true);
  });

  /**
   * F12: When frameId is not found in iframe metadata, returns action-failed.
   */
  it("F12: inspect_element with unknown frameId returns action-failed", async () => {
    const request = {
      requestId: "f12-3",
      action: "inspect_element" as const,
      payload: { tabId: 1, ref: "btn", frameId: "nonexistent-frame" },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
              iframes: [],
            },
          };
        }
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleInspectElement } = await import("../src/relay-page-handlers.js");
      response = await handleInspectElement(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });

  /**
   * F12: When frameId is omitted, behavior is unchanged (main frame).
   */
  it("F12: inspect_element without frameId targets main frame", async () => {
    const request = {
      requestId: "f12-4",
      action: "inspect_element" as const,
      payload: { tabId: 1, ref: "btn" },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        return {
          data: {
            found: true,
            anchorKey: "btn:50%x50%",
            anchorStrategy: "ref",
            anchorConfidence: "high",
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleInspectElement } = await import("../src/relay-page-handlers.js");
      response = await handleInspectElement(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found", true);
    // Should NOT call get_page_map (no traverseFrames needed)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("F12: get_text_map without frameId targets main frame", async () => {
    const request = {
      requestId: "f12-4b",
      action: "get_text_map" as const,
      payload: { tabId: 1 },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        return {
          data: {
            segments: [{ text: "main frame", bounds: { x: 0, y: 0, width: 10, height: 10 }, visible: true, role: "main" }],
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetTextMap } = await import("../src/relay-page-handlers.js");
      response = await handleGetTextMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("segments");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("PAG-03 passthrough: get_page_map preserves content-script response when metadata is omitted", async () => {
    const request = {
      requestId: "pag-page-1",
      action: "get_page_map" as const,
      payload: { tabId: 1, interactiveOnly: true, offset: 0, limit: 5 },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
            nodes: Array.from({ length: 92 }, (_, i) => ({ uid: `n${i}` })),
            totalElements: 1258,
            truncated: false,
            filterSummary: {
              activeFilters: ["interactiveOnly"],
              totalBeforeFilter: 618,
              totalAfterFilter: 92,
              reductionRatio: 0.85,
            },
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetPageMap } = await import("../src/relay-page-handlers.js");
      response = await handleGetPageMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("nodes");
    expect((response.data as { nodes: unknown[] }).nodes).toHaveLength(92);
    expect((response.data as Record<string, unknown>).hasMore).toBeUndefined();
    expect((response.data as Record<string, unknown>).totalAvailable).toBeUndefined();
    expect((response.data as Record<string, unknown>).nextOffset).toBeUndefined();
  });

  it("PAG-03 passthrough: get_text_map preserves content-script response when metadata is omitted", async () => {
    const request = {
      requestId: "pag-text-1",
      action: "get_text_map" as const,
      payload: { tabId: 1, maxSegments: 50, offset: 0, limit: 10 },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
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
            segments: Array.from({ length: 50 }, (_, i) => ({ text: `seg${i}` })),
            totalSegments: 675,
            truncated: true,
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetTextMap } = await import("../src/relay-page-handlers.js");
      response = await handleGetTextMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("segments");
    expect((response.data as { segments: unknown[] }).segments).toHaveLength(50);
    expect((response.data as Record<string, unknown>).hasMore).toBeUndefined();
    expect((response.data as Record<string, unknown>).totalAvailable).toBeUndefined();
    expect((response.data as Record<string, unknown>).nextOffset).toBeUndefined();
  });

  /**
   * F12: get_dom_excerpt with cross-origin frameId returns iframe-cross-origin error.
   */
  it("F12: get_dom_excerpt with cross-origin frameId returns iframe-cross-origin error", async () => {
    const request = {
      requestId: "f12-5",
      action: "get_dom_excerpt" as const,
      payload: { tabId: 1, selector: "body", frameId: "cross-frame" },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetDomExcerpt } = await import("../src/relay-page-handlers.js");
      response = await handleGetDomExcerpt(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(false);
    expect(response.error).toBe("iframe-cross-origin");
  });

  /**
   * F12: get_text_map with same-origin frameId forwards to child frame.
   */
  it("F12: get_text_map with same-origin frameId forwards to child frame", async () => {
    const request = {
      requestId: "f12-6",
      action: "get_text_map" as const,
      payload: { tabId: 1, frameId: "child-frame" },
    };

    (chrome.webNavigation.getAllFrames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/parent" },
      { frameId: 9, parentFrameId: 0, url: "https://example.com/child" },
    ]);

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
                  src: "https://example.com/child",
                  bounds: { x: 0, y: 0, width: 300, height: 200 },
                  sameOrigin: true,
                },
              ],
            },
          };
        }
      }
      if (options?.frameId === 9 && (message as { action?: string }).action === "get_text_map") {
        return {
          data: {
            segments: [{ text: "Hello from iframe", bounds: { x: 0, y: 0, width: 300, height: 200 }, visible: true, role: "main" }],
          },
        };
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetTextMap } = await import("../src/relay-page-handlers.js");
      response = await handleGetTextMap(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("segments");
  });

  /**
   * F12: get_semantic_graph with cross-origin frameId returns iframe-cross-origin error.
   */
  it("F12: get_semantic_graph with cross-origin frameId returns iframe-cross-origin error", async () => {
    const request = {
      requestId: "f12-7",
      action: "get_semantic_graph" as const,
      payload: { tabId: 1, frameId: "cross-frame" },
    };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { type?: string }).type === "PAGE_UNDERSTANDING_ACTION") {
        if (message.action === "get_page_map") {
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
      }
      throw new Error(`Unexpected sendMessage call: ${JSON.stringify({ message, options })}`);
    });

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    let response;
    try {
      const { handleGetSemanticGraph } = await import("../src/relay-page-handlers.js");
      response = await handleGetSemanticGraph(request);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(response.success).toBe(false);
    expect(response.error).toBe("iframe-cross-origin");
  });
});
