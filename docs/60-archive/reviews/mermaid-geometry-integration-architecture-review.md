# Architecture Review — Mermaid Geometry Integration for Accordo Diagrams

**Reviewer:** Reviewer Agent  
**Date:** 2026-04-05  
**Proposal:** "Mermaid Geometry Integration for Accordo Diagrams" (architecture proposal submitted for review)  
**Verdict:** **PASS WITH FINDINGS — 5 blocking issues must be resolved before implementation begins**

---

## Summary

The proposal correctly diagnoses a real problem: the existing `auto-layout.ts` reimplements geometry heuristics that diverge from Mermaid's own layout engine, producing node sizes and positions that don't match what Mermaid renders. The proposed direction — extract geometry from Mermaid's own SVG output rather than reimplementing it — is architecturally sound in principle.

However, the proposal **significantly underestimates the technical risk and complexity** of the approach. Several issues are blockers: the jsdom + `mermaid.render()` path is harder than stated, the proposed API types are inconsistent with the existing type system, and the most common edit path (incremental node additions via `unplaced[]`) is not addressed at all. These must be resolved before any implementation begins.

---

## PASS — What the Proposal Gets Right

1. **Problem diagnosis is accurate.** `SHAPE_DIMS` in `auto-layout.ts` (lines 19–37) are hardcoded constants. When Mermaid renders actual SVG, node sizes are text-content-dependent and differ from these constants. The root cause is real.

2. **The pipeline boundary is correct.** Inserting a new `mermaid-geometry-extractor` module between parsing and `LayoutStore` population is the right boundary. It preserves the existing `LayoutStore` schema, `generateCanvas`, reconciler, and MCP tools unchanged. The proposal correctly identifies what doesn't change (§10).

3. **The `applyGeometryToLayout` merge function is the right design.** Keeping existing user overrides when merging extracted geometry into a LayoutStore is the correct reconciliation approach — it's consistent with the existing reconciler contract.

4. **jsdom is a reasonable starting point** for providing a DOM environment to `mermaid.render()` in Node.js. It is not the only option (see Findings), but it is a defensible choice if the DOM limitations are explicitly handled.

5. **"Fallback to auto-layout on extractor failure" is correct** as a principle. It preserves backward compatibility during the rollout.

6. **Keeping mermaid pinned is correct.** SVG structure is not part of Mermaid's public API contract and can change on any release. Strict pinning is necessary.

---

## FAIL — Blocking Issues (Must Fix Before Implementation)

### BLOCKER-1 — jsdom will not be sufficient for `mermaid.render()` without canvas polyfills

**Evidence:** `packages/diagram/src/parser/adapter.ts` lines 1–22 already sets up a `window` shim specifically because `getDiagramFromText()` triggers DOMPurify (which checks for `window.trustedTypes`). That's a minimal shim for the *parsing* path.

`mermaid.render()` goes further: it calls `document.createElement('svg')`, appends to DOM, measures text using `SVGTextElement.getComputedTextLength()` and `getBBox()`, and may use `requestAnimationFrame`. jsdom does not implement SVG geometry methods (`getComputedTextLength`, `getBBox` return 0 by default). Without real text measurement, the extracted dimensions will be **zeros** — worse than the current hardcoded constants.

**What must be resolved:** The proposal must explicitly specify what shims are required beyond jsdom:
- `node-canvas` for canvas-based text measurement? (adds ~15MB native dependency, requires OS-level build toolchain)
- A custom `getBBox` stub that returns heuristic values? (defeats the purpose)
- Headless Chromium via Puppeteer? (completely different approach)

This is not a "risk" (§7 item 4) — it is a potential showstopper that must be prototyped and confirmed before the architecture is approved. **The PoC in Phase 1 should be the first gate, not the last.**

**Required resolution:** Add a PoC spike as Phase 0 (before Phase 1). The spike must demonstrate that `mermaid.render()` produces non-zero node geometry for a state diagram in a Vitest Node.js test environment. Report the shims required and their cost (bundle size, build complexity, native dependencies).

