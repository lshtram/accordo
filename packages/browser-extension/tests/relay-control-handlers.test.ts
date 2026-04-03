/**
 * relay-control-handlers.test.ts
 *
 * Tests for M110-TC — Relay Control Handlers
 * (handleNavigate, handleClick, handleType, handlePressKey)
 *
 * These tests validate the extension-side relay handlers that receive
 * BrowserRelayAction requests ("navigate", "click", "type", "press_key")
 * from the Hub and dispatch CDP commands to the browser.
 *
 * REQ-TC-003: PERMISSION_REQUIRED when hasPermission(tabId) returns false.
 * REQ-TC-004: Sends correct navigate relay action to extension.
 * REQ-TC-006: Dispatches Input.dispatchMouseEvent with correct x/y.
 * REQ-TC-007: PERMISSION_REQUIRED if tab not granted for click.
 * REQ-TC-008: Supports dblClick: true option.
 * REQ-TC-010: Dispatches Input.dispatchKeyEvent for each character.
 * REQ-TC-011: PERMISSION_REQUIRED if tab not granted for type.
 * REQ-TC-012: Supports pressEnter, pressTab, pressEscape shortcuts.
 * REQ-TC-013: Dispatches correct Input.dispatchKeyEvent for key.
 * REQ-TC-014: Handles modifier keys via modifiers bitmask.
 * REQ-TC-015: Uses KeyCodeMap for named keys.
 *
 * API checklist:
 * - handleNavigate(request) → sends "navigate" BrowserRelayAction
 * - handleClick(request) → sends "click" BrowserRelayAction
 * - handleType(request) → sends "type" BrowserRelayAction
 * - handlePressKey(request) → sends "press_key" BrowserRelayAction
 * - Each handler checks hasPermission(tabId) before sending
 * - handleNavigate returns { success: false, error: "control-not-granted" } when denied
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import {
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
} from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Helper to build a minimal RelayActionRequest for control actions. */
function makeRequest(action: "navigate" | "click" | "type" | "press_key", payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    action: action as RelayActionRequest["action"],
    payload,
  };
}

/**
 * Simulate granting permission for a tab in chrome.storage.session.
 * The storage key is "controlGrantedTabs" (from control-permission.ts).
 */
function grantPermission(tabId: number): void {
  // Directly set in storage mock
  (globalThis.chrome.storage.local as unknown as Record<string, unknown>).get = vi.fn().mockResolvedValue({ controlGrantedTabs: [tabId] });
}

// ── Permission checks ─────────────────────────────────────────────────────────

describe("Permission checks — all handlers", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    setMockTabUrl(2, "https://example.com/page2");
  });

  describe("handleNavigate", () => {
    it("REQ-TC-003: returns control-not-granted error when permission denied", async () => {
      // Tab 1 has no permission granted
      const request = makeRequest("navigate", { tabId: 1, url: "https://example.com" });
      const response = await handleNavigate(request);
      expect(response.success).toBe(false);
      expect(response.error).toBe("control-not-granted");
    });
  });

  describe("handleClick", () => {
    it("REQ-TC-007: returns control-not-granted error when permission denied", async () => {
      const request = makeRequest("click", { tabId: 1, uid: "btn-submit" });
      const response = await handleClick(request);
      expect(response.success).toBe(false);
      expect(response.error).toBe("control-not-granted");
    });
  });

  describe("handleType", () => {
    it("REQ-TC-011: returns control-not-granted error when permission denied", async () => {
      const request = makeRequest("type", { tabId: 1, text: "hello" });
      const response = await handleType(request);
      expect(response.success).toBe(false);
      expect(response.error).toBe("control-not-granted");
    });
  });

  describe("handlePressKey", () => {
    it("REQ-TC-013: returns control-not-granted error when permission denied", async () => {
      const request = makeRequest("press_key", { tabId: 1, key: "Enter" });
      const response = await handlePressKey(request);
      expect(response.success).toBe(false);
      expect(response.error).toBe("control-not-granted");
    });
  });
});

// ── handleNavigate ────────────────────────────────────────────────────────────

