/**
 * M50-DI — accordo_voice_dictation MCP tool tests (Phase B — must FAIL before implementation)
 * Coverage: M50-DI-01 through M50-DI-12
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDictationTool } from "../tools/dictation.js";
import type { DictationToolDeps, RecordingHandle, StartRecordingFn, InsertTextFn } from "../tools/dictation.js";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { AudioFsm } from "../core/fsm/audio-fsm.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { VoiceVocabulary } from "../text/vocabulary.js";
import { DEFAULT_VOICE_POLICY } from "../core/fsm/types.js";

function makeSessionFsm(): SessionFsm {
  return {
    state: "active",
    policy: { ...DEFAULT_VOICE_POLICY },
    enable: vi.fn(),
    disable: vi.fn(),
    pushToTalkStart: vi.fn(),
    pushToTalkEnd: vi.fn(),
    updatePolicy: vi.fn(),
  } as unknown as SessionFsm;
}

function makeAudioFsm(stateOverride: string = "idle"): AudioFsm {
  return {
    get state() { return stateOverride; },
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    transcriptReady: vi.fn(),
    error: vi.fn(),
    reset: vi.fn(),
  } as unknown as AudioFsm;
}

function makeSttProvider(available = true, transcript = "hello world"): SttProvider {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn().mockResolvedValue({ text: transcript }),
  } as unknown as SttProvider;
}

function makeRecordingHandle(pcm = new Uint8Array([0, 1, 2])): RecordingHandle {
  return {
    stop: vi.fn().mockResolvedValue(pcm),
  };
}

function makeVocabulary(): VoiceVocabulary {
  return {
    process: vi.fn().mockImplementation((t: string) => t),
    getEntries: vi.fn().mockReturnValue([]),
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    setEntries: vi.fn(),
  } as unknown as VoiceVocabulary;
}

function makeDeps(
  audioFsmState = "idle",
  overrides: Partial<DictationToolDeps> = {},
): DictationToolDeps {
  return {
    sessionFsm: makeSessionFsm(),
    audioFsm: makeAudioFsm(audioFsmState),
    sttProvider: makeSttProvider(),
    vocabulary: makeVocabulary(),
    startRecording: vi.fn().mockReturnValue(makeRecordingHandle()) as unknown as StartRecordingFn,
    ...overrides,
  };
}

describe("createDictationTool", () => {
  it("M50-DI-00: createDictationTool is exported as a function", () => {
    expect(typeof createDictationTool).toBe("function");
  });

  it("M50-DI-01: tool name is 'accordo_voice_dictation'", () => {
    const tool = createDictationTool(makeDeps());
    expect(tool.name).toBe("accordo_voice_dictation");
  });

  it("M50-DI-02: group is 'voice'", () => {
    const tool = createDictationTool(makeDeps());
    expect(tool.group).toBe("voice");
  });

  it("M50-DI-03: description matches requirement", () => {
    const tool = createDictationTool(makeDeps());
    expect(tool.description).toBe(
      "Record audio and transcribe speech-to-text. Returns the transcript.",
    );
  });

  it("M50-DI-12: dangerLevel is 'safe' and idempotent is false", () => {
    const tool = createDictationTool(makeDeps());
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(false);
  });

  it("M50-DI-05: action:start — starts recording and returns { recording: true }", async () => {
    const startRecording = vi.fn().mockReturnValue(makeRecordingHandle()) as unknown as StartRecordingFn;
    const tool = createDictationTool(makeDeps("idle", { startRecording }));

    const result = await tool.handler({ action: "start" });

    expect(result).toEqual({ recording: true });
    expect(startRecording).toHaveBeenCalled();
  });

  it("M50-DI-11: action:start — calls sessionFsm.pushToTalkStart and audioFsm.startCapture", async () => {
    const sessionFsm = makeSessionFsm();
    const audioFsm = makeAudioFsm("idle");
    const tool = createDictationTool(makeDeps("idle", { sessionFsm, audioFsm }));

    await tool.handler({ action: "start" });

    expect(sessionFsm.pushToTalkStart).toHaveBeenCalled();
    expect(audioFsm.startCapture).toHaveBeenCalled();
  });

  it("M50-DI-06: action:stop — stops recording, transcribes, returns { text }", async () => {
    const handle = makeRecordingHandle();
    const startRecording = vi.fn().mockReturnValue(handle) as unknown as StartRecordingFn;
    const deps = makeDeps("listening", { startRecording });
    const tool = createDictationTool(deps);

    // Start first to set active recording
    await tool.handler({ action: "start" });
    const result = await tool.handler({ action: "stop" }) as Record<string, unknown>;

    expect(typeof result.text).toBe("string");
    expect(handle.stop).toHaveBeenCalled();
  });

  it("M50-DI-11: action:stop — calls audioFsm.stopCapture and transcriptReady", async () => {
    const handle = makeRecordingHandle();
    const startRecording = vi.fn().mockReturnValue(handle) as unknown as StartRecordingFn;
    const audioFsm = makeAudioFsm("listening");
    const deps = makeDeps("listening", { startRecording, audioFsm });
    const tool = createDictationTool(deps);

    await tool.handler({ action: "start" });
    await tool.handler({ action: "stop" });

    expect(audioFsm.stopCapture).toHaveBeenCalled();
    expect(audioFsm.transcriptReady).toHaveBeenCalled();
  });

  it("M50-DI-09: vocabulary.process applied to transcript", async () => {
    const handle = makeRecordingHandle();
    const startRecording = vi.fn().mockReturnValue(handle) as unknown as StartRecordingFn;
    const vocabulary = makeVocabulary();
    (vocabulary.process as ReturnType<typeof vi.fn>).mockReturnValue("processed text");
    const deps = makeDeps("idle", { startRecording, vocabulary });
    const tool = createDictationTool(deps);

    await tool.handler({ action: "start" });
    const result = await tool.handler({ action: "stop" }) as Record<string, unknown>;

    expect(vocabulary.process).toHaveBeenCalled();
    expect(result.text).toBe("processed text");
  });

  it("M50-DI-08: insertAtCursor:true — calls insertText with transcript", async () => {
    const handle = makeRecordingHandle();
    const startRecording = vi.fn().mockReturnValue(handle) as unknown as StartRecordingFn;
    const insertText = vi.fn().mockResolvedValue(undefined) as InsertTextFn;
    const deps = makeDeps("idle", { startRecording, insertText });
    const tool = createDictationTool(deps);

    await tool.handler({ action: "start" });
    await tool.handler({ action: "stop", insertAtCursor: true });

    expect(insertText).toHaveBeenCalledWith(expect.any(String));
  });

  it("M50-DI-07: action:toggle starts when idle", async () => {
    const startRecording = vi.fn().mockReturnValue(makeRecordingHandle()) as unknown as StartRecordingFn;
    const tool = createDictationTool(makeDeps("idle", { startRecording }));

    const result = await tool.handler({ action: "toggle" });

    expect(result).toEqual({ recording: true });
    expect(startRecording).toHaveBeenCalled();
  });

  it("M50-DI-07: action:toggle stops when already recording", async () => {
    const handle = makeRecordingHandle();
    const startRecording = vi.fn().mockReturnValue(handle) as unknown as StartRecordingFn;
    const deps = makeDeps("idle", { startRecording });
    const tool = createDictationTool(deps);

    // start first
    await tool.handler({ action: "start" });
    // then toggle — should stop
    const result = await tool.handler({ action: "toggle" }) as Record<string, unknown>;

    expect(typeof result.text).toBe("string");
    expect(handle.stop).toHaveBeenCalled();
  });

  it("M50-DI-10: STT unavailable — returns error result (no throw)", async () => {
    const sttProvider = makeSttProvider(false);
    const deps = makeDeps("idle", { sttProvider });
    const tool = createDictationTool(deps);

    const result = await tool.handler({ action: "start" }) as Record<string, unknown>;

    // should return error, not throw
    expect(result).toHaveProperty("error");
  });
});