---

### BLOCKER-2 — SVG element ID ↔ Mermaid node ID mapping is underspecified and differs per diagram type

**Evidence:** The existing parser in `adapter.ts` consumes the mermaid internal `db` which provides raw node IDs. SVG output mangles these: Mermaid prefixes IDs with diagram-type-specific patterns. For flowcharts: `flowchart-<nodeId>-<index>`. For state diagrams: `stateDiagram-<stateId>-<index>`. For class diagrams: `classId-<className>-<index>`. These patterns are internal, not documented, and have changed across Mermaid versions.

**Why it matters:** `applyGeometryToLayout` must map `GeometryMap.nodes` keys to `NodeLayout` keys in the `LayoutStore`. If the SVG ID → node ID mapping is wrong, the extracted geometry is applied to the wrong nodes (silent data corruption) or silently lost (geometry is ignored, fallback fires constantly).

**Required resolution:** Before Phase 1, research and document the SVG ID → node ID mapping rules for each supported diagram type. These rules must be tested with a suite of representative diagrams. The spike (BLOCKER-1) must include this mapping work. If the mapping cannot be made reliable, the architecture should use mermaid's internal `db` (already available from `getDiagramFromText`) as the source of node IDs, rather than parsing SVG element IDs.

---

### BLOCKER-3 — Proposed `GeometryMap` types are inconsistent with the existing type system

**Evidence:** `packages/diagram/src/types.ts`:
- `NodeLayout` uses `w: number` and `h: number` (not `width`/`height`) — lines ~80–95 of types.ts
- `EdgeLayout` uses `waypoints: ReadonlyArray<{x: number, y: number}>` (not `points`) — lines ~110–125 of types.ts

The proposal's `GeometryMap` type (§5) defines:
```typescript
nodes: Record<string, { x: number; y: number; width: number; height: number; shape: string }>
edges: Record<string, { points: Array<{x: number; y: number}> }>
```

The `applyGeometryToLayout` function must translate `width → w`, `height → h`, `points → waypoints`. This is an explicit field rename in the adapter. If not documented and enforced by the type system, this is a latent bug — the compiler won't catch it because both are `number`.

Additionally, mermaid's SVG uses **center-based coordinates** for node positions (the center of the bounding box), while `NodeLayout` uses **top-left coordinates**. `auto-layout.ts` lines 142–143 perform this conversion: `x: placed.x - (w/2)`. The geometry extractor must perform the same conversion, or the proposal must explicitly state that `GeometryMap` uses top-left coordinates throughout.

**Required resolution:** Update the `GeometryMap` type definition to either:
(a) Match the existing field names (`w`, `h`, `waypoints`) exactly — simplifying the adapter, or  
(b) Keep different names but document the explicit mapping in `applyGeometryToLayout`'s contract and add a comment in code explaining the rename.

Also explicitly state and test whether `GeometryMap.nodes[id].x/y` are **top-left** or **center** coordinates, and document the conversion in the interface contract.

---

### BLOCKER-4 — The `unplaced[]` flow is not addressed

**Evidence:** `packages/diagram/src/reconciler/reconciler.ts` — new nodes detected by the reconciler (diagram source edited to add a node) are placed into `LayoutStore.unplaced[]`. These are then resolved by `placeNodes()` in `packages/diagram/src/canvas/canvas-generator.ts` before rendering. The proposal says `generateCanvas` doesn't change (§10).

The proposal replaces `computeInitialLayout` (called once when a diagram is first opened). But the ongoing editing loop is:
1. User edits diagram source
2. Reconciler diffs old vs new → new nodes → `unplaced[]`
3. `generateCanvas` calls `placeNodes()` to position them heuristically

For `unplaced[]` nodes, the only geometry available is the heuristic. Two options exist: (a) re-run `extractMermaidGeometry` on the full updated source to get fresh geometry for all nodes (including new ones), or (b) keep the heuristic fallback for new nodes only. Option (a) means the extractor runs on every edit — performance implications must be addressed. Option (b) means new nodes still use heuristic dimensions until the user explicitly resets layout.

