/**
 * relay-select-page-tabs-update.test.ts — tabs.update failure/indeterminate cases.
 *
 * Covers:
 *   - tabs.update rejection + probe tab exists -> action-failed
 *   - tabs.update rejection + probe tab gone -> tab-not-found
 *   - tabs.update undefined + probe tab exists -> action-failed
 *   - tabs.update undefined + probe tab gone -> tab-not-found
 *   - tabs.update wrong tab id -> action-failed (no probe)
 *   - tabs.update active !== true but id/windowId match -> success
 *   - tabs.update windowId missing -> action-failed; windows.update NOT called
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks, simulateTabNotFound } from "./setup/chrome-mock.js";

describe("handleSelectPage — tabs.update failures", () => {
  beforeEach(() => { resetChromeMocks(); });

  it("action-failed when tabs.update rejects and probe confirms tab still exists", async () => {
    chrome.tabs.update = vi.fn().mockRejectedValue(new Error("tabs.update failed"));
    chrome.tabs.get = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: false, url: "https://target.example" } as chrome.tabs.Tab);

    const result = await handleSelectPage({ requestId: "req-tf1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("tab-not-found when tabs.update rejects and probe confirms tab is gone", async () => {
    chrome.tabs.update = vi.fn().mockRejectedValue(new Error("tabs.update failed"));
    simulateTabNotFound(7);

    const result = await handleSelectPage({ requestId: "req-tf2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("action-failed when tabs.update returns undefined and probe confirms tab exists", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(undefined);
    chrome.tabs.get = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: false, url: "https://target.example" } as chrome.tabs.Tab);

    const result = await handleSelectPage({ requestId: "req-tu1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("tab-not-found when tabs.update returns undefined and probe confirms tab is gone", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(undefined);
    simulateTabNotFound(7);

    const result = await handleSelectPage({ requestId: "req-tu2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("action-failed when tabs.update resolves with wrong tab id (no probe)", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 999, windowId: 42, active: true, url: "https://wrong.example" } as chrome.tabs.Tab);
    chrome.tabs.get = vi.fn();

    const result = await handleSelectPage({ requestId: "req-tv1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });

  it("success when tabs.update resolves with stale active:false metadata", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: false, url: "https://target.example" } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 42, focused: true } as chrome.windows.Window);

    const result = await handleSelectPage({ requestId: "req-tv2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(true);
    expect(chrome.windows.update).toHaveBeenCalledWith(42, { focused: true });
  });

  it("action-failed when tabs.update resolves but windowId is missing; windows.update NOT called", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, active: true, url: "https://target.example" } as unknown as chrome.tabs.Tab);
    chrome.windows.update = vi.fn();

    const result = await handleSelectPage({ requestId: "req-wm1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });
});
