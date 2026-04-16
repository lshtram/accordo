/**
 * Tests for tool-registry.ts
 * Requirements: requirements-hub.md §5.1
 * DEC-006 — Dual-pool design (bridgeTools + hubTools)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolRegistration } from "@accordo/bridge-types";
import { ToolRegistry } from "../tool-registry.js";
import type { HubToolRegistration } from "../hub-tool-types.js";
import { isHubTool } from "../hub-tool-types.js";

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

const TOOL_OPEN = makeTool("accordo_editor_open");
const TOOL_CLOSE = makeTool("accordo_editor_close", { dangerLevel: "moderate" });
const TOOL_RUN = makeTool("accordo_terminal_run", {
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
      expect(registry.get("accordo_editor_open")).toEqual(TOOL_OPEN);
      expect(registry.get("accordo_editor_close")).toEqual(TOOL_CLOSE);
    });

    it("§5.1: register replaces the entire registry — not additive", () => {
      // req-hub §5.1: toolRegistry messages are full replacements
      registry.register([TOOL_OPEN, TOOL_CLOSE]);
      registry.register([TOOL_RUN]);
      expect(registry.get("accordo_editor_open")).toBeUndefined();
      expect(registry.get("accordo_terminal_run")).toBeDefined();
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
      const result = registry.get("accordo_terminal_run");
      expect(result).toEqual(TOOL_RUN);
    });

    it("§5.1: get returns undefined for unknown tool name", () => {
      registry.register([TOOL_OPEN]);
      expect(registry.get("accordo_nonexistent_tool")).toBeUndefined();
    });

    it("§5.1: get returns undefined on empty registry", () => {
      expect(registry.get("accordo_editor_open")).toBeUndefined();
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
      expect(tool).toHaveProperty("name", "accordo_terminal_run");
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

    it("§5.1: toMcpTools strips group field from output", () => {
      // req-hub §5.1 + arch §3.7: group is an internal field, must not leak to MCP
      const grouped = makeTool("accordo_editor_open", { group: "editor" });
      registry.register([grouped]);
      const mcpTools = registry.toMcpTools();
      expect(mcpTools).toHaveLength(1);
      expect(mcpTools[0]).not.toHaveProperty("group");
      expect(mcpTools[0]).toHaveProperty("name", "accordo_editor_open");
    });

    it("§5.1: toMcpTools includes grouped tools (MCP tools/list is unfiltered)", () => {
      // All tools must appear in tools/list regardless of group — filtering is prompt-engine's job
      const tools = [
        makeTool("accordo_editor_discover"),
        makeTool("accordo_editor_open", { group: "editor" }),
        makeTool("accordo_editor_close", { group: "editor" }),
      ];
      registry.register(tools);
      const mcpNames = registry.toMcpTools().map(t => t.name);
      expect(mcpNames).toContain("accordo_editor_discover");
      expect(mcpNames).toContain("accordo_editor_open");
      expect(mcpNames).toContain("accordo_editor_close");
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

// ── DEC-006: Dual-pool design (hubTools + bridgeTools) ───────────────────────

function makeHubTool(name: string): HubToolRegistration {
  return {
    name,
    description: `Hub-native tool: ${name}`,
    inputSchema: {
      type: "object",
      properties: {},
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    localHandler: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const HUB_TOOL_RUN = makeHubTool("accordo_hub_demo");
const HUB_TOOL_STOP = makeHubTool("accordo_hub_status");

describe("ToolRegistry — DEC-006: dual-pool design", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── registerHubTool ────────────────────────────────────────────────────────

  describe("registerHubTool", () => {
    it("DEC-006: registerHubTool adds to hubTools pool — retrievable by get()", () => {
      registry.registerHubTool(HUB_TOOL_RUN);

      const result = registry.get("accordo_hub_demo");
      expect(result).toBeDefined();
      expect(result?.name).toBe("accordo_hub_demo");
    });

    it("DEC-006: registerHubTool tool is identifiable as hub tool via isHubTool()", () => {
      registry.registerHubTool(HUB_TOOL_RUN);

      const result = registry.get("accordo_hub_demo");
      expect(result).toBeDefined();
      expect(isHubTool(result!)).toBe(true);
    });

    it("DEC-006: registerHubTool does NOT add to bridgeTools", () => {
      registry.registerHubTool(HUB_TOOL_RUN);

      // register() with empty list clears bridge tools — hub tool must survive
      registry.register([]);
      expect(registry.get("accordo_hub_demo")).toBeDefined();
    });

    it("DEC-006: registerHubTool replaces existing hub tool with same name", () => {
      const v1 = makeHubTool("accordo_hub_demo");
      const v2 = makeHubTool("accordo_hub_demo");
      v2.description = "Updated description";

      registry.registerHubTool(v1);
      registry.registerHubTool(v2);

      const result = registry.get("accordo_hub_demo");
      expect(result?.description).toBe("Updated description");
    });
  });

  // ── register (bridge) does not affect hub tools ────────────────────────────

  describe("register (bridge) vs hubTools", () => {
    it("DEC-006: register() clears only bridgeTools — hub tools survive", () => {
      registry.registerHubTool(HUB_TOOL_RUN);
      registry.registerHubTool(HUB_TOOL_STOP);
      registry.register([TOOL_OPEN, TOOL_CLOSE]);

      // Now replace bridge tools with a different set
      registry.register([TOOL_RUN]);

      // Bridge tools replaced: TOOL_OPEN and TOOL_CLOSE gone, TOOL_RUN present
      expect(registry.get("accordo_editor_open")).toBeUndefined();
      expect(registry.get("accordo_terminal_run")).toBeDefined();

      // Hub tools unchanged
      expect(registry.get("accordo_hub_demo")).toBeDefined();
      expect(registry.get("accordo_hub_status")).toBeDefined();
    });

    it("DEC-006: register() with empty list clears bridge tools, hub tools remain", () => {
      registry.registerHubTool(HUB_TOOL_RUN);
      registry.register([TOOL_OPEN]);

      registry.register([]);

      expect(registry.get("accordo_editor_open")).toBeUndefined();
      expect(registry.get("accordo_hub_demo")).toBeDefined();
      expect(registry.size).toBe(1); // only hub tool
    });
  });

  // ── list() merges both pools ───────────────────────────────────────────────

  describe("list — merging", () => {
    it("DEC-006: list() returns tools from both pools", () => {
      registry.registerHubTool(HUB_TOOL_RUN);
      registry.register([TOOL_OPEN]);

      const all = registry.list();
      const names = all.map(t => t.name);
      expect(names).toContain("accordo_hub_demo");
      expect(names).toContain("accordo_editor_open");
      expect(all).toHaveLength(2);
    });

    it("DEC-006: list() hub tools win on name collision", () => {
      // Create a bridge tool with the same name as a hub tool
      const bridgeCollision = makeTool("accordo_hub_demo", {
        description: "Bridge version (should lose)",
      });
      registry.register([bridgeCollision]);
      registry.registerHubTool(HUB_TOOL_RUN);

      const all = registry.list();
      const hubTool = all.find(t => t.name === "accordo_hub_demo");
      expect(hubTool).toBeDefined();
      // Hub tool wins — its description, not the bridge version's
      expect(hubTool?.description).toBe(HUB_TOOL_RUN.description);
      // Deduplicated — only one entry for the colliding name
      expect(all.filter(t => t.name === "accordo_hub_demo")).toHaveLength(1);
    });
  });

  // ── get() priority ─────────────────────────────────────────────────────────

  describe("get — priority", () => {
    it("DEC-006: get() checks hubTools first, then bridgeTools", () => {
      const bridgeVersion = makeTool("accordo_hub_demo", {
        description: "Bridge version",
      });
      registry.register([bridgeVersion]);
      registry.registerHubTool(HUB_TOOL_RUN);

      const result = registry.get("accordo_hub_demo");
      expect(result?.description).toBe(HUB_TOOL_RUN.description);
    });

    it("DEC-006: get() falls back to bridgeTools when hubTools has no match", () => {
      registry.register([TOOL_OPEN]);
      registry.registerHubTool(HUB_TOOL_RUN);

      const result = registry.get("accordo_editor_open");
      expect(result).toBeDefined();
      expect(result?.name).toBe("accordo_editor_open");
    });
  });

  // ── size with dual pools ──────────────────────────────────────────────────

  describe("size — dual pool", () => {
    it("DEC-006: size counts tools from both pools (deduplicated)", () => {
      registry.registerHubTool(HUB_TOOL_RUN);
      registry.registerHubTool(HUB_TOOL_STOP);
      registry.register([TOOL_OPEN, TOOL_CLOSE]);

      expect(registry.size).toBe(4);
    });

    it("DEC-006: size deduplicates on name collision", () => {
      const collision = makeTool("accordo_hub_demo");
      registry.register([collision, TOOL_OPEN]);
      registry.registerHubTool(HUB_TOOL_RUN);

      // 2 bridge + 1 hub, but 1 name collision → 2 unique
      expect(registry.size).toBe(2);
    });
  });

  // ── toMcpTools strips localHandler ────────────────────────────────────────

  describe("toMcpTools — hub tools", () => {
    it("DEC-005: toMcpTools strips localHandler from hub tools", () => {
      registry.registerHubTool(HUB_TOOL_RUN);

      const mcpTools = registry.toMcpTools();
      expect(mcpTools).toHaveLength(1);
      expect(mcpTools[0]).not.toHaveProperty("localHandler");
      expect(mcpTools[0]).toHaveProperty("name", "accordo_hub_demo");
    });
  });
});