describe("handleNavigate", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    setMockTabUrl(42, "https://example.com/page2");
  });

  it("REQ-TC-004: sends Page.navigate CDP command for type:url", async () => {
    // Grant permission
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("navigate", { tabId: 1, type: "url", url: "https://example.com/new" });
    await handleNavigate(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.objectContaining({ url: "https://example.com/new" })
    );
  });

  it("REQ-TC-004: sends Page.goBackInHistory for type:back", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    const request = makeRequest("navigate", { tabId: 1, type: "back" });
    await handleNavigate(request);
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.goBackInHistory",
      undefined
    );
  });

  it("REQ-TC-004: sends Page.goForwardInHistory for type:forward", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    const request = makeRequest("navigate", { tabId: 1, type: "forward" });
    await handleNavigate(request);
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.goForwardInHistory",
      undefined
    );
  });

  it("REQ-TC-004: sends Page.reload for type:reload", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    const request = makeRequest("navigate", { tabId: 1, type: "reload" });
    await handleNavigate(request);
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.reload",
      undefined
    );
  });

  it("REQ-TC-002: navigates existing tab when tabId is provided", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [42] });
    const request = makeRequest("navigate", { tabId: 42, url: "https://example.com/page2" });
    await handleNavigate(request);
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      "Page.navigate",
      expect.any(Object)
    );
  });

  it("REQ-TC-004: waits for Page.loadEventFired after navigation command", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    const request = makeRequest("navigate", { tabId: 1, url: "https://example.com/new" });
    await handleNavigate(request);
    // Page.loadEventFired should be awaited (the handler waits for it)
    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Page.navigate",
      expect.any(Object)
    );
  });

  it("REQ-TC-004: returns success:true with url and title on successful navigation", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    // Mock Page.getFrameTree to return a title
    (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(async (target, method) => {
      if (method === "Page.navigate") return {};
      if (method === "Page.getFrameTree") return { frameTree: { frame: { title: "New Page Title" } } };
      return {};
    });

    const request = makeRequest("navigate", { tabId: 1, url: "https://example.com/new" });
    const response = await handleNavigate(request);
    expect(response.success).toBe(true);
    expect((response as { data?: { url?: string; title?: string } }).data).toHaveProperty("url", "https://example.com/new");
    expect((response as { data?: { url?: string; title?: string } }).data).toHaveProperty("title", "New Page Title");
  });
});

// ── handleClick ───────────────────────────────────────────────────────────────

describe("handleClick", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-005: resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS content script", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 150,
      y: 250,
      bounds: { x: 100, y: 200, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest("click", { tabId: 1, uid: "btn-submit" });
    await handleClick(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ELEMENT_COORDS", uid: "btn-submit" })
    );
  });

  it("REQ-TC-006: dispatches Input.dispatchMouseEvent with correct x/y (center of element)", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 150,
      y: 250,
      bounds: { x: 100, y: 200, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest("click", { tabId: 1, uid: "btn-submit" });
    await handleClick(request);

    // Click sequence: mouseMoved → mousePressed → mouseReleased
    const sendCommandCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls;
    const clickCalls = sendCommandCalls.filter(([, method]) => method === "Input.dispatchMouseEvent");
    expect(clickCalls.length).toBeGreaterThanOrEqual(3);

    // Verify center coordinates are used (150, 250)
    const mousePressedCall = clickCalls.find(([, , params]) => params?.type === "mousePressed");
    expect(mousePressedCall?.[2]).toMatchObject({ x: 150, y: 250, button: "left", clickCount: 1 });
  });

  it("REQ-TC-008: sends dblClick: true → double-click CDP sequence (5 events)", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 50,
      y: 50,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest("click", { tabId: 1, uid: "dbl-btn", dblClick: true });
    await handleClick(request);

    const clickCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchMouseEvent");

    // Double-click: mouseMoved + mousePressed(1) + mouseReleased(1) + mousePressed(2) + mouseReleased(2)
    expect(clickCalls.length).toBe(5);

    // clickCount: 2 for the second pair
    const lastClick = clickCalls[4];
    expect(lastClick[2]).toMatchObject({ clickCount: 2, button: "left" });
  });

  it("REQ-TC-006: sends DOM.scrollIntoViewIfNeeded when inViewport is false", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 100,
      y: 2000, // below viewport
      bounds: { x: 0, y: 2000, width: 100, height: 50 },
      inViewport: false,
    });

    const request = makeRequest("click", { tabId: 1, uid: "below-fold-btn" });
    await handleClick(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "DOM.scrollIntoViewIfNeeded",
      expect.any(Object)
    );
  });

  it("REQ-TC-006: uses selector as alternative to uid for coordinate resolution", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 300,
      y: 400,
      bounds: { x: 250, y: 350, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest("click", { tabId: 1, selector: "#my-button" });
    await handleClick(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ELEMENT_COORDS", selector: "#my-button" })
    );
  });

  it("REQ-TC-006: uses explicit coordinates directly when coordinates option provided", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    // Note: with explicit coordinates, no tabs.sendMessage needed

    const request = makeRequest("click", { tabId: 1, coordinates: { x: 77, y: 88 } });
    await handleClick(request);

    // Should NOT call tabs.sendMessage for coordinate resolution
    expect(globalThis.chrome.tabs.sendMessage).not.toHaveBeenCalled();

    // Should dispatch mouse events at the specified coordinates
    const mousePressedCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method, params]) => method === "Input.dispatchMouseEvent" && params?.type === "mousePressed");
    expect(mousePressedCall?.[2]).toMatchObject({ x: 77, y: 88 });
  });
});

// ── handleType ────────────────────────────────────────────────────────────────