**Required resolution:** The proposal must explicitly address the `unplaced[]` flow: which path does it take, and what are the performance implications? This must appear in the architecture description and in the NFRs.

---

### BLOCKER-5 — classDiagram and erDiagram have no migration path

**Evidence:** `auto-layout.ts` supports four diagram types: `flowchart`, `classDiagram`, `stateDiagram-v2`, `erDiagram` (line ~50, `switch` on `diagram.type`). The proposal's 5-phase rollout covers only `stateDiagram-v2` (Phases 1–2) and `flowchart` (Phase 3). Phase 4 says "deprecate auto-layout heuristics" — but that cannot happen while `classDiagram` and `erDiagram` still rely on dagre-based layout.

**Required resolution:** Add Phase 5 for `classDiagram` and Phase 6 for `erDiagram`, or explicitly state that those types will retain dagre-based layout indefinitely and are excluded from the heuristic deprecation. The "possibly remove dagre dependency" claim in §9 cannot be realized without these phases.

---

## Medium Findings (Should Fix Before Phase 1)

### MEDIUM-1 — No performance SLA

The existing `computeInitialLayout` is synchronous and fast (~1–5ms for typical diagrams). The proposed `extractMermaidGeometry` involves: jsdom initialization, dynamic import of mermaid, DOM manipulation, SVG parsing, and ID mapping. This is potentially 100–500ms on first call (jsdom cold start) and 50–200ms on subsequent calls.

The VSCode workspace extension host shares resources with the editor. Blocking the extension host for 500ms on diagram open would be user-visible.

**Required resolution:** Add a non-functional requirement specifying a maximum latency budget for `extractMermaidGeometry`. Specify whether jsdom is initialized once (singleton) or per-call. Specify whether extraction is performed eagerly (on diagram open) or lazily (on first render).

### MEDIUM-2 — No test strategy for `extractMermaidGeometry` in Vitest

The existing 618-test suite runs under Vitest with Node.js environment. `extractMermaidGeometry` using jsdom would require either:
- Vitest `environment: "jsdom"` or `environment: "happy-dom"` — different from the rest of the test suite
- Mocking the entire jsdom/mermaid render pipeline — which would make the tests test nothing meaningful
- Integration-style tests using real jsdom + mermaid

**Required resolution:** Specify the test environment and strategy for `extractMermaidGeometry` tests before Phase B. Clarify whether these are unit tests (mocked DOM) or integration tests (real jsdom + mermaid).

### MEDIUM-3 — Bundle size impact not analyzed

jsdom with all dependencies is approximately 1.8–2.2MB compressed. The `packages/diagram` package already bundles `mermaid@11.12.3` (large) and `@dagrejs/dagre@^1.1.4`. The `extensionKind: ["workspace"]` constraint means this runs in the VSCode extension host process — bundle size affects VS Code startup time.

**Required resolution:** Measure the current `packages/diagram` bundle size (run `pnpm build` and inspect `dist/` output sizes). Add a bundle size limit as an NFR. Evaluate whether jsdom can be dynamically imported (loaded only when a diagram is opened) to reduce startup impact.

### MEDIUM-4 — Fallback contract is underspecified

"Fallback to current auto-layout on extractor failure" is stated as a principle but not defined at the function boundary level. What constitutes failure? Timeout (what value)? Unhandled exception? Partial SVG parse (some nodes mapped, others not)? Mermaid render error (syntax error in diagram)?

**Required resolution:** Define the fallback contract explicitly:
```typescript
type ExtractionResult =
  | { ok: true; geometry: GeometryMap }
  | { ok: false; reason: 'timeout' | 'render-error' | 'mapping-incomplete'; fallback: 'dagre' }
```
Specify the timeout value. Specify whether partial success (some nodes mapped) is treated as success or failure.

---

## Minor Findings (Address in Implementation)

