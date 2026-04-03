/**
 * Tests for resolveConfig — NP-08, NP-09
 *
 * These tests live in a separate file so node:fs can be mocked properly.
 *
 * Strategy: vi.hoisted creates mockReadFileSync lazily so it's available when
 * vi.mock("node:fs") is hoisted to the top of the file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted defers evaluation — mockReadFileSync is created when first accessed,
// which happens when vi.mock's factory runs (after vi.hoisted is set up).
const mockReadFileSync = vi.hoisted(vi.fn);

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

import { resolveConfig } from "./narration.js";

const MOCK_DIRECTORY = "/data/projects/myproject";
const MOCK_GEMINI_API_KEY = "test-gemini-api-key";

describe("resolveConfig", () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
  });

  it("NP-08: reads GEMINI_API_KEY from env", () => {
    process.env["GEMINI_API_KEY"] = MOCK_GEMINI_API_KEY;
    mockReadFileSync.mockReturnValueOnce("{}");

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.geminiApiKey).toBe(MOCK_GEMINI_API_KEY);
  });

  it("NP-08: reads ACCORDO_NARRATION_MODE from env", () => {
    process.env["ACCORDO_NARRATION_MODE"] = "everything";
    mockReadFileSync.mockReturnValueOnce("{}");

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.narrationMode).toBe("everything");
  });

  it("NP-09: reads hubUrl and hubToken from opencode.json in directory", () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        mcp: {
          accordo: {
            url: "http://test-hub:3001",
            headers: { Authorization: "Bearer test-token-xyz" },
          },
        },
      }),
    );

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.hubUrl).toBe("http://test-hub:3001");
    expect(config.hubToken).toBe("Bearer test-token-xyz");
  });

  it("NP-08: defaults narrationMode to 'off' when env is not set", () => {
    delete process.env["ACCORDO_NARRATION_MODE"];
    mockReadFileSync.mockReturnValueOnce("{}");

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.narrationMode).toBe("off");
  });

  it("NP-08: minResponseLength defaults to 100", () => {
    mockReadFileSync.mockReturnValueOnce("{}");

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.minResponseLength).toBe(100);
  });

  it("NP-08: debounceMs defaults to 1500", () => {
    mockReadFileSync.mockReturnValueOnce("{}");

    const config = resolveConfig(MOCK_DIRECTORY);
    expect(config.debounceMs).toBe(1500);
  });
});
