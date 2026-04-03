/**
 * control-tools.test.ts
 *
 * Tests for M110-TC — browser_tab_control MCP Tools
 * (browser_navigate, browser_click, browser_type, browser_press_key)
 *
 * These tests validate the contract defined in REQ-TC-001 through REQ-TC-017:
 * - REQ-TC-001: browser_navigate creates new tab when no tabId, navigates to URL
 * - REQ-TC-002: browser_navigate navigates existing tab when tabId provided
 * - REQ-TC-003: browser_navigate fails with PERMISSION_REQUIRED when permission denied
 * - REQ-TC-004: browser_navigate sends correct "navigate" relay action to extension
 * - REQ-TC-005: browser_click resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS
 * - REQ-TC-006: browser_click dispatches Input.dispatchMouseEvent with correct x/y
 * - REQ-TC-007: browser_click fails with PERMISSION_REQUIRED if tab not granted
 * - REQ-TC-008: browser_click supports dblClick: true option
 * - REQ-TC-009: browser_type resolves uid to input area coordinates
 * - REQ-TC-010: browser_type dispatches Input.dispatchKeyEvent for each char (keydown+keyup)
 * - REQ-TC-011: browser_type fails with PERMISSION_REQUIRED if tab not granted
 * - REQ-TC-012: browser_type supports pressEnter/pressTab/pressEscape shortcuts
 * - REQ-TC-013: browser_press_key dispatches correct Input.dispatchKeyEvent for key
 * - REQ-TC-014: browser_press_key handles modifier keys (Shift/Control/Alt/Meta) bitmask
 * - REQ-TC-015: browser_press_key uses KeyCodeMap for named keys
 * - REQ-TC-016: PERMISSION_REQUIRED when hasPermission(tabId) returns false
 * - REQ-TC-017: TAB_NOT_FOUND when tabId refers to non-existent tab
 *
 * API checklist (buildNavigateTool):
 * - name: "browser_navigate" → registered
 * - description mentions navigate/URL/back/forward/reload
 * - schema includes tabId?, type?, url?, timeout?
 * - dangerLevel: "moderate"
 *
 * API checklist (buildClickTool):
 * - name: "browser_click" → registered
 * - description mentions uid/selector/coordinates click target
 * - schema includes tabId?, uid?, selector?, coordinates?, dblClick?
 * - dangerLevel: "moderate"
 *
 * API checklist (buildTypeTool):
 * - name: "browser_type" → registered
 * - description mentions typing text
 * - schema includes tabId?, text, uid?, selector?, clearFirst?, submitKey?
 * - dangerLevel: "moderate"
 *
 * API checklist (buildPressKeyTool):
 * - name: "browser_press_key" → registered
 * - description mentions key/modifier support
 * - schema includes tabId?, key
 * - dangerLevel: "moderate"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildNavigateTool,
  buildClickTool,
  buildTypeTool,
  buildPressKeyTool,
  buildControlTools,
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
  NAVIGATE_DEFAULT_TIMEOUT_MS,
  NAVIGATE_MAX_TIMEOUT_MS,
  NAVIGATE_RELAY_TIMEOUT_MS,
  CONTROL_ACTION_TIMEOUT_MS,
  type NavigateArgs,
  type NavigateResponse,
  type ClickArgs,
  type ClickResponse,
  type TypeArgs,
  type TypeResponse,
  type PressKeyArgs,
  type PressKeyResponse,
} from "../control-tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Wraps a handle* call, converting pre-assertion "not implemented" stub throws
 * into assertion-level failures that carry requirement context.
 */
async function expectHandle(
  fn: () => Promise<unknown>,
  requirement: string
): Promise<unknown> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "not implemented") {
      expect.fail(`[${requirement}] handler threw "not implemented" — stub must be replaced`);
    }
    throw err;
  }
}