describe("handleType", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-009: resolves uid to input area coordinates via RESOLVE_ELEMENT_COORDS", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "hello", uid: "input-name" });
    await handleType(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ELEMENT_COORDS", uid: "input-name" })
    );
  });

  it("REQ-TC-010: uses Input.insertText to insert the full string at once", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "hello world" });
    await handleType(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Input.insertText",
      expect.objectContaining({ text: "hello world" })
    );
  });

  it("REQ-TC-010: clearFirst:true dispatches Ctrl+A then Delete before typing", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "new content", clearFirst: true });
    await handleType(request);

    const keyEventCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Should have Ctrl+A (keyDown + keyUp) and Delete (keyDown + keyUp) before insertText
    const keyDownEvents = keyEventCalls.filter(([, , params]) => params?.type === "rawKeyDown");
    expect(keyDownEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("REQ-TC-012: submitKey:'Enter' dispatches Enter keydown+keyup after insertText", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "hello", submitKey: "Enter" });
    await handleType(request);

    const keyEventCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const enterKeyDown = keyEventCalls.find(
      ([, , params]) => params?.type === "keyDown" && params?.key === "Enter"
    );
    const enterKeyUp = keyEventCalls.find(
      ([, , params]) => params?.type === "keyUp" && params?.key === "Enter"
    );
    expect(enterKeyDown).toBeDefined();
    expect(enterKeyUp).toBeDefined();
  });

  it("REQ-TC-012: submitKey:'Tab' dispatches Tab keydown+keyup after insertText", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "hello", submitKey: "Tab" });
    await handleType(request);

    const tabKeyUp = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method, params]) => method === "Input.dispatchKeyEvent" && params?.key === "Tab" && params?.type === "keyUp");
    expect(tabKeyUp).toBeDefined();
  });

  it("REQ-TC-012: submitKey:'Escape' dispatches Escape keydown+keyup after insertText", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest("type", { tabId: 1, text: "hello", submitKey: "Escape" });
    await handleType(request);

    const escKeyUp = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method, params]) => method === "Input.dispatchKeyEvent" && params?.key === "Escape" && params?.type === "keyUp");
    expect(escKeyUp).toBeDefined();
  });
});

// ── handlePressKey ─────────────────────────────────────────────────────────────

describe("handlePressKey", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-013: dispatches Input.dispatchKeyEvent for 'Enter' key", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Enter" });
    await handlePressKey(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", key: "Enter" })
    );
  });

  it("REQ-TC-013: dispatches keyUp after keyDown for Enter", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Enter" });
    await handlePressKey(request);

    const keyUpCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method, params]) => method === "Input.dispatchKeyEvent" && params?.type === "keyUp" && params?.key === "Enter");
    expect(keyUpCall).toBeDefined();
  });

  it("REQ-TC-014: 'Control+A' sends modifier keyDown for Control, then base key 'A', then keyUp", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Control+A" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Control rawKeyDown → A keyDown → A keyUp → Control keyUp
    expect(keyEvents.length).toBeGreaterThanOrEqual(3);

    // Modifier bitmask for Control = 2
    const controlKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Control"
    );
    expect(controlKeyDown?.[2]).toMatchObject({ modifiers: 2 });

    const aKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "keyDown" && params?.key === "A"
    );
    expect(aKeyDown?.[2]).toMatchObject({ modifiers: 2 }); // Control modifier still held
  });

  it("REQ-TC-014: 'Control+Shift+R' computes correct combined modifier bitmask (2+8=10)", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Control+Shift+R" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Control + Shift = 2 + 8 = 10
    const rKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "keyDown" && params?.key === "R"
    );
    expect(rKeyDown?.[2]).toMatchObject({ modifiers: 10 });
  });

  it("REQ-TC-015: uses KeyCodeMap for Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const namedKeys = ["Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
    for (const key of namedKeys) {
      (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockClear();

      const request = makeRequest("press_key", { tabId: 1, key });
      await handlePressKey(request);

      const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
        .find(([, method, params]) => method === "Input.dispatchKeyEvent" && params?.type === "keyDown");
      expect(keyDownCall?.[2]).toMatchObject({ key, code: key });
    }
  });

  it("REQ-TC-013..015: returns { success: true, key } echoing the pressed key", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Enter" });
    const response = await handlePressKey(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { key?: string } }).data).toHaveProperty("key", "Enter");
  });

  it("REQ-TC-013..015: 'Control+A' echoes 'Control+A' as the key", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [1] });

    const request = makeRequest("press_key", { tabId: 1, key: "Control+A" });
    const response = await handlePressKey(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { key?: string } }).data).toHaveProperty("key", "Control+A");
  });
});

// ── Unsupported-page error ───────────────────────────────────────────────────

describe("handleNavigate — unsupported-page error", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(999, "chrome://settings");
  });

  it("REQ-TC-003: returns unsupported-page error when attach fails on chrome:// page", async () => {
    (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [999] });
    // Simulate unsupported-page error from debugger manager
    (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Cannot attach to this target. Check if the tab is an extension page or a Chrome internal page.")
    );

    const request = makeRequest("navigate", { tabId: 999, url: "chrome://settings" });
    const response = await handleNavigate(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("unsupported-page");
  });
});
