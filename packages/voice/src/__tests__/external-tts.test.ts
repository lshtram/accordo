import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalTtsAdapter } from "../core/adapters/external-tts.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makePcmWav(sampleRate: number, pcm: Uint8Array): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const bytes = new TextEncoder();
  header.set(bytes.encode("RIFF"), 0);
  view.setUint32(4, 36 + pcm.length, true);
  header.set(bytes.encode("WAVE"), 8);
  header.set(bytes.encode("fmt "), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  header.set(bytes.encode("data"), 36);
  view.setUint32(40, pcm.length, true);

  const out = new Uint8Array(header.length + pcm.length);
  out.set(header, 0);
  out.set(pcm, 44);
  return out;
}

describe("ExternalTtsAdapter", () => {
  it("M50-ET-03: isAvailable requires endpoint and auth token", async () => {
    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await expect(adapter.isAvailable()).resolves.toBe(true);

    const missing = new ExternalTtsAdapter({ endpoint: "", authToken: "" });
    await expect(missing.isAvailable()).resolves.toBe(false);
  });

  it("M50-ET-05: adds Bearer prefix when auth token lacks it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com/v1", authToken: "plain-token" });
    await adapter.synthesize({ text: "hello", language: "en-US" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer plain-token");
  });

  it("M50-ET-04: decodes PCM WAV response and returns parsed sampleRate", async () => {
    const pcm = new Uint8Array([10, 0, 20, 0]);
    const wav = makePcmWav(22050, pcm);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => wav.buffer,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "Bearer token" });
    const result = await adapter.synthesize({ text: "hello", language: "en-US" });

    expect(result.audio).toEqual(pcm);
    expect(result.sampleRate).toBe(22050);
  });

  it("M50-ET-06: omits voice/language/speed when request.voice is undefined (Kokoro-compatible)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await adapter.synthesize({ text: "hello", language: "en-US" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("voice");
    expect(body).not.toHaveProperty("language");
    expect(body).not.toHaveProperty("speed");
    // OpenAI-compatible fields must still be present
    expect(body).toHaveProperty("model");
    expect(body).toHaveProperty("input");
    expect(body).toHaveProperty("text");
    expect(body).toHaveProperty("response_format", "wav");
  });

  it("M50-ET-07: includes voice/language/speed when request.voice is provided (OpenAI-compatible)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await adapter.synthesize({ text: "hello", language: "fr-FR", voice: "alloy", speed: 1.5 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: "tts-1",
      input: "hello",
      text: "hello",
      voice: "alloy",
      language: "fr-FR",
      speed: 1.5,
      response_format: "wav",
    });
  });

  it("M50-ET-08: HTTP 500 error includes server-error cause classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => '{"error":"model overloaded"}',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await expect(adapter.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow(
      /server-error/,
    );
  });

  it("M50-ET-08: HTTP 401 error includes auth cause classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await expect(adapter.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow(/auth/);
  });

  it("M50-ET-08: HTTP 404 error includes endpoint-not-found cause classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ExternalTtsAdapter({ endpoint: "https://api.example.com", authToken: "token" });
    await expect(adapter.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow(
      /endpoint-not-found/,
    );
  });
});
