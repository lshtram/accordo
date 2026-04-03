# Review — hub-script-routing — Phase A

**Reviewer:** Reviewer agent  
**Date:** 2026-04-01  
**Module:** `hub` — NarrationScript execution migration (M52)  
**Review Point:** Phase A (design correctness & feasibility)  
**Files reviewed:**
- `packages/hub/src/hub-tool-types.ts`
- `packages/hub/src/tool-registry.ts`
- `packages/hub/src/mcp-call-executor.ts`
- `packages/hub/src/script/index.ts`
- `packages/hub/src/script/script-types.ts`
- `packages/hub/src/script/script-runner.ts`
- `packages/hub/src/script/script-deps-adapter.ts`
- `packages/hub/src/script/script-tools.ts`
- `packages/hub/src/server.ts`
- `packages/script/src/script-runner.ts` (original — verbatim comparison)
- `packages/script/src/extension.ts` (original extension — name collision check)
- `docs/decisions.md` (DEC-005, DEC-006, DEC-007)
- `docs/10-architecture/architecture.md`
- `docs/30-development/coding-guidelines.md`

---

## Summary

**Verdict: CONDITIONAL PASS — Phase B may begin with 4 issues to track**

The core architectural design is sound and the decisions (DEC-005, DEC-006, DEC-007) are well-reasoned and documented. All five specific questions have clear answers. However, four issues were found that the developer must address during Phase C/D implementation (none block Phase B test writing, but all must be resolved before Phase D2 review).

---

## Q1 — Dual-pool ToolRegistry: is the split correct?

**Answer: CORRECT. No issues.**

The split is the right call. `register()` (Bridge bulk-replace) clears only `bridgeTools`. `registerHubTool()` writes to `hubTools` and is never touched by Bridge updates. `list()`, `get()`, and `toMcpTools()` merge both pools with Hub tools winning on collision. The `size` property deduplicates across both maps.

One cosmetic issue: the JSDoc on `list()` says _"Hub-native tools appear first"_ (line 67), but the implementation adds Bridge tools first and then overwrites with Hub tools — the final Map ordering has Hub tools last. The _behaviour_ (Hub wins on collision) is correct; only the comment is wrong. This is a doc-only bug, but it should be fixed before D2 to avoid misleading future readers.

**Issue A1 (doc-only):** `tool-registry.ts` line 67 — JSDoc says "Hub-native tools appear first" but implementation puts them last in iteration order. Fix the comment to say "Hub-native tools take precedence (overwrite Bridge tools on collision)."

---

## Q2 — `localHandler` short-circuit in `McpCallExecutor`: ordering, error boundaries, race conditions, audit parity

**Answer: CORRECT. No issues.**

- **Ordering** — tool lookup and "unknown tool" guard happen before the `isHubTool` branch (lines 88–91). Correct.
- **Error boundaries** — the `try/catch` on lines 114–136 catches all throws from `localHandler` and maps them to a proper `isError:true` MCP response. Correct.
- **Race conditions** — `localHandler` is awaited on line 115. `McpCallExecutor.executeToolCall` itself is `async`. No race.
- **Audit parity** — `audit("success")`, `audit("error", msg)` are called in both the happy and error paths of the local branch, mirroring the Bridge path. Correct.
- **Soft-error check** — `extractSoftError(data)` is applied to the local handler result (lines 117–121) just as it is for Bridge results. Correct.

One design note (not a bug): Hub-native tools are never subject to the idempotent-retry logic (lines 162–192). This is intentional — retrying a `localHandler` that throws a "not implemented" stub would just throw twice. When the implementation is real, the architect should decide whether Hub-native tools need idempotent retry. Given that script tools are stateful (a retry of `accordo_script_run` would start a second overlapping script), the current behaviour (no retry) is correct. No action required.

---

## Q3 — `script-deps-adapter` stub: does the throw-on-failure contract hold for transport-level errors?

**Answer: YES for the implementation spec; PARTIAL for the stub.**

DEC-007 is correctly documented. The throw-on-failure wrapping (if `!result.success` → throw) is the right contract to preserve `ScriptRunner.errPolicy`.

**However, the current stub violates the intent in a subtle way:** all methods `throw new Error("not implemented")` synchronously (not via rejected Promises). This is correct for `showSubtitle` and `clearHighlights` (which are `void` return), but for the `async` methods (`executeCommand`, `speakText`, `openAndHighlight`, `wait`) a synchronous throw inside an `async`-declared function becomes a rejected Promise — so it _does_ work. No test breakage. But for readability and DEC-007 contract clarity, the async stubs should use `return Promise.reject(new Error("not implemented"))` or be declared as `async` functions.

**Issue A2 (style/clarity):** `script-deps-adapter.ts` stubs for async methods throw synchronously inside non-`async` arrow functions. The result is a rejected Promise (JS semantics), which is functionally correct, but surprising on inspection. Declare them `async` or use `Promise.reject()` for explicitness. Fix before Phase D2.

**Additional concern on `showSubtitle`:** DEC-007 specifies `showSubtitle` as fire-and-forget via `bridgeServer.invoke("accordo_subtitle_show", ...)`. But `accordo_subtitle_show` does not currently exist as a registered tool in the Bridge. The `ScriptRunnerDeps` interface declares `showSubtitle` as a synchronous `void` return — which means the adapter cannot await the Bridge call. The implementation plan must either: (a) make `showSubtitle` truly fire-and-forget (call `bridgeServer.invoke()` without awaiting and without error propagation) or (b) change the `ScriptRunnerDeps` interface to return `Promise<void>`. This design question must be resolved during Phase C — the current stub does not expose this tension.

