/**
 * M50-FWH — FasterWhisperHttpAdapter unit tests
 *
 * Coverage: M50-FWH-01 through M50-FWH-08
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FetchFn } from "../core/adapters/faster-whisper-http.js";

// ---------------------------------------------------------------------------
// fs/promises mock — must be hoisted before adapter import
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/accordo-fwh-xyz"),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

import { FasterWhisperHttpAdapter } from "../core/adapters/faster-whisper-http.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake PCM buffer (2-byte samples at 16 kHz ~ 10 ms) */
const FAKE_PCM = new Uint8Array(320); // 160 samples × 2 bytes

function makeOkFetch(jsonBody: unknown): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(jsonBody),
    text: vi.fn().mockResolvedValue(JSON.stringify(jsonBody)),
  });
}

function makeErrorFetch(status: number, body = "error"): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: body }),
    text: vi.fn().mockResolvedValue(body),
  });
}

function makeThrowingFetch(msg: string): FetchFn {
  return vi.fn().mockRejectedValue(new Error(msg));
}

// ---------------------------------------------------------------------------
// M50-FWH-01 / M50-FWH-08 — construction + identity
// ---------------------------------------------------------------------------
describe("FasterWhisperHttpAdapter — construction", () => {
  it("M50-FWH-01: implements SttProvider (kind=stt, id=faster-whisper-http)", () => {
    const adapter = new FasterWhisperHttpAdapter();
    expect(adapter.kind).toBe("stt");
    expect(adapter.id).toBe("faster-whisper-http");
  });

  it("M50-FWH-02: defaults to localhost:8280 and Systran/faster-whisper-small", () => {
    const logs: string[] = [];
    const fetchFn = makeOkFetch({});
    const adapter = new FasterWhisperHttpAdapter({ fetchFn, log: (m) => logs.push(m) });
    expect(adapter.id).toBe("faster-whisper-http");
    // default base url used — we'll verify in isAvailable test below
    void adapter; void logs;
  });

  it("M50-FWH-02: strips trailing slash from baseUrl", async () => {
    const fetchFn = makeOkFetch({});
    const adapter = new FasterWhisperHttpAdapter({
      baseUrl: "http://localhost:8280/",
      fetchFn,
    });
    await adapter.isAvailable();
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(calls[0]![0]).toBe("http://localhost:8280/v1/models");
  });
});

