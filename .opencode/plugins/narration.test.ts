/**
 * Tests for narration.ts plugin
 *
 * Requirements: docs/20-requirements/requirements-narration-plugin.md
 *
 * API checklist:
 *   - parseNarrationMode(value: string | undefined): NarrationMode      [NP-08]
 *   - resolveConfig(directory: string): NarrationConfig                  [NP-08, NP-09]
 *   - extractLastAssistantText(client, sessionId): Promise<string | undefined>  [NP-03]
 *   - summarizeWithGemini(text, apiKey): Promise<string | undefined>     [NP-04]
 *   - callReadAloud(hubUrl, hubToken, text, cleanMode): Promise<boolean> [NP-05, NP-07]
 *   - discoverNarrationMode(hubUrl, hubToken, fallback): Promise<NarrationMode> [NP-06]
 *   - handleSessionIdle(client, sessionId, config): Promise<void>        [NP-01, NP-02, NP-03, NP-10]
 *   - NarrationPlugin(context): Promise<{ event: (opts) => Promise<void> }> [NP-01, NP-02]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures these values are defined before vi.mock runs.
// Values are inlined directly in mockResolveConfig to avoid closure-capture issues.
const { mockResolveConfig } = vi.hoisted(() => {
  return {
    mockResolveConfig: vi.fn((_directory: string) => ({
      geminiApiKey: "test-gemini-key",
      narrationMode: "summary" as const,
      hubUrl: "http://localhost:3001",
      hubToken: "Bearer test-token-123",
      minResponseLength: 100,
      debounceMs: 1500,
    })),
  };
});

const MOCK_HUB_URL = "http://localhost:3001";
const MOCK_HUB_TOKEN = "Bearer test-token-123";

// Mock ./narration.js directly — override only resolveConfig so NarrationPlugin
// gets a proper config without needing node:fs mocking in ESM.
// All other functions remain real via vi.importActual.
// We also patch _resolvers.resolveConfig so NarrationPlugin's internal call
// goes through the mock (ESM live-binding workaround).
vi.mock("./narration.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./narration.js")>();
  // Patch the internal resolver object so NarrationPlugin picks up the mock
  original._resolvers.resolveConfig = mockResolveConfig;
  return {
    ...original,
    resolveConfig: mockResolveConfig,
  };
});

// Import the module under test
import {
  NarrationPlugin,
  parseNarrationMode,
  resolveConfig,
  extractLastAssistantText,
  summarizeWithGemini,
  callReadAloud,
  discoverNarrationMode,
  handleSessionIdle,
} from "./narration.js";

// Expose debounceTimers for testing
import { debounceTimers } from "./narration.js";

// ── Types (mirrored from narration.ts for use in tests) ──────────────────────

type NarrationMode = "off" | "summary" | "everything";

interface NarrationConfig {
  readonly geminiApiKey: string | undefined;
  readonly narrationMode: NarrationMode;
  readonly hubUrl: string;
  readonly hubToken: string;
  readonly minResponseLength: number;
  readonly debounceMs: number;
}

interface PluginContext {
  readonly client: {
    session: {
      messages(opts: { path: { id: string } }): Promise<
        Array<{
          info: { role: string };
          parts: Array<{ type: string; text?: string }>;
        }>
      >;
    };
  };
  readonly project: unknown;
  readonly directory: string;
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

/**
 * Global fetch mock — intercepts both Gemini API calls and MCP readAloud calls.
 * Override `geminiResponse` to change what Gemini returns.
 * Set `mcpReadAloudResult` to control the MCP tool call outcome.
 */
const fetchMock = vi.fn();

