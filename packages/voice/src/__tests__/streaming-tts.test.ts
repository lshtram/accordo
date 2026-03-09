/**
 * M51-STR — Streaming TTS pipeline tests (Phase B — must FAIL before implementation)
 *
 * Coverage: M51-STR-01 through M51-STR-07
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from "../core/providers/tts-provider.js";
import type { CancellationToken } from "../core/providers/stt-provider.js";

// ---------------------------------------------------------------------------
// Mock playback — we do not want actual audio during tests
// ---------------------------------------------------------------------------
vi.mock("../core/audio/playback.js", () => ({
  playPcmAudio: vi.fn().mockResolvedValue(undefined),
}));

import { playPcmAudio } from "../core/audio/playback.js";
import { streamingSpeak } from "../core/audio/streaming-tts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake TTS provider that records calls and returns dummy PCM. */
function makeTtsProvider(overrides: Partial<TtsProvider> = {}): TtsProvider {
  const calls: TtsSynthesisRequest[] = [];
  return {
    kind: "tts",
    id: "fake-tts",
    isAvailable: vi.fn().mockResolvedValue(true),
    synthesize: vi.fn(async (req: TtsSynthesisRequest) => {
      calls.push(req);
      const pcm = new Uint8Array(100); // dummy audio
      return { audio: pcm, sampleRate: 22050 } satisfies TtsSynthesisResult;
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    /** Expose recorded calls for assertions. */
    get _calls() { return calls; },
    ...overrides,
  } as TtsProvider & { _calls: TtsSynthesisRequest[] };
}

/** Flush microtask queue. */
const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

/** Create a fake CancellationToken. */
function makeCancellationToken(): CancellationToken & { cancel(): void } {
  let cancelled = false;
  const handlers: Array<() => void> = [];
  return {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(handler: () => void) { handlers.push(handler); },
    cancel() {
      cancelled = true;
      for (const h of handlers) h();
    },
  };
}

// ---------------------------------------------------------------------------
// M51-STR-01: Export + basic contract
// ---------------------------------------------------------------------------

describe("M51-STR: streamingSpeak — export and contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M51-STR-01: streamingSpeak is exported as a function", () => {
    expect(typeof streamingSpeak).toBe("function");
  });

  it("M51-STR-01: streamingSpeak returns a Promise", () => {
    const provider = makeTtsProvider();
    const result = streamingSpeak("Hello.", provider, { language: "en-US" });
    expect(result).toBeInstanceOf(Promise);
    // let it resolve to avoid unhandled rejection
    return result;
  });
});

// ---------------------------------------------------------------------------
// M51-STR-02 + M51-STR-06: Sentence splitting + single-sentence fallback
// ---------------------------------------------------------------------------

