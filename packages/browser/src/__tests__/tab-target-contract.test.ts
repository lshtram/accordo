import { describe, expect, it, vi } from "vitest";
import { buildPageUnderstandingTools } from "../page-understanding-tools.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleListPages, handleSelectPage } from "../page-tool-handlers.js";
import type { BrowserRelayLike } from "../types.js";

function createRelay(responseData: unknown): BrowserRelayLike {
  return {
    request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: responseData }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

describe("browser tab target contract", () => {
  it("list_pages and select_page surface targeting metadata to the agent layer", async () => {
    const listRelay = createRelay({
      pages: [{ tabId: 1, windowId: 9, url: "https://a.example", title: "A", active: true, isImplicitTarget: true }],
    });
    const selectRelay = createRelay({ success: true, tabId: 1, windowId: 9, isImplicitTarget: true });

    await expect(handleListPages(listRelay, {})).resolves.toEqual({
      pages: [{ tabId: 1, windowId: 9, url: "https://a.example", title: "A", active: true, isImplicitTarget: true }],
    });
    await expect(handleSelectPage(selectRelay, { tabId: 1 })).resolves.toEqual({
      success: true,
      tabId: 1,
      windowId: 9,
      isImplicitTarget: true,
    });
  });

  it("agent-facing descriptions explain per-window active state and implicit-target semantics", () => {
    const relay = createRelay({});
    const tools = buildPageUnderstandingTools(relay, new SnapshotRetentionStore(), {} as never);

    const listTool = tools.find((tool) => tool.name === "accordo_browser_list_pages");
    const pageMapTool = tools.find((tool) => tool.name === "accordo_browser_get_page_map");

    expect(listTool?.description).toContain("per-window active state");
    expect(listTool?.description).toContain("isImplicitTarget");
    expect(pageMapTool?.inputSchema.properties.tabId.description).toContain("implicit target tab");
    expect(pageMapTool?.inputSchema.properties.tabId.description).toContain("last focused window");
  });
});
