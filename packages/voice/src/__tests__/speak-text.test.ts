/**
 * M52-VS — accordo.voice.speakText command tests (Phase B — must FAIL before implementation)
 * Coverage: M52-VS-01 through M52-VS-08
 *
 * These tests live in the voice package because the implementation is in
 * packages/voice/src/extension.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, type BridgeAPI, type VoiceActivateDeps } from "../extension.js";
import {
  commands,
  extensions,
  createExtensionContextMock,
} from "./mocks/vscode.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../core/audio/playback.js", () => ({
  playPcmAudio: vi.fn().mockResolvedValue(undefined),
  startPcmPlayback: vi.fn(),
  createCachedSound: vi.fn(),
}));

vi.mock("../text/text-cleaner.js", () => ({
  cleanTextForNarration: vi.fn().mockImplementation(
    (text: string, _mode: string) => `cleaned:${text}`,
  ),
}));

// AQ-INT-02: Mock the audioQueue so extension activation doesn't spawn real subprocesses.
vi.mock("../core/audio/audio-queue.js", () => {
  const mockAudioQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    get size() { return 0; },
    get isPlaying() { return false; },
  };
  return {
    createAudioQueue: vi.fn(() => mockAudioQueue),
    DEFAULT_MAX_QUEUE_DEPTH: 10,
    CancelledError: class extends Error {
      name = "CancelledError";
      constructor() { super("Audio playback was cancelled"); }
    },
    QueueFullError: class extends Error {
      name = "QueueFullError";
      currentSize: number;
      maxDepth: number;
      constructor(currentSize: number, maxDepth: number) {
        super(`Audio queue is full (${String(currentSize)}/${String(maxDepth)} chunks)`);
        this.currentSize = currentSize;
        this.maxDepth = maxDepth;
      }
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTtsProvider(available = true): TtsProvider {
  return {
    kind: "tts" as const,
    id: "mock-tts",
    isAvailable: vi.fn().mockResolvedValue(available),
    synthesize: vi.fn().mockResolvedValue({
      audio: new Float32Array(1024),
      sampleRate: 22050,
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as TtsProvider;
}

function makeSttProvider(available = false): SttProvider {
  return {
    kind: "stt" as const,
    id: "mock-stt",
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn(),
  } as unknown as SttProvider;
}

function makeDeps(ttsAvailable = true): VoiceActivateDeps {
  return {
    ttsProvider: makeTtsProvider(ttsAvailable),
    sttProvider: makeSttProvider(false),
  };
}

function makeBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

/**
 * Activate the extension and return the registered speakText handler.
 * Returns undefined if the command was not registered.
 */
async function activateAndGetSpeakHandler(
  deps: VoiceActivateDeps,
  bridge?: BridgeAPI,
): Promise<((args: unknown) => Promise<void>) | undefined> {
  vi.clearAllMocks();

  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(
    bridge ? { exports: bridge, isActive: true } : undefined,
  );

  const ctx = createExtensionContextMock();
  await activate(ctx, deps);

  const allCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
  const speakCall = allCalls.find(([name]) => name === "accordo.voice.speakText");
  return speakCall?.[1] as ((args: unknown) => Promise<void>) | undefined;
}

// ── M52-VS-01: command registration ──────────────────────────────────────────

describe("M52-VS-01 command is registered", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("registers accordo.voice.speakText", async () => {
    await activateAndGetSpeakHandler(makeDeps());
    expect(commands.registerCommand).toHaveBeenCalledWith(
      "accordo.voice.speakText",
      expect.any(Function),
    );
  });

  it("M52-VS-07: registered unconditionally at activation (not deferred)", async () => {
    // Handler must be registered even when TTS is not available
    await activateAndGetSpeakHandler(makeDeps(false));
    expect(commands.registerCommand).toHaveBeenCalledWith(
      "accordo.voice.speakText",
      expect.any(Function),
    );
  });
});

// ── M52-VS-02: argument shape ─────────────────────────────────────────────────

describe("M52-VS-02 argument shape", () => {
  it("handler accepts { text, voice?, speed?, block? } without throwing", async () => {
    const handler = await activateAndGetSpeakHandler(makeDeps());
    await expect(handler?.({ text: "hello", voice: "af_sarah", speed: 1.2, block: true }))
      .resolves.not.toThrow();
  });
});

// ── M52-VS-03: TTS unavailable — silent return ────────────────────────────────

describe("M52-VS-03 silent return when TTS unavailable", () => {
  it("returns without error when TTS is not available", async () => {
    const deps = makeDeps(false);
    const handler = await activateAndGetSpeakHandler(deps);

    await expect(handler?.({ text: "silent" })).resolves.not.toThrow();
  });

  it("does NOT call ttsProvider.synthesize when TTS unavailable", async () => {
    const deps = makeDeps(false);
    const handler = await activateAndGetSpeakHandler(deps);

    await handler?.({ text: "noop" });

    expect((deps.ttsProvider as ReturnType<typeof makeTtsProvider>).synthesize)
      .not.toHaveBeenCalled();
  });
});

// ── M52-VS-04: block:true awaits playback ────────────────────────────────────

describe("M52-VS-04 block:true awaits playPcmAudio", () => {
  it("command Promise resolves only after playPcmAudio resolves for block:true", async () => {
    const { playPcmAudio } = await import("../core/audio/playback.js");
    let resolvePlay!: () => void;
    const blockingPlay = new Promise<void>(r => { resolvePlay = r; });
    (playPcmAudio as ReturnType<typeof vi.fn>).mockReturnValueOnce(blockingPlay);

    const handler = await activateAndGetSpeakHandler(makeDeps());
    let resolved = false;
    const p = handler?.({ text: "blocking" }).then(() => { resolved = true; });

    await Promise.resolve(); // tick
    expect(resolved).toBe(false);

    resolvePlay();
    await p;
    expect(resolved).toBe(true);
  });
});

// ── M52-VS-05: block:false fire-and-forget ───────────────────────────────────

describe("M52-VS-05 block:false is fire-and-forget", () => {
  it("command returns before playback completes when block:false", async () => {
    const { playPcmAudio } = await import("../core/audio/playback.js");
    let resolvePlay!: () => void;
    const blockingPlay = new Promise<void>(r => { resolvePlay = r; });
    (playPcmAudio as ReturnType<typeof vi.fn>).mockReturnValueOnce(blockingPlay);

    const handler = await activateAndGetSpeakHandler(makeDeps());

    let resolved = false;
    const p = handler?.({ text: "nonblocking", block: false }).then(() => { resolved = true; });
    await p;

    expect(resolved).toBe(true); // handler returned even though play hasn't resolved

    resolvePlay(); // clean up
  });
});

// ── M52-VS-08: text cleaning ─────────────────────────────────────────────────

describe("M52-VS-08 cleanTextForNarration applied for block:true", () => {
  it("calls cleanTextForNarration before synthesising for block:true", async () => {
    const { cleanTextForNarration } = await import("../text/text-cleaner.js");
    const handler = await activateAndGetSpeakHandler(makeDeps());

    await handler?.({ text: "raw input", block: true });

    expect(cleanTextForNarration).toHaveBeenCalledWith("raw input", expect.any(String));
  });
});
