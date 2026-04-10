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
 * - navigate waits for lifecycle settle after navigation command
 * - navigate returns success:true with url and title on successful navigation
 * - navigate returns unsupported-page error on chrome:// pages
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl, fireFrameNavigatedEvent } from "./setup/chrome-mock.js";
import { handleNavigate, toLifecycleEventName } from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

// Shared deterministic request counter — ensures consistent IDs across test files
let requestCounter = 0;
function nextRequestId(): string {
  return `test-req-${++requestCounter}`;
}

function makeRequest(payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: nextRequestId(),
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
      "Page.enable",
      undefined
    );

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.objectContaining({ url: "https://example.com/new" })
    );
  });

  it("REQ-TC-004: type:back sends Page.navigateToHistoryEntry CDP command", async () => {
    // Mock the back navigation command sequence
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Fire frameNavigated so the waiter resolves
        fireFrameNavigatedEvent((target as { tabId?: number }).tabId ?? 1);
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    await handleNavigate(request);

    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigateToHistoryEntry",
      expect.objectContaining({ entryId: 10 })
    );
  });

  it("REQ-TC-004: type:forward sends Page.navigateToHistoryEntry CDP command", async () => {
    // Mock the forward navigation command sequence
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 0, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Fire frameNavigated so the waiter resolves
        fireFrameNavigatedEvent((target as { tabId?: number }).tabId ?? 1);
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "forward" });
    await handleNavigate(request);

    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigateToHistoryEntry",
      expect.objectContaining({ entryId: 20 })
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

describe("handleNavigate — lifecycle wait", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-004: waits for lifecycle event after Page.navigate", async () => {
    const request = makeRequest({ tabId: 1, url: "https://example.com/new" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.setLifecycleEventsEnabled",
      { enabled: true }
    );
    const navigateCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method]) => method === "Page.navigate");
    expect(navigateCall).toBeDefined();
  });

  it("MCP-NAV-001: default navigate waits for DOMContentLoaded lifecycle event", async () => {
    const request = makeRequest({ tabId: 1, url: "https://example.com/dom-ready" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.setLifecycleEventsEnabled",
      { enabled: true }
    );
  });

  it("MCP-NAV-001: maps waitUntil values to the correct lifecycle event names", () => {
    expect(toLifecycleEventName("domcontentloaded")).toBe("DOMContentLoaded");
    expect(toLifecycleEventName("load")).toBe("load");
    expect(toLifecycleEventName("networkidle")).toBe("networkIdle");
  });

  it("MCP-NAV-001: reload also enables lifecycle events before waiting", async () => {
    const request = makeRequest({ tabId: 1, type: "reload" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.setLifecycleEventsEnabled",
      { enabled: true }
    );
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.reload",
      undefined
    );
  });

  it("MCP-NAV-001: back navigation uses frameNavigated waiter (not lifecycle events)", async () => {
    // Mock the back navigation command sequence
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        fireFrameNavigatedEvent((target as { tabId?: number }).tabId ?? 1);
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    await handleNavigate(request);

    // Back navigation does NOT use Page.setLifecycleEventsEnabled (that's for url/reload)
    expect(mockSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.setLifecycleEventsEnabled",
      { enabled: true }
    );
    // Back navigation uses Page.navigateToHistoryEntry via frameNavigated waiter
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigateToHistoryEntry",
      expect.objectContaining({ entryId: 10 })
    );
  });
});