### MINOR-1 — "Not using internal Mermaid APIs" framing is misleading

The proposal says "do not attempt to call Mermaid's internal layout functions directly" (§6). But `adapter.ts` already uses `mermaidAPI.getDiagramFromText()` — an internal API. The new approach uses `mermaid.render()` (public API) but extracts geometry from SVG structure that is internal and undocumented. The framing should be: "use the public `mermaid.render()` API for rendering; accept that SVG structure is implementation-internal and must be validated per Mermaid version."

### MINOR-2 — `GeometryMap.direction` is redundant

`ParsedDiagram.direction` is already returned by the existing `adapter.ts` parser. If `applyGeometryToLayout` receives both a `GeometryMap` and the existing `ParsedDiagram`, the `direction` field in `GeometryMap` is redundant. Remove it or explain why it needs to be re-extracted from SVG.

### MINOR-3 — `auto-layout.ts` already violates the 200-line file guideline

`auto-layout.ts` is 511 lines. `coding-guidelines.md` specifies a 200-line file maximum. While replacing it is the goal of this initiative, the current file is a guideline violation. If Phase C work produces new files, they must comply with the limit from the start. The review should not accept new files that exceed 200 lines.

### MINOR-4 — Mermaid SVG regression detection not specified

Given that mermaid is pinned but will eventually need to be upgraded, the proposal should specify how SVG structure regressions are detected across version bumps. Snapshot tests of extracted geometry (input: mermaid source → expected: `GeometryMap` JSON) would catch regressions automatically. This should be part of the test requirements.

---

## Required Changes Before Implementation Begins

In priority order:

1. **[BLOCKER-1] Add Phase 0 PoC spike.** Demonstrate that `mermaid.render()` in Node.js (Vitest test) produces non-zero node `width/height/x/y` for a state diagram. Document the shims required (jsdom, canvas polyfills, requestAnimationFrame stubs). Report bundle size delta. This is a binary gate: if non-zero geometry cannot be produced, the SVG-render-and-extract approach must be revised or replaced.

2. **[BLOCKER-2] Research and document SVG ID mapping rules** for `stateDiagram-v2` and `flowchart` before Phase 1. Produce a table: diagram type → SVG element ID pattern → mermaid node ID recovery rule. Include version-specific notes if patterns changed between mermaid 10.x and 11.x.

3. **[BLOCKER-3] Fix `GeometryMap` type definition** to explicitly use existing field names or document the translation. Clarify coordinate system (top-left vs center) and document the conversion rule.

4. **[BLOCKER-4] Specify the `unplaced[]` edit-loop behavior** explicitly: does `extractMermaidGeometry` run on every reconciler cycle, or only on initial layout? Define the performance contract for both paths.

5. **[BLOCKER-5] Extend the rollout plan** to cover `classDiagram` and `erDiagram`, OR explicitly state these are excluded from heuristic deprecation indefinitely. Remove the "possibly remove dagre dependency" claim until all four types have migration plans.

6. **[MEDIUM-1] Add performance NFR.** Specify maximum latency for `extractMermaidGeometry`. Specify jsdom lifecycle (singleton vs per-call).

7. **[MEDIUM-2] Specify test strategy** for `extractMermaidGeometry` before Phase B begins.

8. **[MEDIUM-4] Define the `ExtractionResult` return type** with explicit failure modes and fallback contract.

---

## Detailed Execution Work Plan

The proposal's 5-phase plan is restructured here to address the blockers:

### Phase 0 — Technical Spike (1–2 days, no PR merge until spike passes)

**Goal:** Validate that `mermaid.render()` in Node.js produces usable geometry.

