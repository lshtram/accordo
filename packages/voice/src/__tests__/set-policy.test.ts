/**
 * M50-POL — accordo_voice_setPolicy MCP tool tests (Phase B — must FAIL before implementation)
 * Coverage: M50-POL-01 through M50-POL-11
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSetPolicyTool } from "../tools/set-policy.js";
import type { SetPolicyToolDeps, ConfigUpdateFn } from "../tools/set-policy.js";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import { DEFAULT_VOICE_POLICY, NARRATION_MODES } from "../core/fsm/types.js";

function makeSessionFsm(stateOverride: string = "inactive"): SessionFsm {
  const _policy = { ...DEFAULT_VOICE_POLICY };
  return {
    get state() { return stateOverride; },
    get policy() { return { ..._policy }; },
    enable: vi.fn(),
    disable: vi.fn(),
    pushToTalkStart: vi.fn(),
    pushToTalkEnd: vi.fn(),
    updatePolicy: vi.fn().mockImplementation((partial: Partial<typeof _policy>) => {
      Object.assign(_policy, partial);
    }),
  } as unknown as SessionFsm;
}

function makeDeps(
  fsm: SessionFsm = makeSessionFsm(),
  updateConfig: ConfigUpdateFn = vi.fn().mockResolvedValue(undefined),
): SetPolicyToolDeps {
  return { sessionFsm: fsm, updateConfig };
}

describe("createSetPolicyTool", () => {
  it("M50-POL-00: createSetPolicyTool is exported as a function", () => {
    expect(typeof createSetPolicyTool).toBe("function");
  });

  it("M50-POL-01: tool name is 'accordo_voice_setPolicy'", () => {
    const tool = createSetPolicyTool(makeDeps());
    expect(tool.name).toBe("accordo_voice_setPolicy");
  });

  it("M50-POL-02: group is 'voice'", () => {
    const tool = createSetPolicyTool(makeDeps());
    expect(tool.group).toBe("voice");
  });

  it("M50-POL-03: description matches requirement", () => {
    const tool = createSetPolicyTool(makeDeps());
    expect(tool.description).toBe(
      "Update voice policy: enable/disable, narration mode, speed, voice, language",
    );
  });

  it("M50-POL-11: dangerLevel is 'safe' and idempotent is true", () => {
    const tool = createSetPolicyTool(makeDeps());
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(true);
  });

  it("M50-POL-07: enabled:true — calls sessionFsm.enable()", async () => {
    const fsm = makeSessionFsm("inactive");
    const tool = createSetPolicyTool(makeDeps(fsm));

    await tool.handler({ enabled: true });

    expect(fsm.enable).toHaveBeenCalled();
  });

  it("M50-POL-07: enabled:false — calls sessionFsm.disable()", async () => {
    const fsm = makeSessionFsm("active");
    const tool = createSetPolicyTool(makeDeps(fsm));

    await tool.handler({ enabled: false });

    expect(fsm.disable).toHaveBeenCalled();
  });

  it("M50-POL-05: valid fields passed to sessionFsm.updatePolicy()", async () => {
    const fsm = makeSessionFsm("inactive");
    const tool = createSetPolicyTool(makeDeps(fsm));

    await tool.handler({ speed: 1.5, voice: "fr-fr", narrationMode: "narrate-everything" });

    expect(fsm.updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.5, voice: "fr-fr", narrationMode: "narrate-everything" }),
    );
  });

  it("M50-POL-09: returns { policy: <new policy> } on success", async () => {
    const fsm = makeSessionFsm("inactive");
    const tool = createSetPolicyTool(makeDeps(fsm));

    const result = await tool.handler({ narrationMode: "narrate-summary" }) as Record<string, unknown>;

    expect(result).toHaveProperty("policy");
    expect(typeof result.policy).toBe("object");
  });

  it("M50-POL-06: speed below 0.5 returns error result (no throw)", async () => {
    const tool = createSetPolicyTool(makeDeps());

    const result = await tool.handler({ speed: 0.1 }) as Record<string, unknown>;

    expect(result).toHaveProperty("error");
    expect(result.policy).toBeUndefined();
  });

  it("M50-POL-06: speed above 2.0 returns error result (no throw)", async () => {
    const tool = createSetPolicyTool(makeDeps());

    const result = await tool.handler({ speed: 3.0 }) as Record<string, unknown>;

    expect(result).toHaveProperty("error");
  });

  it("M50-POL-06: invalid narrationMode returns error result (no throw)", async () => {
    const tool = createSetPolicyTool(makeDeps());

    const result = await tool.handler({ narrationMode: "invalid-mode" }) as Record<string, unknown>;

    expect(result).toHaveProperty("error");
  });

  it("M50-POL-06: empty voice string returns error result (no throw)", async () => {
    const tool = createSetPolicyTool(makeDeps());

    const result = await tool.handler({ voice: "" }) as Record<string, unknown>;

    expect(result).toHaveProperty("error");
  });

  it("M50-POL-08: persists to config via updateConfig for speed change", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined) as ConfigUpdateFn;
    const fsm = makeSessionFsm("inactive");
    const tool = createSetPolicyTool({ sessionFsm: fsm, updateConfig });

    await tool.handler({ speed: 1.2 });

    expect(updateConfig).toHaveBeenCalledWith(
      expect.stringContaining("speed"),
      1.2,
      expect.anything(),
    );
  });
});
