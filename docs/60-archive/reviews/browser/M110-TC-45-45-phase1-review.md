# Review — M110-TC 45/45 Phase 1 — Phase A

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Design doc:** `docs/50-reviews/M110-TC-45-45-phase1-design.md`  
**Scope:** GAP-C1 (a11y states) + GAP-F1 (actionability/eventability) + GAP-H1 (error taxonomy + health tool)

---

## Verdict: PASS ✅

All seven files reviewed. The design is correct, coherent, and feasible. Five minor findings are noted below — none is a blocker; two are worth fixing before Phase B to avoid propagating debt.

---

## PASS — Items Verified

### 1. Architecture Correctness

**`states: string[]` representation** — Correct. `string[]` is the right choice over `Record<string, boolean>`:
- Sparse (absent = default state; no noise)
- Agent-friendly (`states.includes("disabled")` is idiomatic)
- Smaller token payload (empty array omitted entirely via the `length > 0` guard)
- Deterministic iteration order matches the mapping table order

**State mapping table (10 entries)** — Complete and correct:
- Native DOM properties (`disabled`, `readOnly`, `required`, `checked`) properly type-cast to `HTMLInputElement` — these are idiomatic patterns
- ARIA attributes (`aria-expanded` → `"expanded"/"collapsed"`, `aria-selected`, `aria-pressed`) — correct attribute names and value checks (`=== "true"`, `=== "false"`)
- `document.activeElement === el` → `"focused"` — identity check is correct
- `el.hasAttribute("hidden")` → `"hidden"` — attribute presence is correct
- Missing ARIA states `aria-checked`, `aria-disabled`, `aria-hidden` are not required at C:4→5 scope — the 10 chosen states cover the gap adequately

### 2. Interface Design

**`SemanticA11yNode.states?: string[]`** (`semantic-graph-types.ts` line 35):
- Optional field — backward compatible. Existing consumers who don't check for `states` are unaffected.
- JSDoc references `MCP-A11Y-002` — requirement ID is traceable.

**`ElementDetail` new fields** (`element-inspector.ts` lines 89–104):
- All four new fields are optional — no breaking change to existing callers.
- `hasPointerEvents`, `isObstructed`, `clickTargetSize` correctly typed with explicit primitives/object shapes.
- `GAP-F1 / MCP-INT-001` requirement IDs present in JSDoc.

**`HealthResponse` interface** (`health-tool.ts` lines 24–33):
- Clean, minimal interface. `connected: boolean` is the primary discriminant.
- `recentErrors: string[]` (not optional, always present) is correct — callers can check `.length` without null guard.
- `uptimeSeconds: number` is well-named.
- `debuggerUrl?: string` correctly deferred to implementation.
- `HealthArgs` as an empty interface is acceptable for this pattern (signals "no parameters" explicitly to MCP callers).

**`buildHealthTool()` signature** (`health-tool.ts` lines 54–56):
- Follows the exact `buildXxxTool(relay: BrowserRelayLike): ExtensionToolDefinition` pattern of `buildWaitForTool`, `buildTextMapTool`, `buildSemanticGraphTool`, `buildDiffSnapshotsTool` — consistent.
- `_relay` parameter (underscore-prefixed) is idiomatic TypeScript for "parameter reserved for implementation, unused in stub".

### 3. Coherence — Stubs Tie Together

**`semantic-graph-a11y.ts` imports `collectElementStates`** (line 14):
- Import is present and correct: `import { collectElementStates, ... } from "./semantic-graph-helpers.js"`
- Call site (lines 101–102): `const states = collectElementStates(el); if (states.length > 0) node.states = states;` — exactly as designed.
- Position in `buildA11yNode()` is correct: after `name` is set (line 98), before heading level check (line 105).

**`element-inspector.ts` imports `collectElementStates`** (line 15):
- Import is present and correct: `import { collectElementStates } from "./semantic-graph-helpers.js"`
- Call site (line 258): `const states = collectElementStates(element as HTMLElement);`
- Spread at return (line 282): `...(states.length > 0 ? { states } : {})` — correct, matches the "only include when non-empty" contract.