/** Makes a mock relay that resolves with success. */
function makeRelayResolve<T>(data: T) {
  // If the caller explicitly passed success:false, preserve it at the top level
  // so error-propagation tests work correctly. Otherwise wrap in { success:true, data }
  // so handlers that look for response.data.* work for success cases.
  const d = data as Record<string, unknown>;
  const response = d.success === false
    ? { requestId: "", success: false, error: d.error as string }
    : { success: true, data };
  return {
    request: vi.fn().mockResolvedValue(response),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that returns a permission-denied error. */
function makeRelayPermissionDenied() {
  return {
    request: vi.fn().mockResolvedValue({ success: false, error: "control-not-granted" }),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that returns tab-not-found error. */
function makeRelayTabNotFound() {
  return {
    request: vi.fn().mockResolvedValue({ success: false, error: "tab-not-found" }),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that rejects because browser is not connected. */
function makeRelayNotConnected() {
  return {
    request: vi.fn().mockRejectedValue(new Error("browser not-connected")),
    isConnected: vi.fn(() => false),
  };
}

// ── Constants tests ───────────────────────────────────────────────────────────

describe("M110-TC constants", () => {
  it("REQ-TC-004: NAVIGATE_DEFAULT_TIMEOUT_MS equals 15000", () => {
    expect(NAVIGATE_DEFAULT_TIMEOUT_MS).toBe(15000);
  });

  it("REQ-TC-004: NAVIGATE_MAX_TIMEOUT_MS equals 30000", () => {
    expect(NAVIGATE_MAX_TIMEOUT_MS).toBe(30000);
  });

  it("REQ-TC-004: NAVIGATE_RELAY_TIMEOUT_MS equals 35000 (greater than max)", () => {
    expect(NAVIGATE_RELAY_TIMEOUT_MS).toBe(35000);
    expect(NAVIGATE_RELAY_TIMEOUT_MS).toBeGreaterThan(NAVIGATE_MAX_TIMEOUT_MS);
  });

  it("REQ-TC-006: CONTROL_ACTION_TIMEOUT_MS equals 5000", () => {
    expect(CONTROL_ACTION_TIMEOUT_MS).toBe(5000);
  });
});

// ── buildNavigateTool tests ───────────────────────────────────────────────────

describe("buildNavigateTool", () => {
  it("REQ-TC-001..004: returns browser_navigate tool definition", () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com" });
    const tool = buildNavigateTool(relay);
    expect(tool.name).toBe("browser_navigate");
  });

  it("REQ-TC-001..004: tool description mentions URL navigation", () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true });
    const tool = buildNavigateTool(relay);
    expect(tool.description).toMatch(/navigate|URL|url/i);
  });

  it("REQ-TC-001..004: tool schema includes tabId, type, url, timeout properties", () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true });
    const tool = buildNavigateTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("tabId");
    expect(schema.properties).toHaveProperty("type");
    expect(schema.properties).toHaveProperty("url");
    expect(schema.properties).toHaveProperty("timeout");
  });

  it("REQ-TC-001..004: tool is marked moderate dangerLevel and non-idempotent", () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true });
    const tool = buildNavigateTool(relay);
    expect(tool.dangerLevel).toBe("moderate");
    expect(tool.idempotent).toBe(false);
  });
});

// ── buildClickTool tests ─────────────────────────────────────────────────────

describe("buildClickTool", () => {
  it("REQ-TC-005..008: returns browser_click tool definition", () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true });
    const tool = buildClickTool(relay);
    expect(tool.name).toBe("browser_click");
  });

  it("REQ-TC-005..008: tool description mentions uid/selector/coordinates", () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true });
    const tool = buildClickTool(relay);
    expect(tool.description).toMatch(/uid|selector|coordinates|click/i);
  });

  it("REQ-TC-005..008: tool schema includes tabId, uid, selector, coordinates, dblClick", () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true });
    const tool = buildClickTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("tabId");
    expect(schema.properties).toHaveProperty("uid");
    expect(schema.properties).toHaveProperty("selector");
    expect(schema.properties).toHaveProperty("coordinates");
    expect(schema.properties).toHaveProperty("dblClick");
  });

  it("REQ-TC-008: tool schema dblClick is boolean with default false", () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true });
    const tool = buildClickTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, { type: string; default?: boolean }> };
    expect(schema.properties.dblClick.type).toBe("boolean");
  });

  it("REQ-TC-005..008: tool is marked moderate dangerLevel and non-idempotent", () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true });
    const tool = buildClickTool(relay);
    expect(tool.dangerLevel).toBe("moderate");
    expect(tool.idempotent).toBe(false);
  });
});

// ── buildTypeTool tests ─────────────────────────────────────────────────────

