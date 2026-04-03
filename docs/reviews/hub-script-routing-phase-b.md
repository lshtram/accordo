# Review — hub-script-routing — Phase B

**Reviewer:** Reviewer agent  
**Date:** 2026-04-01  
**Module:** `hub` — NarrationScript execution migration (M52)  
**Review Point:** Phase B (test design quality and coverage)  
**Files reviewed:**
- `packages/hub/src/__tests__/script-deps-adapter.test.ts` (16 tests)
- `packages/hub/src/__tests__/script-tools.test.ts` (24 tests)
- `packages/hub/src/__tests__/tool-registry.test.ts` (31 tests — new dual-pool section)
- `packages/hub/src/__tests__/mcp-handler.test.ts` (50 tests — new short-circuit section)

**Baseline confirmation:** `pnpm test` reports **21 failing (expected stubs) / 493 passing / 0 regressions**. All failing tests fail at the assertion level with "not implemented", not import/compile errors.

---

## Overall Verdict

**APPROVED — Phase C may proceed.**

The test suite is well-structured, requirement-referenced, and covers the critical paths. Issues found are minor — most are test-coverage gaps that are nice-to-have rather than blockers. Three specific gaps are **CONDITIONAL** additions that should be addressed before Phase D2, and are called out explicitly below.

---

## File-by-File Analysis

---

### 1. `script-deps-adapter.test.ts` — 16 tests

#### Coverage ✅

All six `ScriptRunnerDeps` methods are covered:
- `executeCommand`: 7 tests covering happy path, failure path, transport errors, arg handling, timeout presence
- `speakText`: 2 tests (type check + invoke call)
- `showSubtitle`: 2 tests (type check + fire-and-forget behaviour)
- `openAndHighlight`: 2 tests (invokes + throws on failure)
- `clearHighlights`: 1 test (invokes)
- `wait`: 2 tests (resolves + does not invoke Bridge)

#### Correctness ✅

Test assertions are sound. The mock `BridgeServer` is minimal but correct — `invoke` is a typed `vi.fn()` with the right signature. The `successResult` / `failureResult` helpers correctly model the `ResultMessage` contract.

#### A3 — `showSubtitle` void contract ✅ ADDRESSED

The test at line 145–157 correctly verifies the fire-and-forget pattern:
```ts
deps.showSubtitle("Hello", 3000);
expect(bridge.invoke).toHaveBeenCalledTimes(1);
```
The test calls `showSubtitle` synchronously (no `await`), confirms `bridge.invoke` was called once, and checks the exact tool name (`accordo_subtitle_show`) and args shape. This is the correct way to test the fire-and-forget (Option A) dispatch pattern and is exactly what the Phase A review asked for. The choice of Option A (fire-and-forget) is validated by the test contract. **A3 is addressed.**

#### Edge cases — Gaps (minor)

**Gap B1 (minor):** `openAndHighlight` does not verify what tool name or argument shape is passed to `bridge.invoke`. Currently only "calls bridgeServer.invoke" (called at all) and "throws on failure" are tested. A third test verifying the specific tool name and `{ file, startLine, endLine }` argument shape would make the contract unambiguous for the implementer.

**Gap B2 (minor):** `speakText` checks that `bridge.invoke` is called with a tool name matching `/voice|speak/i`, but does not verify the text content or opts (`{ block: true }`) are forwarded correctly. Given that the ScriptRunner depends on `block: true` to pause execution, this is a meaningful correctness property.

**Gap B3 (minor):** `clearHighlights` has a single test confirming invoke is called, but does not verify which tool name is passed. The implementer needs to know the expected tool ID.

**Gap B4 (minor):** `showSubtitle` does not test the error-swallow behaviour. Since `showSubtitle` is fire-and-forget, it should never throw even if `bridge.invoke` rejects. This is an implicit requirement of the void return contract.

#### Test independence ✅

Each test uses a fresh `bridge` and `deps` via `beforeEach`. No shared mutable state.

#### Naming ✅

Test names are prefixed with requirement IDs (`M52-ADAPT`, `DEC-007`). Clear and self-documenting.

---

### 2. `script-tools.test.ts` — 24 tests

#### Coverage ✅

All four tool factories plus the `createScriptTools` convenience wrapper are tested. Static properties (name, description, idempotent, inputSchema) and `localHandler` behaviour are both covered.

#### A4 — `scriptId` assignment ✅ ADDRESSED

Test `A4: localHandler returns a result with a real scriptId (not undefined)` at line 111–122 directly verifies the A4 requirement:
```ts
expect(result).toHaveProperty("scriptId");
expect(typeof result.scriptId).toBe("string");
expect((result.scriptId as string).length).toBeGreaterThan(0);
```
This forces Phase C to generate a real UUID and expose it in the run result. **A4 is addressed.**

