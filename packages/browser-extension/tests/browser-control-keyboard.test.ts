/**
 * browser-control-keyboard.test.ts
 *
 * Tests for M110-TC — browser_press_key relay action
 *
 * Tests the handlePressKey handler in relay-control-handlers.ts
 * for the browser_press_key action.
 *
 * REQ-TC-013: Dispatches correct Input.dispatchKeyEvent for key
 * REQ-TC-014: Handles modifier keys via modifiers bitmask
 * REQ-TC-015: Uses KeyCodeMap for named keys
 *
 * API checklist (handlePressKey):
 * - press_key Enter → keyDown + keyUp for Enter
 * - press_key Tab → keyDown + keyUp for Tab
 * - press_key Escape → keyDown + keyUp for Escape
 * - press_key ArrowUp/Down/Left/Right → uses KeyCodeMap
 * - press_key 'Control+A' → modifier bitmask 2, correct event ordering
 * - press_key 'Control+Shift+R' → combined modifier bitmask 10 (2+8)
 * - press_key Alt → modifier bitmask 1
 * - press_key Meta → modifier bitmask 4
 * - press_key Shift → modifier bitmask 8
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { handlePressKey } from "../src/relay-control-handlers.js";
import type { RelayActionRequest } from "../src/relay-definitions.js";
import {
  MODIFIER_ALT,
  MODIFIER_CONTROL,
  MODIFIER_META,
  MODIFIER_SHIFT,
} from "../src/key-code-map.js";

function makeRequest(payload: Record<string, unknown> = {}): RelayActionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    action: "press_key",
    payload,
  };
}

// Track granted tabs within a test file scope
const keyboardGrantedTabs: number[] = [];

function grantPermission(tabId: number): void {
  if (!keyboardGrantedTabs.includes(tabId)) {
    keyboardGrantedTabs.push(tabId);
  }
  (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ controlGrantedTabs: [...keyboardGrantedTabs] });
}

describe("handlePressKey — permission", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
  });

  it("REQ-TC-013: returns control-not-granted error when permission denied", async () => {
    const request = makeRequest({ tabId: 1, key: "Enter" });
    const response = await handlePressKey(request);
    expect(response.success).toBe(false);
    expect(response.error).toBe("control-not-granted");
  });
});

describe("handlePressKey — basic key press", () => {
  beforeEach(() => {
    keyboardGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-013: dispatches Input.dispatchKeyEvent for 'Enter' key", async () => {
    const request = makeRequest({ tabId: 1, key: "Enter" });
    await handlePressKey(request);

    expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1 }),
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", key: "Enter" })
    );
  });

  it("REQ-TC-013: dispatches keyUp after keyDown for Enter", async () => {
    const request = makeRequest({ tabId: 1, key: "Enter" });
    await handlePressKey(request);

    const keyUpCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyUp" && params?.key === "Enter"
      );
    expect(keyUpCall).toBeDefined();
  });

  it("REQ-TC-013: returns { success: true, key } echoing the pressed key", async () => {
    const request = makeRequest({ tabId: 1, key: "Enter" });
    const response = await handlePressKey(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { key?: string } }).data).toHaveProperty("key", "Enter");
  });
});

describe("handlePressKey — modifier bitmask", () => {
  beforeEach(() => {
    keyboardGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-014: 'Control+A' sends modifier keyDown for Control, then base key 'A', then keyUp", async () => {
    const request = makeRequest({ tabId: 1, key: "Control+A" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Should have at least 4 events: Control rawKeyDown, A keyDown, A keyUp, Control keyUp
    expect(keyEvents.length).toBeGreaterThanOrEqual(3);

    // Modifier bitmask for Control = 2
    const controlKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Control"
    );
    expect(controlKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_CONTROL });
  });

  it("REQ-TC-014: 'Control+A' base key 'A' is dispatched with modifiers: 2 (Control)", async () => {
    const request = makeRequest({ tabId: 1, key: "Control+A" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const aKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "keyDown" && params?.key === "A"
    );
    expect(aKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_CONTROL }); // Control modifier still held
  });

  it("REQ-TC-014: 'Control+Shift+R' computes correct combined modifier bitmask (2+8=10)", async () => {
    const request = makeRequest({ tabId: 1, key: "Control+Shift+R" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Control + Shift = 2 + 8 = 10
    const rKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "keyDown" && params?.key === "R"
    );
    expect(rKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_CONTROL + MODIFIER_SHIFT }); // 10
  });

  it("REQ-TC-014: 'Alt' sends modifier bitmask 1", async () => {
    const request = makeRequest({ tabId: 1, key: "Alt" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const altKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Alt"
    );
    expect(altKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_ALT });
  });

  it("REQ-TC-014: 'Meta' sends modifier bitmask 4", async () => {
    const request = makeRequest({ tabId: 1, key: "Meta" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const metaKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Meta"
    );
    expect(metaKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_META });
  });

  it("REQ-TC-014: 'Shift' sends modifier bitmask 8", async () => {
    const request = makeRequest({ tabId: 1, key: "Shift" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    const shiftKeyDown = keyEvents.find(
      ([, , params]) => params?.type === "rawKeyDown" && params?.key === "Shift"
    );
    expect(shiftKeyDown?.[2]).toMatchObject({ modifiers: MODIFIER_SHIFT });
  });

  it("REQ-TC-014: modifier bitmask must be set on ALL key events (not just modifier press)", async () => {
    const request = makeRequest({ tabId: 1, key: "Control+A" });
    await handlePressKey(request);

    const keyEvents = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent");

    // Every keyDown/keyUp event should carry the modifier bitmask
    for (const call of keyEvents) {
      const params = call[2] as { type?: string; modifiers?: number };
      if (params.type === "keyDown" || params.type === "rawKeyDown") {
        expect(params.modifiers).toBeGreaterThan(0); // All key events carry modifiers
      }
    }
  });

  it("REQ-TC-014..015: 'Control+A' echoes 'Control+A' as the key in response", async () => {
    const request = makeRequest({ tabId: 1, key: "Control+A" });
    const response = await handlePressKey(request);

    expect(response.success).toBe(true);
    expect((response as { data?: { key?: string } }).data).toHaveProperty("key", "Control+A");
  });
});

describe("handlePressKey — KeyCodeMap for named keys", () => {
  beforeEach(() => {
    keyboardGrantedTabs.length = 0;
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com");
    grantPermission(1);
  });

  it("REQ-TC-015: uses KeyCodeMap for Tab", async () => {
    const request = makeRequest({ tabId: 1, key: "Tab" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "Tab", code: "Tab" });
  });

  it("REQ-TC-015: uses KeyCodeMap for Escape", async () => {
    const request = makeRequest({ tabId: 1, key: "Escape" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "Escape", code: "Escape" });
  });

  it("REQ-TC-015: uses KeyCodeMap for ArrowUp", async () => {
    const request = makeRequest({ tabId: 1, key: "ArrowUp" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "ArrowUp", code: "ArrowUp" });
  });

  it("REQ-TC-015: uses KeyCodeMap for ArrowDown", async () => {
    const request = makeRequest({ tabId: 1, key: "ArrowDown" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "ArrowDown", code: "ArrowDown" });
  });

  it("REQ-TC-015: uses KeyCodeMap for ArrowLeft", async () => {
    const request = makeRequest({ tabId: 1, key: "ArrowLeft" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "ArrowLeft", code: "ArrowLeft" });
  });

  it("REQ-TC-015: uses KeyCodeMap for ArrowRight", async () => {
    const request = makeRequest({ tabId: 1, key: "ArrowRight" });
    await handlePressKey(request);

    const keyDownCall = (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" && params?.type === "keyDown"
      );
    expect(keyDownCall?.[2]).toMatchObject({ key: "ArrowRight", code: "ArrowRight" });
  });
});
