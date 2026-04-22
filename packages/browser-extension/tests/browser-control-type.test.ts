/**
 * browser-control-type.test.ts
 *
 * Tests for M110-TC — browser_type relay action
 *
 * Tests the handleType handler in relay-control-handlers.ts
 * for the browser_type action.
 *
 * REQ-TC-009: Resolves uid to input area coordinates via RESOLVE_ELEMENT_COORDS
 * REQ-TC-010: Uses Input.insertText to insert full string at once
 * REQ-TC-011: PERMISSION_REQUIRED if tab not granted for type
 * REQ-TC-012: Supports submitKey option (Enter, Tab, Escape)
 *
 * API checklist (handleType):
 * - type text into element via uid → TYPE_IN_ELEMENT in main frame
 * - type text via selector → TYPE_IN_ELEMENT with selector
 * - type with clearFirst → dispatches Ctrl+A then Delete before typing
 * - type with delay between chars → optional delay between key events
 * - type with submitKey → dispatches keyDown+keyUp for the submit key after typing
 * - type element-not-found → returns element-not-found error
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { handleType } from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";

function makeRequest(payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    action: "type",
    payload,
  };
}

// Track granted tabs within a test file scope
const typeGrantedTabs: number[] = [];

function grantPermission(tabId: number): void {
  if (!typeGrantedTabs.includes(tabId)) {
    typeGrantedTabs.push(tabId);
  }
  (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [...typeGrantedTabs] });
}

describe("handleType — permission", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-011: returns control-not-granted error when permission denied", async () => {
    const request = makeRequest({ tabId: 1, text: "hello world" });
    const response = await handleType(request);
    expect(response.success).toBe(false);
    expect(response.error).toBe("control-not-granted");
  });
});

describe("handleType — uid resolution", () => {
  beforeEach(() => {
    typeGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-009: types into uid target via TYPE_IN_ELEMENT", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ typed: true });

    const request = makeRequest({ tabId: 1, text: "hello", uid: "input-name" });
    await handleType(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "TYPE_IN_ELEMENT", uid: "input-name", text: "hello" }),
      { frameId: 0 }
    );
  });

  it("REQ-TC-009: returns element-not-found error when uid resolves to not-found", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "not-found",
    });

    const request = makeRequest({ tabId: 1, text: "hello", uid: "non-existent-uid" });
    const response = await handleType(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("element-not-found");
  });

  it("REQ-TC-011: returns element-not-focusable error when target cannot receive text", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "not-focusable",
    });

    const request = makeRequest({ tabId: 1, text: "hello", uid: "non-focusable-target" });
    const response = await handleType(request);

    expect(response.success).toBe(false);
    expect(response.error).toBe("element-not-focusable");
  });
});

describe("handleType — selector resolution", () => {
  beforeEach(() => {
    typeGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-009: uses selector as alternative to uid for TYPE_IN_ELEMENT", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ typed: true });

    const request = makeRequest({ tabId: 1, text: "hello", selector: "#username-input" });
    await handleType(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "TYPE_IN_ELEMENT", selector: "#username-input", text: "hello" }),
      { frameId: 0 }
    );
  });
});

describe("handleType — text insertion", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-010: uses Input.insertText to insert the full string at once", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "hello world" });
    await handleType(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Input.insertText",
      expect.objectContaining({ text: "hello world" })
    );
  });

  it("REQ-TC-010: text can contain Unicode and emoji", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "héllo wörld 🔥" });
    await handleType(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Input.insertText",
      expect.objectContaining({ text: "héllo wörld 🔥" })
    );
  });
});

describe("handleType — clearFirst", () => {
  beforeEach(() => {
    typeGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-010: clearFirst:true dispatches Ctrl+A then Delete before typing", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "new content", clearFirst: true });
    await handleType(request);

    const keyEventCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const ctrlKeyDownIndex = keyEventCalls.findIndex(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Control"
    );
    const aKeyDownIndex = keyEventCalls.findIndex(
      ([, , params]) => params?.type === "keyDown" && params?.key === "a" && params?.code === "KeyA"
    );
    const aKeyUpIndex = keyEventCalls.findIndex(
      ([, , params]) => params?.type === "keyUp" && params?.key === "a" && params?.code === "KeyA"
    );
    const ctrlKeyUpIndex = keyEventCalls.findIndex(
      ([, , params]) => params?.type === "keyUp" && params?.key === "Control"
    );
    const deleteKeyDownIndex = keyEventCalls.findIndex(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Delete"
    );

    expect(ctrlKeyDownIndex).toBeGreaterThanOrEqual(0);
    expect(aKeyDownIndex).toBeGreaterThan(ctrlKeyDownIndex);
    expect(aKeyUpIndex).toBeGreaterThan(aKeyDownIndex);
    expect(ctrlKeyUpIndex).toBeGreaterThan(aKeyUpIndex);
    expect(deleteKeyDownIndex).toBeGreaterThan(ctrlKeyUpIndex);
  });
});

describe("handleType — submitKey", () => {
  beforeEach(() => {
    typeGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-012: submitKey:'Enter' dispatches Enter keydown+keyup after insertText", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "hello", submitKey: "Enter" });
    await handleType(request);

    const keyEventCalls = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Should have keyDown and keyUp for Enter
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
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "hello", submitKey: "Tab" });
    await handleType(request);

    const tabKeyUp = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.key === "Tab" && params?.type === "keyUp"
      );
    expect(tabKeyUp).toBeDefined();
  });

  it("REQ-TC-012: submitKey:'Escape' dispatches Escape keydown+keyup after insertText", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      x: 200,
      y: 150,
      bounds: { x: 100, y: 100, width: 200, height: 40 },
      inViewport: true,
    });

    const request = makeRequest({ tabId: 1, text: "hello", submitKey: "Escape" });
    await handleType(request);

    const escKeyUp = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.key === "Escape" && params?.type === "keyUp"
      );
    expect(escKeyUp).toBeDefined();
  });
});

describe("handleType — element focus", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-009: targeted typing no longer depends on separate focus call", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ typed: true });

    const request = makeRequest({ tabId: 1, text: "hello", uid: "input-field" });
    await handleType(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ type: "TYPE_IN_ELEMENT", uid: "input-field", text: "hello" }),
      { frameId: 0 }
    );
  });

  it("REQ-TC-009: resolves element coordinates in the main frame", async () => {
    (globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ typed: true });

    const request = makeRequest({ tabId: 1, text: "hello", selector: "textarea#APjFqb" });
    await handleType(request);

    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: "TYPE_IN_ELEMENT",
        selector: "textarea#APjFqb",
        text: "hello",
      }),
      { frameId: 0 }
    );
  });
});
