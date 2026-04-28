/**
 * relay-select-page-success.test.ts — Success paths for handleSelectPage.
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("handleSelectPage — success paths", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("success when tab is activated in the same window", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({
      id: 7, windowId: 42, active: true, url: "https://target.example",
    } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({
      id: 42, focused: true,
    } as chrome.windows.Window);

    const result = await handleSelectPage({
      requestId: "req-s1",
      action: "select_page",
      payload: { tabId: 7 },
    } as never);

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).tabId).toBe(7);
    expect((result.data as Record<string, unknown>).windowId).toBe(42);
  });

  it("success when tab activation and window focus both confirm", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({
      id: 7, windowId: 42, active: true, url: "https://target.example",
    } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({
      id: 42, focused: true,
    } as chrome.windows.Window);

    const result = await handleSelectPage({
      requestId: "req-s2",
      action: "select_page",
      payload: { tabId: 7 },
    } as never);

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(42, { focused: true });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("windows.update is NOT called when tab activation confirmation fails", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({
      id: 7, windowId: 42, active: false, // active === false → confirmation fails
    } as unknown as chrome.tabs.Tab);
    chrome.windows.update = vi.fn();

    await handleSelectPage({
      requestId: "req-nwu",
      action: "select_page",
      payload: { tabId: 7 },
    } as never);

    expect(chrome.windows.update).not.toHaveBeenCalled();
  });
});