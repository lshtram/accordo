/**
 * Accordo Narration Plugin for OpenCode
 *
 * Hooks into OpenCode's `session.idle` event to automatically summarize
 * agent responses via Gemini Flash and narrate them through Accordo's
 * `readAloud` MCP tool.
 *
 * Alternative to voice-architecture.md ADR-03 (agent-driven summary)
 * for the OpenCode client where system prompt injection is unreliable.
 *
 * Requirements: docs/20-requirements/requirements-narration-plugin.md
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Narration mode — mirrors the voice policy's narrationMode values.
 * - "off"        → plugin does nothing
 * - "summary"    → summarize via LLM, then readAloud
 * - "everything" → readAloud with full response text (no summarization)
 */
type NarrationMode = "off" | "summary" | "everything";

/**
 * Configuration resolved from environment + opencode.json.
 */
interface NarrationConfig {
  /** Gemini API key for summarization (required for "summary" mode). */
  readonly geminiApiKey: string | undefined;
  /** Override narration mode (env ACCORDO_NARRATION_MODE). */
  readonly narrationMode: NarrationMode;
  /** Hub MCP endpoint URL (from opencode.json mcp.accordo.url). */
  readonly hubUrl: string;
  /** Bearer token for Hub auth (from opencode.json mcp.accordo.headers.Authorization). */
  readonly hubToken: string;
  /** Minimum response length to trigger narration (characters). */
  readonly minResponseLength: number;
  /** Debounce delay for session.idle events (milliseconds). */
  readonly debounceMs: number;
}

/**
 * Subset of OpenCode's Plugin type — only what we use.
 * The real type comes from @opencode-ai/plugin but we avoid the dependency.
 */
interface PluginContext {
  readonly client: {
    readonly app: {
      log(opts: { body: { service: string; level: string; message: string } }): Promise<void>;
    };
    readonly session: {
      messages(opts: {
        path: { id: string };
      }): Promise<
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

interface PluginEvent {
  readonly type: string;
  readonly sessionId?: string;
  readonly properties?: Record<string, unknown>;
}

// ── Config Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve plugin configuration from environment variables and opencode.json.
 *
 * NP-08: Environment variable configuration
 * NP-09: MCP auth token discovery from opencode.json
 */
function resolveConfig(directory: string): NarrationConfig {
  const geminiApiKey = process.env["GEMINI_API_KEY"];
  const narrationMode = parseNarrationMode(process.env["ACCORDO_NARRATION_MODE"]);
  const minResponseLength = 100;
  const debounceMs = 1500;

  let hubUrl = "";
  let hubToken = "";

  try {
    const configPath = join(directory, "opencode.json");
    const content = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(content) as {
      mcp?: {
        accordo?: {
          url?: string;
          headers?: { Authorization?: string };
        };
      };
    };
    hubUrl = parsed.mcp?.accordo?.url ?? "";
    hubToken = parsed.mcp?.accordo?.headers?.Authorization ?? "";
  } catch {
    // NP-07: silently ignore file read errors
  }

  return {
    geminiApiKey,
    narrationMode,
    hubUrl,
    hubToken,
    minResponseLength,
    debounceMs,
  };
}

/**
 * Parse the narration mode from an environment variable string.
 * Returns "off" for unrecognized values.
 */
function parseNarrationMode(value: string | undefined): NarrationMode {
  if (value === "summary" || value === "narrate-summary") return "summary";
  if (value === "everything" || value === "narrate-everything") return "everything";
  return "off";
}

// ── Message Extraction ────────────────────────────────────────────────────────

/**
 * Extract the last assistant message text from a session.
 *
 * NP-03: Walks the messages array in reverse to find the last
 * message with role === "assistant", then concatenates all text parts.
 *
 * Returns undefined if no assistant message is found.
 */
async function extractLastAssistantText(
  client: PluginContext["client"],
  sessionId: string,
): Promise<string | undefined> {
  try {
    const messages = await client.session.messages({ path: { id: sessionId } });
    // Walk in reverse to find the last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.info.role === "assistant") {
        const textParts = msg.parts
          .filter((p) => p.type === "text" && p.text !== undefined)
          .map((p) => p.text as string);
        if (textParts.length > 0) {
          return textParts.join("");
        }
      }
    }
    return undefined;
  } catch {
    // NP-07: silently skip on error
    return undefined;
  }
}

// ── LLM Summarization ─────────────────────────────────────────────────────────

/**
 * Summarize text into 2-3 spoken sentences using Gemini 2.0 Flash.
 *
 * NP-04: Uses raw fetch to Google's generativelanguage API.
 * No SDK dependency. Prompt instructs the model to produce concise
 * spoken-form output suitable for TTS narration.
 *
 * Returns the summary text, or undefined on any failure (NP-07).
 */
async function summarizeWithGemini(
  text: string,
  apiKey: string,
): Promise<string | undefined> {
  if (!apiKey || apiKey.trim() === "") {
    return undefined;
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  const prompt =
    "You are a spoken narration assistant. Summarize the following text into exactly 2-3 clear sentences, plain language, no technical formatting. Respond with only the summary.";

  try {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + "\n\n" + text }] }],
      }),
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return summary;
  } catch {
    // NP-07: silently return undefined on error
    return undefined;
  }
}

