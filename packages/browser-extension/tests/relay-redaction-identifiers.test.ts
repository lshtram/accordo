import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleRelayAction } from "../src/relay-actions.js";
import { applyRedaction } from "../src/relay-privacy.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

const IDENTIFIER_DATA = {
  pageId: "pg_2a29a33263504859810dba80e1f3e90f",
  snapshotId: "pg_2a29a33263504859810dba80e1f3e90f:31",
  frameId: "main",
  auditId: "audit-3326350485",
  anchorKey: "anchor-3326350485",
  canonicalAnchorKey: "canonical-4445556666",
  nodes: [
    { uid: "main:3326350485", ref: "ref-3326350485", nodeId: 3326350485, text: "Email admin@example.com" },
  ],
  segments: [
    { uid: "main:4445556666", textRaw: "Call 444-555-6666", textNormalized: "Call 444-555-6666" },
  ],
};

function expectIdentifiersPreserved(result: typeof IDENTIFIER_DATA): void {
  expect(result.pageId).toBe(IDENTIFIER_DATA.pageId);
  expect(result.snapshotId).toBe(IDENTIFIER_DATA.snapshotId);
  expect(result.frameId).toBe(IDENTIFIER_DATA.frameId);
  expect(result.auditId).toBe(IDENTIFIER_DATA.auditId);
  expect(result.anchorKey).toBe(IDENTIFIER_DATA.anchorKey);
  expect(result.canonicalAnchorKey).toBe(IDENTIFIER_DATA.canonicalAnchorKey);
  expect(result.nodes[0].uid).toBe(IDENTIFIER_DATA.nodes[0].uid);
  expect(result.nodes[0].ref).toBe(IDENTIFIER_DATA.nodes[0].ref);
  expect(result.nodes[0].nodeId).toBe(IDENTIFIER_DATA.nodes[0].nodeId);
  expect(result.segments[0].uid).toBe(IDENTIFIER_DATA.segments[0].uid);
}

describe("redaction identifier preservation", () => {
  beforeEach(() => resetChromeMocks());

  it("preserves machine identifiers while redacting text-bearing fields", () => {
    const { data: redacted, redactionApplied } = applyRedaction(IDENTIFIER_DATA);
    const result = redacted as typeof IDENTIFIER_DATA;

    expect(redactionApplied).toBe(true);
    expectIdentifiersPreserved(result);
    expect(result.nodes[0].text).not.toContain("admin@example.com");
    expect(result.segments[0].textRaw).not.toContain("444-555-6666");
  });

  it("preserves inspect handles on forwarded read-tool responses with redactPII", async () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: undefined, writable: true });
    globalThis.chrome.tabs.get = vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" });
    globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ data: IDENTIFIER_DATA });

    try {
      const response = await handleRelayAction({
        requestId: "test-redaction-identifiers",
        action: "inspect_element",
        payload: { tabId: 1, selector: "body", redactPII: true },
      });

      expect(response.success).toBe(true);
      const data = response.data as typeof IDENTIFIER_DATA & { redactionApplied: boolean };
      expect(data.redactionApplied).toBe(true);
      expectIdentifiersPreserved(data);
      expect(data.nodes[0].text).not.toContain("admin@example.com");
    } finally {
      Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
    }
  });

  it("marks semantic graph redactionApplied when forwarded form values are redacted", async () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: undefined, writable: true });
    globalThis.chrome.tabs.get = vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" });
    globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({
      data: { ...IDENTIFIER_DATA, forms: [{ fields: [{ nodeId: 19, uid: "main:19", value: "reviewer-proof@example.com" }] }] },
    });

    try {
      const response = await handleRelayAction({
        requestId: "test-redaction-semantic",
        action: "get_semantic_graph",
        payload: { tabId: 1, redactPII: true },
      });

      expect(response.success).toBe(true);
      const data = response.data as typeof IDENTIFIER_DATA & { forms: Array<{ fields: Array<{ uid: string; value: string }> }>; redactionApplied: boolean };
      expect(data.redactionApplied).toBe(true);
      expectIdentifiersPreserved(data);
      expect(data.forms[0].fields[0].uid).toBe("main:19");
      expect(data.forms[0].fields[0].value).toBe("[REDACTED]");
    } finally {
      Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
    }
  });
});