const originalFetch = globalThis.fetch;
beforeEach(() => {
  // Use real timers for debounce tests (fake timers don't properly advance
  // when vi.mock captures setTimeout at module evaluation time).
  vi.useRealTimers();
  debounceTimers.clear();
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
  mcpDiscoverNarrationMode = "summary"; // Reset discover mode to default
  setupMcpMock(); // Ensure fetch mock is ready before NarrationPlugin initializes
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

// ── Shared mock state ───────────────────────────────────────────────────────────

let geminiResponseText: string | undefined = "This is a concise summary of the response.";
let mcpReadAloudResult = true;
/** Controls what the discover mock returns. Defaults to "summary". */
let mcpDiscoverNarrationMode: string = "summary";

function setupMcpMock() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    // Gemini API — generativelanguage.googleapis.com
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: geminiResponseText ?? "" }],
              },
            },
          ],
        }),
      } as Response;
    }

    // MCP call to Hub — matches resolved MOCK_HUB_URL + /mcp
    if (typeof url === "string" && url.includes(`${MOCK_HUB_URL}/mcp`)) {
      // Parse the JSON-RPC body to determine which tool is being called
      let toolName = "unknown";
      try {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        toolName = body?.params?.name ?? "unknown";
      } catch { /* ignore */ }

      // accordo_voice_discover returns the full voice state as JSON string
      if (toolName === "accordo_voice_discover") {
        return {
          ok: true,
          json: async () => ({
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    sttAvailable: true,
                    ttsAvailable: true,
                    policy: { narrationMode: `narrate-${mcpDiscoverNarrationMode}` },
                  }),
                },
              ],
            },
          }),
        } as Response;
      }

      // accordo_voice_readAloud returns boolean
      return {
        ok: mcpReadAloudResult,
        json: async () => ({ result: mcpReadAloudResult }),
      } as Response;
    }

    return originalFetch(url, init);
  });
}

// ── Mock client.session.messages ──────────────────────────────────────────────

function makeMessagesResponse(role: string, textParts: string[]): Awaited<
  ReturnType<PluginContext["client"]["session"]["messages"]>
> {
  return textParts.map((text) => ({
    info: { role },
    parts: [{ type: "text", text }] as Array<{ type: string; text?: string }>,
  }));
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_GEMINI_API_KEY = "test-gemini-api-key";
const MOCK_SESSION_ID = "session-abc-123";
const MOCK_DIRECTORY = "/data/projects/myproject";

/** A valid assistant response (>= 100 chars) */
const VALID_RESPONSE_TEXT =
  "The plugin successfully connected to the Accordo Hub and retrieved 16 tool registrations. The session was authenticated with a bearer token and all MCP tools were enumerated correctly.";

/** A short response (< 100 chars) that should be skipped */
const SHORT_RESPONSE_TEXT = "OK";

function makePluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    client: {
      app: {
        log: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        messages: vi.fn().mockResolvedValue(
          makeMessagesResponse("assistant", [VALID_RESPONSE_TEXT]),
        ),
      },
    },
    project: {},
    directory: MOCK_DIRECTORY,
    ...overrides,
  } as unknown as PluginContext;
}

// ── parseNarrationMode ────────────────────────────────────────────────────────

describe("parseNarrationMode", () => {
  it("NP-08: returns 'off' for undefined", () => {
    expect(parseNarrationMode(undefined)).toBe("off");
  });

  it("NP-08: returns 'off' for empty string", () => {
    expect(parseNarrationMode("")).toBe("off");
  });

  it("NP-08: returns 'off' for unrecognized values", () => {
    expect(parseNarrationMode("invalid")).toBe("off");
    expect(parseNarrationMode("narrate-off")).toBe("off"); // wrong prefix
  });

  it("NP-08: returns 'summary' for 'summary'", () => {
    expect(parseNarrationMode("summary")).toBe("summary");
  });

  it("NP-08: returns 'everything' for 'everything'", () => {
    expect(parseNarrationMode("everything")).toBe("everything");
  });

  it("NP-08: case-sensitive — invalid cases return 'off'", () => {
    expect(parseNarrationMode("Summary")).toBe("off");
    expect(parseNarrationMode("EVERYTHING")).toBe("off");
  });

  it("NP-08: accepts 'narrate-summary' and normalizes to 'summary'", () => {
    expect(parseNarrationMode("narrate-summary")).toBe("summary");
  });

  it("NP-08: accepts 'narrate-everything' and normalizes to 'everything'", () => {
    expect(parseNarrationMode("narrate-everything")).toBe("everything");
  });
});

// ── extractLastAssistantText ───────────────────────────────────────────────────