#### Correctness — One false positive risk ⚠️

**B5 (potential false positive — MUST FIX before Phase C implementation):**

The "already running" test at line 97–109 is structured as:
```ts
const longScript = { steps: [{ type: "delay", ms: 999_999 }] };
await tool.localHandler({ script: longScript });  // First call
await expect(tool.localHandler({ script: longScript })).rejects.toThrow(/already running/i);
```

The first `await tool.localHandler(...)` call completes synchronously today (throws "not implemented" immediately). When the implementation lands:
- `localHandler` must call `runner.run()` and return without awaiting completion
- The first call must leave the runner in "running" state  
- Only then will the second call correctly fail with "already running"

**This test design is correct** for the intended implementation where `localHandler` starts the runner (fire-and-forget) and returns a `{ scriptId }` result. The key invariant is that `localHandler` returns a result immediately after starting the runner, not after it completes. The test will work correctly once implemented.

However, the test should be more explicit about this contract with a comment. As written, a naive implementer who `await`s the runner's completion inside `localHandler` would make this test fail for the wrong reason (the first call never returns). A comment explaining "first call returns immediately with scriptId; runner continues in background" would prevent this confusion.

This is not a test defect — it is a clarity gap.

#### Edge cases — Gaps

**Gap B6 (important — SHOULD add before Phase D2):** No test for `makeRunScriptTool` input validation. When `script` is invalid (e.g. empty steps, ms out of range), the `localHandler` must either:
- (a) call `validateScript()` and reject with a validation error, or
- (b) let `ScriptRunner` validate and catch the error

Which path is taken is a Phase C decision, but there should be at least one test for the case where invalid input is passed. Currently, the contract for invalid input is completely untested.

**Gap B7 (minor):** `makeStopScriptTool` has no test verifying that stopping an actually-running runner causes the runner to enter the "stopping" or "stopped" state. The only test is "does not throw when idle". A "stop while running" test would give the Phase C implementer a concrete target.

**Gap B8 (minor):** `makeScriptStatusTool` checks `result.state` exists but does not verify the complete `ScriptStatus` shape (`currentStep`, `totalSteps`). If the implementer returns a partial object, this test passes.

**Gap B9 (minor):** `makeScriptDiscoverTool` has no test for the content of the discover output. The test at line 198–205 only checks `result` is defined. A test verifying that the discover output mentions at least the 6 step types ("speak", "subtitle", "delay", "highlight", "clear-highlights", "command") would make the reference-card contract testable.

#### Naming ✅

Requirement IDs (`M52-TOOL-01` through `M52-TOOL-04`) are present on all tests. `A4` label ties back to the Phase A review issue directly.

---

### 3. `tool-registry.test.ts` — New dual-pool section (17 new tests)

#### Coverage ✅ — Excellent

The dual-pool section covers:
- `registerHubTool`: adds to hub pool, type guard passes, survives `register([])`, replacement on name collision
- `register` vs hub tools isolation: bridge-replace leaves hub tools intact
- `list()` merging: both pools merged, hub wins on name collision, deduplicated
- `get()` priority: hub-first lookup, bridge fallback
- `size` deduplication across pools
- `toMcpTools()` strips `localHandler`