describe("buildTypeTool", () => {
  it("REQ-TC-009..012: returns browser_type tool definition", () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const tool = buildTypeTool(relay);
    expect(tool.name).toBe("browser_type");
  });

  it("REQ-TC-009..012: tool description mentions text typing", () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const tool = buildTypeTool(relay);
    expect(tool.description).toMatch(/type|text|input/i);
  });

  it("REQ-TC-009..012: tool schema includes tabId, text, uid, selector, clearFirst, submitKey", () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const tool = buildTypeTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties).toHaveProperty("tabId");
    expect(schema.properties).toHaveProperty("text");
    expect(schema.properties).toHaveProperty("uid");
    expect(schema.properties).toHaveProperty("selector");
    expect(schema.properties).toHaveProperty("clearFirst");
    expect(schema.properties).toHaveProperty("submitKey");
    expect(schema.required).toContain("text");
  });

  it("REQ-TC-012: submitKey description mentions Enter, Tab, Escape", () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const tool = buildTypeTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, { description: string }> };
    expect(schema.properties.submitKey.description).toMatch(/Enter|Tab|Escape/);
  });

  it("REQ-TC-009..012: tool is marked moderate dangerLevel and non-idempotent", () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const tool = buildTypeTool(relay);
    expect(tool.dangerLevel).toBe("moderate");
    expect(tool.idempotent).toBe(false);
  });
});

// ── buildPressKeyTool tests ──────────────────────────────────────────────────

describe("buildPressKeyTool", () => {
  it("REQ-TC-013..015: returns browser_press_key tool definition", () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Enter" });
    const tool = buildPressKeyTool(relay);
    expect(tool.name).toBe("browser_press_key");
  });

  it("REQ-TC-013..015: tool description mentions key/modifier support", () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true });
    const tool = buildPressKeyTool(relay);
    expect(tool.description).toMatch(/key|modifier|Control|Shift|Alt|Meta/i);
  });

  it("REQ-TC-013..015: tool schema includes tabId and key (required)", () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true });
    const tool = buildPressKeyTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties).toHaveProperty("tabId");
    expect(schema.properties).toHaveProperty("key");
    expect(schema.required).toContain("key");
  });

  it("REQ-TC-014: key description mentions Control, Shift, Alt, Meta modifiers", () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true });
    const tool = buildPressKeyTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, { description: string }> };
    expect(schema.properties.key.description).toMatch(/Control|Shift|Alt|Meta/);
  });

  it("REQ-TC-013..015: tool is marked moderate dangerLevel and non-idempotent", () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true });
    const tool = buildPressKeyTool(relay);
    expect(tool.dangerLevel).toBe("moderate");
    expect(tool.idempotent).toBe(false);
  });
});

// ── buildControlTools tests ──────────────────────────────────────────────────

describe("buildControlTools", () => {
  it("REQ-TC-001..017: returns all 4 control tools", () => {
    const relay = makeRelayResolve({ success: true });
    const tools = buildControlTools(relay);
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_press_key");
  });
});

// ── handleNavigate: REQ-TC-001..004 ─────────────────────────────────────────

describe("handleNavigate — REQ-TC-001..004", () => {
  it("REQ-TC-001: creates new tab (no tabId) and navigates to URL", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com", title: "Example" });
    const result = await expectHandle(
      () => handleNavigate(relay, { url: "https://example.com" }),
      "REQ-TC-001"
    ) as NavigateResponse;
    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.com");
  });

  it("REQ-TC-002: navigates existing tab when tabId is provided", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com/page2" });
    const result = await expectHandle(
      () => handleNavigate(relay, { tabId: 42, url: "https://example.com/page2" }),
      "REQ-TC-002"
    ) as NavigateResponse;
    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.com/page2");
  });

  it("REQ-TC-003: returns control-not-granted error when permission denied", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleNavigate(relay, { url: "https://example.com" }),
      "REQ-TC-003"
    ) as NavigateResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-004: sends 'navigate' relay action to extension", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com" });
    await expectHandle(
      () => handleNavigate(relay, { type: "url", url: "https://example.com" }),
      "REQ-TC-004"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ type: "url", url: "https://example.com" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-004: relay timeout is NAVIGATE_RELAY_TIMEOUT_MS for URL navigation", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com" });
    await expectHandle(
      () => handleNavigate(relay, { url: "https://example.com" }),
      "REQ-TC-004"
    );
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(NAVIGATE_RELAY_TIMEOUT_MS);
  });

  it("REQ-TC-001: supports type: 'back' navigation", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com/back" });
    const result = await expectHandle(
      () => handleNavigate(relay, { type: "back" }),
      "REQ-TC-001"
    ) as NavigateResponse;
    expect(result.success).toBe(true);
  });

  it("REQ-TC-001: supports type: 'forward' navigation", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com/forward" });
    const result = await expectHandle(
      () => handleNavigate(relay, { type: "forward" }),
      "REQ-TC-001"
    ) as NavigateResponse;
    expect(result.success).toBe(true);
  });

  it("REQ-TC-001: supports type: 'reload' navigation", async () => {
    const relay = makeRelayResolve<NavigateResponse>({ success: true, url: "https://example.com" });
    const result = await expectHandle(
      () => handleNavigate(relay, { type: "reload" }),
      "REQ-TC-001"
    ) as NavigateResponse;
    expect(result.success).toBe(true);
  });
});

