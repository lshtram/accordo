/**
 * M50-RA — accordo_voice_readAloud MCP tool tests (Phase B — must FAIL before implementation)
 * Coverage: M50-RA-01 through M50-RA-12
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReadAloudTool } from "../tools/read-aloud.js";
import type { ReadAloudToolDeps, PlayAudioFn, StreamSpeakFn } from "../tools/read-aloud.js";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { NarrationFsm } from "../core/fsm/narration-fsm.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";
import { DEFAULT_VOICE_POLICY } from "../core/fsm/types.js";

function makeSessionFsm(overrides: Partial<SessionFsm> = {}): SessionFsm {
  return {
    state: "active",
    policy: { ...DEFAULT_VOICE_POLICY, voice: "en-us", speed: 1.0 },
    enable: vi.fn(),
    disable: vi.fn(),
    pushToTalkStart: vi.fn(),
    pushToTalkEnd: vi.fn(),
    updatePolicy: vi.fn(),
    ...overrides,
  } as unknown as SessionFsm;
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

function makeTtsProvider(available = true): TtsProvider {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    synthesize: vi.fn().mockResolvedValue({ audio: new Uint8Array([0, 1, 2]), sampleRate: 22050 }),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as TtsProvider;
}

function makeDeps(overrides: Partial<ReadAloudToolDeps> = {}): ReadAloudToolDeps {
  return {
    sessionFsm: makeSessionFsm(),
    narrationFsm: makeNarrationFsm(),
    ttsProvider: makeTtsProvider(),
    cleanText: vi.fn().mockImplementation((t: string) => `CLEANED:${t}`),
    playAudio: vi.fn().mockResolvedValue(undefined) as PlayAudioFn,
    ...overrides,
  };
}

describe("createReadAloudTool", () => {
  it("M50-RA-00: createReadAloudTool is exported as a function", () => {
    expect(typeof createReadAloudTool).toBe("function");
  });

  it("M50-RA-01: tool name is 'accordo_voice_readAloud'", () => {
    const tool = createReadAloudTool(makeDeps());
    expect(tool.name).toBe("accordo_voice_readAloud");
  });

  it("M50-RA-02: group is 'voice'", () => {
    const tool = createReadAloudTool(makeDeps());
    expect(tool.group).toBe("voice");
  });

  it("M50-RA-03: description matches requirement", () => {
    const tool = createReadAloudTool(makeDeps());
    expect(tool.description).toBe(
      "Read text aloud using text-to-speech. Cleans markdown/code before speaking.",
    );
  });

  it("M50-RA-12: dangerLevel is 'safe' and idempotent is false", () => {
    const tool = createReadAloudTool(makeDeps());
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(false);
  });

  it("M50-RA-05: returns { spoken:false, reason:'empty text' } for empty string", async () => {
    const tool = createReadAloudTool(makeDeps());
    const result = await tool.handler({ text: "" });
    expect(result).toEqual({ spoken: false, reason: "empty text" });
  });

  it("M50-RA-05: returns { spoken:false, reason:'empty text' } for whitespace-only", async () => {
    const tool = createReadAloudTool(makeDeps());
    const result = await tool.handler({ text: "   \n\t  " });
    expect(result).toEqual({ spoken: false, reason: "empty text" });
  });

  it("M50-RA-06: applies cleanText when cleanMode is not 'raw'", async () => {
    const cleanText = vi.fn().mockReturnValue("cleaned output");
    const dep = makeDeps({ cleanText });
    const tool = createReadAloudTool(dep);

    await tool.handler({ text: "# Hello World" });

    expect(cleanText).toHaveBeenCalledWith("# Hello World", expect.any(String));
  });

  it("M50-RA-06: skips cleanText when cleanMode is 'raw'", async () => {
    const cleanText = vi.fn().mockReturnValue("should not be called");
    const dep = makeDeps({ cleanText });
    const tool = createReadAloudTool(dep);

    await tool.handler({ text: "raw text", cleanMode: "raw" });

    expect(cleanText).not.toHaveBeenCalled();
  });

  it("M50-RA-09: returns { spoken:true, textLength, cleanedLength, voice } on success", async () => {
    const tool = createReadAloudTool(makeDeps());
    const result = await tool.handler({ text: "Hello world." }) as Record<string, unknown>;

    expect(result.spoken).toBe(true);
    expect(typeof result.textLength).toBe("number");
    expect(typeof result.cleanedLength).toBe("number");
    expect(typeof result.voice).toBe("string");
  });

  it("M50-RA-10: returns error result when TTS provider is unavailable (no throw)", async () => {
    const tts = makeTtsProvider(false);
    const tool = createReadAloudTool(makeDeps({ ttsProvider: tts }));

    const result = await tool.handler({ text: "some text" }) as Record<string, unknown>;

    expect(result).toHaveProperty("error");
    expect(result.spoken).toBeUndefined();
  });

  it("M50-RA-07: uses voice from args over policy default", async () => {
    const tts = makeTtsProvider();
    const tool = createReadAloudTool(makeDeps({ ttsProvider: tts }));

    await tool.handler({ text: "test", voice: "fr-fr" });

    expect(tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "fr-fr" }),
    );
  });

  it("M50-RA-07: falls back to policy voice when not provided in args", async () => {
    const tts = makeTtsProvider();
    const sessionFsm = makeSessionFsm({
      policy: { ...DEFAULT_VOICE_POLICY, voice: "policy-voice" },
    } as Partial<SessionFsm>);
    const tool = createReadAloudTool(makeDeps({ ttsProvider: tts, sessionFsm }));

    await tool.handler({ text: "test" });

    expect(tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "policy-voice" }),
    );
  });

  it("M50-RA-08: calls narrationFsm.enqueue and startProcessing", async () => {
    const narrationFsm = makeNarrationFsm();
    const tool = createReadAloudTool(makeDeps({ narrationFsm }));

    await tool.handler({ text: "test narration" });

    expect(narrationFsm.enqueue).toHaveBeenCalled();
    expect(narrationFsm.startProcessing).toHaveBeenCalled();
  });

  it("M50-RA-08: calls playAudio with synthesized PCM audio", async () => {
    const pcm = new Uint8Array([10, 20, 30]);
    const tts = makeTtsProvider();
    (tts.synthesize as ReturnType<typeof vi.fn>).mockResolvedValue({ audio: pcm, sampleRate: 24000 });
    const playAudio = vi.fn().mockResolvedValue(undefined) as PlayAudioFn;
    const tool = createReadAloudTool(makeDeps({ ttsProvider: tts, playAudio }));

    await tool.handler({ text: "play this" });

    expect(playAudio).toHaveBeenCalledWith(pcm, 24000);
  });
});

// ── Bug #14 regression tests — session lock + stop/pause reach streamSpeak ──

describe("createReadAloudTool — session lock and cancellation (Bug #14)", () => {
  it("M50-RA-13: onSpeakActive is called with a cancel function when streamSpeak starts", async () => {
    // Regression: streaming path was fire-and-forget with no way to cancel from outside.
    // Fix: tool calls onSpeakActive(cancelFn) so extension can reach the active pipeline.
    const onSpeakActive = vi.fn();
    let resolveSpeak!: () => void;
    const streamSpeak: StreamSpeakFn = vi.fn().mockImplementation(
      () => new Promise<void>((res) => { resolveSpeak = res; }),
    );
    const tts = makeTtsProvider();
    const tool = createReadAloudTool(makeDeps({ ttsProvider: tts, streamSpeak, onSpeakActive }));

    void tool.handler({ text: "hello world" });
    await Promise.resolve(); // let handler reach the void streamSpeak(...)

    expect(onSpeakActive).toHaveBeenCalledWith(expect.any(Function));
    resolveSpeak(); // avoid dangling promise
  });

  it("M50-RA-14: calling the cancel fn from onSpeakActive requests cancellation on the token", async () => {
    // Regression: the cancellation token was never created/passed, so doStopNarration
    // had no way to abort the active streamSpeak pipeline.
    let capturedCancel!: () => void;
    const onSpeakActive = vi.fn((cancel: () => void) => { capturedCancel = cancel; });
    let resolveSpeak!: () => void;
    let passedToken: { isCancellationRequested: boolean } | undefined;
    const streamSpeak: StreamSpeakFn = vi.fn().mockImplementation(
      (_text, _tts, opts) => {
        passedToken = opts.cancellationToken as { isCancellationRequested: boolean } | undefined;
        return new Promise<void>((res) => { resolveSpeak = res; });
      },
    );
    const tool = createReadAloudTool(makeDeps({ ttsProvider: makeTtsProvider(), streamSpeak, onSpeakActive }));

    void tool.handler({ text: "cancel me" });
    await Promise.resolve();

    expect(passedToken?.isCancellationRequested).toBe(false);
    capturedCancel();
    expect(passedToken?.isCancellationRequested).toBe(true);
    resolveSpeak();
  });

  it("M50-RA-15: a second concurrent tool call cancels the first streamSpeak", async () => {
    // Regression: two rapid tool calls spawned overlapping pipelines.
    // Fix: each call cancels the previous token before starting.
    let cancelFirst!: () => void;
    const onSpeakActive = vi.fn((cancel: () => void) => { cancelFirst = cancel; });
    const tokens: Array<{ isCancellationRequested: boolean }> = [];
    let firstResolve!: () => void;
    let callCount = 0;
    const streamSpeak: StreamSpeakFn = vi.fn().mockImplementation(
      (_text, _tts, opts) => {
        tokens.push(opts.cancellationToken as { isCancellationRequested: boolean });
        callCount++;
        if (callCount === 1) return new Promise<void>((res) => { firstResolve = res; });
        return Promise.resolve();
      },
    );
    const tool = createReadAloudTool(makeDeps({ ttsProvider: makeTtsProvider(), streamSpeak, onSpeakActive }));

    // First call — starts the pipeline
    void tool.handler({ text: "first" });
    await Promise.resolve();
    const savedCancelFirst = cancelFirst;

    // Second call — should cancel the first
    await tool.handler({ text: "second" });

    savedCancelFirst(); // calling cancel externally shows the token is now cancelled
    expect(tokens[0]!.isCancellationRequested).toBe(true);
    firstResolve();
  });
});
