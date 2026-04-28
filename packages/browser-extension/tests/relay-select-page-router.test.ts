/**
 * relay-select-page-router.test.ts — Router-level proof for handleSelectPage errors.
 *
 * Proves that structured error responses (tab-not-found, action-failed, invalid-request)
 * from handleSelectPage survive the generic try/catch in handleRelayAction unchanged.
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRelayAction } from "../src/relay-actions.js";
import { resetChromeMocks, simulateTabNotFound } from "./setup/chrome-mock.js";

describe("handleRelayAction with select_page — error response survival", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("structured tab-not-found survives the handleRelayAction generic catch", async () => {
    chrome.tabs.update = vi.fn().mockRejectedValue(new Error("tabs.update failed"));
    simulateTabNotFound(7);

    const result = await handleRelayAction({
      requestId: "req-r1",
      action: "select_page",
      payload: { tabId: 7 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("structured action-failed survives the handleRelayAction generic catch", async () => {
    chrome.tabs.update = vi.fn().mockRejectedValue(new Error("tabs.update failed"));
    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 7, windowId: 42, active: false, url: "https://target.example",
    } as chrome.tabs.Tab);

    const result = await handleRelayAction({
      requestId: "req-r2",
      action: "select_page",
      payload: { tabId: 7 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("invalid-request survives the handleRelayAction generic catch", async () => {
    const result = await handleRelayAction({
      requestId: "req-r3",
      action: "select_page",
      payload: { tabId: -1 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });
});