describe("M51-STR: sentence splitting and single-sentence fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M51-STR-06: single sentence delegates to a single synthesize call", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak("Hello world.", provider, { language: "en-US" });
    expect(provider.synthesize).toHaveBeenCalledTimes(1);
  });

  it("M51-STR-02: multi-sentence text produces one synthesize call per sentence", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak(
      "First sentence. Second sentence. Third sentence.",
      provider,
      { language: "en-US" },
    );
    expect(provider.synthesize).toHaveBeenCalledTimes(3);
  });

  it("M51-STR-02: empty text resolves without calling synthesize", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak("", provider, { language: "en-US" });
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("M51-STR-02: whitespace-only text resolves without calling synthesize", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak("   \n  ", provider, { language: "en-US" });
    expect(provider.synthesize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M51-STR-03 + M51-STR-04: Streaming pipeline (overlap synthesis + playback)
// ---------------------------------------------------------------------------

describe("M51-STR: streaming pipeline behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M51-STR-03: multi-sentence text plays audio for each sentence", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak(
      "First sentence. Second sentence. Third sentence.",
      provider,
      { language: "en-US" },
    );
    // Each sentence should produce a playback call
    expect(playPcmAudio).toHaveBeenCalledTimes(3);
  });

  it("M51-STR-04: first sentence synthesized and played before remaining sentences", async () => {
    // Track call order to verify pipeline overlap
    const callOrder: string[] = [];
    const provider = makeTtsProvider({
      synthesize: vi.fn(async (req: TtsSynthesisRequest) => {
        callOrder.push(`synth:${req.text}`);
        return { audio: new Uint8Array(10), sampleRate: 22050 };
      }),
    });
    vi.mocked(playPcmAudio).mockImplementation(async () => {
      callOrder.push("play");
    });

    await streamingSpeak("First. Second.", provider, { language: "en-US" });

    // First synth must happen before first play
    const firstSynth = callOrder.indexOf("synth:First.");
    const firstPlay = callOrder.indexOf("play");
    expect(firstSynth).toBeLessThan(firstPlay);
    // Both sentences must be synthesized
    expect(callOrder.filter((c) => c.startsWith("synth:")).length).toBe(2);
  });

  it("M51-STR-03: playback order matches sentence order", async () => {
    const playedAudio: Uint8Array[] = [];
    // Create distinct audio for each sentence so we can verify ordering
    let callIdx = 0;
    const provider = makeTtsProvider({
      synthesize: vi.fn(async () => {
        const marker = callIdx++;
        const audio = new Uint8Array([marker]);
        return { audio, sampleRate: 22050 };
      }),
    });
    vi.mocked(playPcmAudio).mockImplementation(async (pcm: Uint8Array) => {
      playedAudio.push(pcm);
    });

    await streamingSpeak("A. B. C.", provider, { language: "en-US" });

    // Playback must occur in sentence order: marker 0, 1, 2
    expect(playedAudio.length).toBe(3);
    expect(playedAudio[0]![0]).toBe(0);
    expect(playedAudio[1]![0]).toBe(1);
    expect(playedAudio[2]![0]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M51-STR-05: Cancellation
// ---------------------------------------------------------------------------

describe("M51-STR: cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M51-STR-05: cancellation stops synthesis of remaining sentences", async () => {
    const token = makeCancellationToken();
    let synthCount = 0;
    const provider = makeTtsProvider({
      synthesize: vi.fn(async (req: TtsSynthesisRequest) => {
        synthCount++;
        if (synthCount === 1) {
          // Cancel after first synthesis completes
          token.cancel();
        }
        return { audio: new Uint8Array(10), sampleRate: 22050 };
      }),
    });

    await streamingSpeak(
      "First sentence. Second sentence. Third sentence.",
      provider,
      { language: "en-US", cancellationToken: token },
    );

    // Should have stopped after first synthesis — not all 3
    expect(synthCount).toBeLessThan(3);
  });

  it("M51-STR-05: already-cancelled token prevents any synthesis", async () => {
    const token = makeCancellationToken();
    token.cancel(); // pre-cancelled

    const provider = makeTtsProvider();
    await streamingSpeak("Hello. World.", provider, {
      language: "en-US",
      cancellationToken: token,
    });

    expect(provider.synthesize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Options passthrough + error handling
// ---------------------------------------------------------------------------

describe("M51-STR: options passthrough and error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M51-STR-01: passes language, voice, and speed to TTS provider", async () => {
    const provider = makeTtsProvider();
    await streamingSpeak("Hello.", provider, {
      language: "fr-FR",
      voice: "custom_voice",
      speed: 1.5,
    });
    expect(provider.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Hello.",
        language: "fr-FR",
        voice: "custom_voice",
        speed: 1.5,
      }),
      undefined, // cancellationToken not set → undefined
    );
  });

  it("M51-STR-01: passes CancellationToken through to TTS provider", async () => {
    const token = makeCancellationToken();
    const provider = makeTtsProvider();
    await streamingSpeak("Hello.", provider, {
      language: "en-US",
      cancellationToken: token,
    });
    expect(provider.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Hello." }),
      token,
    );
  });

  it("M51-STR: synthesis error rejects the streamingSpeak promise", async () => {
    const provider = makeTtsProvider({
      synthesize: vi.fn().mockRejectedValue(new Error("TTS engine crashed")),
    });
    await expect(
      streamingSpeak("Hello.", provider, { language: "en-US" }),
    ).rejects.toThrow("TTS engine crashed");
  });

  it("M51-STR: playback error rejects the streamingSpeak promise", async () => {
    const provider = makeTtsProvider();
    vi.mocked(playPcmAudio).mockRejectedValueOnce(new Error("Audio device busy"));
    await expect(
      streamingSpeak("Hello.", provider, { language: "en-US" }),
    ).rejects.toThrow("Audio device busy");
  });
});
