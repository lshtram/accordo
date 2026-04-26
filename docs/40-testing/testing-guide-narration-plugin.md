# Testing Guide — Narration Plugin (`.opencode/plugins/narration.ts`)

## Section 1 — Automated tests

Run from repo root:

```bash
npx vitest run .opencode/plugins/narration.test.ts .opencode/plugins/narration.resolve-config.test.ts
```

What this verifies:
- `session.idle` hook + debounce behavior
- narration-mode parsing (`summary` / `everything` / `off`, including `narrate-*` aliases)
- assistant-message extraction from OpenCode session API
- Gemini summarization path for long responses in summary mode
- direct raw narration path for short responses in summary mode
- MCP `tools/call` invocation for `accordo_voice_readAloud`
- fail-safe behavior (errors are swallowed, user workflow continues)

## Section 2 — User journey tests

These are manual checks in a real OpenCode session.

### Prerequisites

1. Accordo Hub is running and reachable
2. OpenCode is connected to Hub via MCP
3. Plugin exists at `.opencode/plugins/narration.ts`
4. Environment variables are set as needed:
   - `ACCORDO_NARRATION_MODE=summary|everything|off`
   - `GEMINI_API_KEY` (required only when summary mode should call Gemini)

---

### NP-01: summary mode narrates a long response as a short summary

1. Set `ACCORDO_NARRATION_MODE=summary`
2. Ask for a long answer (e.g., “Give me a detailed 3-paragraph explanation of X”)
3. Wait for the assistant to finish

Expected:
- narration starts shortly after response completion
- spoken text is a short summary, not full output

---

### NP-02: summary mode narrates short responses directly (no Gemini summary)

1. Keep `ACCORDO_NARRATION_MODE=summary`
2. Ask a short question (e.g., “What is 2+2?”)

Expected:
- short raw answer is narrated directly
- no visible failure even if Gemini is unavailable

---

### NP-03: everything mode narrates full response

1. Set `ACCORDO_NARRATION_MODE=everything`
2. Ask any normal question

Expected:
- full assistant response is narrated
- narration happens without summarization

---

### NP-04: off mode disables narration

1. Set `ACCORDO_NARRATION_MODE=off`
2. Ask any question

Expected:
- no audio narration
- text response still works normally

---

### NP-05: debounce prevents duplicate narration for bursty completions

1. Set `ACCORDO_NARRATION_MODE=summary`
2. Ask a complex task likely to trigger subagent/tool bursts

Expected:
- at most one narration for the final response window

---

### NP-06: narration failures are silent (best-effort)

1. Stop Hub or break MCP auth token
2. Ask a question while narration mode is `summary` or `everything`

Expected:
- assistant response still appears normally
- no blocking error popup from plugin