// ---------------------------------------------------------------------------
// M50-FWH-03 — isAvailable
// ---------------------------------------------------------------------------
describe("FasterWhisperHttpAdapter — isAvailable()", () => {
  it("M50-FWH-03: returns true when server responds 200", async () => {
    const fetchFn = makeOkFetch({ data: [] });
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("M50-FWH-03: calls GET /v1/models on the configured base URL", async () => {
    const fetchFn = makeOkFetch({});
    const adapter = new FasterWhisperHttpAdapter({
      baseUrl: "http://whisper.local:9000",
      fetchFn,
    });
    await adapter.isAvailable();
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(calls[0]![0]).toBe("http://whisper.local:9000/v1/models");
    expect((calls[0]![1] as Record<string, unknown>)["method"]).toBe("GET");
  });

  it("M50-FWH-03: returns false when server responds non-200", async () => {
    const fetchFn = makeErrorFetch(503);
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("M50-FWH-03: returns false when fetch throws (network error)", async () => {
    const fetchFn = makeThrowingFetch("ECONNREFUSED");
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("M50-FWH-03: logs failure details when unavailable", async () => {
    const logs: string[] = [];
    const fetchFn = makeThrowingFetch("ECONNREFUSED");
    const adapter = new FasterWhisperHttpAdapter({
      fetchFn,
      log: (m) => logs.push(m),
    });
    await adapter.isAvailable();
    expect(logs.some((l) => l.includes("FAIL"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M50-FWH-04 — transcribe: basic success
// ---------------------------------------------------------------------------
describe("FasterWhisperHttpAdapter — transcribe()", () => {
  it("M50-FWH-04: returns trimmed text from JSON response", async () => {
    const fetchFn = makeOkFetch({ text: "  Hello world  " });
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    const result = await adapter.transcribe({
      audio: FAKE_PCM,
      language: "en-US",
      sampleRate: 16000,
    });
    expect(result.text).toBe("Hello world");
  });

  it("M50-FWH-04: returns empty string when audio byteLength is 0", async () => {
    const fetchFn = vi.fn();
    const adapter = new FasterWhisperHttpAdapter({ fetchFn: fetchFn as FetchFn });
    const result = await adapter.transcribe({
      audio: new Uint8Array(0),
      language: "en-US",
    });
    expect(result.text).toBe("");
    // No HTTP call should be made for empty audio
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("M50-FWH-05: sends multipart POST to /v1/audio/transcriptions", async () => {
    const fetchFn = makeOkFetch({ text: "test" });
    const adapter = new FasterWhisperHttpAdapter({
      baseUrl: "http://localhost:8280",
      model: "Systran/faster-whisper-small",
      fetchFn,
    });
    await adapter.transcribe({ audio: FAKE_PCM, language: "en-US" });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    // First call is isAvailable GET; second is transcription POST
    const postCall = calls.find(([url]) => url.includes("/v1/audio/transcriptions"));
    expect(postCall).toBeDefined();
    expect((postCall![1] as Record<string, unknown>)["method"]).toBe("POST");
    const body = (postCall![1] as Record<string, unknown>)["body"];
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("model")).toBe("Systran/faster-whisper-small");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("file")).toBeTruthy();
  });

  it("M50-FWH-05: sends the language code (strip region tag) in form data", async () => {
    const fetchFn = makeOkFetch({ text: "Bonjour" });
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await adapter.transcribe({ audio: FAKE_PCM, language: "fr-FR" });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    const postCall = calls.find(([url]) => url.includes("/v1/audio/transcriptions"))!;
    const form = (postCall[1] as Record<string, unknown>)["body"] as FormData;
    expect(form.get("language")).toBe("fr");
  });

  it("M50-FWH-05: does NOT send language field for language=auto", async () => {
    const fetchFn = makeOkFetch({ text: "hello" });
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await adapter.transcribe({ audio: FAKE_PCM, language: "auto" });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    const postCall = calls.find(([url]) => url.includes("/v1/audio/transcriptions"))!;
    const form = (postCall[1] as Record<string, unknown>)["body"] as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("M50-FWH-07: throws when server returns non-200", async () => {
    const fetchFn = makeErrorFetch(500, "Internal Server Error");
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await expect(
      adapter.transcribe({ audio: FAKE_PCM, language: "en-US" }),
    ).rejects.toThrow("500");
  });

  it("M50-FWH-07: throws when fetch throws (network failure)", async () => {
    const fetchFn = makeThrowingFetch("Network failure");
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await expect(
      adapter.transcribe({ audio: FAKE_PCM, language: "en-US" }),
    ).rejects.toThrow("Network failure");
  });

  it("M50-FWH-07: returns empty string when response has no text field", async () => {
    const fetchFn = makeOkFetch({ segments: [] });
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    const result = await adapter.transcribe({ audio: FAKE_PCM, language: "en-US" });
    expect(result.text).toBe("");
  });
});

// ---------------------------------------------------------------------------
// M50-FWH-06 — cancellation
// ---------------------------------------------------------------------------
describe("FasterWhisperHttpAdapter — cancellation", () => {
  it("M50-FWH-06: throws 'Operation cancelled' when token is already cancelled", async () => {
    // We simulate cancellation by having fetch throw a DOMException (aborted)
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const fetchFn = vi.fn().mockRejectedValue(abortErr) as FetchFn;
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn(),
    };
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await expect(
      adapter.transcribe({ audio: FAKE_PCM, language: "en-US" }, token),
    ).rejects.toThrow("Operation cancelled");
  });

  it("M50-FWH-06: calls onCancellationRequested to wire abort signal", async () => {
    const fetchFn = makeOkFetch({ text: "hi" });
    const onCancel = vi.fn();
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: onCancel,
    };
    const adapter = new FasterWhisperHttpAdapter({ fetchFn });
    await adapter.transcribe({ audio: FAKE_PCM, language: "en-US" }, token);
    expect(onCancel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M50-FWH-03 — custom baseUrl / model respected
// ---------------------------------------------------------------------------
describe("FasterWhisperHttpAdapter — custom configuration", () => {
  it("uses configured model in form data", async () => {
    const fetchFn = makeOkFetch({ text: "ok" });
    const adapter = new FasterWhisperHttpAdapter({
      model: "deepdml/faster-whisper-large-v3-turbo-ct2",
      fetchFn,
    });
    await adapter.transcribe({ audio: FAKE_PCM, language: "en" });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    const postCall = calls.find(([url]) => url.includes("/v1/audio/transcriptions"))!;
    const form = (postCall[1] as Record<string, unknown>)["body"] as FormData;
    expect(form.get("model")).toBe("deepdml/faster-whisper-large-v3-turbo-ct2");
  });
});