// ── MCP readAloud Call ────────────────────────────────────────────────────────

/**
 * Call accordo_voice_readAloud via the Hub's MCP endpoint.
 *
 * NP-05: Sends a JSON-RPC 2.0 `tools/call` request to POST /mcp
 * with bearer token authentication.
 *
 * Returns true if the call succeeded, false on any failure (NP-07).
 */
async function callReadAloud(
  hubUrl: string,
  hubToken: string,
  text: string,
  cleanMode: "narrate-full" | "narrate-headings" | "raw",
): Promise<boolean> {
  try {
    const response = await fetch(`${hubUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: hubToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "accordo_voice_readAloud",
          arguments: { text, cleanMode },
        },
      }),
    });

    return response.ok;
  } catch {
    // NP-07: silently return false on error
    return false;
  }
}

// ── Narration Mode Discovery ──────────────────────────────────────────────────

/**
 * Discover the current narration mode from the Accordo voice state.
 *
 * NP-06: Calls accordo_voice_discover via MCP to read the current
 * voice policy. Falls back to the config override if the call fails.
 */
async function discoverNarrationMode(
  hubUrl: string,
  hubToken: string,
  fallback: NarrationMode,
): Promise<NarrationMode> {
  try {
    const response = await fetch(`${hubUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: hubToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "accordo_voice_discover",
          arguments: {},
        },
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    const toolResult = data.result;
    const text = toolResult?.content?.[0]?.text;
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { policy?: { narrationMode?: string } };
      const value = parsed?.policy?.narrationMode;
      if (value !== undefined) {
        return parseNarrationMode(value);
      }
    } catch {
      // JSON parse failed → fall through to fallback
    }

    // discover succeeded but returned no specific mode; use config
    return fallback;
  } catch {
    // NP-07: silently return fallback on error
    return fallback;
  }
}

// ── Core Narration Logic ──────────────────────────────────────────────────────

/**
 * Handle a session.idle event: extract text, summarize (if needed), narrate.
 *
 * NP-01, NP-02, NP-03, NP-04, NP-05, NP-06, NP-07, NP-10
 *
 * This is the main orchestration function. It:
 * 1. Extracts the last assistant message
 * 2. Checks minimum length (NP-10)
 * 3. Resolves narration mode (NP-06)
 * 4. Summarizes if mode is "summary" (NP-04)
 * 5. Calls readAloud (NP-05)
 * 6. Swallows all errors (NP-07)
 */
