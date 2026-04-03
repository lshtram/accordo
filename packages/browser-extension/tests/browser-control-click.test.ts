/**
 * browser-control-click.test.ts
 *
 * Tests for M110-TC — browser_click relay action
 *
 * Tests the handleClick handler in relay-control-handlers.ts
 * for the browser_click action.
 *
 * REQ-TC-005: Resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS
 * REQ-TC-006: Dispatches Input.dispatchMouseEvent with correct x/y
 * REQ-TC-007: PERMISSION_REQUIRED if tab not granted for click
 * REQ-TC-008: Supports dblClick: true option
 *
 * API checklist (handleClick):
 * - click by uid found → sends RESOLVE_ELEMENT_COORDS, dispatches mouse sequence
 * - click by uid not found → returns element-not-found error
 * - click by selector found → sends RESOLVE_ELEMENT_COORDS with selector
 * - click by selector not found → returns element-not-found error
 * - click zero-size element → returns element-not-found error
 * - click scrolls into viewport → sends DOM.scrollIntoViewIfNeeded when inViewport=false
 * - dblClick sends correct CDP sequence (5 events)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { handleClick } from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

function makeRequest(payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    action: "click",
    payload,
  };
}

// Track granted tabs within a test file scope
const clickGrantedTabs: number[] = [];

function grantPermission(tabId: number): void {
  if (!clickGrantedTabs.includes(tabId)) {
    clickGrantedTabs.push(tabId);
  }
  (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [...clickGrantedTabs] });
}

describe("handleClick — permission", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-007: returns control-not-granted error when permission denied", async () => {
    // Tab 1 has no permission granted
    const request = makeRequest({ tabId: 1, uid: "btn-submit" });
    const response = await handleClick(request);
    expect(response.success).toBe(false);
    expect(response.error).toBe("control-not-granted");
  });
});

describe("handleClick — uid resolution", () => {
  beforeEach(() => {
    clickGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-005: resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 150,
      y: 250,
      bounds: { x: 100, y: 200, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, uid: "btn-submit" });
    await handleClick(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ELEMENT_COORDS", uid: "btn-submit" })
    );
  });

  it("REQ-TC-005: returns element-not-found error when uid resolves to not-found", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "not-found",
    });

    const request = makeRequest({ tabId: 1, uid: "non-existent-uid" });
    const response = await handleClick(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("element-not-found");
  });

  it("REQ-TC-005: returns element-not-found error when uid resolves to zero-size element", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "zero-size",
    });

    const request = makeRequest({ tabId: 1, uid: "zero-size-element" });
    const response = await handleClick(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("element-not-found");
  });
});

describe("handleClick — selector resolution", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-006: uses selector as alternative to uid for coordinate resolution", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 300,
      y: 400,
      bounds: { x: 250, y: 350, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, selector: "#my-button" });
    await handleClick(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ELEMENT_COORDS", selector: "#my-button" })
    );
  });

  it("REQ-TC-006: returns element-not-found error when selector finds no element", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "not-found",
    });

    const request = makeRequest({ tabId: 1, selector: ".non-existent-class" });
    const response = await handleClick(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("element-not-found");
  });
});

describe("handleClick — CDP mouse sequence", () => {
  beforeEach(() => {
    clickGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-006: dispatches Input.dispatchMouseEvent with correct x/y (center of element)", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 150,
      y: 250,
      bounds: { x: 100, y: 200, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, uid: "btn-submit" });
    await handleClick(request);

    const clickCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchMouseEvent");

    // Verify center coordinates are used (150, 250) from resolved element
    const mousePressedCall = clickCalls.find(
      ([, , params]) => params?.type === "mousePressed" && params?.button === "left"
    );
    expect(mousePressedCall?.[2]).toMatchObject({ x: 150, y: 250, clickCount: 1 });
  });

  it("REQ-TC-006: single click sends 3 CDP events: mouseMoved + mousePressed + mouseReleased", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 50,
      y: 50,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, uid: "btn" });
    await handleClick(request);

    const clickCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchMouseEvent");

    expect(clickCalls.length).toBe(3);

    expect(clickCalls[0][2]).toMatchObject({ type: "mouseMoved" });
    expect(clickCalls[1][2]).toMatchObject({ type: "mousePressed", button: "left", clickCount: 1 });
    expect(clickCalls[2][2]).toMatchObject({ type: "mouseReleased", button: "left", clickCount: 1 });
  });
});

describe("handleClick — dblClick CDP sequence", () => {
  beforeEach(() => {
    clickGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-008: dblClick: true sends correct 5-event double-click CDP sequence", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 50,
      y: 50,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, uid: "dbl-btn", dblClick: true });
    await handleClick(request);

    const clickCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchMouseEvent");

    // Double-click: mouseMoved + mousePressed(1) + mouseReleased(1) + mousePressed(2) + mouseReleased(2)
    expect(clickCalls.length).toBe(5);

    // Event 1: mouseMoved
    expect(clickCalls[0][2]).toMatchObject({ type: "mouseMoved" });

    // Event 2: mousePressed with clickCount=1
    expect(clickCalls[1][2]).toMatchObject({ type: "mousePressed", button: "left", clickCount: 1 });

    // Event 3: mouseReleased with clickCount=1
    expect(clickCalls[2][2]).toMatchObject({ type: "mouseReleased", button: "left", clickCount: 1 });

    // Event 4: mousePressed with clickCount=2
    expect(clickCalls[3][2]).toMatchObject({ type: "mousePressed", button: "left", clickCount: 2 });

    // Event 5: mouseReleased with clickCount=2
    expect(clickCalls[4][2]).toMatchObject({ type: "mouseReleased", button: "left", clickCount: 2 });
  });
});

describe("handleClick — scroll into viewport", () => {
  beforeEach(() => {
    clickGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-006: sends DOM.scrollIntoViewIfNeeded when inViewport is false", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 100,
      y: 2000, // below viewport
      bounds: { x: 0, y: 2000, width: 100, height: 50 },
      inViewport: false,
    });

    const request = makeRequest({ tabId: 1, uid: "below-fold-btn" });
    await handleClick(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "DOM.scrollIntoViewIfNeeded",
      expect.any(Object)
    );
  });

  it("REQ-TC-006: does NOT send scrollIntoView when inViewport is true", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 100,
      y: 200, // in viewport
      bounds: { x: 0, y: 200, width: 100, height: 50 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, uid: "visible-btn" });
    await handleClick(request);

    const scrollCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "DOM.scrollIntoViewIfNeeded");
    expect(scrollCalls.length).toBe(0);
  });
});

describe("handleClick — explicit coordinates", () => {
  beforeEach(() => {
    clickGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-006: uses explicit coordinates directly when coordinates option provided", async () => {
    // With explicit coordinates, no tabs.sendMessage needed for coordinate resolution
    const request = makeRequest({ tabId: 1, coordinates: { x: 77, y: 88 } });
    await handleClick(request);

    // Should NOT call tabs.sendMessage for coordinate resolution
    expect(globalThis.chrome.tabs.sendMessage).not.toHaveBeenCalled();

    // Should dispatch mouse events at the specified coordinates
    const mousePressedCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(([, method, params]) => method === "Input.dispatchMouseEvent" && params?.type === "mousePressed");
    expect(mousePressedCall?.[2]).toMatchObject({ x: 77, y: 88 });
  });
});
