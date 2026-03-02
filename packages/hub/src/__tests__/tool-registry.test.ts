/**
 * Tests for tool-registry.ts
 * Requirements: requirements-hub.md §5.1
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolRegistration } from "@accordo/bridge-types";
import { ToolRegistry } from "../tool-registry.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTool(name: string, overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    name,
    description: `Description for ${name}`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "A path" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    ...overrides,
  };
}

const TOOL_OPEN = makeTool("accordo.editor.open");
const TOOL_CLOSE = makeTool("accordo.editor.close", { dangerLevel: "moderate" });
const TOOL_RUN = makeTool("accordo.terminal.run", {
  dangerLevel: "destructive",
  requiresConfirmation: true,
  idempotent: false,
});

// ── ToolRegistry ──────────────────────────────────────────────────────────────

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe("register", () => {
    it("§5.1: register stores tools retrievable by name", () => {
      // req-hub §5.1: register(tools: ToolRegistration[]) → void
      registry.register([TOOL_OPEN, TOOL_CLOSE]);
      expect(registry.get("accordo.editor.open")).toEqual(TOOL_OPEN);
      expect(registry.get("accordo.editor.close")).toEqual(TOOL_CLOSE);
    });

    it("§5.1: register replaces the entire registry — not additive", () => {
      // req-hub §5.1: toolRegistry messages are full replacements
      registry.register([TOOL_OPEN, TOOL_CLOSE]);
      registry.register([TOOL_RUN]);
      expect(registry.get("accordo.editor.open")).toBeUndefined();
      expect(registry.get("accordo.terminal.run")).toBeDefined();
    });

    it("§5.1: register with empty list clears the registry", () => {
      registry.register([TOOL_OPEN]);
      registry.register([]);
      expect(registry.list()).toEqual([]);
      expect(registry.size).toBe(0);
    });

    it("§5.1: register accepts up to 16 tools without error", () => {
      const tools = Array.from({ length: 16 }, (_, i) => makeTool(`accordo.tool.${i}`));
      registry.register(tools);
      expect(registry.size).toBe(16);
    });
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("§5.1: get returns the matching tool by name", () => {
      // req-hub §5.1: get(name: string) → ToolRegistration | undefined
      registry.register([TOOL_OPEN, TOOL_RUN]);
      const result = registry.get("accordo.terminal.run");
      expect(result).toEqual(TOOL_RUN);
    });

    it("§5.1: get returns undefined for unknown tool name", () => {
      registry.register([TOOL_OPEN]);
      expect(registry.get("accordo.nonexistent.tool")).toBeUndefined();
    });

    it("§5.1: get returns undefined on empty registry", () => {
      expect(registry.get("accordo.editor.open")).toBeUndefined();
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("§5.1: list returns all registered tools", () => {
      // req-hub §5.1: list() → ToolRegistration[]
      registry.register([TOOL_OPEN, TOOL_CLOSE, TOOL_RUN]);
      const result = registry.list();
      expect(result).toHaveLength(3);
      expect(result).toContainEqual(TOOL_OPEN);
      expect(result).toContainEqual(TOOL_CLOSE);
      expect(result).toContainEqual(TOOL_RUN);
    });

    it("§5.1: list returns empty array on empty registry", () => {
      expect(registry.list()).toEqual([]);
    });

    it("§5.1: list returns a copy — mutations do not affect the registry", () => {
      registry.register([TOOL_OPEN]);
      registry.list().push(TOOL_CLOSE);
      expect(registry.size).toBe(1);
    });
  });

  // ── toMcpTools ────────────────────────────────────────────────────────────

  describe("toMcpTools", () => {
    it("§5.1: toMcpTools strips dangerLevel, requiresConfirmation, idempotent", () => {
      // req-hub §5.1: toMcpTools() → McpTool[] — strip internal fields
      registry.register([TOOL_RUN]);
      const mcpTools = registry.toMcpTools();
      expect(mcpTools).toHaveLength(1);
      const tool = mcpTools[0];
      expect(tool).toHaveProperty("name", "accordo.terminal.run");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).not.toHaveProperty("dangerLevel");
      expect(tool).not.toHaveProperty("requiresConfirmation");
      expect(tool).not.toHaveProperty("idempotent");
    });

    it("§5.1: toMcpTools returns empty array on empty registry", () => {
      expect(registry.toMcpTools()).toEqual([]);
    });

    it("§5.1: toMcpTools preserves registration order", () => {
      const tools = [TOOL_OPEN, TOOL_CLOSE, TOOL_RUN];
      registry.register(tools);
      const mcpNames = registry.toMcpTools().map((t) => t.name);
      const listNames = registry.list().map((t) => t.name);
      expect(mcpNames).toEqual(listNames);
    });
  });

  // ── size ──────────────────────────────────────────────────────────────────

  describe("size", () => {
    it("§5.1: size is 0 for empty registry", () => {
      expect(registry.size).toBe(0);
    });

    it("§5.1: size reflects number of registered tools", () => {
      registry.register([TOOL_OPEN, TOOL_CLOSE]);
      expect(registry.size).toBe(2);
    });

    it("§5.1: size updates after re-registration", () => {
      registry.register([TOOL_OPEN, TOOL_CLOSE, TOOL_RUN]);
      registry.register([TOOL_OPEN]);
      expect(registry.size).toBe(1);
    });
  });
});
