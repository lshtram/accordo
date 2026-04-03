# Review — narration-plugin — Phase B

**Date:** 2026-03-31  
**Reviewer:** Reviewer agent  
**Test file:** `.opencode/plugins/narration.test.ts`  
**Requirements:** `docs/20-requirements/requirements-narration-plugin.md`  
**Verdict:** ⚠️ **CONDITIONAL PASS** — tests are ready for Phase C with two mandatory fixes noted below

---

## 1. Test Execution

Tests were run using the workspace's installed vitest (v3.2.4, from `packages/hub/node_modules`):

```
Test Files  1 failed (1)
     Tests  48 failed (48)
  Start at  15:56:35
  Duration  537ms
```

**All 48 tests fail.** ✅ This is the correct and expected state for Phase B.

---

## 2. Failure Mode Analysis

This is a critical Phase B gate criterion: tests must fail at the **assertion level**, not at import/collection errors. The 48 failures split into two categories:

| Category | Count | Error message | Assessment |
|---|---|---|---|
| Functions not exported | 43 | `(0, <fn>) is not a function` | ⚠️ See §4.1 — wrong failure mode |
| `throw new Error("not implemented")` | 5 | `Error: not implemented` | ✅ Correct failure mode |

The 43 "not a function" failures are caused by `parseNarrationMode`, `resolveConfig`, `extractLastAssistantText`, `summarizeWithGemini`, `callReadAloud`, `discoverNarrationMode`, and `handleSessionIdle` not being exported from `narration.ts`. The stub file only exports `NarrationPlugin` and `default`.

The 5 `"not implemented"` failures (the `NarrationPlugin`-based tests + the E2E test) are hitting the `resolveConfig` stub correctly and throwing at the right level.

**This is a blocker that must be fixed before Phase C.** See §4 — Fix Required.

---

## 3. Requirement Coverage Matrix

| Req ID | Description | Tests Present | Test Quality |
|---|---|---|---|
| **NP-01** | Session.idle hook | ✅ 3 tests | Covers: fires handler, ignores non-idle events, ignores missing sessionID |
| **NP-02** | Debounce 1500ms | ✅ 3 tests | Covers: rapid fires, intermediate subagent idle, E2E flow |
| **NP-03** | Last assistant text extraction | ✅ 5 tests | Covers: last message, mixed roles, multi-part, no-assistant, empty array |
| **NP-04** | Gemini summarization | ✅ 4 tests + 1 integration | Covers: endpoint, body, prompt, response parsing, spoken-form output |
| **NP-05** | MCP readAloud invocation | ✅ 5 tests | Covers: POST /mcp, auth header, JSON-RPC structure, cleanMode variants |
| **NP-06** | Narration mode awareness | ✅ 6 tests | Covers: discover call, mode extraction, fallback on failure, fallback on missing, unrecognized mode |
| **NP-07** | Silent error handling | ✅ 5 tests | Covers: Gemini non-OK, empty API key, MCP non-OK, fetch throws, summarize throws |
| **NP-08** | Env var configuration | ✅ 6 tests | Covers: GEMINI_API_KEY, ACCORDO_NARRATION_MODE, default 'off', minResponseLength default, debounceMs default |
| **NP-09** | Auth token from opencode.json | ✅ 1 test | ⚠️ Under-tested — see §5.1 |
| **NP-10** | Minimum response length | ✅ 2 tests | Covers: short skip, cleanMode pass-through |

All 10 functional requirements (NP-01 through NP-10) have at least one test. ✅

---

## 4. Fixes Required (Blockers)

### 4.1 — Missing exports in `narration.ts` (BLOCKER)

**File:** `.opencode/plugins/narration.ts`  
**Problem:** The stub exports only `NarrationPlugin` (line 194) and `default` (line 230). The six helper functions tested directly — `parseNarrationMode`, `resolveConfig`, `extractLastAssistantText`, `summarizeWithGemini`, `callReadAloud`, `discoverNarrationMode`, `handleSessionIdle` — are **not exported**.

This causes 43 of 48 tests to fail with `is not a function` rather than `not implemented`. This is the wrong failure mode: tests cannot verify behaviour they cannot call.

**Fix:** Add named exports to the stub file:

```typescript
export {
  parseNarrationMode,
  resolveConfig,
  extractLastAssistantText,
  summarizeWithGemini,
  callReadAloud,
  discoverNarrationMode,
  handleSessionIdle,
};
```

After this fix, all 48 tests should fail with `Error: not implemented` (correct Phase B failure mode).

---

## 5. Gaps and Weaknesses (Non-blocking for Phase C, address in Phase D)

### 5.1 — NP-09 test is non-functional (medium severity)

**Location:** `resolveConfig` describe block, line 208  
**Problem:** The test asserts `config.hubUrl === MOCK_HUB_URL` and `config.hubToken === MOCK_HUB_TOKEN`, but the test makes no arrangement to create a mock `opencode.json` at `MOCK_DIRECTORY`. The implementation will need to read `{directory}/opencode.json` synchronously (or async). Without a mock file, this test will either fail with a file-not-found error or return incorrect values — not a clean "not implemented" assertion failure.

**Recommendation:** The test needs `vi.mock('node:fs')` or a real temp file fixture at `/data/projects/myproject/opencode.json` containing `{ "mcp": { "accordo": { "url": "http://localhost:3001", "headers": { "Authorization": "Bearer test-token-123" } } } }`. This must be resolved before the test can pass in Phase D.

### 5.2 — `discoverNarrationMode` is partially tested but NP-06 conflates two concerns

**Location:** `handleSessionIdle` describe block  
**Problem:** The `handleSessionIdle` tests use a config object with `narrationMode` directly — they never exercise the `discoverNarrationMode` path. The requirement (NP-06) states the plugin reads mode from `accordo_voice_discover` **or** from a local config override. The integration between `handleSessionIdle` and `discoverNarrationMode` is only tested in the E2E test, but that test uses `NarrationPlugin` (which calls `resolveConfig`, not a fixed config). There is no test for the path: `handleSessionIdle` calling `discoverNarrationMode` at runtime.

**Recommendation:** Add one test to `handleSessionIdle` that verifies it calls `discoverNarrationMode` to read the live mode (rather than only using `config.narrationMode`). If the design intends `handleSessionIdle` to receive the already-resolved mode, the requirement text should be clarified — but if `discoverNarrationMode` is invoked per-event, this needs a test.

### 5.3 — NP-04 test names reference "2.5 Flash" but requirement says "2.0 Flash"

**Location:** `summarizeWithGemini` describe block, line 310  
**Problem:** Test name says "Gemini 2.5 Flash API" but `requirements-narration-plugin.md` NP-04 specifies "Gemini 2.0 Flash". The endpoint URL check (`stringContaining("generativelanguage.googleapis.com")`) is too broad to catch a wrong model version. No test verifies the specific model in the request body (e.g. `gemini-2.0-flash` vs `gemini-2.5-flash`).

**Recommendation:** Add an assertion on the URL path or request body `model` field to pin the required model version. This prevents a developer accidentally using the wrong (more expensive) model.

### 5.4 — `callReadAloud` mock response structure is ambiguous

**Location:** `setupMcpMock()` shared helper, line 82  
**Problem:** The MCP mock returns `{ result: mcpReadAloudResult }` where `mcpReadAloudResult` is a boolean. A real JSON-RPC 2.0 MCP response has the shape `{ jsonrpc: "2.0", id: ..., result: { content: [...] } }`. The mock is not realistic: the implementation will likely check `response.ok` (already tested), but if it also parses the body for errors, the overly-simplified mock structure won't catch a wrong JSON parse path.

**Impact:** Low — since NP-07 says failures should be silently skipped, an incorrect parse just falls through. But the mock fidelity could be improved for future regression safety.

### 5.5 — NP-07 stderr logging is untested

**Location:** `handleSessionIdle` NP-07 tests, lines 631–676  
**Problem:** NP-07 requires errors be "logged to stderr". The tests verify errors are swallowed (`.resolves.not.toThrow()`) but do not verify that a `console.error` call was made. This is a minor gap — the requirement is explicit that failures are "logged to stderr".

**Recommendation:** Add `vi.spyOn(console, 'error')` in the NP-07 tests to verify `console.error` is called with context information.

