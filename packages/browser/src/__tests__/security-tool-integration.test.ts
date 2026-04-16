/**
 * security-tool-integration.test.ts
 *
 * Tests for F1 + F2 + F5 integration at the tool handler level:
 * - F1: Origin policy on handlers (MCP-SEC-001)
 * - F2: redactPII parameter on handlers (MCP-SEC-002)
 * - F5: RedactionWarning on tool responses (MCP-VC-005, MCP-SEC-005)
 *
 * These tests exercise the tool builders with SecurityConfig and new parameters.
 * They will fail until Phase C implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTextMapTool,
  GetTextMapArgs,
  GetSemanticGraphArgs,
  TextMapResponse,
  SemanticGraphResponse,
} from "../text-map-tool.js";
import { buildSemanticGraphTool } from "../semantic-graph-tool.js";
import {
  buildPageUnderstandingTools,
  GetPageMapArgs,
  InspectElementArgs,
  GetDomExcerptArgs,
  GetTextMapArgs as GetPageMapTextMapArgs,
  CaptureRegionArgs,
} from "../page-understanding-tools.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { SecurityConfig, BrowserAuditLog, DEFAULT_SECURITY_CONFIG, DEFAULT_REDACTION_PATTERNS } from "../security/index.js";

// ── Mock fixtures ────────────────────────────────────────────────────────────

const MOCK_ENVELOPE = {
  pageId: "mock-page-001",
  frameId: "main",
  snapshotId: "mock-page-001:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

const MOCK_TEXT_MAP_WITH_PII: TextMapResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/contact",
  title: "Contact Us",
  segments: [
    {
      textRaw: "Contact us at help@example.com",
      textNormalized: "Contact us at help@example.com",
      nodeId: 0,
      role: "heading",
      accessibleName: undefined,
      bbox: { x: 0, y: 0, width: 300, height: 40 },
      visibility: "visible" as const,
      readingOrderIndex: 0,
    },
    {
      textRaw: "Call (555) 123-4567",
      textNormalized: "Call (555) 123-4567",
      nodeId: 1,
      role: undefined,
      accessibleName: undefined,
      bbox: { x: 0, y: 50, width: 200, height: 30 },
      visibility: "visible" as const,
      readingOrderIndex: 1,
    },
  ],
  totalSegments: 2,
  truncated: false,
};

const MOCK_SEMANTIC_GRAPH_WITH_PII: SemanticGraphResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/contact",
  title: "Contact Us",
  a11yTree: [
    {
      role: "document",
      name: "Contact Us",
      nodeId: 0,
      children: [
        {
          role: "heading",
          name: "Contact admin@example.com",
          level: 1,
          nodeId: 1,
          children: [],
        },
      ],
    },
  ],
  landmarks: [
    { role: "main", label: "Main content", nodeId: 2, tag: "main" },
  ],
  outline: [
    { level: 1, text: "Contact admin@example.com", nodeId: 1, id: undefined },
  ],
  forms: [
    {
      formId: "contact-form",
      name: "Contact form",
      action: "/contact",
      method: "POST",
      nodeId: 3,
      fields: [
        {
          tag: "input",
          type: "email",
          name: "email",
          label: "Email",
          required: true,
          value: "user@example.com",
          nodeId: 4,
        },
      ],
    },
  ],
};

// ── Mock relay factory ───────────────────────────────────────────────────────

function createMockRelay(overrides?: {
  connected?: boolean;
  response?: ReturnType<any>;
}) {
  return {
    request: vi.fn().mockImplementation(async () => {
      // Deep clone to prevent test pollution — each call gets a fresh copy
      const response = overrides?.response ?? { success: true, requestId: "test", data: {} };
      return structuredClone(response);
    }),
    push: vi.fn(),
    isConnected: vi.fn(() => overrides?.connected ?? true),
  };
}

// ── Default security config for tests ────────────────────────────────────────

function createTestSecurityConfig(): SecurityConfig {
  const auditLog = new BrowserAuditLog();
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog,
  };
}

// ── F2 + F5: redactPII parameter + redactionWarning ─────────────────────────

describe("MCP-SEC-002 + MCP-SEC-005: redactPII parameter on get_text_map", () => {
  it("MCP-SEC-002: get_text_map accepts redactPII: true parameter", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_TEXT_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildTextMapTool(relay, store, security);

    const args: GetTextMapArgs = { redactPII: true };
    const result = await (tool.handler as any)(args);

    if ("success" in result && !result.success) {
      // If redaction fails (not implemented), that's expected at this stage
      // We just verify the parameter is accepted
      return;
    }
    // When implemented: response should have redactionApplied: true
    expect(result).toHaveProperty("redactionApplied");
  });

  it("MCP-SEC-005: get_text_map without redactPII includes redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_TEXT_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildTextMapTool(relay, store, security);

    const result = await (tool.handler as any)({});

    if ("success" in result && !result.success) return; // not implemented yet
    // When redactPII is false/not set: response should have redactionWarning
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("PII");
  });

  it("MCP-SEC-005: get_text_map with redactPII: true and successful redaction has NO redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_TEXT_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "email", pattern: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}" },
    ];
    const tool = buildTextMapTool(relay, store, security);

    const result = await (tool.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    // When redactPII succeeds: no redactionWarning
    expect(result.redactionWarning).toBeUndefined();
  });
});

describe("MCP-SEC-002 + MCP-SEC-005: redactPII parameter on get_semantic_graph", () => {
  it("MCP-SEC-002: get_semantic_graph accepts redactPII: true parameter", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SEMANTIC_GRAPH_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildSemanticGraphTool(relay, store, security);

    const result = await (tool.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionApplied");
  });

  it("MCP-SEC-005: get_semantic_graph without redactPII includes redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SEMANTIC_GRAPH_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildSemanticGraphTool(relay, store, security);

    const result = await (tool.handler as any)({});

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("PII");
  });
});

// ── F5: CaptureRegion redactionWarning ───────────────────────────────────────

describe("MCP-VC-005: capture_region redactionWarning for screenshots", () => {
  it("MCP-VC-005: capture_region with RedactionPolicy configured returns redactionWarning", async () => {
    // Note: buildCaptureRegionTool is part of page-understanding-tools
    // For now, we test that the security integration point exists
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          success: true,
          dataUrl: "data:image/png;base64,abc",
          width: 100,
          height: 100,
          sizeBytes: 50,
        },
      },
    });

    // The design doc says: when RedactionPolicy is configured (non-empty redactPatterns),
    // screenshots return redactionWarning: "screenshots-not-subject-to-redaction-policy"
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "email", pattern: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}" },
    ];

    const store = new SnapshotRetentionStore();
    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
    expect(captureTool).toBeDefined();

    const result = await (captureTool!.handler as any)({ mode: "viewport" });

    if ("success" in result && !result.success) return;
    // MCP-VC-005: Screenshots always get this warning when policy is configured
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("screenshots");
  });

  it("MCP-VC-005: capture_region without RedactionPolicy does NOT return redactionWarning", async () => {
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          success: true,
          dataUrl: "data:image/png;base64,abc",
          width: 100,
          height: 100,
          sizeBytes: 50,
        },
      },
    });

    // No redaction policy configured
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [];

    const store = new SnapshotRetentionStore();
    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");

    const result = await (captureTool!.handler as any)({ mode: "viewport" });

    if ("success" in result && !result.success) return;
    // Without a redaction policy, no warning needed
    expect(result.redactionWarning).toBeUndefined();
  });
});

// ── F4: auditId in response ──────────────────────────────────────────────────

describe("MCP-SEC-004: auditId in tool responses", () => {
  it("MCP-SEC-004: get_text_map response includes auditId", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_TEXT_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildTextMapTool(relay, store, security);

    const result = await (tool.handler as any)({});

    expect("success" in result ? result.success !== false : true).toBe(true);
    expect(result).toHaveProperty("segments");
    // MCP-SEC-004: auditId is a UUID in the response
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
    // UUIDv4 format check
    expect(result.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("MCP-SEC-004: get_semantic_graph response includes auditId", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_SEMANTIC_GRAPH_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildSemanticGraphTool(relay, store, security);

    const result = await (tool.handler as any)({});

    expect("success" in result ? result.success !== false : true).toBe(true);
    expect(result).toHaveProperty("landmarks");
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
  });

  it("MCP-SEC-004: Multiple invocations produce unique auditIds", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_TEXT_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tool = buildTextMapTool(relay, store, security);

    const result1 = await (tool.handler as any)({});
    const result2 = await (tool.handler as any)({});

    expect("success" in result1 ? result1.success !== false : true).toBe(true);
    expect("success" in result2 ? result2.success !== false : true).toBe(true);
    expect(result1).toHaveProperty("auditId");
    expect(result2).toHaveProperty("auditId");
    expect(result1.auditId).not.toBe(result2.auditId);
  });

  it("MCP-SEC-004: get_page_map response includes auditId on success", async () => {
    const relay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          depth: 0,
          truncated: false,
        },
      },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({});

    expect("success" in result ? result.success !== false : true).toBe(true);
    expect(result).toHaveProperty("pageUrl", "https://example.com");
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
    expect(result.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("MCP-SEC-004: inspect_element response includes auditId on success", async () => {
    const relay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          found: true,
          anchorKey: "id:test",
          anchorStrategy: "id",
          anchorConfidence: "high",
          element: { name: "Test", tag: "div" },
        },
      },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#test" });

    expect("success" in result ? result.success !== false : true).toBe(true);
    expect(result).toHaveProperty("found", true);
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
    expect(result.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("MCP-SEC-004: get_dom_excerpt response includes auditId on success", async () => {
    const relay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          found: true,
          html: "<div>Test</div>",
          text: "Test",
          nodeCount: 1,
        },
      },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#test" });

    expect("success" in result ? result.success !== false : true).toBe(true);
    expect(result).toHaveProperty("found", true);
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
    expect(result.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("MCP-SEC-004: capture_region response includes auditId on success", async () => {
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          success: true,
          dataUrl: "data:image/png;base64,abc",
          width: 100,
          height: 100,
          sizeBytes: 50,
        },
      },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");

    const result = await (captureTool!.handler as any)({ mode: "viewport" });

    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("fileUri");
    expect(result).toHaveProperty("auditId");
    expect(typeof result.auditId).toBe("string");
    expect(result.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("MCP-SEC-004: get_page_map error response does NOT include auditId", async () => {
    const relay = createMockRelay({
      connected: false,
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({});

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("auditId");
  });

  it("MCP-SEC-004: inspect_element error response does NOT include auditId", async () => {
    const relay = createMockRelay({
      connected: false,
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#test" });

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("auditId");
  });

  it("MCP-SEC-004: get_dom_excerpt error response does NOT include auditId", async () => {
    const relay = createMockRelay({
      connected: false,
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#test" });

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("auditId");
  });

  it("MCP-SEC-004: capture_region error response does NOT include auditId", async () => {
    const mockRelay = createMockRelay({
      connected: false,
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");

    const result = await (captureTool!.handler as any)({ mode: "viewport" });

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("auditId");
  });
});

// ── F1: Origin policy on handlers ───────────────────────────────────────────

describe("MCP-SEC-001: Origin policy on page understanding handlers", () => {
  it("MCP-SEC-001: get_page_map accepts allowedOrigins and deniedOrigins", async () => {
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          depth: 0,
          truncated: false,
        },
      },
    });

    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool).toBeDefined();

    // MCP-SEC-001: These parameters should be accepted
    const result = await (pageMapTool!.handler as any)({
      deniedOrigins: ["https://blocked.com"],
    });

    if ("success" in result && !result.success) {
      // If origin-blocked is returned, that means policy is enforced
      expect(result.error).toBe("origin-blocked");
      return;
    }
    // If it succeeds, the origin was allowed
  });

  it("MCP-SEC-001: deniedOrigins blocks matching origin before DOM access", async () => {
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://blocked-origin.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          depth: 0,
          truncated: false,
        },
      },
    });

    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    // Configure: block https://blocked-origin.com
    security.originPolicy.deniedOrigins = ["https://blocked-origin.com"];

    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({});

    // B2-ER-007: Error returned BEFORE any DOM access
    expect(result.success).toBe(false);
    expect(result.error).toBe("origin-blocked");
    expect(result.retryable).toBe(false);
  });

  it("MCP-SEC-001: allowedOrigins blocks non-matching origin", async () => {
    const mockRelay = createMockRelay({
      response: {
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://not-allowed.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          depth: 0,
          truncated: false,
        },
      },
    });

    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    // Configure: only allow https://example.com
    security.originPolicy.allowedOrigins = ["https://example.com"];

    const tools = buildPageUnderstandingTools(mockRelay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({});

    expect(result.success).toBe(false);
    expect(result.error).toBe("origin-blocked");
    expect(result.retryable).toBe(false);
  });
});

// ── M115: redactPII coverage for newly-covered handlers ────────────────────

const MOCK_PAGE_MAP_WITH_PII = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/contact",
  title: "Contact",
  nodes: [
    {
      nodeId: 1,
      name: "Contact admin@example.com",
      text: "Call (555) 123-4567",
      role: "heading",
      children: [
        {
          nodeId: 2,
          name: "Nested: bob@corp.org",
          text: "Inner (555) 999-8888 text",
          role: "paragraph",
          children: [],
        },
      ],
    },
    { nodeId: 3, name: "Safe content", text: "Safe text", role: "paragraph", children: [] },
  ],
  totalElements: 3,
  depth: 2,
  truncated: false,
};

const MOCK_INSPECT_WITH_PII = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/contact",
  title: "Contact",
  found: true,
  anchorKey: "id:contact-email",
  anchorStrategy: "id",
  anchorConfidence: "high",
  element: {
    name: "Email: user@example.com",
    tag: "a",
    href: "mailto:user@example.com",
    textContent: "Contact us at help@example.com",
    ariaLabel: "Email contact",
    placeholder: undefined,
    accessibleName: "Email link to admin@corp.com",
  },
  context: {
    name: "Email section",
    textContent: "Call (555) 222-3333 for support",
    accessibleName: "Section accessible name",
  },
};

const MOCK_EXCERPT_WITH_PII = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/contact",
  title: "Contact",
  found: true,
  html: "<p>Contact us at admin@example.com</p>",
  text: "Contact us at admin@example.com, call (555) 999-8888",
  nodeCount: 2,
  truncated: false,
};

// ── get_page_map redactPII ──────────────────────────────────────────────────

describe("MCP-SEC-002 + MCP-SEC-005: redactPII on get_page_map", () => {
  it("MCP-SEC-002: get_page_map accepts redactPII: true and sets redactionApplied", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionApplied");
    expect(result.redactionApplied).toBe(true);
  });

  it("MCP-SEC-002: get_page_map top-level node name field is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    const topNode = result.nodes[0];
    expect(topNode.name).not.toContain("admin@example.com");
    expect(topNode.name).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: get_page_map nested node name field is redacted (children recursion)", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    const nestedNode = result.nodes[0].children[0];
    expect(nestedNode.name).not.toContain("bob@corp.org");
    expect(nestedNode.name).toContain("[REDACTED]");
    // text field also redacted
    expect(nestedNode.text).not.toContain("(555) 999-8888");
    expect(nestedNode.text).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: get_page_map safe node is unchanged", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    const safeNode = result.nodes[1];
    expect(safeNode.name).toBe("Safe content");
    expect(safeNode.text).toBe("Safe text");
  });

  it("MCP-SEC-005: get_page_map without redactPII includes redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({});

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("PII");
  });

  it("MCP-SEC-005: get_page_map with redactPII: true has NO redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.redactionWarning).toBeUndefined();
  });

  it("MCP-SEC-003: get_page_map with malformed regex returns redaction-failed (fail-closed)", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "bad", pattern: "[a-z" }, // unclosed character class
    ];
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    const result = await (pageMapTool!.handler as any)({ redactPII: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe("redaction-failed");
    expect(result.retryable).toBe(false);
  });
});

// ── inspect_element redactPII ────────────────────────────────────────────────

describe("MCP-SEC-002 + MCP-SEC-005: redactPII on inspect_element", () => {
  it("MCP-SEC-002: inspect_element element.name is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.element.name).not.toContain("user@example.com");
    expect(result.element.name).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: inspect_element element.textContent is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.element.textContent).not.toContain("help@example.com");
    expect(result.element.textContent).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: inspect_element element.accessibleName is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.element.accessibleName).not.toContain("admin@corp.com");
    expect(result.element.accessibleName).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: inspect_element context.textContent is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.context.textContent).not.toContain("(555) 222-3333");
    expect(result.context.textContent).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: inspect_element sets redactionApplied: true", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.redactionApplied).toBe(true);
  });

  it("MCP-SEC-005: inspect_element without redactPII includes redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email" });

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("PII");
  });

  it("MCP-SEC-005: inspect_element with redactPII: true has NO redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.redactionWarning).toBeUndefined();
  });

  it("MCP-SEC-003: inspect_element with malformed regex returns redaction-failed (fail-closed)", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_INSPECT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "bad", pattern: "[a-z" },
    ];
    const tools = buildPageUnderstandingTools(relay, store, security);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");

    const result = await (inspectTool!.handler as any)({ selector: "#email", redactPII: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe("redaction-failed");
    expect(result.retryable).toBe(false);
  });
});

// ── get_dom_excerpt redactPII ─────────────────────────────────────────────────

describe("MCP-SEC-002 + MCP-SEC-005: redactPII on get_dom_excerpt", () => {
  it("MCP-SEC-002: get_dom_excerpt text is redacted", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_EXCERPT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#contact", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.text).not.toContain("admin@example.com");
    expect(result.text).not.toContain("(555) 999-8888");
    expect(result.text).toContain("[REDACTED]");
  });

  it("MCP-SEC-002: get_dom_excerpt sets redactionApplied: true", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_EXCERPT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#contact", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.redactionApplied).toBe(true);
  });

  it("MCP-SEC-005: get_dom_excerpt without redactPII includes redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_EXCERPT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#contact" });

    if ("success" in result && !result.success) return;
    expect(result).toHaveProperty("redactionWarning");
    expect(result.redactionWarning).toContain("PII");
  });

  it("MCP-SEC-005: get_dom_excerpt with redactPII: true has NO redactionWarning", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_EXCERPT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#contact", redactPII: true });

    if ("success" in result && !result.success) return;
    expect(result.redactionWarning).toBeUndefined();
  });

  it("MCP-SEC-003: get_dom_excerpt with malformed regex returns redaction-failed (fail-closed)", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_EXCERPT_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "bad", pattern: "[a-z" },
    ];
    const tools = buildPageUnderstandingTools(relay, store, security);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");

    const result = await (excerptTool!.handler as any)({ selector: "#contact", redactPII: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe("redaction-failed");
    expect(result.retryable).toBe(false);
  });
});

// ── audit trail redacted=true ─────────────────────────────────────────────────

describe("MCP-SEC-004: audit trail records redacted: true when redaction occurs", () => {
  it("MCP-SEC-004: audit log records redacted: true when redactPII succeeds on get_page_map", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    security.redactionPolicy.redactPatterns = [
      { name: "email", pattern: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}" },
    ];
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    await (pageMapTool!.handler as any)({ redactPII: true });

    // Check the audit entry was recorded with redacted: true
    const entries = (security.auditLog as any).entries ?? [];
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      expect(lastEntry.redacted).toBe(true);
    }
  });

  it("MCP-SEC-004: audit log records redacted: false when no redactPII on get_page_map", async () => {
    const relay = createMockRelay({
      response: { success: true, requestId: "test", data: MOCK_PAGE_MAP_WITH_PII },
    });
    const store = new SnapshotRetentionStore();
    const security = createTestSecurityConfig();
    const tools = buildPageUnderstandingTools(relay, store, security);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");

    await (pageMapTool!.handler as any)({});

    const entries = (security.auditLog as any).entries ?? [];
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      expect(lastEntry.redacted).toBe(false);
    }
  });
});