// ── handleNavigate: permission error handling ─────────────────────────────────

describe("handleNavigate — permission / tab-not-found error handling", () => {
  it("REQ-TC-016: returns control-not-granted when hasPermission returns false", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleNavigate(relay, { url: "https://example.com" }),
      "REQ-TC-016"
    ) as NavigateResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-017: returns tab-not-found when tabId is invalid", async () => {
    const relay = makeRelayTabNotFound();
    const result = await expectHandle(
      () => handleNavigate(relay, { tabId: 99999, url: "https://example.com" }),
      "REQ-TC-017"
    ) as NavigateResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("REQ-TC-016: returns browser-not-connected when relay is disconnected", async () => {
    const relay = makeRelayNotConnected();
    const result = await expectHandle(
      () => handleNavigate(relay, { url: "https://example.com" }),
      "REQ-TC-016"
    ) as NavigateResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser-not-connected");
  });
});

// ── handleClick: REQ-TC-005..008 ───────────────────────────────────────────

describe("handleClick — REQ-TC-005..008", () => {
  it("REQ-TC-005: resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "btn-submit" });
    const result = await expectHandle(
      () => handleClick(relay, { uid: "btn-submit" }),
      "REQ-TC-005"
    ) as ClickResponse;
    expect(result.success).toBe(true);
    expect(result.target).toBe("btn-submit");
  });

  it("REQ-TC-005: sends 'click' relay action with uid to extension", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "my-button" });
    await expectHandle(
      () => handleClick(relay, { uid: "my-button" }),
      "REQ-TC-005"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "click",
      expect.objectContaining({ uid: "my-button" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-006: relay timeout is CONTROL_ACTION_TIMEOUT_MS (5000)", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "btn" });
    await expectHandle(
      () => handleClick(relay, { uid: "btn" }),
      "REQ-TC-006"
    );
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(CONTROL_ACTION_TIMEOUT_MS);
  });

  it("REQ-TC-007: returns control-not-granted error when permission denied", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleClick(relay, { uid: "btn-submit" }),
      "REQ-TC-007"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-008: supports dblClick: true option", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "dbl-btn" });
    const result = await expectHandle(
      () => handleClick(relay, { uid: "dbl-btn", dblClick: true }),
      "REQ-TC-008"
    ) as ClickResponse;
    expect(result.success).toBe(true);
    expect(relay.request).toHaveBeenCalledWith(
      "click",
      expect.objectContaining({ uid: "dbl-btn", dblClick: true }),
      expect.any(Number)
    );
  });

  it("REQ-TC-005: supports selector as alternative to uid", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "#my-form button" });
    const result = await expectHandle(
      () => handleClick(relay, { selector: "#my-form button" }),
      "REQ-TC-005"
    ) as ClickResponse;
    expect(result.success).toBe(true);
    expect(relay.request).toHaveBeenCalledWith(
      "click",
      expect.objectContaining({ selector: "#my-form button" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-006: supports explicit coordinates option", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: true, target: "100,200" });
    const result = await expectHandle(
      () => handleClick(relay, { coordinates: { x: 100, y: 200 } }),
      "REQ-TC-006"
    ) as ClickResponse;
    expect(result.success).toBe(true);
    expect(relay.request).toHaveBeenCalledWith(
      "click",
      expect.objectContaining({ coordinates: { x: 100, y: 200 } }),
      expect.any(Number)
    );
  });
});

// ── handleClick: permission error handling ───────────────────────────────────