**`semantic-graph-helpers.ts` stub** (lines 86–100):
- Function signature exactly matches design doc: `export function collectElementStates(_el: HTMLElement): string[]`
- Returns `[]` — correct stub behavior.
- Comment block documents all 10 planned state checks — serves as the implementation specification.

**`page-tool-types.ts` error codes** (lines 309–311):
- All three new codes present: `"detached-node"`, `"blocked-resource"`, `"navigation-failed"`.
- `"detached-node"` correctly added to `TRANSIENT_ERRORS` at `1000` ms (lines 366, 391).
- `"blocked-resource"` and `"navigation-failed"` correctly absent from `TRANSIENT_ERRORS` (permanent failures).
- `"navigation-failed"` alignment: already present in `NavigateResponse.error` union in `control-tool-types.ts` — cross-package consistency is maintained.

### 4. Backward Compatibility

All new fields on `SemanticA11yNode` and `ElementDetail` are optional (`?:`). No existing interface members were removed or changed. `CaptureError` is a union expansion — additive only. No breaking changes.

### 5. Traceability

| Requirement ID | Interface Element | Present? |
|---|---|---|
| MCP-A11Y-002 | `SemanticA11yNode.states`, `collectElementStates()` | ✅ |
| B2-SG-002 | Updated node comment in `semantic-graph-types.ts` | ✅ |
| MCP-INT-001 | `hasPointerEvents`, `isObstructed`, `clickTargetSize` | ✅ |
| MCP-ER-004 | `HealthArgs`, `HealthResponse`, `buildHealthTool()` | ✅ |
| MCP-ER-005 | Three new `CaptureError` codes | ✅ |
| MCP-ER-006 | `TRANSIENT_ERRORS["detached-node"] = 1000` | ✅ |

### 6. Feasibility

All dependencies are in-codebase. `BrowserRelayLike` is already defined (has `isConnected()`). `ExtensionToolDefinition` is imported from `@accordo/bridge-types`. The `semantic-graph-helpers.ts` module is already a shared helper used by `semantic-graph-a11y.ts` — adding `collectElementStates` there is zero-friction. Scope is realistic for one phase.

---

## Findings

### F1 — Minor: `TRANSIENT_ERRORS` Defined Twice (pre-existing, now extended twice)

**File:** `packages/browser/src/page-tool-types.ts`, lines 362–367 and 387–392

The module-level `TRANSIENT_ERRORS` constant (line 362) and the function-local `TRANSIENT_ERRORS` inside `buildStructuredError()` (line 387) are separate declarations. Both were updated with `"detached-node": 1000` in this phase. This is a pre-existing pattern, but it now means the same update must be applied in two places, creating a future maintenance risk.

**Severity:** Low (no current functional impact — both copies were updated)  
**Recommendation:** In implementation phase, consolidate to a single declaration (the module-level one) and have `buildStructuredError()` reference the module-level constant. Not a Phase B blocker.

---

### F2 — Minor: `visible` Field Inconsistency in `buildDetail()` (pre-existing, no regression)

**File:** `packages/browser-extension/src/content/element-inspector.ts`, lines 255 vs 278

```typescript
// Line 255 (unused variable — computed but never used):
const visible = visibleConfidence === "high";

// Line 278 (actual returned value — uses different expression):
visible: visibleConfidence !== "low",
```

The local variable `visible` is computed as `=== "high"` but the returned `visible` field uses `!== "low"`. These are not equivalent: `visibleConfidence === "medium"` produces `false` in the local variable but `true` in the return. The local variable `visible` is a dead variable (assigned but never read).

This is a pre-existing issue and was not introduced by Phase 1. Phase 1 did not modify the `visible` or `visibleConfidence` logic. However, the stub code for `hasPointerEvents`, `isObstructed`, `clickTargetSize` was added to `buildDetail()` in the same area (lines 264–267), and the reviewer flags it so the implementation developer does not miss the pre-existing inconsistency when working in this function.

**Severity:** Low (pre-existing; no regression from Phase 1)  
**Recommendation:** Remove the dead `visible` variable or align both expressions. Flag for fix during Phase C implementation of the same function.

---

### F3 — Informational: `void` Suppression Pattern in `buildHealthTool()` Stub