describe("extractLastAssistantText", () => {
  it("NP-03: returns text from the last assistant message", async () => {
    const ctx = makePluginContext();
    const text = await extractLastAssistantText(ctx.client, MOCK_SESSION_ID);
    expect(text).toBe(VALID_RESPONSE_TEXT);
  });

  it("NP-03: returns text from last assistant even when messages include user/other roles", async () => {
    const ctx = makePluginContext({
      client: {
        session: {
          messages: vi.fn().mockResolvedValue([
            ...makeMessagesResponse("user", ["Hello"]),
            ...makeMessagesResponse("assistant", [VALID_RESPONSE_TEXT]),
          ]),
        },
      },
    });
    const text = await extractLastAssistantText(ctx.client, MOCK_SESSION_ID);
    expect(text).toBe(VALID_RESPONSE_TEXT);
  });

  it("NP-03: concatenates multiple text parts from the same assistant message", async () => {
    const ctx = makePluginContext({
      client: {
        session: {
          messages: vi.fn().mockResolvedValue([
            {
              info: { role: "assistant" },
              parts: [
                { type: "text", text: "Part one. " },
                { type: "text", text: "Part two." },
              ],
            },
          ]),
        },
      },
    });
    const text = await extractLastAssistantText(ctx.client, MOCK_SESSION_ID);
    expect(text).toBe("Part one. Part two.");
  });

  it("NP-03: returns undefined when no assistant message exists", async () => {
    const ctx = makePluginContext({
      client: {
        session: {
          messages: vi.fn().mockResolvedValue(
            makeMessagesResponse("user", ["Hello"]),
          ),
        },
      },
    });
    const text = await extractLastAssistantText(ctx.client, MOCK_SESSION_ID);
    expect(text).toBeUndefined();
  });

  it("NP-03: returns undefined when messages array is empty", async () => {
    const ctx = makePluginContext({
      client: {
        session: {
          messages: vi.fn().mockResolvedValue([]),
        },
      },
    });
    const text = await extractLastAssistantText(ctx.client, MOCK_SESSION_ID);
    expect(text).toBeUndefined();
  });
});

// ── summarizeWithGemini ────────────────────────────────────────────────────────

describe("summarizeWithGemini", () => {
  beforeEach(() => {
    setupMcpMock();
  });

  it("NP-04: calls Gemini 2.5 Flash API with correct endpoint", async () => {
    await summarizeWithGemini("Some long response text", MOCK_GEMINI_API_KEY);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("NP-04: includes the text to summarize in the request body", async () => {
    const longText = "This is a very long response that needs summarization.";
    await summarizeWithGemini(longText, MOCK_GEMINI_API_KEY);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining(longText),
      }),
    );
  });

  it("NP-04: prompt instructs model to produce 2-3 spoken sentences", async () => {
    await summarizeWithGemini("Some text", MOCK_GEMINI_API_KEY);
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    // The prompt should mention spoken sentences, narration, or TTS-friendly output
    expect(body.contents[0].parts[0].text).toMatch(/2-3|sentence|spoken|concise|narrat/i);
  });

  it("NP-04: returns the summary text from Gemini response", async () => {
    const expected = "A concise two sentence summary of the response.";
    geminiResponseText = expected;
    const result = await summarizeWithGemini("Some text", MOCK_GEMINI_API_KEY);
    expect(result).toBe(expected);
  });

  it("NP-07: returns undefined on API failure (non-OK response)", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false } as Response));
    const result = await summarizeWithGemini("Some text", MOCK_GEMINI_API_KEY);
    expect(result).toBeUndefined();
  });

  it("NP-07: returns undefined when API key is empty", async () => {
    const result = await summarizeWithGemini("Some text", "");
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── callReadAloud ─────────────────────────────────────────────────────────────

describe("callReadAloud", () => {
  beforeEach(() => {
    setupMcpMock();
  });

  it("NP-05: sends JSON-RPC 2.0 request to POST /mcp", async () => {
    await callReadAloud(MOCK_HUB_URL, MOCK_HUB_TOKEN, "Hello world", "narrate-full");
    expect(fetchMock).toHaveBeenCalledWith(
      `${MOCK_HUB_URL}/mcp`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("NP-05: includes bearer token in Authorization header", async () => {
    await callReadAloud(MOCK_HUB_URL, MOCK_HUB_TOKEN, "Hello world", "narrate-full");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: MOCK_HUB_TOKEN,
        }),
      }),
    );
  });

  it("NP-05: sends correct JSON-RPC 2.0 tool/call structure for accordo_voice_readAloud", async () => {
    const text = "Speak this text";
    await callReadAloud(MOCK_HUB_URL, MOCK_HUB_TOKEN, text, "narrate-full");
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("accordo_voice_readAloud");
    expect(body.params.arguments.text).toBe(text);
  });

  it("NP-10: passes cleanMode in the arguments (narrate-full)", async () => {
    await callReadAloud(MOCK_HUB_URL, MOCK_HUB_TOKEN, "text", "narrate-full");
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.arguments.cleanMode).toBe("narrate-full");
  });

  it("NP-10: passes cleanMode in the arguments (narrate-headings)", async () => {
    await callReadAloud(MOCK_HUB_URL, MOCK_HUB_TOKEN, "text", "narrate-headings");
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.arguments.cleanMode).toBe("narrate-headings");
  });

  it("NP-07: returns true when MCP call succeeds", async () => {
    mcpReadAloudResult = true;
    const result = await callReadAloud(
      MOCK_HUB_URL,
      MOCK_HUB_TOKEN,
      "Hello",
      "narrate-full",
    );
    expect(result).toBe(true);
  });

  it("NP-07: returns false when MCP call fails (non-OK)", async () => {
    mcpReadAloudResult = false;
    fetchMock.mockImplementationOnce(
      async () => ({ ok: false } as Response),
    );
    const result = await callReadAloud(
      MOCK_HUB_URL,
      MOCK_HUB_TOKEN,
      "Hello",
      "narrate-full",
    );
    expect(result).toBe(false);
  });

  it("NP-07: returns false when fetch throws", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("Network error");
    });
    const result = await callReadAloud(
      MOCK_HUB_URL,
      MOCK_HUB_TOKEN,
      "Hello",
      "narrate-full",
    );
    expect(result).toBe(false);
  });
});