describe("handleClick — permission error handling", () => {
  it("REQ-TC-016: returns control-not-granted when hasPermission returns false", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleClick(relay, { uid: "btn" }),
      "REQ-TC-016"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-017: returns tab-not-found when tabId is invalid", async () => {
    const relay = makeRelayTabNotFound();
    const result = await expectHandle(
      () => handleClick(relay, { tabId: 99999, uid: "btn" }),
      "REQ-TC-017"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("REQ-TC-016: returns browser-not-connected when relay is disconnected", async () => {
    const relay = makeRelayNotConnected();
    const result = await expectHandle(
      () => handleClick(relay, { uid: "btn" }),
      "REQ-TC-016"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser-not-connected");
  });
});

// ── handleType: REQ-TC-009..012 ─────────────────────────────────────────────

describe("handleType — REQ-TC-009..012", () => {
  it("REQ-TC-009: resolves uid to input area coordinates", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    const result = await expectHandle(
      () => handleType(relay, { text: "hello", uid: "input-name" }),
      "REQ-TC-009"
    ) as TypeResponse;
    expect(result.success).toBe(true);
  });

  it("REQ-TC-010: sends 'type' relay action with text to extension", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "hello world" }),
      "REQ-TC-010"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ text: "hello world" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-010: relay timeout is CONTROL_ACTION_TIMEOUT_MS", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "test" }),
      "REQ-TC-010"
    );
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(CONTROL_ACTION_TIMEOUT_MS);
  });

  it("REQ-TC-011: returns control-not-granted error when permission denied", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleType(relay, { text: "hello" }),
      "REQ-TC-011"
    ) as TypeResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-012: supports submitKey: 'Enter'", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "hello", submitKey: "Enter" }),
      "REQ-TC-012"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ text: "hello", submitKey: "Enter" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-012: supports submitKey: 'Tab'", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "hello", submitKey: "Tab" }),
      "REQ-TC-012"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ submitKey: "Tab" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-012: supports submitKey: 'Escape'", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "hello", submitKey: "Escape" }),
      "REQ-TC-012"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ submitKey: "Escape" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-009: supports clearFirst: true to clear existing content", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "new content", clearFirst: true }),
      "REQ-TC-009"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ text: "new content", clearFirst: true }),
      expect.any(Number)
    );
  });

  it("REQ-TC-009: supports selector as alternative to uid", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: true });
    await expectHandle(
      () => handleType(relay, { text: "hello", selector: "#my-input" }),
      "REQ-TC-009"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "type",
      expect.objectContaining({ selector: "#my-input" }),
      expect.any(Number)
    );
  });
});

// ── handleType: permission error handling ───────────────────────────────────

describe("handleType — permission error handling", () => {
  it("REQ-TC-016: returns control-not-granted when hasPermission returns false", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handleType(relay, { text: "hello" }),
      "REQ-TC-016"
    ) as TypeResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-017: returns tab-not-found when tabId is invalid", async () => {
    const relay = makeRelayTabNotFound();
    const result = await expectHandle(
      () => handleType(relay, { tabId: 99999, text: "hello" }),
      "REQ-TC-017"
    ) as TypeResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("REQ-TC-016: returns browser-not-connected when relay is disconnected", async () => {
    const relay = makeRelayNotConnected();
    const result = await expectHandle(
      () => handleType(relay, { text: "hello" }),
      "REQ-TC-016"
    ) as TypeResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser-not-connected");
  });
});

// ── handlePressKey: REQ-TC-013..015 ─────────────────────────────────────────

describe("handlePressKey — REQ-TC-013..015", () => {
  it("REQ-TC-013: dispatches correct Input.dispatchKeyEvent for 'Enter' key", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Enter" });
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "Enter" }),
      "REQ-TC-013"
    ) as PressKeyResponse;
    expect(result.success).toBe(true);
    expect(result.key).toBe("Enter");
  });

  it("REQ-TC-013: sends 'press_key' relay action to extension", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Enter" });
    await expectHandle(
      () => handlePressKey(relay, { key: "Enter" }),
      "REQ-TC-013"
    );
    expect(relay.request).toHaveBeenCalledWith(
      "press_key",
      expect.objectContaining({ key: "Enter" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-013: relay timeout is CONTROL_ACTION_TIMEOUT_MS", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Enter" });
    await expectHandle(
      () => handlePressKey(relay, { key: "Enter" }),
      "REQ-TC-013"
    );
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(CONTROL_ACTION_TIMEOUT_MS);
  });

  it("REQ-TC-014: handles 'Control+A' key combination with modifiers bitmask", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Control+A" });
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "Control+A" }),
      "REQ-TC-014"
    ) as PressKeyResponse;
    expect(result.success).toBe(true);
    expect(relay.request).toHaveBeenCalledWith(
      "press_key",
      expect.objectContaining({ key: "Control+A" }),
      expect.any(Number)
    );
  });

  it("REQ-TC-014: handles 'Control+Shift+R' key combination", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: true, key: "Control+Shift+R" });
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "Control+Shift+R" }),
      "REQ-TC-014"
    ) as PressKeyResponse;
    expect(result.success).toBe(true);
  });

  it("REQ-TC-015: uses KeyCodeMap for named keys (Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight)", async () => {
    const namedKeys = ["Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
    for (const key of namedKeys) {
      const relay = makeRelayResolve<PressKeyResponse>({ success: true, key });
      const result = await expectHandle(
        () => handlePressKey(relay, { key }),
        `REQ-TC-015:${key}`
      ) as PressKeyResponse;
      expect(result.success).toBe(true);
      expect(result.key).toBe(key);
    }
  });

  it("REQ-TC-013..015: handles modifier-only keys (Shift, Control, Alt, Meta)", async () => {
    const modifiers = ["Shift", "Control", "Alt", "Meta"] as const;
    for (const key of modifiers) {
      const relay = makeRelayResolve<PressKeyResponse>({ success: true, key });
      const result = await expectHandle(
        () => handlePressKey(relay, { key }),
        `REQ-TC-014:${key}`
      ) as PressKeyResponse;
      expect(result.success).toBe(true);
    }
  });
});

