/**
 * mcp-a11y-states.test.ts
 *
 * Tests for MCP-A11Y-001 — Element actionability states exposure.
 *
 * Verifies that:
 * - browser_inspect_element surfaces states when present (disabled, readonly, etc.)
 * - browser_inspect_element omits states field when no states apply
 * - browser_get_semantic_graph a11y nodes surface states when present
 * - browser_get_semantic_graph a11y nodes omit states field when none apply
 *
 * MCP-A11Y-001: Supported states are:
 *   disabled, readonly, expanded, collapsed, checked, selected, required, hidden
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSemanticGraphTool,
  GetSemanticGraphArgs,
  SemanticGraphResponse,
} from "../semantic-graph-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { SecurityConfig, BrowserAuditLog, DEFAULT_SECURITY_CONFIG, DEFAULT_REDACTION_PATTERNS } from "../security/index.js";
import { buildPageUnderstandingTools, InspectElementArgs } from "../page-understanding-tools.js";
import type { BrowserRelayLike } from "../types.js";

// ── Mock envelope ─────────────────────────────────────────────────────────────

const MOCK_ENVELOPE = {
  pageId: "a11y-test-page",
  frameId: "main",
  snapshotId: "a11y-test-page:1",
  capturedAt: "2026-04-06T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

// ── Mock relay factory ────────────────────────────────────────────────────────

function createMockRelay(overrides?: {
  connected?: boolean;
  response?: ReturnType<BrowserRelayLike["request"]>;
}) {
  return {
    request: vi.fn().mockImplementation(async () => {
      const response = overrides?.response ?? { success: true, requestId: "test", data: {} };
      return structuredClone(response);
    }),
    push: vi.fn(),
    isConnected: vi.fn(() => overrides?.connected ?? true),
  };
}

function createTestSecurityConfig(): SecurityConfig {
  const auditLog = new BrowserAuditLog();
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog,
  };
}

// ── MCP-A11Y-001: collectElementStates unit tests ──────────────────────────────
// (Tests the helper via mock DOM elements in jsdom)

// We test via the browser package's mock relay path since the content-side
// collectElementStates is tested through end-to-end mock responses.

const MOCK_INSPECT_DISABLED_BUTTON = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/form",
  title: "Form",
  found: true,
  anchorKey: "css:button.submit-btn",
  anchorStrategy: "css-path",
  anchorConfidence: "medium",
  element: {
    tag: "button",
    id: undefined,
    classList: ["submit-btn"],
    role: "button",
    ariaLabel: undefined,
    textContent: "Submit",
    attributes: { type: "submit", disabled: "" },
    bounds: { x: 100, y: 200, width: 120, height: 44 },
    visible: true,
    visibleConfidence: "high" as const,
    accessibleName: undefined,
    states: ["disabled"],
    hasPointerEvents: true,
    isObstructed: false,
    clickTargetSize: { width: 120, height: 44 },
  },
  context: {
    parentChain: ["form#login-form", "body"],
    siblingCount: 3,
    siblingIndex: 1,
    nearestLandmark: "main",
  },
  visibilityConfidence: "high",
};

const MOCK_INSPECT_PLAIN_INPUT = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/form",
  title: "Form",
  found: true,
  anchorKey: "css:input.username",
  anchorStrategy: "css-path",
  anchorConfidence: "medium",
  element: {
    tag: "input",
    id: undefined,
    classList: ["username"],
    role: "textbox",
    ariaLabel: undefined,
    textContent: undefined,
    attributes: { type: "text", name: "username" },
    bounds: { x: 100, y: 100, width: 200, height: 40 },
    visible: true,
    visibleConfidence: "high" as const,
    accessibleName: undefined,
    // Note: states field is absent — no states apply for a plain text input
    hasPointerEvents: true,
    isObstructed: false,
    clickTargetSize: { width: 200, height: 40 },
  },
  context: {
    parentChain: ["form#login-form", "body"],
    siblingCount: 2,
    siblingIndex: 0,
    nearestLandmark: "main",
  },
  visibilityConfidence: "high",
};

const MOCK_INSPECT_CHECKED_CHECKBOX = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/form",
  title: "Form",
  found: true,
  anchorKey: "css:input#remember",
  anchorStrategy: "id",
  anchorConfidence: "high",
  element: {
    tag: "input",
    id: "remember",
    classList: [],
    role: "checkbox",
    ariaLabel: "Remember me",
    textContent: undefined,
    attributes: { type: "checkbox", name: "remember" },
    bounds: { x: 100, y: 300, width: 20, height: 20 },
    visible: true,
    visibleConfidence: "high" as const,
    accessibleName: "Remember me",
    states: ["checked"],
    hasPointerEvents: true,
    isObstructed: false,
    clickTargetSize: { width: 20, height: 20 },
  },
  context: {
    parentChain: ["form#login-form", "body"],
    siblingCount: 4,
    siblingIndex: 2,
    nearestLandmark: "main",
  },
  visibilityConfidence: "high",
};

const MOCK_SG_WITH_STATES: SemanticGraphResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  title: "Test Page",
  a11yTree: [
    {
      role: "document",
      name: "Test Page",
      nodeId: 0,
      children: [
        {
          role: "button",
          name: "Submit",
          nodeId: 1,
          children: [],
          states: ["disabled"],
        },
        {
          role: "checkbox",
          name: "Remember me",
          nodeId: 2,
          children: [],
          states: ["checked"],
        },
        {
          role: "textbox",
          name: "Username",
          nodeId: 3,
          children: [],
          // plain — no states
        },
        {
          role: "menuitem",
          name: "File",
          nodeId: 4,
          children: [],
          states: ["expanded"],
        },
        {
          role: "menuitem",
          name: "Edit",
          nodeId: 5,
          children: [],
          states: ["collapsed"],
        },
      ],
    },
  ],
  landmarks: [
    { role: "main", label: undefined, nodeId: 6, tag: "main" },
  ],
  outline: [
    { level: 1, text: "Test Page", nodeId: 0, id: undefined },
  ],
  forms: [],
};

const MOCK_SG_PLAIN_NODES: SemanticGraphResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  title: "Plain Page",
  a11yTree: [
    {
      role: "document",
      name: "Plain Page",
      nodeId: 0,
      children: [
        {
          role: "heading",
          name: "Hello",
          level: 1,
          nodeId: 1,
          children: [],
          // no states field
        },
        {
          role: "paragraph",
          name: undefined,
          nodeId: 2,
          children: [],
          // no states field
        },
      ],
    },
  ],
  landmarks: [],
  outline: [
    { level: 1, text: "Plain Page", nodeId: 0, id: undefined },
  ],
  forms: [],
};

// ── MCP-A11Y-001: inspect_element states ──────────────────────────────────────

describe("MCP-A11Y-001: inspect_element states exposure", () => {
  it("MCP-A11Y-001: inspect_element includes states when element has disabled state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_DISABLED_BUTTON },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool).toBeDefined();

    const result = await (inspectTool!.handler as any)({ selector: "button.submit-btn" });

    expect(result.success !== false).toBe(true);
    expect(result.element).toBeDefined();
    expect(result.element.states).toBeDefined();
    expect(result.element.states).toContain("disabled");
    expect(result.element.states).not.toContain("readonly");
  });

  it("MCP-A11Y-001: inspect_element includes states when element has checked state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_CHECKED_CHECKBOX },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool).toBeDefined();

    const result = await (inspectTool!.handler as any)({ selector: "input#remember" });

    expect(result.success !== false).toBe(true);
    expect(result.element).toBeDefined();
    expect(result.element.states).toBeDefined();
    expect(result.element.states).toContain("checked");
  });

  it("MCP-A11Y-001: inspect_element omits states field when no states apply", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_PLAIN_INPUT },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool).toBeDefined();

    const result = await (inspectTool!.handler as any)({ selector: "input.username" });

    expect(result.success !== false).toBe(true);
    expect(result.element).toBeDefined();
    // MCP-A11Y-001: states field is omitted (not an empty array) when no states apply
    expect(result.element).not.toHaveProperty("states");
  });

  it("MCP-A11Y-001: inspect_element with aria-expanded=true includes expanded state", async () => {
    const mockExpandable = {
      ...MOCK_INSPECT_PLAIN_INPUT,
      element: {
        ...MOCK_INSPECT_PLAIN_INPUT.element,
        tag: "button",
        role: "button",
        attributes: { "aria-expanded": "true" },
        states: ["expanded"],
      },
    };
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: mockExpandable },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "[aria-expanded]" });

    expect(result.success !== false).toBe(true);
    expect(result.element.states).toContain("expanded");
  });

  it("MCP-A11Y-001: inspect_element with aria-expanded=false includes collapsed state", async () => {
    const mockCollapsed = {
      ...MOCK_INSPECT_PLAIN_INPUT,
      element: {
        ...MOCK_INSPECT_PLAIN_INPUT.element,
        tag: "button",
        role: "button",
        attributes: { "aria-expanded": "false" },
        states: ["collapsed"],
      },
    };
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: mockCollapsed },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "[aria-expanded]" });

    expect(result.success !== false).toBe(true);
    expect(result.element.states).toContain("collapsed");
  });

  it("MCP-A11Y-001: inspect_element with aria-hidden=true includes hidden state", async () => {
    const mockHidden = {
      ...MOCK_INSPECT_PLAIN_INPUT,
      element: {
        ...MOCK_INSPECT_PLAIN_INPUT.element,
        tag: "span",
        role: "generic",
        attributes: { "aria-hidden": "true" },
        states: ["hidden"],
      },
    };
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: mockHidden },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "span.decorative" });

    expect(result.success !== false).toBe(true);
    expect(result.element.states).toContain("hidden");
  });
});

// ── MCP-A11Y-001: semantic graph states ────────────────────────────────────────

describe("MCP-A11Y-001: get_semantic_graph states exposure", () => {
  async function invokeSGTool(
    relay: BrowserRelayLike,
    store: SnapshotRetentionStore,
    security: SecurityConfig,
    args: GetSemanticGraphArgs = {},
  ) {
    const tool = buildSemanticGraphTool(relay, store, security);
    return (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)(args);
  }

  it("MCP-A11Y-001: get_semantic_graph a11y node includes disabled state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SG_WITH_STATES },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const result = await invokeSGTool(relay, store, security);

    if ("success" in result && !result.success) {
      throw new Error(`Expected success but got: ${JSON.stringify(result)}`);
    }
    const sg = result as SemanticGraphResponse;

    // Find the button node with disabled state
    const buttonNode = sg.a11yTree[0].children.find((n) => n.role === "button");
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.states).toBeDefined();
    expect(buttonNode!.states).toContain("disabled");
  });

  it("MCP-A11Y-001: get_semantic_graph a11y node includes checked state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SG_WITH_STATES },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const result = await invokeSGTool(relay, store, security);

    if ("success" in result && !result.success) {
      throw new Error(`Expected success but got: ${JSON.stringify(result)}`);
    }
    const sg = result as SemanticGraphResponse;

    const checkboxNode = sg.a11yTree[0].children.find((n) => n.role === "checkbox");
    expect(checkboxNode).toBeDefined();
    expect(checkboxNode!.states).toBeDefined();
    expect(checkboxNode!.states).toContain("checked");
  });

  it("MCP-A11Y-001: get_semantic_graph a11y node includes expanded state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SG_WITH_STATES },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const result = await invokeSGTool(relay, store, security);

    if ("success" in result && !result.success) {
      throw new Error(`Expected success but got: ${JSON.stringify(result)}`);
    }
    const sg = result as SemanticGraphResponse;

    const expandedNode = sg.a11yTree[0].children.find((n) => n.role === "menuitem" && n.states?.includes("expanded"));
    expect(expandedNode).toBeDefined();
    expect(expandedNode!.states).toContain("expanded");
  });

  it("MCP-A11Y-001: get_semantic_graph a11y node includes collapsed state", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SG_WITH_STATES },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const result = await invokeSGTool(relay, store, security);

    if ("success" in result && !result.success) {
      throw new Error(`Expected success but got: ${JSON.stringify(result)}`);
    }
    const sg = result as SemanticGraphResponse;

    const collapsedNode = sg.a11yTree[0].children.find((n) => n.role === "menuitem" && n.states?.includes("collapsed"));
    expect(collapsedNode).toBeDefined();
    expect(collapsedNode!.states).toContain("collapsed");
  });

  it("MCP-A11Y-001: get_semantic_graph a11y node omits states when no states apply", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SG_PLAIN_NODES },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const result = await invokeSGTool(relay, store, security);

    if ("success" in result && !result.success) {
      throw new Error(`Expected success but got: ${JSON.stringify(result)}`);
    }
    const sg = result as SemanticGraphResponse;

    // Heading node should NOT have a states field
    const headingNode = sg.a11yTree[0].children.find((n) => n.role === "heading");
    expect(headingNode).toBeDefined();
    expect(headingNode!).not.toHaveProperty("states");
  });

  it("MCP-A11Y-001: SemanticA11yNode type includes states as optional array", () => {
    // Type-level verification: the SemanticA11yNode interface exported from
    // semantic-graph-tool.ts includes states?: string[]
    const nodeWithStates: import("../semantic-graph-tool.js").SemanticA11yNode = {
      role: "button",
      nodeId: 1,
      children: [],
      states: ["disabled"],
    };
    expect(nodeWithStates.states).toEqual(["disabled"]);

    const nodeWithout: import("../semantic-graph-tool.js").SemanticA11yNode = {
      role: "heading",
      nodeId: 2,
      children: [],
      // states omitted — type should allow this
    };
    expect((nodeWithout as any).states).toBeUndefined();
  });
});
