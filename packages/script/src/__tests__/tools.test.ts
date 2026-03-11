/**
 * M52-TOOL — MCP tool tests (Phase B — must FAIL before implementation)
 * Coverage: M52-TOOL-01 through M52-TOOL-11
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRunScriptTool } from "../tools/run-script.js";
import { makeStopScriptTool } from "../tools/stop-script.js";
import { makeScriptStatusTool } from "../tools/script-status.js";
import type { ScriptRunner } from "../script-runner.js";
import type { ScriptStatus } from "../script-types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRunner(overrides: Partial<{
  state: ScriptRunner["state"];
  status: ScriptStatus;
  run: ScriptRunner["run"];
  stop: ScriptRunner["stop"];
}>  = {}): ScriptRunner {
  const defaultStatus: ScriptStatus = {
    state: "idle",
    currentStep: -1,
    totalSteps: 0,
  };
  return {
    state: "idle",
    status: defaultStatus,
    run: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ScriptRunner;
}

const VALID_SCRIPT = { steps: [{ type: "clear-highlights" }] };
const INVALID_SCRIPT = { steps: [] }; // empty steps array — FMT-01

beforeEach(() => {
  vi.clearAllMocks();
});

// ── accordo_script_run ────────────────────────────────────────────────────────

describe("accordo_script_run", () => {
  describe("M52-TOOL-01 validation", () => {
    it("returns { error } for invalid script (empty steps)", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      const result = await tool.handler({ script: INVALID_SCRIPT }) as Record<string, unknown>;

      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe("string");
    });

    it("returns { error } when script is not an object", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      const result = await tool.handler({ script: null }) as Record<string, unknown>;
      expect(result.error).toBeTruthy();
    });

    it("does NOT call runner.run() on invalid script", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      await tool.handler({ script: INVALID_SCRIPT });
      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe("M52-TOOL-02 busy check", () => {
    it("returns busy error when runner is already running", async () => {
      const runner = makeRunner({ state: "running" });
      const tool = makeRunScriptTool(runner);

      const result = await tool.handler({ script: VALID_SCRIPT }) as Record<string, unknown>;

      expect(result.error).toContain("already running");
    });

    it("does NOT call runner.run() when busy", async () => {
      const runner = makeRunner({ state: "running" });
      const tool = makeRunScriptTool(runner);

      await tool.handler({ script: VALID_SCRIPT });
      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe("M52-TOOL-03 successful start", () => {
    it("returns { started: true, scriptId, steps }", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      const result = await tool.handler({ script: VALID_SCRIPT }) as Record<string, unknown>;

      expect(result.started).toBe(true);
      expect(typeof result.scriptId).toBe("string");
      expect((result.scriptId as string).length).toBeGreaterThan(0);
      expect(result.steps).toBe(1);
    });

    it("calls runner.run() with the validated script", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      await tool.handler({ script: VALID_SCRIPT });
      expect(runner.run).toHaveBeenCalledOnce();
    });

    it("each call generates a unique scriptId", async () => {
      const tool = makeRunScriptTool(makeRunner());
      const tool2 = makeRunScriptTool(makeRunner());

      const r1 = await tool.handler({ script: VALID_SCRIPT }) as Record<string, unknown>;
      const r2 = await tool2.handler({ script: VALID_SCRIPT }) as Record<string, unknown>;

      expect(r1.scriptId).not.toBe(r2.scriptId);
    });

    it("includes label in response when present in script", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);
      const script = { ...VALID_SCRIPT, label: "My Demo" };

      const result = await tool.handler({ script }) as Record<string, unknown>;

      expect(result.label).toBe("My Demo");
    });
  });

  describe("M52-TOOL-04 fire-and-forget timing", () => {
    it("returns in < 10 ms (does not await step execution)", async () => {
      const runner = makeRunner();
      const tool = makeRunScriptTool(runner);

      const start = Date.now();
      await tool.handler({ script: VALID_SCRIPT });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10);
    });
  });

  describe("M52-TOOL-10 / M52-TOOL-11 tool metadata", () => {
    it("tool name is accordo_script_run", () => {
      const tool = makeRunScriptTool(makeRunner());
      expect(tool.name).toBe("accordo_script_run");
    });

    it("dangerLevel is safe", () => {
      const tool = makeRunScriptTool(makeRunner());
      expect(tool.dangerLevel).toBe("safe");
    });

    it("group is 'script'", () => {
      const tool = makeRunScriptTool(makeRunner());
      expect(tool.group).toBe("script");
    });
  });
});

// ── accordo_script_stop ───────────────────────────────────────────────────────

describe("accordo_script_stop", () => {
  describe("M52-TOOL-05 stop behaviour", () => {
    it("calls runner.stop()", async () => {
      const runner = makeRunner({ state: "running" });
      const tool = makeStopScriptTool(runner);

      await tool.handler({});
      expect(runner.stop).toHaveBeenCalled();
    });

    it("never throws even when runner is idle", async () => {
      const runner = makeRunner({ state: "idle" });
      const tool = makeStopScriptTool(runner);

      await expect(tool.handler({})).resolves.not.toThrow();
    });
  });

  describe("M52-TOOL-06 wasRunning flag", () => {
    it("wasRunning:true when runner was in running state", async () => {
      const runner = makeRunner({ state: "running" });
      const tool = makeStopScriptTool(runner);

      const result = await tool.handler({}) as Record<string, unknown>;
      expect(result.wasRunning).toBe(true);
    });

    it("wasRunning:false when runner was idle", async () => {
      const runner = makeRunner({ state: "idle" });
      const tool = makeStopScriptTool(runner);

      const result = await tool.handler({}) as Record<string, unknown>;
      expect(result.wasRunning).toBe(false);
    });
  });

  describe("M52-TOOL-07 response returned immediately", () => {
    it("returns { stopped, wasRunning } without awaiting full stop", async () => {
      let resolveStop!: () => void;
      const runner = makeRunner({
        state: "running",
        stop: vi.fn(() => new Promise<void>(r => { resolveStop = r; })),
      });
      const tool = makeStopScriptTool(runner);

      const start = Date.now();
      const result = await tool.handler({}) as Record<string, unknown>;
      const elapsed = Date.now() - start;

      expect(result.stopped).toBe(true);
      expect(elapsed).toBeLessThan(50);

      resolveStop(); // clean up
    });
  });

  describe("M52-TOOL-10 / M52-TOOL-11 tool metadata", () => {
    it("tool name is accordo_script_stop", () => {
      const tool = makeStopScriptTool(makeRunner());
      expect(tool.name).toBe("accordo_script_stop");
    });

    it("dangerLevel is safe", () => {
      expect(makeStopScriptTool(makeRunner()).dangerLevel).toBe("safe");
    });

    it("group is 'script'", () => {
      expect(makeStopScriptTool(makeRunner()).group).toBe("script");
    });
  });
});

// ── accordo_script_status ─────────────────────────────────────────────────────

describe("accordo_script_status", () => {
  describe("M52-TOOL-08 read-only status", () => {
    it("returns current runner status without calling run or stop", async () => {
      const runner = makeRunner();
      const tool = makeScriptStatusTool(runner);

      const result = await tool.handler({}) as Record<string, unknown>;

      expect(result.state).toBe("idle");
      expect(runner.run).not.toHaveBeenCalled();
      expect(runner.stop).not.toHaveBeenCalled();
    });

    it("reflects state changes on the runner", async () => {
      const runner = makeRunner({
        state: "running",
        status: {
          state: "running",
          currentStep: 2,
          totalSteps: 5,
          label: "My Script",
          scriptId: "abc-123",
        },
      });
      const tool = makeScriptStatusTool(runner);

      const result = await tool.handler({}) as Record<string, unknown>;

      expect(result.state).toBe("running");
      expect(result.currentStep).toBe(2);
      expect(result.totalSteps).toBe(5);
      expect(result.label).toBe("My Script");
      expect(result.scriptId).toBe("abc-123");
    });
  });

  describe("M52-TOOL-09 idle defaults", () => {
    it("currentStep is -1 and totalSteps is 0 when idle with no prior run", async () => {
      const runner = makeRunner();
      const tool = makeScriptStatusTool(runner);

      const result = await tool.handler({}) as Record<string, unknown>;

      expect(result.currentStep).toBe(-1);
      expect(result.totalSteps).toBe(0);
    });
  });

  describe("M52-TOOL-10 / M52-TOOL-11 tool metadata", () => {
    it("tool name is accordo_script_status", () => {
      expect(makeScriptStatusTool(makeRunner()).name).toBe("accordo_script_status");
    });

    it("dangerLevel is safe", () => {
      expect(makeScriptStatusTool(makeRunner()).dangerLevel).toBe("safe");
    });

    it("group is 'script'", () => {
      expect(makeScriptStatusTool(makeRunner()).group).toBe("script");
    });

    it("idempotent is true", () => {
      expect(makeScriptStatusTool(makeRunner()).idempotent).toBe(true);
    });
  });
});
