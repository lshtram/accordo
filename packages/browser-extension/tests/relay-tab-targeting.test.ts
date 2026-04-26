import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleListPages, handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks, seedStorage } from "./setup/chrome-mock.js";

describe("relay tab targeting metadata", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("list_pages includes windowId and exactly one implicit target in a multi-window state", async () => {
    chrome.tabs.query = vi.fn().mockImplementation(async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo && Object.keys(queryInfo).length === 0) {
        return [
          { id: 1, url: "https://a.example", title: "A", active: true, windowId: 10 },
          { id: 2, url: "https://b.example", title: "B", active: true, windowId: 20 },
          { id: 3, url: "https://c.example", title: "C", active: false, windowId: 20 },
        ] as chrome.tabs.Tab[];
      }
      if (queryInfo?.active && queryInfo.lastFocusedWindow) {
        return [{ id: 2, url: "https://b.example", title: "B", active: true, windowId: 20 }] as chrome.tabs.Tab[];
      }
      return [] as chrome.tabs.Tab[];
    });
    seedStorage({ controlGrantedTabs: [2] });

    const response = await handleListPages({ requestId: "list-1", action: "list_pages", payload: {} } as never);

    expect(response.success).toBe(true);
    const pages = (response.data as { pages: Array<Record<string, unknown>> }).pages;
    expect(pages).toHaveLength(3);
    expect(pages.filter((page) => page.active === true)).toHaveLength(2);
    expect(pages.filter((page) => page.isImplicitTarget === true)).toHaveLength(1);
    expect(pages.find((page) => page.tabId === 2)).toMatchObject({
      windowId: 20,
      active: true,
      controlGranted: true,
      isImplicitTarget: true,
    });
  });

  it("select_page focuses the tab window and returns implicit-target metadata", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: true, url: "https://target.example" } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 42, focused: true } as chrome.windows.Window);

    const response = await handleSelectPage({ requestId: "sel-1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(42, { focused: true });
    expect(response).toMatchObject({
      success: true,
      data: { success: true, tabId: 7, windowId: 42, isImplicitTarget: true },
    });
  });
});
