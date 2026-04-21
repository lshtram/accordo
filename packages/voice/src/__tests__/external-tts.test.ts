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
});
