/**
 * Tests for Session Enrichment (MS-01)
 * Requirements: multi-session-architecture.md §MS-01
 *
 * Session type gains agentHint, label, group, metadata fields.
 * createSession() accepts optional params.
 *
 * API checklist:
 *   createSession(agentHint?, label?, group?, metadata?) — 7 tests
 *   getSession(id) — 1 test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { McpSessionRegistry } from "../mcp-session.js";
import type { Session } from "../mcp-session.js";

describe("McpSessionRegistry — Session Enrichment (MS-01)", () => {

  // MS-01.1: createSession accepts agentHint, stores it on session
  describe("createSession accepts agentHint", () => {
    it("MS-01.1: agentHint is stored on the created session", () => {
      const registry = new McpSessionRegistry();
      const session = registry.createSession("copilot");
      expect((session as Session & { agentHint: string | null }).agentHint).toBe("copilot");
    });

    it("MS-01.1: agentHint defaults to null when not provided", () => {
      const registry = new McpSessionRegistry();
      const session = registry.createSession();
      expect((session as Session & { agentHint: string | null }).agentHint).toBeNull();
    });
  });

  // MS-01.2: createSession accepts label, stores it on session
  describe("createSession accepts label", () => {
    it("MS-01.2: label is stored on the created session", () => {
      const registry = new McpSessionRegistry();
      // Overload: createSession(agentHint, label)
      const session = registry.createSession(undefined, "my-label");
      expect((session as Session & { label: string | null }).label).toBe("my-label");
    });

    it("MS-01.2: label defaults to null when not provided", () => {
      const registry = new McpSessionRegistry();
      const session = registry.createSession();
      expect((session as Session & { label: string | null }).label).toBeNull();
    });
  });

  // MS-01.3: createSession accepts group, stores it on session
  describe("createSession accepts group", () => {
    it("MS-01.3: group is stored on the created session", () => {
      const registry = new McpSessionRegistry();
      // createSession(agentHint, label, group)
      const session = registry.createSession(undefined, undefined, "dev-group");
      expect((session as Session & { group: string | null }).group).toBe("dev-group");
    });

    it("MS-01.3: group defaults to null when not provided", () => {
      const registry = new McpSessionRegistry();
      const session = registry.createSession();
      expect((session as Session & { group: string | null }).group).toBeNull();
    });
  });

  // MS-01.4: createSession accepts metadata, stores it on session
  describe("createSession accepts metadata", () => {
    it("MS-01.4: metadata is stored on the created session", () => {
      const registry = new McpSessionRegistry();
      const meta = { projectId: "123", env: "production" };
      // createSession(agentHint, label, group, metadata)
      const session = registry.createSession(undefined, undefined, undefined, meta);
      expect((session as Session & { metadata: Record<string, string> }).metadata).toEqual(meta);
    });

    it("MS-01.4: metadata defaults to empty object when not provided", () => {
      const registry = new McpSessionRegistry();
      const session = registry.createSession();
      expect((session as Session & { metadata: Record<string, string> }).metadata).toEqual({});
    });
  });

  // MS-01.5: getSession returns enriched session with all fields
  it("MS-01.5: getSession returns enriched session with all fields", () => {
    const registry = new McpSessionRegistry();
    const meta = { projectId: "456" };
    const session = registry.createSession("opencode", "session-label", "group-a", meta);

    const found = registry.getSession(session.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
    expect((found as Session & { agentHint: string | null }).agentHint).toBe("opencode");
    expect((found as Session & { label: string | null }).label).toBe("session-label");
    expect((found as Session & { group: string | null }).group).toBe("group-a");
    expect((found as Session & { metadata: Record<string, string> }).metadata).toEqual(meta);
  });

  // MS-01.6: session without optional fields has undefined for those fields (backward compat)
  it("MS-01.6: session created with no optional params has null/undefined for enrichment fields", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    // Core fields always present
    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe("string");
    expect(session.createdAt).toBeDefined();
    expect(session.lastActivity).toBeDefined();
    expect(session.initialized).toBe(false);

    // Enrichment fields
    const enriched = session as Session & { agentHint: string | null; label: string | null; group: string | null; metadata: Record<string, string> };
    expect(enriched.agentHint).toBeNull();
    expect(enriched.label).toBeNull();
    expect(enriched.group).toBeNull();
    expect(enriched.metadata).toEqual({});
  });

  // MS-01.7: session.id, createdAt, lastActivity, initialized unchanged
  it("MS-01.7: core session fields are unchanged by enrichment", () => {
    const registry = new McpSessionRegistry();
    const before = Date.now();
    const session = registry.createSession("copilot", "label", "group", { key: "value" });
    const after = Date.now();

    expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
    expect(session.lastActivity).toBeGreaterThanOrEqual(before);
    expect(session.lastActivity).toBeLessThanOrEqual(after);
    expect(session.initialized).toBe(false);
  });
});