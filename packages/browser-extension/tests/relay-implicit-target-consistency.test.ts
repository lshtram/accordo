import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetPageMap } from "../src/relay-get-page-map.js";
import { handleClick } from "../src/relay-control-click.js";
import { resetChromeMocks, seedStorage } from "./setup/chrome-mock.js";

describe("implicit target consistency", () => {
  beforeEach(() => {
    resetChromeMocks();
    seedStorage({ controlGrantedTabs: [11] });
  });

  it("page-understanding and control flows use the same implicit target rule", async () => {
    const activeTab = { id: 11, url: "https://focused.example", title: "Focused", active: true, windowId: 5 } as chrome.tabs.Tab;
    chrome.tabs.query = vi.fn().mockResolvedValue([activeTab]);
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({
      data: {
        pageId: "p1",
        frameId: "main",
        snapshotId: "p1:1",
        capturedAt: "2025-01-01T00:00:00Z",
        viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        pageUrl: "https://focused.example",
        title: "Focused",
        nodes: [],
        totalElements: 0,
        depth: 0,
        truncated: false,
      },
    });
    chrome.debugger.attach = vi.fn().mockResolvedValue(undefined);
    chrome.debugger.sendCommand = vi.fn().mockResolvedValue({});

    const originalDocument = globalThis.document;
    vi.stubGlobal("document", undefined);
    try {
      await handleGetPageMap({ requestId: "pg-1", action: "get_page_map", payload: {} } as never);
      await handleClick({ requestId: "clk-1", action: "click", payload: { coordinates: { x: 10, y: 20 } } } as never);
    } finally {
      vi.stubGlobal("document", originalDocument);
    }

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ action: "get_page_map" }),
      { frameId: 0 },
    );
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 11 }, expect.any(String));
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 11 }, "Input.dispatchMouseEvent", expect.any(Object));
  });
});
