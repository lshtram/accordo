import { describe, expect, it, vi } from "vitest";
import { buildPageUnderstandingTools } from "../page-understanding-tools.js";
import { buildSemanticGraphTool } from "../semantic-graph-tool.js";
import { buildTextMapTool } from "../text-map-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { BrowserAuditLog, DEFAULT_REDACTION_PATTERNS, type SecurityConfig } from "../security/index.js";
import type { BrowserRelayLike } from "../types.js";

const ENVELOPE = {
  pageId: "p1",
  frameId: "main",
  snapshotId: "p1:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

function createSecurity(): SecurityConfig {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog(),
  };
}

function createRelay(): BrowserRelayLike {
  return {
    request: vi.fn().mockImplementation(async (action: string) => ({ success: true, requestId: "test", data: responseFor(action) })),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

function createAlreadyRedactedRelay(): BrowserRelayLike {
  return {
    request: vi.fn().mockResolvedValue({
      success: true,
      requestId: "test",
      data: { ...ENVELOPE, pageUrl: "https://example.com", title: "T", a11yTree: [], landmarks: [], outline: [], forms: [{ fields: [{ nodeId: 1, uid: "main:1", value: "[REDACTED]" }] }], redactionApplied: true },
    }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

function responseFor(action: string): Record<string, unknown> {
  const pii = "user@example.com";
  if (action === "get_text_map") return { ...ENVELOPE, pageUrl: "https://example.com", title: "T", segments: [{ textRaw: pii, textNormalized: pii, nodeId: 1, bbox: { x: 0, y: 0, width: 10, height: 10 }, visibility: "visible", readingOrderIndex: 0 }], totalSegments: 1, truncated: false };
  if (action === "get_semantic_graph") return { ...ENVELOPE, pageUrl: "https://example.com", title: "T", a11yTree: [{ role: "text", name: pii, nodeId: 1, children: [] }], landmarks: [], outline: [{ level: 1, text: pii, nodeId: 1 }], forms: [] };
  if (action === "get_page_map") return { ...ENVELOPE, pageUrl: "https://example.com", title: "T", nodes: [{ nodeId: 1, uid: "main:1", ref: "ref-1", tag: "div", text: pii }], totalElements: 1, truncated: false };
  if (action === "inspect_element") return { ...ENVELOPE, pageUrl: "https://example.com", found: true, element: { textContent: pii } };
  return { ...ENVELOPE, pageUrl: "https://example.com", found: true, html: `<div>${pii}</div>`, text: pii, nodeCount: 1, truncated: false };
}

function relevantText(toolName: string, result: any): string {
  if (toolName === "text") return `${result.segments[0].textRaw}|${result.segments[0].textNormalized}`;
  if (toolName === "semantic") return `${result.a11yTree[0].name}|${result.outline[0].text}`;
  if (toolName === "page") return String(result.nodes[0].text);
  if (toolName === "inspect") return String(result.element.textContent);
  return String(result.text);
}

function getTools(relay: BrowserRelayLike, security: SecurityConfig) {
  const store = new SnapshotRetentionStore();
  const pageTools = buildPageUnderstandingTools(relay, store, security);
  return {
    text: buildTextMapTool(relay, store, security),
    semantic: buildSemanticGraphTool(relay, store, security),
    page: pageTools.find((tool) => tool.name === "accordo_browser_get_page_map")!,
    inspect: pageTools.find((tool) => tool.name === "accordo_browser_inspect_element")!,
    excerpt: pageTools.find((tool) => tool.name === "accordo_browser_get_dom_excerpt")!,
  };
}

function argsFor(toolName: string): Record<string, unknown> {
  if (toolName === "inspect") return { selector: "#pii-target" };
  if (toolName === "excerpt") return { selector: "#pii-target" };
  return {};
}

describe("read tool redaction contract", () => {
  it("false and omitted return raw content with warning across all five read tools", async () => {
    const tools = getTools(createRelay(), createSecurity());
    for (const [name, tool] of Object.entries(tools)) {
      for (const args of [argsFor(name), { ...argsFor(name), redactPII: false }]) {
        const result = await (tool.handler as any)(args);
        expect(relevantText(name, result)).toContain("user@example.com");
        expect(result.redactionApplied).not.toBe(true);
        expect(result.redactionWarning).toBe("PII may be present in response");
        expect(JSON.stringify({ name, result })).not.toContain('"redactionApplied":true,"redactionWarning":"PII may be present in response"');
      }
    }
  });

  it("true redacts and omits warning across all five read tools", async () => {
    const tools = getTools(createRelay(), createSecurity());
    for (const [name, tool] of Object.entries(tools)) {
      const result = await (tool.handler as any)({ ...argsFor(name), redactPII: true });
      expect(relevantText(name, result)).not.toContain("user@example.com");
      expect(result.redactionApplied).toBe(true);
      expect(result.redactionWarning).toBeUndefined();
    }
  });

  // Regression: redactPII:true must not redact machine identifiers (pageId/snapshotId/frameId/nodeId/uid/ref).
  // Live behavior prior to the redaction boundary fix incorrectly redacted pageId and snapshotId,
  // rendering follow-up tool calls unusable.
  it("true redacts text fields without redacting machine identifiers across all five read tools", async () => {
    const tools = getTools(createRelay(), createSecurity());
    for (const [name, tool] of Object.entries(tools)) {
      const result = await (tool.handler as any)({ ...argsFor(name), redactPII: true });

      // Envelope identifiers must be preserved.
      expect(result.pageId).toBe("p1");
      expect(result.snapshotId).toBe("p1:1");
      expect(result.frameId).toBe("main");

      // Text content must be redacted.
      expect(relevantText(name, result)).not.toContain("user@example.com");
      expect(result.redactionApplied).toBe(true);

      // page_map nodes carry nodeId / uid / ref — verify they survive redaction.
      if (name === "page") {
        expect(result.nodes[0].nodeId).toBe(1);
        expect(result.nodes[0].uid).toBe("main:1");
        expect(result.nodes[0].ref).toBe("ref-1");
      }
    }
  });

  it("preserves upstream redactionApplied when forwarded data is already redacted", async () => {
    const tool = buildSemanticGraphTool(createAlreadyRedactedRelay(), new SnapshotRetentionStore(), createSecurity());
    const result = await (tool.handler as any)({ redactPII: true });

    expect(result.pageId).toBe("p1");
    expect(result.snapshotId).toBe("p1:1");
    expect(result.forms[0].fields[0].uid).toBe("main:1");
    expect(result.forms[0].fields[0].value).toBe("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
  });
});