// ── discoverNarrationMode ─────────────────────────────────────────────────────

describe("discoverNarrationMode", () => {
  beforeEach(() => {
    setupMcpMock();
  });

  it("NP-06: calls accordo_voice_discover via MCP to get narration mode", async () => {
    await discoverNarrationMode(MOCK_HUB_URL, MOCK_HUB_TOKEN, "off");
    expect(fetchMock).toHaveBeenCalledWith(
      `${MOCK_HUB_URL}/mcp`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("NP-06: extracts narrationMode from the discover response", async () => {
    // Mock the MCP response — accordo_voice_discover returns voice policy
    // wrapped as result.content[0].text (the standard MCP tool result envelope)
    fetchMock.mockImplementationOnce(
      async () => ({
        ok: true,
        json: async () => ({
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ policy: { narrationMode: "summary" } }),
              },
            ],
          },
        }),
      } as Response),
    );
    const result = await discoverNarrationMode(MOCK_HUB_URL, MOCK_HUB_TOKEN, "off");
    expect(result).toBe("summary");
  });

  it("NP-06: falls back to config override when MCP call fails", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false } as Response));
    const result = await discoverNarrationMode(MOCK_HUB_URL, MOCK_HUB_TOKEN, "everything");
    expect(result).toBe("everything");
  });

  it("NP-06: falls back to config override when narrationMode is missing from response", async () => {
    fetchMock.mockImplementationOnce(
      async () => ({
        ok: true,
        json: async () => ({ result: {} }),
      } as Response),
    );
    const result = await discoverNarrationMode(MOCK_HUB_URL, MOCK_HUB_TOKEN, "summary");
    expect(result).toBe("summary");
  });

  it("NP-06: returns 'off' when discover returns unrecognized narrationMode", async () => {
    fetchMock.mockImplementationOnce(
      async () => ({
        ok: true,
        json: async () => ({
          result: { narrationMode: "invalid-mode" },
        }),
      } as Response),
    );
    const result = await discoverNarrationMode(MOCK_HUB_URL, MOCK_HUB_TOKEN, "off");
    // parseNarrationMode should normalize unknown values to "off"
    expect(result).toBe("off");
  });
});

// ── handleSessionIdle ──────────────────────────────────────────────────────────