describe("handleNavigate — history bounds", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("returns action-failed when no back history available (currentIndex === 0)", async () => {
    // Mock getNavigationHistory to return currentIndex === 0 (at earliest entry)
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        // At the beginning of history — cannot go back
        return { currentIndex: 0, entries: [{ id: 10 }, { id: 20 }] };
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
    // Should NOT have called navigateToHistoryEntry since there's no back entry
    expect(mockSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigateToHistoryEntry",
      expect.anything()
    );
  });

  it("returns action-failed when no forward history available (currentIndex at end)", async () => {
    // Mock getNavigationHistory to return currentIndex at the last entry
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        // At the end of history — cannot go forward
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "forward" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
    // Should NOT have called navigateToHistoryEntry since there's no forward entry
    expect(mockSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigateToHistoryEntry",
      expect.anything()
    );
  });

  it("frameNavigated waiter resolves on successful back navigation", async () => {
    // This test verifies the waiter is set up and resolves when frameNavigated fires
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method, params) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Simulate the frameNavigated event firing after navigation
        fireFrameNavigatedEvent((target as { tabId?: number }).tabId ?? 1);
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const response = await handleNavigate(request);

    // If the waiter resolved correctly, we get a successful response
    expect(response.success).toBe(true);
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
    (globalThis.chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      url: "https://example.com/new",
      active: true,
      index: 0,
      windowId: 1,
      highlighted: false,
      pinned: false,
      incognito: false,
    });
    const defaultSendCommand = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).getMockImplementation();
    (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(async (target, method, params, callback) => {
      if (method === "Page.navigate") {
        return defaultSendCommand?.(target, method, params, callback) ?? {};
      }
      if (method === "Runtime.evaluate" && (params as { expression?: string }).expression === "document.readyState") {
        return { result: { value: "complete" } };
      }
      if (method === "Runtime.evaluate" && (params as { expression?: string }).expression === "document.title") {
        return { result: { value: "New Page Title" } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", title: "New Page Title" } } };
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

  it("MCP-NAV-001: returns readyState from Runtime.evaluate after navigation settles", async () => {
    const defaultSendCommand = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).getMockImplementation();
    (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(async (target, method, params, callback) => {
      if (method === "Page.navigate") {
        return defaultSendCommand?.(target, method, params, callback) ?? {};
      }
      if (method === "Runtime.evaluate" && (params as { expression?: string }).expression === "document.readyState") {
        return { result: { value: "interactive" } };
      }
      if (method === "Runtime.evaluate" && (params as { expression?: string }).expression === "document.title") {
        return { result: { value: "Settled Title" } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", title: "FrameTree Title" } } };
      return {};
    });

    const request = makeRequest({ tabId: 1, url: "https://example.com/nav-ready" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { readyState?: string; title?: string } }).data?.readyState).toBe("interactive");
    expect((response as { data?: { readyState?: string; title?: string } }).data?.title).toBe("Settled Title");
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

describe("handleNavigate — back/forward edge cases", () => {
  beforeEach(() => {
    grantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    setMockTabUrl(2, "https://example.com/other");
    grantPermission(1);
    grantPermission(2);
  });

  it("frame-navigated waiter timeout returns action-failed for type:back", async () => {
    // Mock getNavigationHistory to return valid history, but the waiter will timeout
    // because frameNavigated is never fired. We advance fake timers to trigger the timeout.
    vi.useFakeTimers();
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Do NOT fire frameNavigated — simulate timeout scenario
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const navigatePromise = handleNavigate(request);

    // Advance time past the 10-second waiter timeout
    await vi.advanceTimersByTimeAsync(11000);
    const response = await navigatePromise;

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
    vi.useRealTimers();
  });

  it("frame-navigated waiter ignores events from a different tabId", async () => {
    vi.useFakeTimers();
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        return { currentIndex: 1, entries: [{ id: 10 }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Do NOT fire frameNavigated here — we will fire it manually below
        // to properly test the waiter's tabId filtering.
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const navigatePromise = handleNavigate(request);

    // Step 1: Fire wrong-tab event — waiter should NOT resolve (filtered by tabId)
    fireFrameNavigatedEvent(1 + 999); // wrong tabId
    await vi.advanceTimersByTimeAsync(100); // process any pending callbacks

    // Step 2: Fire correct-tab event — waiter should NOW resolve
    fireFrameNavigatedEvent(1); // correct tabId
    await vi.advanceTimersByTimeAsync(100); // process waiter resolution

    const response = await navigatePromise;

    expect(response.success).toBe(true);
    vi.useRealTimers();
  });

  it("malformed navigation history (missing entries) returns action-failed for type:back", async () => {
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        // Return history with missing entries array
        return { currentIndex: 1 };
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });

  it("malformed navigation history (undefined id on entry) returns action-failed for type:back", async () => {
    vi.useFakeTimers();
    const mockSendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    mockSendCommand.mockImplementation(async (target, method) => {
      if (method === "Page.enable") return undefined;
      if (method === "Page.getNavigationHistory") {
        // Return entries with undefined id
        return { currentIndex: 1, entries: [{ id: undefined }, { id: 20 }] };
      }
      if (method === "Page.navigateToHistoryEntry") {
        // Do NOT fire frameNavigated — Chrome would likely reject the undefined
        // entryId in reality; simulate this by letting the waiter time out.
        return undefined;
      }
      return {};
    });

    const request = makeRequest({ tabId: 1, type: "back" });
    const navigatePromise = handleNavigate(request);

    // Advance time past the 10-second waiter timeout
    await vi.advanceTimersByTimeAsync(11000);
    const response = await navigatePromise;

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
    vi.useRealTimers();
  });
});
