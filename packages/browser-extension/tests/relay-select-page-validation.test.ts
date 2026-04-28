/**
 * relay-select-page-validation.test.ts — Input validation + success for handleSelectPage.
 *
 * Covers:
 *   - invalid input -> invalid-request (5 cases)
 *   - success in same window
 *   - success requiring different-window focus
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("handleSelectPage — input validation", () => {
  beforeEach(() => { resetChromeMocks(); });

  it("invalid-request when tabId is not a number", async () => {
    const result = await handleSelectPage({ requestId: "req-1", action: "select_page", payload: { tabId: "7" as unknown as number } } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is a float", async () => {
    const result = await handleSelectPage({ requestId: "req-2", action: "select_page", payload: { tabId: 7.5 } } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is zero", async () => {
    const result = await handleSelectPage({ requestId: "req-3", action: "select_page", payload: { tabId: 0 } } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is negative", async () => {
    const result = await handleSelectPage({ requestId: "req-4", action: "select_page", payload: { tabId: -1 } } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is missing", async () => {
    const result = await handleSelectPage({ requestId: "req-5", action: "select_page", payload: {} } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });
});

describe("handleSelectPage — success paths", () => {
  beforeEach(() => { resetChromeMocks(); });

  it("success when tab is activated in the same window", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: true, url: "https://target.example" } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 42, focused: true } as chrome.windows.Window);

    const result = await handleSelectPage({ requestId: "req-s1", action: "select_page", payload: { tabId: 7 } } as never);

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).tabId).toBe(7);
    expect((result.data as Record<string, unknown>).windowId).toBe(42);
  });

  it("success when tab activation and window focus both confirm", async () => {
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: 7, windowId: 42, active: true, url: "https://target.example" } as chrome.tabs.Tab);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 42, focused: true } as chrome.windows.Window);

    const result = await handleSelectPage({ requestId: "req-s2", action: "select_page", payload: { tabId: 7 } } as never);

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(42, { focused: true });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