**File:** `packages/browser/src/health-tool.ts`, lines 61–63

```typescript
void _recentErrors;
void _startTime;
void MAX_RECENT_ERRORS;
```

This is a valid TypeScript pattern to suppress "declared but never used" errors for stub variables. However, it is unconventional — the more idiomatic approach is to use `_`-prefixed names (already done for the parameter `_relay`) or to simply not declare the variables in the stub at all (reserving them for the implementation).

The current approach is not wrong, but the `void MAX_RECENT_ERRORS` line suppresses a module-level constant, which is unusual. Constants are typically not subject to unused-variable warnings.

**Severity:** Informational (no impact)  
**Recommendation:** Consider removing `void MAX_RECENT_ERRORS;` — the `MAX_RECENT_ERRORS` constant is module-level and won't cause a lint error. The `void _recentErrors` and `void _startTime` are appropriate stubs.

---

### F4 — Minor: `NavigateResponse.error` Already Has `"navigation-failed"` — No Duplicate Risk, But Document It

**File:** `packages/browser/src/control-tool-types.ts`, line 61  
**File:** `packages/browser/src/page-tool-types.ts`, line 311

`"navigation-failed"` appears in both `NavigateResponse.error` (an independent type) and the new `CaptureError` union. These are separate types and do not conflict. The design doc (§3.1) correctly states `"navigation-failed"` was "already in NavigateResponse" — adding it to `CaptureError` is intentional to provide a unified error vocabulary for the health tool and structured error builder.

No change needed. Flagged for clarity so the test-builder is aware when writing tests for `buildStructuredError("navigation-failed")`.

**Severity:** Informational  
**Recommendation:** No action needed.

---

### F5 — Minor: Wire-Up Not Yet in `extension.ts`

**File:** `packages/browser/src/extension.ts`, line 300

The design doc (§3.2) specifies:

```typescript
const healthTool = buildHealthTool(relay);
const allBrowserTools = [
  ...pageUnderstandingTools,
  waitTool, textMapTool, semanticGraphTool, diffTool,
  healthTool,  // ← NEW
  ...buildControlTools(relay),
];
```

The `extension.ts` file has not yet been updated — `buildHealthTool` is not imported and `healthTool` is not in `allBrowserTools`. This is expected for a Phase A stub (implementation not yet done), but it means the tool will not be discoverable until Phase D wires it up.

**Severity:** Informational (expected at Phase A — wire-up is implementation work)  
**Recommendation:** Ensure Phase D implementation adds the import and registration. The design doc documents the exact lines to change.

---

## Summary

| Check | Result |
|---|---|
| `states: string[]` representation | ✅ Correct |
| State mapping table (10 entries) | ✅ Complete and correct |
| `SemanticA11yNode.states` field | ✅ Well-designed |
| `ElementDetail` new fields | ✅ Well-designed |
| `collectElementStates()` signature | ✅ Correct |
| Import/call in `semantic-graph-a11y.ts` | ✅ Correct |
| Import/call in `element-inspector.ts` | ✅ Correct |
| `HealthArgs` / `HealthResponse` interfaces | ✅ Appropriate |
| `buildHealthTool()` pattern | ✅ Consistent with existing builders |
| New `CaptureError` codes | ✅ Present and correctly classified |
| `TRANSIENT_ERRORS["detached-node"]` | ✅ Present (in both copies — F1) |
| Backward compatibility | ✅ No breaking changes |
| Requirement traceability | ✅ All 6 requirement IDs covered |
| Scope feasibility | ✅ Realistic for one phase |
| F1: Duplicate `TRANSIENT_ERRORS` | ⚠️ Pre-existing, low risk |
| F2: Dead `visible` variable in `buildDetail()` | ⚠️ Pre-existing, no regression |
| F3: `void` suppression in stub | ℹ️ Informational |
| F4: `navigation-failed` cross-type overlap | ℹ️ Informational |
| F5: Wire-up absent in `extension.ts` | ℹ️ Expected at Phase A |

**Phase A gate: PASS. Proceed to Phase B (test-builder).**

---

*Review written by Reviewer agent. No source code or test files were modified.*