describe("handleSessionIdle", () => {
  beforeEach(() => {
    setupMcpMock();
  });

  function makeConfig(overrides: Partial<NarrationConfig> = {}): NarrationConfig {
    return {
      geminiApiKey: MOCK_GEMINI_API_KEY,
      narrationMode: "off",
      hubUrl: MOCK_HUB_URL,
      hubToken: MOCK_HUB_TOKEN,
      minResponseLength: 100,
      debounceMs: 1500,
      ...overrides,
    };
  }

  // NP-01: When narrationMode === "off", no readAloud call is made
  it("NP-01: narrationMode 'off' — session.idle fires but readAloud is not called", async () => {
    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "off" });
    await handleSessionIdle(ctx.client, MOCK_SESSION_ID, config);
    // readAloud uses MCP fetch — check that fetch was not called for /mcp
    const mcpCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && url.includes("/mcp"),
    );
    expect(mcpCalls.length).toBe(0);
  });

  // NP-02: When narrationMode === "summary", summary LLM is called then readAloud
  it("NP-02: narrationMode 'summary' — summary LLM is called then readAloud with summary", async () => {
    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "summary" });
    await handleSessionIdle(ctx.client, MOCK_SESSION_ID, config);

    // Should call Gemini for summarization
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.any(Object),
    );

    // Should call readAloud with the summarized text
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBeGreaterThanOrEqual(1);
    const [, opts] = readAloudCalls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.name).toBe("accordo_voice_readAloud");
  });

  // NP-03: When narrationMode === "everything", readAloud is called with raw text
  it("NP-03: narrationMode 'everything' — readAloud is called with raw response text (no summarization)", async () => {
    mcpDiscoverNarrationMode = "everything"; // Discover returns "narrate-everything"
    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "everything" });
    await handleSessionIdle(ctx.client, MOCK_SESSION_ID, config);

    // Should NOT call Gemini for summarization
    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]) =>
        typeof url === "string" && url.includes("generativelanguage.googleapis.com"),
    );
    expect(geminiCalls.length).toBe(0);

    // Should call readAloud with the raw text
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBeGreaterThanOrEqual(1);
    const [, opts] = readAloudCalls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.name).toBe("accordo_voice_readAloud");
    // In "everything" mode, the raw text is used, not a summary
    expect(body.params.arguments.text).toBe(VALID_RESPONSE_TEXT);
  });

  // NP-06: Short responses in summary mode — narrated in full (no summarization)
  it("NP-06: short response (< minResponseLength) in 'summary' mode calls readAloud with raw text (no Gemini)", async () => {
    const ctx = makePluginContext({
      client: {
        session: {
          messages: vi.fn().mockResolvedValue(
            makeMessagesResponse("assistant", [SHORT_RESPONSE_TEXT]),
          ),
        },
      },
    });
    const config = makeConfig({ narrationMode: "summary", minResponseLength: 100 });
    await handleSessionIdle(ctx.client, MOCK_SESSION_ID, config);

    // Should call readAloud (not skip) with the raw short text
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBeGreaterThanOrEqual(1);
    const [, opts] = readAloudCalls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.name).toBe("accordo_voice_readAloud");
    expect(body.params.arguments.text).toBe(SHORT_RESPONSE_TEXT);
    expect(body.params.arguments.cleanMode).toBe("narrate-full");

    // Should NOT call Gemini for short responses in summary mode (summarization is bypassed)
    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]) =>
        typeof url === "string" && url.includes("generativelanguage.googleapis.com"),
    );
    expect(geminiCalls.length).toBe(0);
  });

  // NP-04: The summarization prompt returns 2-3 sentences, plain language
  it("NP-04: summary is 2-3 sentences, plain language (spoken form)", async () => {
    const expectedSummary = "The assistant connected to the Hub. It retrieved all 16 available tools. The session is ready.";
    geminiResponseText = expectedSummary;

    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "summary" });
    await handleSessionIdle(ctx.client, MOCK_SESSION_ID, config);

    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    const [, opts] = readAloudCalls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.arguments.text).toBe(expectedSummary);
    // Verify it's a reasonable spoken summary (not the full verbose response)
    expect(body.params.arguments.text.length).toBeLessThan(VALID_RESPONSE_TEXT.length);
  });

  // NP-07: Silent failure — no error thrown to user
  it("NP-07: if summarization fails, no error is thrown to the user", async () => {
    fetchMock.mockImplementation(
      async (url: string) => {
        if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
          throw new Error("Gemini API error");
        }
        if (typeof url === "string" && url.includes("/mcp")) {
          return { ok: true, json: async () => ({ result: true }) } as Response;
        }
        return originalFetch(url);
      },
    );

    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "summary" });
    // Should not throw — error is swallowed
    await expect(
      handleSessionIdle(ctx.client, MOCK_SESSION_ID, config),
    ).resolves.not.toThrow();
  });

  it("NP-07: if readAloud fails, no error is thrown to the user", async () => {
    fetchMock.mockImplementation(
      async (url: string) => {
        if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
          return {
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: "summary" }] } }],
            }),
          } as Response;
        }
        if (typeof url === "string" && url.includes("/mcp")) {
          throw new Error("MCP network error");
        }
        return originalFetch(url);
      },
    );

    const ctx = makePluginContext();
    const config = makeConfig({ narrationMode: "summary" });
    // Should not throw — error is swallowed
    await expect(
      handleSessionIdle(ctx.client, MOCK_SESSION_ID, config),
    ).resolves.not.toThrow();
  });
});

