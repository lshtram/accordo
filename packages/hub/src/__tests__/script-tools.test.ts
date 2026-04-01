/**
 * Tests for script-tools.ts
 * Requirements: M52-TOOL-01 through M52-TOOL-04
 * DEC-005 — Hub-native tool local handler pattern
 *
 * Tests the 4 factory functions that create Hub-native script tools
 * as HubToolRegistration objects with localHandler.
 *
 * Test plan items covered:
 * 1. Each factory returns a HubToolRegistration
 * 2. Returned tool has correct name, description, inputSchema
 * 3. localHandler is called with correct args and returns the handler's result
 * 4. localHandler throws/rejects when the handler throws/rejects
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeRunScriptTool,
  makeStopScriptTool,
  makeScriptStatusTool,
  makeScriptDiscoverTool,
  createScriptTools,
} from "../script/script-tools.js";
import type { ScriptToolDeps } from "../script/script-tools.js";
import { isHubTool } from "../hub-tool-types.js";
import { ScriptRunner } from "../script/script-runner.js";
import type { ScriptRunnerDeps } from "../script/script-runner.js";
import { ToolRegistry } from "../tool-registry.js";

// ── Mock deps ────────────────────────────────────────────────────────────────

function makeMockScriptRunnerDeps(): ScriptRunnerDeps {
  return {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    speakText: vi.fn().mockResolvedValue(undefined),
    showSubtitle: vi.fn(),
    openAndHighlight: vi.fn().mockResolvedValue(undefined),
    clearHighlights: vi.fn(),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

function makeToolDeps(): ScriptToolDeps {
  const runnerDeps = makeMockScriptRunnerDeps();
  const runner = new ScriptRunner(runnerDeps);
  const toolRegistry = new ToolRegistry();
  return { runner, toolRegistry };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("script-tools factories", () => {
  let toolDeps: ScriptToolDeps;

  beforeEach(() => {
    toolDeps = makeToolDeps();
  });

  // ── makeRunScriptTool ─────────────────────────────────────────────────────

  describe("makeRunScriptTool", () => {
    it("M52-TOOL-01: returns a HubToolRegistration (isHubTool guard passes)", () => {
      const tool = makeRunScriptTool(toolDeps);
      expect(isHubTool(tool)).toBe(true);
    });

    it("M52-TOOL-01: tool name is 'accordo_script_run'", () => {
      const tool = makeRunScriptTool(toolDeps);
      expect(tool.name).toBe("accordo_script_run");
    });

    it("M52-TOOL-01: tool has a non-empty description", () => {
      const tool = makeRunScriptTool(toolDeps);
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it("M52-TOOL-01: inputSchema requires 'script' property", () => {
      const tool = makeRunScriptTool(toolDeps);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required).toContain("script");
    });

    it("M52-TOOL-01: localHandler accepts script args and returns a result", async () => {
      const tool = makeRunScriptTool(toolDeps);
      const script = {
        steps: [{ type: "delay", ms: 100 }],
      };

      // Stub: localHandler currently throws "not implemented"
      // After implementation it should return a result with scriptId
      const result = await tool.localHandler({ script });

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    // NOTE: localHandler starts the runner fire-and-forget — it returns immediately
    // after calling runner.run() without awaiting completion. The second call should
    // reject because the runner's state is "running" when the first script hasn't finished.
    it("M52-TOOL-01: localHandler rejects when runner is already running", async () => {
      // Override wait to never resolve — keeps the runner stuck in "running" state
      // so the second call finds it busy.
      const hangingDeps = makeMockScriptRunnerDeps();
      hangingDeps.wait = vi.fn().mockReturnValue(new Promise(() => {}));
      const runner = new ScriptRunner(hangingDeps);
      const deps: ScriptToolDeps = { runner, toolRegistry: new ToolRegistry() };
      const tool = makeRunScriptTool(deps);

      // Use a valid delay (≤ 30 000) so the script passes validation
      const longScript = { steps: [{ type: "delay", ms: 100 }] };
      // First call should succeed (starts runner, returns immediately)
      await tool.localHandler({ script: longScript });

      // Second call while running should reject
      await expect(
        tool.localHandler({ script: longScript }),
      ).rejects.toThrow(/already running/i);
    });

    it("A4: localHandler returns a result with a real scriptId (not undefined)", async () => {
      const tool = makeRunScriptTool(toolDeps);
      const script = {
        steps: [{ type: "delay", ms: 100 }],
      };

      const result = await tool.localHandler({ script }) as Record<string, unknown>;

      expect(result).toHaveProperty("scriptId");
      expect(typeof result.scriptId).toBe("string");
      expect((result.scriptId as string).length).toBeGreaterThan(0);
    });

    // B6: Input validation — invalid scripts should be rejected before reaching the runner
    it("B6: localHandler throws on invalid script (missing steps)", async () => {
      const tool = makeRunScriptTool(toolDeps);
      // Script with no steps array → validateScript should flag it
      await expect(
        tool.localHandler({ script: {} }),
      ).rejects.toThrow(/invalid script/i);
    });

    it("B6: localHandler throws on invalid script (step type out of range)", async () => {
      const tool = makeRunScriptTool(toolDeps);
      // Delay with ms exceeding 30 000 → validateScript rejects
      await expect(
        tool.localHandler({ script: { steps: [{ type: "delay", ms: 999_999 }] } }),
      ).rejects.toThrow(/invalid script/i);
    });

    it("B6: localHandler throws when called with no script property", async () => {
      const tool = makeRunScriptTool(toolDeps);
      // No script key at all — validateScript receives undefined
      await expect(
        tool.localHandler({}),
      ).rejects.toThrow();
    });
  });

  // ── makeStopScriptTool ────────────────────────────────────────────────────

  describe("makeStopScriptTool", () => {
    it("M52-TOOL-02: returns a HubToolRegistration (isHubTool guard passes)", () => {
      const tool = makeStopScriptTool(toolDeps);
      expect(isHubTool(tool)).toBe(true);
    });

    it("M52-TOOL-02: tool name is 'accordo_script_stop'", () => {
      const tool = makeStopScriptTool(toolDeps);
      expect(tool.name).toBe("accordo_script_stop");
    });

    it("M52-TOOL-02: tool is idempotent", () => {
      const tool = makeStopScriptTool(toolDeps);
      expect(tool.idempotent).toBe(true);
    });

    it("M52-TOOL-02: localHandler returns a result (does not throw when idle)", async () => {
      const tool = makeStopScriptTool(toolDeps);

      const result = await tool.localHandler({});

      expect(result).toBeDefined();
    });
  });

  // ── makeScriptStatusTool ─────────────────────────────────────────────────

  describe("makeScriptStatusTool", () => {
    it("M52-TOOL-03: returns a HubToolRegistration (isHubTool guard passes)", () => {
      const tool = makeScriptStatusTool(toolDeps);
      expect(isHubTool(tool)).toBe(true);
    });

    it("M52-TOOL-03: tool name is 'accordo_script_status'", () => {
      const tool = makeScriptStatusTool(toolDeps);
      expect(tool.name).toBe("accordo_script_status");
    });

    it("M52-TOOL-03: tool is idempotent", () => {
      const tool = makeScriptStatusTool(toolDeps);
      expect(tool.idempotent).toBe(true);
    });

    it("M52-TOOL-03: localHandler returns ScriptStatus shape with state field", async () => {
      const tool = makeScriptStatusTool(toolDeps);

      const result = await tool.localHandler({}) as Record<string, unknown>;

      expect(result).toHaveProperty("state");
      expect(typeof result.state).toBe("string");
    });
  });

  // ── makeScriptDiscoverTool ───────────────────────────────────────────────

  describe("makeScriptDiscoverTool", () => {
    it("M52-TOOL-04: returns a HubToolRegistration (isHubTool guard passes)", () => {
      const tool = makeScriptDiscoverTool(toolDeps);
      expect(isHubTool(tool)).toBe(true);
    });

    it("M52-TOOL-04: tool name is 'accordo_script_discover'", () => {
      const tool = makeScriptDiscoverTool(toolDeps);
      expect(tool.name).toBe("accordo_script_discover");
    });

    it("M52-TOOL-04: tool is idempotent", () => {
      const tool = makeScriptDiscoverTool(toolDeps);
      expect(tool.idempotent).toBe(true);
    });

    it("M52-TOOL-04: localHandler returns reference info with step types", async () => {
      const tool = makeScriptDiscoverTool(toolDeps);

      const result = await tool.localHandler({});

      // Should return an object or string containing step type reference info
      expect(result).toBeDefined();
    });

    it("M52-TOOL-04: localHandler includes registered tool names from toolRegistry", async () => {
      // Register some tools in the registry
      toolDeps.toolRegistry.register([
        {
          name: "accordo_editor_open",
          description: "Open a file",
          inputSchema: { type: "object" as const, properties: {} },
          dangerLevel: "safe",
          requiresConfirmation: false,
          idempotent: true,
        },
      ]);

      const tool = makeScriptDiscoverTool(toolDeps);
      const result = await tool.localHandler({});

      // The result should include the registered tool names
      const text = typeof result === "string" ? result : JSON.stringify(result);
      expect(text).toContain("accordo_editor_open");
    });
  });

  // ── createScriptTools ────────────────────────────────────────────────────

  describe("createScriptTools", () => {
    it("returns exactly 4 tools", () => {
      const tools = createScriptTools(toolDeps);
      expect(tools).toHaveLength(4);
    });

    it("all 4 tools are HubToolRegistrations", () => {
      const tools = createScriptTools(toolDeps);
      for (const tool of tools) {
        expect(isHubTool(tool)).toBe(true);
      }
    });

    it("returned tools have unique names", () => {
      const tools = createScriptTools(toolDeps);
      const names = tools.map(t => t.name);
      expect(new Set(names).size).toBe(4);
    });

    it("returned tool names match expected script tool names", () => {
      const tools = createScriptTools(toolDeps);
      const names = tools.map(t => t.name).sort();
      expect(names).toEqual([
        "accordo_script_discover",
        "accordo_script_run",
        "accordo_script_status",
        "accordo_script_stop",
      ]);
    });
  });
});