**Issue A3 (design gap):** The `showSubtitle` adapter implementation requires either a fire-and-forget Bridge call or an interface change to `ScriptRunnerDeps.showSubtitle`. This must be resolved in Phase C before implementing the adapter. Document the chosen approach in `docs/decisions.md` as DEC-008.

---

## Q4 — Script state not in `StateCache`: is poll-only via `accordo_script_status` acceptable?

**Answer: YES, acceptable for the current scope.**

`ScriptRunner` maintains its own `_status` object (lines 81, 116–122, 177, 193, 202, 219). The `status` getter returns a safe copy. `accordo_script_status` (M52-TOOL-03) polls this directly via `runner.status`. There is no persistent storage requirement for script state — it's ephemeral per Hub process lifetime. Agents that need to track progress can poll `accordo_script_status`.

The `StateCache` is designed for IDE state from the Bridge (VSCode context), not for Hub-internal execution state. Mixing them would violate separation of concerns.

**One latent concern:** `ScriptRunner._status.scriptId` is never assigned. `run()` preserves the existing `scriptId` field (`scriptId: this._status.scriptId`), which starts as `undefined` and stays `undefined` forever. The tool handler for `accordo_script_run` must generate a UUID and either: (a) assign it before calling `runner.run()`, or (b) the `run()` signature must accept a `scriptId` parameter. Without this, `accordo_script_status` will always return `{ state: "running", scriptId: undefined }` — the agent has no stable ID to correlate requests.

**Issue A4 (functional gap):** `ScriptRunner.run()` never assigns `this._status.scriptId`. The `accordo_script_run` localHandler must generate a UUID and plumb it into the runner before/during `run()`. Without this, multi-call status correlation is impossible. Fix in Phase C.

---

## Q5 — `script-runner.ts` verbatim copy: hidden VS Code dependencies?

**Answer: CLEAN. No VS Code dependencies.**

The Hub copy (`packages/hub/src/script/script-runner.ts`) is confirmed to be a verbatim copy of the original with only the import path changed (`./script-types.js`). There are **zero** `vscode` imports. The class is pure TypeScript with full dependency injection — all side-effectful operations (speak, highlight, command execution) are passed in via `ScriptRunnerDeps`. The runner is editor-agnostic by design and safe to run in the Hub process.

The file header comment (line 10–12) documents the verbatim-copy relationship and notes the original will be removed post-migration. This is acceptable for Phase A. The developer should ensure the packages/script copy is removed in Phase E/F when the migration is complete, to avoid dual-maintenance drift.

---

## Additional Finding: Name Collision — Both Hub and Bridge Register the Same 4 Tool Names

**Severity: Medium — functional risk during transition**

`packages/script/src/extension.ts` still registers `accordo_script_run`, `accordo_script_stop`, `accordo_script_status`, and `accordo_script_discover` via the Bridge (through `registerTools()` in the VSCode extension host). The Hub simultaneously registers the same 4 names as Hub-native tools.

**The name collision is resolved correctly by the dual-pool design** — Hub tools win (`hubTools` overwrites `bridgeTools` on `get()` and `list()`). An MCP agent will always invoke the Hub-native handler. This is correct runtime behaviour.

**However**, the Bridge-side extension handlers still exist and will receive `accordo_script_*` calls if anything bypasses the Hub (e.g. a test that talks directly to the Bridge WebSocket). More importantly, both sets of handlers will appear in `bridgeTools` (from Bridge registration) and in `hubTools` (from startup wiring), and the `tools/list` response will show them once (deduplicated by Hub precedence). This is correct.

The transition risk is that a developer running integration tests against the Bridge directly may see the old extension-hosted handlers and assume they work. They do not route to the new Hub-native runner.

**Recommendation:** Add a comment to `packages/script/src/extension.ts` in the script tool registration section noting that these registrations are shadowed by Hub-native tools during the M52 migration and will be removed in Phase E. No code change required for Phase B.

---

## Correctness & Feasibility Checklist

| Item | Status |
|---|---|
| Interfaces cover every requirement, signatures complete | ✅ PASS |
| External deps behind abstractions, stubs importable | ✅ PASS |
| Architecture.md updated, no coherence issues | ✅ PASS (§13 added) |
| Scope is realistic for one module | ✅ PASS |
| All dependencies available or have a clear plan | ✅ PASS |
| No blocked-path risks | ✅ PASS — minor gap on `showSubtitle` contract (Issue A3), resolvable in Phase C |
| Design decisions recorded in `docs/decisions.md` | ✅ PASS (DEC-005, DEC-006, DEC-007) |

---

## Issues Summary

| ID | Severity | File | Description | When to fix |
|---|---|---|---|---|
| A1 | Minor (doc) | `tool-registry.ts:67` | JSDoc says "Hub-native tools appear first" but they appear last in iteration; fix comment | Before Phase D2 |
| A2 | Minor (style) | `script-deps-adapter.ts` | Async stub methods throw synchronously in non-async arrow functions; use `async` or `Promise.reject()` | Before Phase D2 |
| A3 | Medium (design gap) | `script-deps-adapter.ts` + `script-runner.ts` | `showSubtitle` void-return contract vs fire-and-forget Bridge call; resolve and document as DEC-008 | Phase C, before implementation |
| A4 | Medium (functional) | `script-runner.ts:121` + `script-tools.ts` | `scriptId` never assigned in `run()`; `accordo_script_run` handler must generate a UUID | Phase C |

**None of these issues block Phase B.** Tests can be written against the current stubs and types. Issues A3 and A4 must be resolved before Phase D implementation.

---

## Decision: PASS — Phase B may proceed

The architecture is sound. The dual-pool registry, `localHandler` short-circuit, and throw-on-failure adapter contract are all correctly designed and documented. The verbatim `ScriptRunner` copy is clean of VS Code dependencies. Phase B test writing may begin. The 4 issues above must be tracked and resolved before Phase D2.