// ── NarrationPlugin ────────────────────────────────────────────────────────────

describe("NarrationPlugin", () => {
  // setupMcpMock is called in the top-level beforeEach (real timers)

  // NP-02: Debounce — rapid session.idle events within 1500ms only trigger one narration
  it("NP-05: rapid session.idle events within debounce window trigger only one narration", async () => {
    const ctx = makePluginContext();
    const plugin = await NarrationPlugin(ctx);
    const eventHandler = plugin.event;

    // Fire session.idle 3 times rapidly (within 50ms each)
    for (let i = 0; i < 3; i++) {
      await eventHandler({ type: "session.idle", sessionId: MOCK_SESSION_ID });
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait past debounce (1500ms) to trigger the final call
    await new Promise((r) => setTimeout(r, 3000));

    // Should only have called readAloud once (not 3 times)
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBe(1);
  });

  // NP-02: The debounce ensures subagent completions don't trigger narration early
  it("NP-02: debounce filters out intermediate subagent idle events", async () => {
    const ctx = makePluginContext();
    const plugin = await NarrationPlugin(ctx);
    const eventHandler = plugin.event;

    // First idle (subagent completion) — should be debounced
    await eventHandler({ type: "session.idle", sessionId: "subagent-2" });

    // Wait 1000ms then fire second idle before first debounce settles
    await new Promise((r) => setTimeout(r, 1000));
    await eventHandler({ type: "session.idle", sessionId: MOCK_SESSION_ID });

    // Wait for final debounce to settle
    await new Promise((r) => setTimeout(r, 2000));

    // Should only narrate once (the final idle)
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBe(1);
  });

  it("NP-01: ignores events that are not session.idle", async () => {
    const ctx = makePluginContext();
    const plugin = await NarrationPlugin(ctx);
    const eventHandler = plugin.event;

    await eventHandler({
      type: "session.message",
      sessionId: MOCK_SESSION_ID,
    });

    // No debounce for session.message — advance time to flush any (unexpected) timers
    await new Promise((r) => setTimeout(r, 2000));

    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBe(0);
  });

  it("NP-01: session.idle without sessionId is still processed (mode=off skips readAloud)", async () => {
    // Even without sessionId in the event, session.idle should be handled
    // (we no longer filter by sessionId since it's always undefined in practice).
    // When narrationMode is off, readAloud should not be called.
    mcpDiscoverNarrationMode = "off"; // Discover returns "narrate-off"
    const ctx = makePluginContext();
    const plugin = await NarrationPlugin(ctx);
    const eventHandler = plugin.event;

    await eventHandler({
      type: "session.idle",
    });

    // Advance time to flush debounce timer
    await new Promise((r) => setTimeout(r, 2000));

    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBe(0);
  });
});

// ── End-to-end: full NP flow ──────────────────────────────────────────────────

describe("Full narration flow", () => {
  // setupMcpMock is called in the top-level beforeEach (real timers)

  it("NP-02 → NP-04 → NP-05: complete flow — session.idle → debounce → summarize → readAloud", async () => {
    const ctx = makePluginContext();
    const config: NarrationConfig = {
      geminiApiKey: MOCK_GEMINI_API_KEY,
      narrationMode: "summary",
      hubUrl: MOCK_HUB_URL,
      hubToken: MOCK_HUB_TOKEN,
      minResponseLength: 100,
      debounceMs: 1500,
    };

    const plugin = await NarrationPlugin(ctx);
    const eventHandler = plugin.event;

    // Fire the idle event (async — schedules debounce setTimeout)
    await eventHandler({ type: "session.idle", sessionId: MOCK_SESSION_ID });

    // Wait past debounce to trigger the handler
    await new Promise((r) => setTimeout(r, 2000));

    // Verify Gemini was called (for summarization)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.any(Object),
    );

    // Verify readAloud was called via MCP
    const readAloudCalls = fetchMock.mock.calls.filter(
      ([, opts]) =>
        typeof opts?.body === "string" &&
        JSON.parse(opts.body).params?.name === "accordo_voice_readAloud",
    );
    expect(readAloudCalls.length).toBeGreaterThanOrEqual(1);

    const [, opts] = readAloudCalls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.params.name).toBe("accordo_voice_readAloud");
    // readAloud was called with a summary, not the raw text
    expect(body.params.arguments.cleanMode).toBe("narrate-full");
  });
});