### 5.6 — Debounce tests use mixed real/fake timers (fragility risk)

**Location:** `NarrationPlugin` describe block, lines 692–713  
**Problem:** The debounce test mixes `await new Promise((r) => setTimeout(r, 50))` (real timer, since fake timers are active) with `vi.advanceTimersByTimeAsync(2000)`. Under `vi.useFakeTimers()`, the `setTimeout` in the loop body uses the fake clock, so `50ms` is fake. However, the `await new Promise(...)` idiom is commonly misunderstood with fake timers. Using `vi.advanceTimersByTimeAsync` is the correct approach, but the inner loop's `setTimeout(r, 50)` will only advance if the fake clock advances inside the loop — which it won't without an explicit advance. This may cause the debounce test to behave unexpectedly depending on vitest's fake timer implementation.

**Recommendation:** Replace the inner `await new Promise((r) => setTimeout(r, 50))` with `await vi.advanceTimersByTimeAsync(50)` to ensure predictable fake-clock advancement.

---

## 6. Mock Quality Assessment

| Mock | Quality | Assessment |
|---|---|---|
| `globalThis.fetch` via `vi.fn()` | Good | Reset in `beforeEach`, dispatches by URL substring, covers both Gemini and MCP paths |
| `client.session.messages` | Good | Uses `vi.fn().mockResolvedValue()`, easily overridden per test, realistic shape |
| Gemini API response | Realistic | Matches actual `generativelanguage.googleapis.com` response structure (`candidates[0].content.parts[0].text`) |
| MCP JSON-RPC response | Weak | Returns `{ result: boolean }` — not a valid JSON-RPC 2.0 envelope. See §5.4 |
| Timer mocking | Adequate | `vi.useFakeTimers()` used correctly in Plugin tests. See fragility note §5.6 |

---

## 7. Assertion Specificity

The assertions are generally specific and regression-safe:

- `expect(body.method).toBe("tools/call")` — pins the JSON-RPC method ✅
- `expect(body.params.name).toBe("accordo_voice_readAloud")` — pins the tool name ✅
- `expect(body.params.arguments.text).toBe(VALID_RESPONSE_TEXT)` — pins the exact text payload ✅
- `expect(body.params.arguments.cleanMode).toBe("narrate-full")` — pins the cleanMode ✅
- `expect(fetchMock).not.toHaveBeenCalled()` — verifies no API call for early exits ✅

No `toBeTruthy()` used where an exact value is expected (guideline §2.2). ✅

---

## 8. Test Independence

- Each describe block runs `setupMcpMock()` or `fetchMock.mockReset()` in `beforeEach` ✅
- `geminiResponseText` and `mcpReadAloudResult` module-level variables are **shared mutable state** ⚠️

The shared `geminiResponseText` variable is mutated in test "NP-04: returns the summary text" (line 342) and "NP-04: summary is 2-3 sentences" (line 613). If these tests run in a different order, the leaked state could affect other tests. The `beforeEach` does **not** reset `geminiResponseText` to its default value.

**Recommendation:** Add `geminiResponseText = "This is a concise summary..."` to `beforeEach` in the `summarizeWithGemini` and `handleSessionIdle` describe blocks.

---

## 9. Summary

| Check | Result |
|---|---|
| Every NP requirement has ≥ 1 test | ✅ PASS |
| Tests fail (not collected/skipped) | ✅ PASS — all 48 run and fail |
| Correct failure mode (assertion/stub, not import error) | ❌ FAIL — 43/48 fail with `is not a function` |
| Mocks are realistic | ✅ Mostly — MCP response shape is weak (§5.4) |
| Assertions are specific | ✅ PASS |
| Tests are independent | ⚠️ Partial — shared mutable `geminiResponseText` (§8) |
| Error paths covered | ✅ PASS — 5 NP-07 tests |
| Edge cases covered | ✅ PASS with gaps noted in §5 |

**Required fix before Phase C:**  
→ **Add named exports** for the 7 helper functions in `narration.ts` (§4.1). This is a one-line change and is the only blocker.

After that fix, all 48 tests will fail with `Error: not implemented` — the correct Phase B state — and the tests are ready to drive Phase C implementation.

The gaps in §5 are recommendations for the developer to address during Phase D.
