# Accordo — Narration Plugin Requirements

**Status:** DRAFT  
**Date:** 2026-03-31  
**Scope:** OpenCode plugin for automatic response narration via Accordo voice  
**Architecture ref:** `docs/10-architecture/voice-architecture.md` ADR-03 (alternative approach)

---

## 1. Purpose

Provide an automatic narration layer for OpenCode that summarizes agent responses
and speaks them aloud via Accordo's `readAloud` MCP tool — without relying on
system prompt injection (which is unreliable in OpenCode due to broken
`chat.system.transform` and absence of a before-prompt hook).

This is an **alternative to ADR-03** (agent-driven summary narration) specifically
for the OpenCode agent client. ADR-03 remains the primary approach for agents
where system prompt injection works (Copilot, Claude via instructions URL).

---

## 2. Functional Requirements

### NP-01 — Session idle hook

The plugin MUST hook into OpenCode's `session.idle` event to detect when the
agent has finished a response.

### NP-02 — Debounce subagent completions

The plugin MUST debounce `session.idle` events by 1500ms to avoid narrating
intermediate subagent completions. Only the final idle after all subagents
complete should trigger narration.

### NP-03 — Last assistant message extraction

The plugin MUST extract the last assistant message text from the completed
session using `client.session.messages({ path: { id: sessionID } })`.

### NP-04 — LLM summarization

The plugin MUST call a fast, cheap LLM (Gemini 2.0 Flash) via raw `fetch` to
produce a 2-3 sentence spoken summary of the assistant's response. No SDK
dependency — Bun's native `fetch` is sufficient.

### NP-05 — MCP readAloud invocation

The plugin MUST call the Accordo Hub's `accordo_voice_readAloud` tool via
JSON-RPC 2.0 over the Hub's MCP endpoint (`POST /mcp`) with bearer token auth.

### NP-06 — Narration mode awareness

The plugin MUST respect the current `narrationMode` from the voice policy:
- `narrate-off` → plugin does nothing (no summarization, no readAloud)
- `narrate-summary` → summarize with Gemini then readAloud (for long responses); for short responses, readAloud with raw text directly (no summarization)
- `narrate-everything` → skip summarization, readAloud with full response text

The minimum response length check (NP-10) applies only to whether Gemini summarization
is needed — it does NOT skip narration entirely. Short responses in `narrate-summary`
mode are narrated in full via `readAloud` with the raw text.

The plugin reads narration mode from the `accordo_voice_discover` tool response
via MCP, or from a local config override.

### NP-07 — Error handling (skip, don't break)

On any failure (LLM call, MCP call, message extraction), the plugin MUST
silently skip narration. No errors should propagate to the agent or interrupt
the user's workflow. Failures are logged to stderr.

### NP-08 — Configuration

The plugin MUST support the following configuration via environment variables:
- `GEMINI_API_KEY` — API key for Gemini summarization (required for summarize mode)
- `ACCORDO_NARRATION_MODE` — override narration mode (`off`, `summary`, `everything`)

### NP-09 — MCP auth token discovery

The plugin MUST read the Hub bearer token from the existing `opencode.json`
MCP configuration (same token the agent uses). The Hub URL and auth header are
already configured there.

### NP-10 — Minimum response length

For `narrate-summary` mode: the plugin MUST bypass Gemini summarization when the
assistant response is shorter than `minResponseLength` (default 100 characters),
and instead call `readAloud` directly with the raw text (using `cleanMode=narrate-full`).
This avoids spending API quota on trivial responses.

For `narrate-everything` mode: short responses are still narrated (the minimum length
check does not apply).

The minimum length check is NOT a skip — narration always happens when mode is not `off`.

---

## 3. Non-Functional Requirements

### NP-NFR-01 — Latency

Summarization + readAloud call MUST complete in < 3 seconds total. Gemini Flash
typically responds in < 1s for short prompts.

### NP-NFR-02 — Cost

Summarization MUST use the cheapest viable model. At Gemini 2.0 Flash pricing
($0.10/M input, $0.40/M output), 100 responses/day costs ~$0.01/day.

### NP-NFR-03 — No SDK dependencies

The plugin MUST have zero npm dependencies. It runs in Bun (OpenCode's runtime)
and uses native `fetch` for all HTTP calls.

### NP-NFR-04 — Plugin scope

The plugin is **project-scoped** (`.opencode/plugins/`) because the MCP config
(Hub URL + token) is project-specific in `opencode.json`.

---

## 4. Out of Scope

- Modifying the Hub or Bridge (this is a client-side plugin only)
- Supporting other agent clients (Copilot, Claude — they use ADR-03)
- Voice policy management (handled by existing `setPolicy` tool)
- TTS engine configuration (handled by the voice extension)