**Tasks:**
1. Create `packages/diagram/src/spike/geometry-spike.ts` (throwaway, not merged to main)
2. In a Vitest test: initialize jsdom, configure mermaid with `startOnLoad: false`, call `mermaid.render('test-id', stateDiagramSource)`, parse the returned SVG string, extract `<g>` element bounding boxes
3. Assert that node `width` and `height` values are non-zero
4. If `getBBox()` returns zeros: evaluate `node-canvas` integration; if unacceptable, pivot to an alternative (e.g., parsing mermaid's internal dagre layout output from `getDiagramFromText` db rather than SVG)
5. Document: shims required, bundle size delta, extraction latency (P50/P95 over 10 runs), SVG ID → node ID mapping patterns

**Gate:** Spike passes if and only if non-zero geometry is demonstrated for at least one state diagram and one flowchart.

---

### Phase 1 — Core Types and Extractor Interface (after Phase 0 gate)

**Goal:** Define the stable API contract.

**Tasks:**
1. Add `GeometryMap` type to `packages/diagram/src/types.ts` — using `w/h` field names, `waypoints` for edges, top-left coordinate system, explicit `ExtractionResult` discriminated union
2. Add `extractMermaidGeometry(source: string): Promise<ExtractionResult>` stub with `throw new Error("not implemented")`
3. Add `applyGeometryToLayout(result: ExtractionResult, current: LayoutStore, parsed: ParsedDiagram): LayoutStore` stub
4. Write failing tests for both functions (Phase B of TDD cycle)

**Deliverable:** Type definitions + stubs + failing tests. No implementation.

---

### Phase 2 — Extractor Implementation: State Diagrams

**Goal:** `extractMermaidGeometry` returns valid geometry for `stateDiagram-v2`.

**Tasks:**
1. Implement jsdom initialization (singleton, lazy-initialized on first call)
2. Implement `mermaid.render()` call with timeout wrapper (fallback if >500ms)
3. Implement SVG parse: extract node bounding boxes using documented ID mapping rules for state diagrams
4. Implement `applyGeometryToLayout` for state diagrams
5. All Phase 1 tests pass for state diagrams

**NFR gate:** `extractMermaidGeometry` P95 < 500ms for diagrams with ≤20 nodes (measured in Vitest benchmark).

---

### Phase 3 — Extractor Implementation: Flowcharts

**Goal:** Extend to `flowchart` and `flowchart-v2`.

**Tasks:**
1. Add flowchart SVG ID mapping rules
2. Extend extractor and adapter for flowchart node shapes (rhombus, cylinder, etc.)
3. All tests pass for flowcharts
4. Add snapshot tests: 5 representative flowcharts → verify `GeometryMap` JSON is stable across mermaid patch versions

---

### Phase 4 — Integration: Replace `computeInitialLayout` Call Site

**Goal:** Wire the extractor into the layout pipeline.

**Tasks:**
1. In `auto-layout.ts` (or a new `layout-coordinator.ts` if file size requires split), replace `computeInitialLayout` with: try `extractMermaidGeometry` → on success apply geometry → on failure fall back to `computeInitialLayout`
2. Add integration test: open diagram → verify LayoutStore nodes have non-heuristic dimensions
3. Address `unplaced[]` flow: specify and implement the strategy from BLOCKER-4 resolution
4. Bundle size check: `dist/` must not grow by more than the agreed limit

---

### Phase 5 — classDiagram

**Goal:** Extend to `classDiagram`.

**Tasks:** Same pattern as Phase 2–3 for class diagrams.

---

### Phase 6 — erDiagram

**Goal:** Extend to `erDiagram`.

**Tasks:** Same pattern.

---

### Phase 7 — Deprecate Heuristics (only after Phases 2–6 complete)

**Goal:** Remove `SHAPE_DIMS` constants and dagre-based geometry from `auto-layout.ts`.

**Tasks:**
1. Remove hardcoded `SHAPE_DIMS` constant
2. Evaluate whether `@dagrejs/dagre` is still needed for graph topology (it may still be needed for *ordering* even if geometry comes from mermaid)
3. If dagre can be removed: remove dependency, update package.json, verify tests pass

---

## Concrete Requirements Set

### Functional Requirements

| ID | Requirement |
|----|-------------|
| MG-F-01 | `extractMermaidGeometry(source)` returns a `GeometryMap` with node `x`, `y`, `w`, `h` values that match what Mermaid renders in SVG output, for diagram types `stateDiagram-v2`, `flowchart`, `flowchart-v2`, `classDiagram`, and `erDiagram`. |
| MG-F-02 | All `x`, `y` coordinates in `GeometryMap` use top-left origin (consistent with existing `NodeLayout` schema). |
| MG-F-03 | `extractMermaidGeometry` returns an `ExtractionResult` discriminated union: `{ok: true, geometry: GeometryMap}` or `{ok: false, reason: ..., fallback: 'dagre'}`. |
| MG-F-04 | On `ok: false`, the calling code must fall back to `computeInitialLayout` (dagre) without visible error to the user. |
| MG-F-05 | `applyGeometryToLayout` preserves all existing user-placed node overrides (positions set by drag/drop) when merging extracted geometry into a `LayoutStore`. |
| MG-F-06 | `applyGeometryToLayout` does not modify edges, clusters, or `aesthetics` fields of the existing `LayoutStore` unless geometry extraction provides explicit values for those fields. |
| MG-F-07 | `extractMermaidGeometry` correctly maps SVG element IDs to mermaid node IDs for all supported diagram types. |
| MG-F-08 | Nodes added incrementally (via the `unplaced[]` path in the reconciler) receive either extracted geometry (via re-extraction) or heuristic geometry (via existing `placeNodes` fallback) — the chosen path must be documented in the architecture and tested. |
| MG-F-09 | The `LayoutStore` schema (`NodeLayout`, `EdgeLayout`, `ClusterLayout`, `LayoutStore`) is not changed. All existing MCP tools and `generateCanvas` continue to work without modification. |
| MG-F-10 | For diagram types not yet migrated (during phased rollout), the existing dagre-based layout is used unchanged. |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| MG-NF-01 | `extractMermaidGeometry` P95 latency ≤ 500ms for diagrams with ≤ 20 nodes, measured in the Vitest Node.js environment using real jsdom. |
| MG-NF-02 | `extractMermaidGeometry` P95 latency ≤ 1500ms for diagrams with ≤ 100 nodes. |
| MG-NF-03 | jsdom (and any canvas polyfill) must be initialized as a singleton — not re-initialized per extraction call. |
| MG-NF-04 | The `packages/diagram` bundle size (`dist/` compressed) must not increase by more than 3MB vs. the baseline before this initiative. |
| MG-NF-05 | `extractMermaidGeometry` must not block the VSCode extension host main thread during rendering. If the render call is synchronous, it must be wrapped in a `Promise` and called from an async context. |
| MG-NF-06 | Mermaid version must remain pinned to `11.12.x` (patch updates only) for the duration of the rollout. A version upgrade requires re-running all snapshot geometry tests. |
| MG-NF-07 | New files introduced by this initiative must comply with the 200-line file size limit in `coding-guidelines.md`. `auto-layout.ts` (currently 511 lines) must be split if modified substantively. |
| MG-NF-08 | Zero new uses of `: any`, `@ts-ignore`, or `// eslint-disable` in produced code. |

### Test / Quality Requirements

| ID | Requirement |
|----|-------------|
| MG-T-01 | Every functional requirement (MG-F-01 through MG-F-10) must have at least one passing test. |
| MG-T-02 | `extractMermaidGeometry` must be tested in a real jsdom environment (not mocked). Vitest `environment: 'jsdom'` or equivalent must be configured for the extractor test file. |
| MG-T-03 | Snapshot tests must be created for at least 3 state diagrams, 3 flowcharts, 1 class diagram, and 1 ER diagram. Each snapshot records the `GeometryMap` JSON output. Tests must fail if geometry changes across mermaid patch upgrades (regression detection). |
| MG-T-04 | A test must demonstrate the fallback path: `extractMermaidGeometry` forced to fail (via mocked timeout or injected error) → `computeInitialLayout` is called → valid `LayoutStore` produced. |
| MG-T-05 | A test must demonstrate `applyGeometryToLayout` preserves existing user overrides: pre-populate a `LayoutStore` with one user-moved node → apply fresh geometry → user-moved node position is unchanged. |
| MG-T-06 | The `unplaced[]` path must have at least one test: start with a populated `LayoutStore`, simulate a reconciler cycle that adds a new node, verify the new node receives either extracted or heuristic geometry (not zero/null). |
| MG-T-07 | A latency benchmark test (Vitest bench or custom timer assertion) must demonstrate MG-NF-01 compliance. |
| MG-T-08 | All 618 existing diagram package tests must continue to pass without modification after any Phase 1–7 changes. |

---

## Suggested Acceptance Criteria

These are the conditions under which the initiative can be considered complete:

1. **Phase 0 gate:** A passing Vitest test that calls `mermaid.render()` in Node.js and extracts non-zero `width`, `height`, `x`, `y` for at least one state diagram and one flowchart node.

2. **Geometry accuracy:** For a reference set of 5 diagrams (2 state, 2 flowchart, 1 class), the `x/y/w/h` values produced by `extractMermaidGeometry` differ from the SVG bounding boxes rendered by Mermaid by ≤ 2px (rounding only).

3. **Fallback reliability:** 100% of test scenarios where `extractMermaidGeometry` is forced to fail result in a valid `LayoutStore` produced via the dagre fallback.

4. **Override preservation:** 100% of user-placed overrides in `LayoutStore` are preserved across a `applyGeometryToLayout` call.

5. **Performance:** `extractMermaidGeometry` P95 latency satisfies MG-NF-01 and MG-NF-02 as measured by MG-T-07.

6. **No regressions:** `pnpm test` in `packages/diagram` reports 0 failures. The count of tests is ≥ 618 (new tests added, none removed).

7. **Type safety:** `tsc --noEmit` reports 0 errors in `packages/diagram`.

8. **Linter clean:** ESLint reports 0 new errors on all new/modified files.

9. **File size compliance:** No new file in the implementation exceeds 200 lines. `auto-layout.ts` must be refactored to comply if it is substantively modified.

10. **Complete coverage:** All four diagram types (stateDiagram-v2, flowchart, classDiagram, erDiagram) either have geometry extraction implemented and tested, or have an explicit documented decision to retain dagre-based layout for that type.

---

## Summary Table

| # | Finding | Severity | Status Required |
|---|---------|----------|----------------|
| BLOCKER-1 | jsdom insufficient without canvas polyfills; PoC spike required | Blocking | Phase 0 gate |
| BLOCKER-2 | SVG ID ↔ node ID mapping underspecified | Blocking | Research before Phase 1 |
| BLOCKER-3 | `GeometryMap` types inconsistent with `NodeLayout`/`EdgeLayout` | Blocking | Fix types before Phase 1 |
| BLOCKER-4 | `unplaced[]` edit-loop flow not addressed | Blocking | Specify before Phase 1 |
| BLOCKER-5 | `classDiagram`/`erDiagram` have no migration path | Blocking | Add to rollout plan |
| MEDIUM-1 | No performance SLA | Medium | Add NFR before Phase 1 |
| MEDIUM-2 | No test strategy for extractor | Medium | Specify before Phase B |
| MEDIUM-3 | Bundle size impact not analyzed | Medium | Measure in Phase 0 |
| MEDIUM-4 | Fallback contract underspecified | Medium | Define `ExtractionResult` before Phase 1 |
| MINOR-1 | "Not using internal APIs" framing misleading | Minor | Fix in prose |
| MINOR-2 | `GeometryMap.direction` redundant | Minor | Remove or justify |
| MINOR-3 | `auto-layout.ts` already over 200-line limit | Minor | Must comply in new code |
| MINOR-4 | No mermaid version regression detection | Minor | Add snapshot tests |

---

*Review complete. Return this document to the architect for resolution of the 5 blocking issues. Re-review is required after BLOCKER-1 (Phase 0 spike) completes, as the spike outcome may change the fundamental approach.*
