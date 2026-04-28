/**
 * relay-select-page-windows-update.test.ts — windows.update failure/indeterminate cases.
 *
 * Covers:
 *   - windows.update rejection + probe tab exists -> action-failed
 *   - windows.update rejection + probe tab gone -> tab-not-found
 *   - windows.update undefined + probe tab exists -> action-failed
 *   - windows.update undefined + probe tab gone -> tab-not-found
 *   - windows.update wrong window id -> action-failed (no probe)
 *   - windows.update focused !== true -> action-failed (no probe)
 *   - windows.update NOT called when tab activation fails
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks, simulateTabNotFound } from "./setup/chrome-mock.js";

describe("handleSelectPage — windows.update failures", () => {
  beforeEach(() => { resetChromeMocks(); });

  const validTabUpdate = { id: 7, windowId: 42, active: true, url: "https://target.example" } as chrome.tabs.Tab;

  it("action-failed when windows.update rejects and probe confirms tab still exists", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockRejectedValue(new Error("windows.update failed"));
    chrome.tabs.get = vi.fn().mockResolvedValue(validTabUpdate);

    const result = await handleSelectPage({ requestId: "req-wf1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("tab-not-found when windows.update rejects and probe confirms tab is gone", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockRejectedValue(new Error("windows.update failed"));
    simulateTabNotFound(7);

    const result = await handleSelectPage({ requestId: "req-wf2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("action-failed when windows.update returns undefined and probe confirms tab exists", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockResolvedValue(undefined);
    chrome.tabs.get = vi.fn().mockResolvedValue(validTabUpdate);

    const result = await handleSelectPage({ requestId: "req-wu1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("tab-not-found when windows.update returns undefined and probe confirms tab is gone", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockResolvedValue(undefined);
    simulateTabNotFound(7);

    const result = await handleSelectPage({ requestId: "req-wu2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("action-failed when windows.update resolves with wrong window id", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 999, focused: true } as unknown as chrome.windows.Window);

    const result = await handleSelectPage({ requestId: "req-wv1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("action-failed when windows.update resolves but focused !== true", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue(validTabUpdate);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 42, focused: false } as unknown as chrome.windows.Window);

    const result = await handleSelectPage({ requestId: "req-wv2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("windows.update is NOT called when tab activation confirmation fails", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: false } as unknown as chrome.tabs.Tab);
    chrome.windows.update = vi.fn();

    await handleSelectPage({ requestId: "req-nwu", action: "select_page", payload: { tabId: 7 } } as never);

    expect(chrome.windows.update).not.toHaveBeenCalled();
  });
});