async function handleSessionIdle(
  client: PluginContext["client"],
  sessionId: string,
  config: NarrationConfig,
): Promise<void> {
  try {
    const text = await extractLastAssistantText(client, sessionId);
    if (text === undefined || text.length === 0) {
      return;
    }

    // NP-06: Determine the effective narration mode.
    // If config says "off", skip discover (no MCP calls needed).
    // Otherwise re-check from voice policy in case user changed it.
    let currentMode: NarrationMode = config.narrationMode;
    if (currentMode !== "off") {
      currentMode = await discoverNarrationMode(
        config.hubUrl,
        config.hubToken,
        config.narrationMode,
      );
    }

    if (currentMode === "off") {
      return;
    }

    let narrationText = text;
    let useCleanMode: "narrate-full" | "narrate-headings" | "raw" = "narrate-full";

    // NP-10: For summary mode, bypass Gemini if response is short
    if (currentMode === "summary" && text.length >= config.minResponseLength) {
      // NP-04: Summarize with Gemini
      if (config.geminiApiKey) {
        const summary = await summarizeWithGemini(text, config.geminiApiKey);
        if (summary !== undefined) {
          narrationText = summary;
        }
      }
    }

    // NP-05: Call readAloud
    await callReadAloud(config.hubUrl, config.hubToken, narrationText, useCleanMode);
  } catch (err) {
    // NP-07: Silent failure — log to stderr only
    // eslint-disable-next-line no-console
    console.error("[narration-plugin] error:", err);
  }
}

// ── Module-level debounce timer map (NP-02) ────────────────────────────────────

export const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Overridable internal resolver (for ESM testability) ───────────────────────
// NarrationPlugin calls resolveConfig through this object so that vi.mock can
// patch the reference without a circular self-import.  Tests replace
// _resolvers.resolveConfig; production code never touches this object.
export const _resolvers = {
  resolveConfig,
};

// ── Plugin Export ──────────────────────────────────────────────────────────────

/**
 * OpenCode plugin entry point.
 *
 * NP-01: Hooks session.idle
 * NP-02: Debounces by 1500ms to skip subagent completions
 *
 * Uses OpenCode's v1 plugin format — default export must be { server: Plugin }
 * so readV1Plugin detects it before getLegacyPlugins is called.
 */
const NarrationPlugin = async (
  context: PluginContext,
): Promise<{ event: (opts: PluginEvent) => Promise<void> }> => {
  await context.client.app.log({ body: { service: "narration", level: "info", message: `Plugin loaded, directory: ${context.directory}` } });
  const config = _resolvers.resolveConfig(context.directory);
  await context.client.app.log({ body: { service: "narration", level: "info", message: `Config resolved, hubUrl: ${config.hubUrl}, mode: ${config.narrationMode}` } });

  return {
    event: async (event: PluginEvent): Promise<void> => {
      await context.client.app.log({ body: { service: "narration", level: "info", message: `Event fired: ${event.type}` } });
      if (event.type !== "session.idle") return;

      // Note: session.idle events have no sessionId on the event object (it's in the bus context).
      // We use a fixed debounce key since there's only ever one active session at a time.
      const DEBOUNCE_KEY = "idle";

      // NP-02: Clear any pending debounce timer.
      // Only the final idle event (after all subagents complete) triggers narration.
      const existingTimer = debounceTimers.get(DEBOUNCE_KEY);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        debounceTimers.delete(DEBOUNCE_KEY);
        await context.client.app.log({ body: { service: "narration", level: "info", message: `Debounce timer fired, calling handleSessionIdle` } });
        await handleSessionIdle(context.client, DEBOUNCE_KEY, config).catch(
          (err) => {
            context.client.app.log({ body: { service: "narration", level: "error", message: `Error: ${err}` } });
          },
        );
      }, config.debounceMs);

      debounceTimers.set(DEBOUNCE_KEY, timer);
    },
  };
};

// ── Public exports (for tests) ────────────────────────────────────────────────
export {
  NarrationPlugin,
  parseNarrationMode,
  resolveConfig,
  extractLastAssistantText,
  summarizeWithGemini,
  callReadAloud,
  discoverNarrationMode,
  handleSessionIdle,
};

// ── OpenCode v1 plugin format ─────────────────────────────────────────────────
// OpenCode's plugin loader (readV1Plugin) expects:
//   mod.default = { server: Plugin }  ← v1 format (takes priority)
// If default export is a bare function, the loader falls through to the
// legacy path (getLegacyPlugins), which iterates ALL Object.values(mod) and
// throws "Plugin export is not a function" when it encounters non-function
// named exports (debounceTimers: Map, _resolvers: object).
export default {
  id: "narration",
  server: NarrationPlugin,
};