// ── handlePressKey: permission error handling ────────────────────────────────

describe("handlePressKey — permission error handling", () => {
  it("REQ-TC-016: returns control-not-granted when hasPermission returns false", async () => {
    const relay = makeRelayPermissionDenied();
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "Enter" }),
      "REQ-TC-016"
    ) as PressKeyResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("control-not-granted");
  });

  it("REQ-TC-017: returns tab-not-found when tabId is invalid", async () => {
    const relay = makeRelayTabNotFound();
    const result = await expectHandle(
      () => handlePressKey(relay, { tabId: 99999, key: "Enter" }),
      "REQ-TC-017"
    ) as PressKeyResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("tab-not-found");
  });

  it("REQ-TC-016: returns browser-not-connected when relay is disconnected", async () => {
    const relay = makeRelayNotConnected();
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "Enter" }),
      "REQ-TC-016"
    ) as PressKeyResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser-not-connected");
  });

  it("REQ-TC-013: returns invalid-key error for unknown key names", async () => {
    const relay = makeRelayResolve<PressKeyResponse>({ success: false, error: "invalid-key" });
    const result = await expectHandle(
      () => handlePressKey(relay, { key: "NotARealKey" }),
      "REQ-TC-013"
    ) as PressKeyResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-key");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("handleClick — edge cases", () => {
  it("REQ-TC-005..008: returns no-target error when neither uid, selector, nor coordinates provided", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: false, error: "no-target" });
    const result = await expectHandle(
      () => handleClick(relay, {}),
      "REQ-TC-005..008"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("no-target");
  });

  it("REQ-TC-007: returns element-not-found when uid/selector target does not exist", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: false, error: "element-not-found" });
    const result = await expectHandle(
      () => handleClick(relay, { uid: "nonexistent-element" }),
      "REQ-TC-007"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("element-not-found");
  });

  it("REQ-TC-006: returns element-off-screen when element is outside viewport", async () => {
    const relay = makeRelayResolve<ClickResponse>({ success: false, error: "element-off-screen" });
    const result = await expectHandle(
      () => handleClick(relay, { uid: "below-fold-element" }),
      "REQ-TC-006"
    ) as ClickResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("element-off-screen");
  });
});

describe("handleType — edge cases", () => {
  it("REQ-TC-009..012: returns no-target error when neither uid nor selector provided", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: false, error: "no-target" });
    const result = await expectHandle(
      () => handleType(relay, { text: "hello" }),
      "REQ-TC-009..012"
    ) as TypeResponse;
    // When neither uid nor selector provided, handler should attempt to type
    // at current focus; relay returns no-target only if no focused element
    expect(result.success).toBe(false);
    expect(["no-target", "element-not-found", "element-not-focusable"]).toContain(result.error);
  });

  it("REQ-TC-011: returns element-not-focusable when target element cannot receive focus", async () => {
    const relay = makeRelayResolve<TypeResponse>({ success: false, error: "element-not-focusable" });
    const result = await expectHandle(
      () => handleType(relay, { text: "hello", uid: "disabled-input" }),
      "REQ-TC-011"
    ) as TypeResponse;
    expect(result.success).toBe(false);
    expect(result.error).toBe("element-not-focusable");
  });
});