This is thorough. The most important invariants (hub wins collision, bridge-replace doesn't destroy hub tools) are explicitly tested.

#### Correctness ✅

All assertions are well-targeted. The collision tests verify the exact winning description string rather than just "defined". The deduplication test at line 366–373 correctly counts unique tool names after a collision.

#### Edge cases — One gap

**Gap B10 (minor):** No test for `toMcpTools()` when both pools contain tools (merged output). The existing test only registers a single hub tool. A test with bridge tools and hub tools both present, verifying total count and that `localHandler` is stripped from hub tools while bridge tool fields are also correctly stripped, would complete the coverage.

**Gap B11 (minor):** No test for calling `registerHubTool()` before any `register()` call (hub-only registry state). While this would likely just work, having coverage of the cold-start ordering removes an implementation assumption.

#### Naming ✅

`DEC-006` labels are consistent and accurate.

---

### 4. `mcp-handler.test.ts` — New short-circuit section (7 new tests in DEC-005 describe block)

#### Coverage ✅ — Thorough

Tests cover:
1. Hub tool calls `localHandler` directly, skips `bridgeServer.invoke()`
2. Bridge tool still routes through `bridgeServer.invoke()`
3. `localHandler` thrown error → `isError:true` MCP response
4. `localHandler` soft-error `{ error: '...' }` → `isError:true` detected
5. Audit entry written on hub tool success
6. Audit entry written on hub tool error

The three-path coverage (happy, throw, soft-error) is the right level of depth for this executor.

#### Correctness ✅

The `invokeSpy` verification (`expect(invokeSpy).not.toHaveBeenCalled()`) is the correct way to confirm the short-circuit. The test at line 879–915 is well-structured.

#### Edge cases — One gap

**Gap B12 (important — SHOULD add before Phase D2):** No test for hub tool `localHandler` that returns a non-object result (e.g. a plain string or `null`). The `extractSoftError` check in the executor operates on the returned data — if `localHandler` returns `"some string"`, does the executor still wrap it in a `content` array correctly? This is a real edge case since `makeScriptDiscoverTool` is likely to return a formatted string rather than an object.

**Gap B13 (minor):** The M32 retry section has no test verifying that retry does NOT happen for a hub-native tool (only bridge tools need retry — hub tools are synchronous calls where retry is meaningless). When the implementation lands, an explicit "no retry for hub tools" test would prevent accidental retry logic being applied to `localHandler`.

---

## A3 and A4 Tracking Summary

| Issue | Status | Where addressed |
|---|---|---|
| A3 — `showSubtitle` void-return / fire-and-forget contract | ✅ Addressed | `script-deps-adapter.test.ts` line 145–157: synchronous call, invoke confirmed, no await |
| A4 — `scriptId` never assigned | ✅ Addressed | `script-tools.test.ts` line 111–122: `A4:` prefixed test, asserts `scriptId` is a non-empty string |

Both issues from the Phase A review have corresponding tests that will fail ("not implemented") until Phase C implements the correct behaviour. This is correct — the tests define the contract that Phase C must satisfy.

---

## Required Changes Before Phase D2

These gaps should be filled during or before Phase C. They are not Phase B blockers, but they affect whether Phase D2 can PASS without gaps.

| ID | Priority | File | Description |
|---|---|---|---|
| B5 | Medium | `script-tools.test.ts:89` | Add comment clarifying that `localHandler` returns immediately (fire-and-forget start) — prevents naive `await runner.complete()` implementation |
| B6 | **High** | `script-tools.test.ts` | Add at least one test for invalid script input passed to `makeRunScriptTool.localHandler` — validates input and rejects with error |
| B12 | **High** | `mcp-handler.test.ts` | Add test for hub tool returning a non-object (string) result — `makeScriptDiscoverTool` likely returns a string; verify it is correctly serialised into the `content` array |

---

## Nice-to-Have (Optional, Not Required for Phase D2)

| ID | File | Description |
|---|---|---|
| B1 | `script-deps-adapter.test.ts` | Verify `openAndHighlight` tool name and args shape |
| B2 | `script-deps-adapter.test.ts` | Verify `speakText` forwards text and opts correctly |
| B3 | `script-deps-adapter.test.ts` | Verify `clearHighlights` uses correct tool name |
| B4 | `script-deps-adapter.test.ts` | Verify `showSubtitle` does not throw even when invoke rejects |
| B7 | `script-tools.test.ts` | Test `makeStopScriptTool` while runner is actually running |
| B8 | `script-tools.test.ts` | Verify full `ScriptStatus` shape from `makeScriptStatusTool` |
| B9 | `script-tools.test.ts` | Verify discover output mentions the 6 step types |
| B10 | `tool-registry.test.ts` | `toMcpTools()` with both pools populated |
| B11 | `tool-registry.test.ts` | Hub-only registry (no prior `register()` call) |
| B13 | `mcp-handler.test.ts` | Verify no M32 retry for hub-native tools |

---

## Checklist

| Criterion | Status | Notes |
|---|---|---|
| Every requirement has at least one test | ✅ | M52-ADAPT, M52-TOOL-01–04, DEC-005, DEC-006 all referenced |
| All error paths covered | ✅ with gaps | B6 (invalid input) and B12 (string result) are meaningful gaps |
| All tests fail at assertion level (no import/compile errors) | ✅ | 21 fail with "not implemented", 0 import errors |
| Tests are independent (no shared mutable state) | ✅ | All use `beforeEach` fresh construction |
| A3 addressed | ✅ | Fire-and-forget pattern tested correctly |
| A4 addressed | ✅ | `scriptId` non-empty string assertion present |
| Naming is self-documenting | ✅ | Requirement IDs in all test names |

---

## Decision: APPROVED — Phase C may proceed

The test suite meets the Phase B gate. All 21 "not implemented" failures are at the correct assertion level. The A3 and A4 concerns from Phase A are addressed with concrete, correctly-failing tests. The existing 493 tests continue to pass with zero regressions.

**Before Phase D2**, the developer should address B6 (invalid input for `script_run`) and B12 (non-object hub tool result). These are the only two gaps that could allow a defective implementation to pass Phase D2 review undetected.
