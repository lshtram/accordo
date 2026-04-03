# Review — narration-plugin — Phase D2

**Date:** 2026-03-31  
**Reviewer:** Reviewer agent  
**Module:** `.opencode/plugins/narration.ts`  
**Requirements:** `docs/20-requirements/requirements-narration-plugin.md`  
**Test file:** `.opencode/plugins/narration.test.ts` + `narration.resolve-config.test.ts`

---

## Verdict: FAIL — must fix before Phase E

Two critical production bugs found (items 8 and 9 below). All other items pass.

---

## PASS items

### 1. Tests: 50 passing, zero failures

```
 Test Files  3 passed (3)
      Tests  50 passed (50)
   Duration  12.72s
```

### 2. Type checker

Running `tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --typeRoots ./node_modules/@types` on `.opencode/plugins/narration.ts` exits with zero errors. (No `tsconfig.json` exists in `.opencode/`; the file typechecks cleanly with strict flags applied manually.)

### 3. Requirements coverage

All ten functional requirements are tested:

| Requirement | Test count | Notes |
|---|---|---|
| NP-01 session.idle hook | 2 | ignores non-idle; ignores missing sessionId |
| NP-02 debounce | 3 | 1500ms debounce; rapid-fire; subagent simulation |
| NP-03 last assistant message | 4 | reverse scan; multi-part; no assistant; empty |
| NP-04 Gemini summarization | 4 | success; api error; network error; empty key |
| NP-05 readAloud invocation | 4 | success; http error; network error; verify params |
| NP-06 narration mode | 5 | off/summary/everything; discover; config override |
| NP-07 silent error handling | 5 | each failure path swallowed |
| NP-08 env-var config | 3 | resolveConfig tests |
| NP-09 token discovery | 2 | opencode.json parse; missing file |
| NP-10 min-length bypass | 2 | short skips Gemini; long uses Gemini |

### 4. No `any` types in production code

Zero occurrences of `: any` in `narration.ts`. `as string` on line 149 is guarded by a prior `.filter((p) => p.text !== undefined)` — the cast is safe. `as string | undefined` on line 413 is redundant (the interface already types `sessionId?: string`) but harmless.

### 5. No `console.log` in production code paths

Both `console.error` calls (lines 375, 432) are in error paths, annotated with `// eslint-disable-next-line no-console`. These are stderr-only, as required by NP-07. No `console.log` appears in production code.

> Note: `narration.debug.test.ts` (a test file) contains multiple `console.log("[DEBUG ...]")` calls that produce stdout noise during `vitest run`. These are not in production code, but the file should be removed or cleaned up before commit (§3.7).

### 6. No TODO/FIXME comments

None found in `narration.ts`.

### 7. No commented-out code

None found.

### 8. Secrets handling

`GEMINI_API_KEY` is only used inside `summarizeWithGemini`. It is passed as a URL query parameter (`encodeURIComponent(apiKey)`) and is never logged. `hubToken` (the Bearer token) is placed in the `Authorization` header and is never logged. No secret leaks to stderr.

### 9. Authorization header format — CORRECT

`opencode.json` stores `"Bearer <uuid>"` as the full value in `mcp.accordo.headers.Authorization`. The plugin reads and passes this verbatim as the `Authorization` header. The Hub's `validateBearer()` in `security.ts` compares the incoming header against `Bearer ${token}` where `token` is the raw UUID from `ACCORDO_TOKEN`. This is a correct match — not a bug.

### 10. No banned `exec`/`spawn` patterns

None. Only `fetch` and `readFileSync` (used once at init time, not in a request handler).

### 11. Architectural constraints satisfied

- No VSCode imports. `narration.ts` only imports `node:fs` and `node:path`.
- No Hub or Bridge modifications.
- The plugin is correctly scoped to `.opencode/plugins/`.

### 12. Test quality

- `beforeEach` resets `fetchMock`, `debounceTimers`, and `_resolvers.resolveConfig` in every test suite.
- No `toBeTruthy()`/`toBeFalsy()` where exact values are expected.
- Tests assert observable outcomes (return values, fetch call params), not implementation details.
- Mocks isolated to each test using `vi.fn()`.

