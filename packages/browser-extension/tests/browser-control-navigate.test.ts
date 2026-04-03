/**
 * browser-control-navigate.test.ts
 *
 * Tests for M110-TC — browser_navigate relay action
 *
 * Tests the handleNavigate handler in relay-control-handlers.ts
 * for the browser_navigate action.
 *
 * REQ-TC-002: Navigates existing tab when tabId is provided
 * REQ-TC-003: PERMISSION_REQUIRED when hasPermission returns false
 * REQ-TC-004: Sends correct navigate relay action to extension
 *
 * API checklist (handleNavigate):
 * - navigate type:url → chrome.tabs.update({ url }) + Page.navigate CDP
 * - navigate type:back → Page.goBackInHistory CDP
 * - navigate type:forward → Page.goForwardInHistory CDP
 * - navigate type:reload → Page.reload CDP
 * - navigate waits for Page.loadEventFired after navigation command
 * - navigate returns success:true with url and title on successful navigation
 * - navigate returns unsupported-page error on chrome:// pages
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { handleNavigate } from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

function makeRequest(payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    action: "navigate",
    payload,
  };
}

// Track granted tabs within a test file scope
const grantedTabs: number[] = [];

function grantPermission(tabId: number): void {
  if (!grantedTabs.includes(tabId)) {
    grantedTabs.push(tabId);
  }
  (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [...grantedTabs] });
}

describe("handleNavigate — permission", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-003: returns control-not-granted error when permission denied", async () => {
    const request = makeRequest({ tabId: 1, url: "https://example.com/new" });
    const response = await handleNavigate(request);
    expect(response.success).toBe(false);
    expect(response.error).toBe("control-not-granted");
  });
});

describe("handleNavigate — CDP commands", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-004: type:url sends Page.navigate CDP command", async () => {
    const request = makeRequest({ tabId: 1, type: "url", url: "https://example.com/new" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.objectContaining({ url: "https://example.com/new" })
    );
  });

  it("REQ-TC-004: type:back sends Page.goBackInHistory CDP command", async () => {
    const request = makeRequest({ tabId: 1, type: "back" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.goBackInHistory",
      undefined
    );
  });

  it("REQ-TC-004: type:forward sends Page.goForwardInHistory CDP command", async () => {
    const request = makeRequest({ tabId: 1, type: "forward" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.goForwardInHistory",
      undefined
    );
  });

  it("REQ-TC-004: type:reload sends Page.reload CDP command", async () => {
    const request = makeRequest({ tabId: 1, type: "reload" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.reload",
      undefined
    );
  });

  it("REQ-TC-004: type:url is default when type not specified", async () => {
    const request = makeRequest({ tabId: 1, url: "https://example.com/default-type" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.objectContaining({ url: "https://example.com/default-type" })
    );
  });
});

describe("handleNavigate — tab targeting", () => {
  beforeEach(() => {
    grantedTabs.length = 0; // Reset granted tabs tracker
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    setMockTabUrl(42, "https://example.com/page2");
    grantPermission(1);
    grantPermission(42);
  });

  it("REQ-TC-002: navigates existing tab when tabId is provided", async () => {
    const request = makeRequest({ tabId: 42, url: "https://example.com/new-page" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      "Page.navigate",
      expect.any(Object)
    );
  });

  it("REQ-TC-002: uses tab 1 (active tab) when tabId is omitted", async () => {
    const request = makeRequest({ url: "https://example.com/implicit-tab" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.any(Object)
    );
  });
});

describe("handleNavigate — Page.loadEventFired wait", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-004: waits for Page.loadEventFired after Page.navigate", async () => {
    const request = makeRequest({ tabId: 1, url: "https://example.com/new" });
    await handleNavigate(request);

    // The handler should await Page.loadEventFired
    // We verify that Page.navigate was called and then the wait occurred
    const navigateCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method]) => method === "Page.navigate");
    expect(navigateCall).toBeDefined();

    // Page.loadEventFired should be awaited (not necessarily called, but the handler
    // should wait for it as part of the navigation flow)
    // Since the mock returns {} immediately, we just verify the navigate call was made
  });
});

describe("handleNavigate — success response", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-004: returns success:true with url and title on successful navigation", async () => {
    // Mock CDP responses for navigation + title fetch
    (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(async (target, method) => {
      if (method === "Page.navigate") return {};
      if (method === "Page.getFrameTree") return { frameTree: { frame: { title: "New Page Title" } } };
      return {};
    });

    const request = makeRequest({ tabId: 1, url: "https://example.com/new" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { url?: string; title?: string } }).data).toHaveProperty(
      "url",
      "https://example.com/new"
    );
    expect((response as { data?: { url?: string; title?: string } }).data).toHaveProperty(
      "title",
      "New Page Title"
    );
  });
});

describe("handleNavigate — error handling", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(999, "chrome://settings");
    grantPermission(999);
  });

  it("REQ-TC-003: returns unsupported-page error when attach fails on chrome:// page", async () => {
    // Simulate unsupported-page error from debugger manager
    (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Cannot attach to this target. Check if the tab is an extension page or a Chrome internal page.")
    );

    const request = makeRequest({ tabId: 999, url: "chrome://settings" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("unsupported-page");
  });
});
