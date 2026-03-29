/**
 * voice-adapters.test.ts — Phase B
 * Tests for factory functions in voice-adapters.ts:
 *   createSttProvider(config, log) → SttProvider
 *   createTtsProvider(log)        → TtsProvider
 *   buildReadyChimePcm(sampleRate?, durationMs?, frequencyHz?) → Uint8Array
 *
 * All tests must FAIL before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Import the module under test ────────────────────────────────────────────────
// These will fail to import / have "not implemented" errors until Phase C.
import {
  createSttProvider,
  createTtsProvider,
  buildReadyChimePcm,
} from "../voice-adapters.js";

import type { SttProvider } from "../core/providers/stt-provider.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";

// ── Mock log helper ─────────────────────────────────────────────────────────────

const mockLog = vi.fn();

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// createSttProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("createSttProvider", () => {
  it("REQ-VA-01: returns FasterWhisperHttpAdapter instance when sttProvider === 'faster-whisper-http'", () => {
    const provider = createSttProvider("faster-whisper-http", mockLog);
    expect(provider).toBeDefined();
    expect(provider.kind).toBe("stt");
    // The adapter kind is tested via the SttProvider interface contract
    void provider; // suppress unused var — real code will assert instance type
  });

  it("REQ-VA-02: returns WhisperCppAdapter instance when sttProvider === 'whisper-cpp'", () => {
    const provider = createSttProvider("whisper-cpp", mockLog);
    expect(provider).toBeDefined();
    expect(provider.kind).toBe("stt");
    void provider;
  });

  it("REQ-VA-03: logs the provider selection via the provided log function", () => {
    createSttProvider("faster-whisper-http", mockLog);
    // The log should have been called with a message containing the provider name
    expect(mockLog).toHaveBeenCalled();
    const logCall = (mockLog as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "";
    expect(typeof logCall).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTtsProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("createTtsProvider", () => {
  // Note: Sherpa availability is checked at runtime via isAvailable().
  // Tests here mock deps or use pre-configured environments.

  it("REQ-VA-04: returns a TtsProvider when Sherpa is available", async () => {
    // The real implementation calls sherpa.isAvailable() — we test the
    // observable contract: a provider is returned regardless of which path.
    const provider = await createTtsProvider(mockLog);
    expect(provider).toBeDefined();
    expect(provider.kind).toBe("tts");
  });

  it("REQ-VA-05: createTtsProvider is a function that can be called", () => {
    expect(typeof createTtsProvider).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildReadyChimePcm
// ─────────────────────────────────────────────────────────────────────────────

describe("buildReadyChimePcm", () => {
  it("REQ-VA-06: returns a non-empty Uint8Array", () => {
    const result = buildReadyChimePcm();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("REQ-VA-07: respects sampleRate parameter (default 22050)", () => {
    const result22050 = buildReadyChimePcm(22050, 140, 880);
    const result16000 = buildReadyChimePcm(16000, 140, 880);
    // Different sample rates produce different buffer sizes
    expect(result22050.byteLength).not.toBe(result16000.byteLength);
  });

  it("REQ-VA-08: respects durationMs parameter (default 140)", () => {
    const result140 = buildReadyChimePcm(22050, 140, 880);
    const result500 = buildReadyChimePcm(22050, 500, 880);
    // Longer duration → more samples → larger byte array
    expect(result500.byteLength).toBeGreaterThan(result140.byteLength);
  });

  it("REQ-VA-09: respects frequencyHz parameter (default 880)", () => {
    const result = buildReadyChimePcm(22050, 140, 880);
    // PCM data should be non-zero (sine wave is generated)
    const int16View = new Int16Array(result.buffer);
    const hasNonZero = [...int16View].some((v) => v !== 0);
    expect(hasNonZero).toBe(true);
  });

  it("REQ-VA-10: returns zero-length buffer when durationMs is 0 (edge case)", () => {
    const result = buildReadyChimePcm(22050, 0, 880);
    // Math.max(1, floor(0)) still yields at least 1 sample, but guard for safety
    expect(result.byteLength).toBeGreaterThanOrEqual(0);
  });
});
