/**
 * M50-DT — accordo_voice_discover MCP tool tests (Phase B — must FAIL before implementation)
 * Coverage: M50-DT-01 through M50-DT-06
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDiscoverTool } from "../tools/discover.js";
import type { DiscoverToolDeps } from "../tools/discover.js";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { AudioFsm } from "../core/fsm/audio-fsm.js";
import type { NarrationFsm } from "../core/fsm/narration-fsm.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";
import { DEFAULT_VOICE_POLICY } from "../core/fsm/types.js";

function makeSessionFsm(overrides: Partial<SessionFsm> = {}): SessionFsm {
  return {
    state: "inactive",
    policy: { ...DEFAULT_VOICE_POLICY },
    enable: vi.fn(),
    disable: vi.fn(),
    pushToTalkStart: vi.fn(),
    pushToTalkEnd: vi.fn(),
    updatePolicy: vi.fn(),
    ...overrides,
  } as unknown as SessionFsm;
}

function makeAudioFsm(overrides: Partial<AudioFsm> = {}): AudioFsm {
  return {
    state: "idle",
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    transcriptReady: vi.fn(),
    error: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as unknown as AudioFsm;
}

function makeNarrationFsm(overrides: Partial<NarrationFsm> = {}): NarrationFsm {
  return {
    state: "idle",
    queueLength: 0,
    enqueue: vi.fn(),
    startProcessing: vi.fn(),
    audioReady: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    complete: vi.fn().mockReturnValue(undefined),
    error: vi.fn(),
    ...overrides,
  } as unknown as NarrationFsm;
}

function makeSttProvider(available = true): SttProvider {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn(),
  } as unknown as SttProvider;
}

function makeTtsProvider(available = true): TtsProvider {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    synthesize: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as TtsProvider;
}

function makeDeps(overrides: Partial<DiscoverToolDeps> = {}): DiscoverToolDeps {
  return {
    sessionFsm: makeSessionFsm(),
    audioFsm: makeAudioFsm(),
    narrationFsm: makeNarrationFsm(),
    sttProvider: makeSttProvider(),
    ttsProvider: makeTtsProvider(),
    ...overrides,
  };
}

describe("createDiscoverTool", () => {
  it("M50-DT-00: createDiscoverTool is exported as a function", () => {
    expect(typeof createDiscoverTool).toBe("function");
  });

  it("M50-DT-01: tool name is 'accordo_voice_discover'", () => {
    const tool = createDiscoverTool(makeDeps());
    expect(tool.name).toBe("accordo_voice_discover");
  });

  it("M50-DT-02: group is 'voice'", () => {
    const tool = createDiscoverTool(makeDeps());
    expect(tool.group).toBe("voice");
  });

  it("M50-DT-03: description matches requirement", () => {
    const tool = createDiscoverTool(makeDeps());
    expect(tool.description).toBe("Discover available voice tools and current voice state");
  });

  it("M50-DT-04: inputSchema is an empty object schema (no required properties)", () => {
    const tool = createDiscoverTool(makeDeps());
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    // no required parameters
    const required = (tool.inputSchema as Record<string, unknown>).required;
    expect(!required || (Array.isArray(required) && required.length === 0)).toBe(true);
  });

  it("M50-DT-06: dangerLevel is 'safe' and idempotent is true", () => {
    const tool = createDiscoverTool(makeDeps());
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(true);
  });

  it("M50-DT-05: handler returns tools list, session state, policy, STT/TTS availability", async () => {
    const stt = makeSttProvider(true);
    const tts = makeTtsProvider(false);
    const session = makeSessionFsm({ state: "active" } as Partial<SessionFsm>);
    const deps = makeDeps({ sttProvider: stt, ttsProvider: tts, sessionFsm: session });
    const tool = createDiscoverTool(deps);

    const result = await tool.handler({});

    expect(result).toHaveProperty("tools");
    expect(Array.isArray((result as Record<string, unknown>).tools)).toBe(true);
    expect(result).toHaveProperty("sessionState", "active");
    expect(result).toHaveProperty("policy");
    expect(result).toHaveProperty("sttAvailable", true);
    expect(result).toHaveProperty("ttsAvailable", false);
  });
});
