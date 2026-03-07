/**
 * Tests for extension-registry.ts
 * Requirements: requirements-bridge.md §7 (REG-01 to REG-06)
 *
 * All registerTools() calls test the EXPECTED FINAL behavior.
 * Phase B: registerTools() throws 'not implemented', so most tests FAIL (by design).
 * REG-06 / REG-02 tests use expect(() => ...).toThrow("specific message") to force red.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExtensionRegistry } from "../extension-registry.js";
import type { ExtensionToolDefinition } from "../extension-registry.js";

function makeTool(name: string, overrides: Partial<ExtensionToolDefinition> = {}): ExtensionToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: { input: { type: "string", description: "Input" } } },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    handler: vi.fn(async () => ({ result: `${name} result` })),
    ...overrides,
  };
}

describe("ExtensionRegistry", () => {
  let registry: ExtensionRegistry;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendSpy = vi.fn();
    registry = new ExtensionRegistry();
    registry.setSendFunction(sendSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── REG-01: multiple extensions register concurrently ─────────────────────

  describe("REG-01: multiple extensions can register tools concurrently", () => {
    it("REG-01: tools from multiple extensions are all stored", () => {
      registry.registerTools("extensionA", [makeTool("extensionA:search")]);
      registry.registerTools("extensionB", [makeTool("extensionB:analyze")]);
      expect(registry.getAllTools()).toHaveLength(2);
    });

    it("REG-01: getAllTools() returns tools from all registered extensions", () => {
      registry.registerTools("extA", [makeTool("extA:tool1"), makeTool("extA:tool2")]);
      registry.registerTools("extB", [makeTool("extB:tool3")]);
      expect(registry.getAllTools()).toHaveLength(3);
    });

    it("REG-01: registration returns an object with dispose()", () => {
      const disposable = registry.registerTools("extA", [makeTool("extA:tool")]);
      expect(typeof disposable.dispose).toBe("function");
    });

    it("REG-01: registry.size reflects total registered tools", () => {
      registry.registerTools("extA", [makeTool("extA:t1"), makeTool("extA:t2")]);
      expect(registry.size).toBe(2);
    });
  });

  // ── REG-02: duplicate tool name throws ────────────────────────────────────

  describe("REG-02: duplicate tool name throws", () => {
    it("REG-02: registering a duplicate name throws with name in message", () => {
      registry.registerTools("extA", [makeTool("shared:tool")]);
      expect(() => registry.registerTools("extB", [makeTool("shared:tool")])).toThrow("shared:tool");
    });

    it("REG-02: error message includes the duplicate tool name", () => {
      registry.registerTools("extA", [makeTool("conflict:tool")]);
      expect(() => registry.registerTools("extB", [makeTool("conflict:tool")])).toThrow("conflict:tool");
    });

    it("REG-02: duplicate within same call also throws", () => {
      const tool = makeTool("duplicate:name");
      expect(() => registry.registerTools("extA", [tool, { ...tool }])).toThrow("duplicate:name");
    });
  });

  // ── REG-03: 100 ms debounce ───────────────────────────────────────────────

  describe("REG-03: 100 ms debounce on registry sends", () => {
    it("REG-03: send is not called before 100 ms have elapsed", () => {
      registry.registerTools("extA", [makeTool("extA:tool")]);
      vi.advanceTimersByTime(99);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("REG-03: send is called exactly once after 100 ms", () => {
      registry.registerTools("extA", [makeTool("extA:tool")]);
      vi.advanceTimersByTime(100);
      expect(sendSpy).toHaveBeenCalledOnce();
    });

    it("REG-03: multiple rapid registrations coalesce into a single send", () => {
      registry.registerTools("extA", [makeTool("extA:t1")]);
      registry.registerTools("extB", [makeTool("extB:t2")]);
      registry.registerTools("extC", [makeTool("extC:t3")]);
      vi.advanceTimersByTime(100);
      expect(sendSpy).toHaveBeenCalledOnce();
    });

    it("REG-03: send receives the current list of all tools", () => {
      registry.registerTools("extA", [makeTool("extA:t1")]);
      registry.registerTools("extB", [makeTool("extB:t2")]);
      vi.advanceTimersByTime(100);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "extA:t1" }),
          expect.objectContaining({ name: "extB:t2" }),
        ]),
      );
    });
  });

  // ── REG-04: getHandler() ──────────────────────────────────────────────────

  describe("REG-04: getHandler() returns correct handler", () => {
    it("REG-04: getHandler() returns the registered handler function", () => {
      const handler = vi.fn(async () => ({ ok: true }));
      registry.registerTools("extA", [makeTool("extA:search", { handler })]);
      expect(registry.getHandler("extA:search")).toBe(handler);
    });

    it("REG-04: getHandler() returns undefined for unknown tool name", () => {
      expect(registry.getHandler("nonexistent:tool")).toBeUndefined();
    });

    it("REG-04: handler is not included in getAllTools() output (never serialized)", () => {
      const handler = vi.fn(async () => ({}));
      registry.registerTools("extA", [makeTool("extA:private", { handler })]);
      const tools = registry.getAllTools();
      expect(JSON.stringify(tools)).not.toContain("handler");
    });

    it("REG-04: group field is included in getAllTools() wire format", () => {
      // arch §3.7: group is forwarded to Hub as metadata (no visibility effect — all tools always shown)
      const tool = makeTool("extA:grouped", { group: "editor" } as Partial<ExtensionToolDefinition>);
      registry.registerTools("extA", [tool]);
      const wire = registry.getAllTools();
      expect(wire).toHaveLength(1);
      expect(wire[0]).toHaveProperty("group", "editor");
    });

    it("REG-04: group field is omitted from wire format when not set", () => {
      registry.registerTools("extA", [makeTool("extA:ungrouped")]);
      const wire = registry.getAllTools();
      expect(wire[0]).not.toHaveProperty("group");
    });
  });

  // ── getTool ───────────────────────────────────────────────────────────────

  describe("getTool()", () => {
    it("getTool() returns undefined for unknown tool", () => {
      expect(registry.getTool("missing")).toBeUndefined();
    });

    it("getTool() returns tool registration after registration", () => {
      registry.registerTools("ext", [makeTool("ext:myTool")]);
      const spec = registry.getTool("ext:myTool");
      expect(spec).toBeDefined();
      expect(spec!.name).toBe("ext:myTool");
    });
  });

  // ── REG-06: validates inputSchema ────────────────────────────────────────

  describe("REG-06: validates inputSchema must be type:object", () => {
    it("REG-06: throws when inputSchema has type:string (not object)", () => {
      const invalid = makeTool("extA:invalid", {
        inputSchema: { type: "string" } as never,
      });
      expect(() => registry.registerTools("extA", [invalid])).toThrow("object");
    });

    it("REG-06: throws when inputSchema has type:array", () => {
      const invalid = makeTool("extA:array", {
        inputSchema: { type: "array" } as never,
      });
      expect(() => registry.registerTools("extA", [invalid])).toThrow("object");
    });

    it("REG-06: accepts valid inputSchema with type:object", () => {
      const valid = makeTool("extA:valid", {
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      });
      expect(() => registry.registerTools("extA", [valid])).not.toThrow();
    });
  });

  // ── REG-05: dispose() removes tools ──────────────────────────────────────

  describe("REG-05: dispose() removes tools", () => {
    it("REG-05: dispose() removes tools from registry", () => {
      const disposable = registry.registerTools("extA", [makeTool("extA:removable")]);
      disposable.dispose();
      expect(registry.getHandler("extA:removable")).toBeUndefined();
      expect(registry.getTool("extA:removable")).toBeUndefined();
    });

    it("REG-05: dispose() triggers a debounced registry send", () => {
      const disposable = registry.registerTools("extA", [makeTool("extA:gone")]);
      vi.advanceTimersByTime(100);
      vi.clearAllMocks();
      disposable.dispose();
      vi.advanceTimersByTime(100);
      expect(sendSpy).toHaveBeenCalledOnce();
    });

    it("REG-05: same tool name can be re-registered after dispose", () => {
      const d = registry.registerTools("extA", [makeTool("extA:reuse")]);
      d.dispose();
      expect(() => registry.registerTools("extA", [makeTool("extA:reuse")])).not.toThrow();
    });

    it("REG-05: dispose() decrements registry size", () => {
      registry.registerTools("extB", [makeTool("extB:keep")]);
      const d = registry.registerTools("extA", [makeTool("extA:gone")]);
      expect(registry.size).toBe(2);
      d.dispose();
      expect(registry.size).toBe(1);
    });
  });
});