---

## FAIL items — must fix before Phase E

### BUG-1 (Critical): `NarrationMode` value mismatch — `discoverNarrationMode` will always return `"off"` in production

**File:** `.opencode/plugins/narration.ts`, lines 25, 120–125, 293–298  
**Severity:** Critical — narration via voice-policy discover is silently broken at runtime.

**Root cause:**

The plugin defines its own `NarrationMode` type:
```typescript
type NarrationMode = "off" | "summary" | "everything";
```

The voice package (`packages/voice/src/core/fsm/types.ts` line 32) defines:
```typescript
export type NarrationMode = "narrate-off" | "narrate-everything" | "narrate-summary";
```

The `accordo_voice_discover` tool returns a `VoicePolicy` object whose `narrationMode` field contains values like `"narrate-summary"` and `"narrate-off"`.

`discoverNarrationMode()` calls `parseNarrationMode(obj.narrationMode)` (line 296). `parseNarrationMode` only recognizes `"summary"` and `"everything"` (lines 121–123); anything else falls through to `return "off"`. Therefore:

- `"narrate-summary"` → `parseNarrationMode` → **`"off"`** (wrong; should be `"summary"`)
- `"narrate-everything"` → `parseNarrationMode` → **`"off"`** (wrong; should be `"everything"`)
- `"narrate-off"` → `parseNarrationMode` → `"off"` (accidentally correct)

**Effect:** Whenever narration mode is driven by the voice policy (i.e. `ACCORDO_NARRATION_MODE` env var is not set), `discoverNarrationMode` always returns `"off"` regardless of the actual policy. The plugin will never narrate in the common case.

**Why tests pass anyway:** All test mocks use the plugin's own internal values (`"summary"`, `"everything"`) in the mocked discover response, not the real values the Hub would return. The bug is invisible to the test suite.

**Required fix:** Update `parseNarrationMode` to accept both the `"narrate-*"` prefixed values (real Hub values) and the unprefixed aliases (env-var values and existing tests):

```typescript
function parseNarrationMode(value: string | undefined): NarrationMode {
  if (value === "summary" || value === "narrate-summary") return "summary";
  if (value === "everything" || value === "narrate-everything") return "everything";
  return "off";
}
```

Tests for `discoverNarrationMode` must be updated to mock the discover response with the real `"narrate-summary"` / `"narrate-everything"` values from the Hub, and assert the correct mapped result.

---

### BUG-2 (Critical): `discoverNarrationMode` parses the wrong JSON structure — narration mode will never be extracted

**File:** `.opencode/plugins/narration.ts`, lines 287–298  
**Severity:** Critical — `discoverNarrationMode` silently falls back to `fallback` on every real call.

**Root cause:**

The Hub's `buildToolSuccessResponse` (in `packages/hub/src/mcp-error-mapper.ts`, line 97–108) serializes the tool's return value as a **JSON string inside `content[0].text`**:

```typescript
// Hub's actual response shape:
{
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [{ type: "text", text: JSON.stringify(toolReturnValue) }]
  }
}
```

The `accordo_voice_discover` tool returns an object containing `policy: { narrationMode: "narrate-summary", ... }` (see `packages/voice/src/tools/discover.ts`, line 64: `policy: sessionFsm.policy`).

The plugin currently parses:
```typescript
const data = (await response.json()) as { result?: unknown };
const result = data.result;
// Then looks for result.narrationMode directly ← WRONG
```

But the actual path to narration mode is:
```
data.result.content[0].text  →  JSON.parse(...)  →  .policy.narrationMode
```

**Effect:** The `result` object in the real response is `{ content: [...] }`. It does not have a `.narrationMode` property. The guard on line 293 (`typeof result === "object" && ... obj.narrationMode !== undefined`) will be false. The function falls through to `return fallback` on every real call.

**Why tests pass anyway:** Tests mock `json: async () => ({ result: { narrationMode: "summary" } })` — a synthetic structure that does not match real Hub responses.

**Required fix:** Parse the actual MCP response structure:

```typescript
const data = (await response.json()) as {
  result?: {
    content?: Array<{ type: string; text?: string }>;
  };
};

const text = data.result?.content?.[0]?.text;
if (text === undefined) return fallback;

let parsed: unknown;
try {
  parsed = JSON.parse(text);
} catch {
  return fallback;
}

if (
  typeof parsed === "object" &&
  parsed !== null &&
  !Array.isArray(parsed) &&
  "policy" in parsed
) {
  const obj = parsed as { policy?: { narrationMode?: string } };
  if (obj.policy?.narrationMode !== undefined) {
    return parseNarrationMode(obj.policy.narrationMode);
  }
}

return fallback;
```

Tests for `discoverNarrationMode` must be updated to mock the correct Hub response structure, not the synthetic flat structure.

---

## Minor observations (non-blocking, improve before Phase E if possible)

### M-1: Function length violations

The following functions exceed the ~40-line guideline (§3.4):

| Function | Lines |
|---|---|
| `handleSessionIdle` | ~46 lines (slightly over) |
| `discoverNarrationMode` | ~52 lines (the fix in BUG-2 will add more lines) |
| `resolveConfig` | ~35 lines (borderline) |

Consider extracting a `parseMcpDiscoverResponse(data: unknown): NarrationMode | undefined` helper from `discoverNarrationMode` after BUG-2 is fixed. This will also make the parse logic independently testable.

### M-2: Debug test file contains `console.log`

`narration.debug.test.ts` prints `[DEBUG fetch]` and `[DEBUG]` lines to stdout during every test run. This file should be removed (it was a debugging aid) or have all `console.log` calls removed before committing. It adds ~8 lines of noise to CI output.

### M-3: `_resolvers` exported as public API

`_resolvers` is exported (line 387) solely to enable ESM test patching. It is an internal implementation detail. Consider adding a `// @internal` JSDoc tag or a clear comment marking it as test-only infrastructure, so future readers don't treat it as a stable public export.

### M-4: `NP-06` requirement text uses `narrate-off` / `narrate-summary` / `narrate-everything`

The requirements doc (`requirements-narration-plugin.md` lines 56–57) lists the mode values with the `narrate-` prefix. The plugin's `NarrationMode` type omits the prefix. After fixing BUG-1 to accept both forms, this discrepancy is harmless — but consider aligning the requirements and code to use the canonical Hub values (`"narrate-*"`) everywhere to avoid future confusion.

---

## Summary table

| Item | Status |
|---|---|
| 1. Tests pass (50/50) | ✅ PASS |
| 2. Type checker clean | ✅ PASS |
| 3. All requirements have tests | ✅ PASS |
| 4. No `any` types | ✅ PASS |
| 5. No `console.log` in production | ✅ PASS |
| 6. No TODO/FIXME | ✅ PASS |
| 7. No commented-out code | ✅ PASS |
| 8. Secrets not leaked | ✅ PASS |
| 9. Auth header format correct | ✅ PASS |
| 10. No unsafe exec/spawn | ✅ PASS |
| 11. Architecture constraints | ✅ PASS |
| 12. Test quality | ✅ PASS |
| BUG-1: NarrationMode value mismatch | ❌ FAIL |
| BUG-2: Wrong MCP response structure | ❌ FAIL |
| M-1: Function length (minor) | ⚠️ WARNING |
| M-2: Debug test noise (minor) | ⚠️ WARNING |
| M-3: `_resolvers` clarity (minor) | ⚠️ WARNING |

---

## Required actions before Phase E

1. **Fix `parseNarrationMode`** to accept `"narrate-summary"` → `"summary"` and `"narrate-everything"` → `"everything"` (BUG-1).
2. **Fix `discoverNarrationMode`** to parse the real Hub MCP response: `result.content[0].text` → JSON.parse → `.policy.narrationMode` (BUG-2).
3. **Update the discover tests** to use the real Hub response shape and real `"narrate-*"` mode values. Tests currently pass only because they mock a synthetic structure.
4. **Remove or clean `narration.debug.test.ts`** before commit (M-2).
