# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-08  
**Status:** Browser MCP implementation waves 1-8 are complete and committed. Live evaluation sits at **44/45** pending an explicit product decision on OCR-assisted screenshot redaction. DEC-024 reload-reconnect is implemented and committed; remaining work is robustness hardening and broader E2E validation.  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### ~~Priority 0 — Critical fixes (D2 review gap — found via live E2E)~~ ✅ RESOLVED

`browser_diff_snapshots` action-failed cascade fixed via B2-CTX-000 (`2a20512`). Root cause was `browser_get_semantic_graph` content-script stub throwing "not implemented". Semantic graph now implemented via `collectSemanticGraph()`. Remaining item (D2-001: add "requires live E2E" flag to checklist) moved to Later queue.

---

### Priority A — Browser continuity for agents (MUST-HAVE)

**Problem:** current `browser_*` tools are active-tab scoped, so agent context can break when users switch tabs.  
**Requirement:** if a tab is open, agent must be able to keep reading/inspecting it without forcing user focus.

**Planned deliverables:**
1. ~~Add `browser_list_pages` + `browser_select_page` (prerequisite for all tab targeting)~~ ✅ **DONE** (`2a1cf9b`, `9c3fa9f`)
2. Add tab-scoped targeting contract: `tabId` on remaining understanding tools:
   - `browser_capture_region` — add `tabId` param
   - `browser_diff_snapshots` — add `tabId` param
   (7 tools already done in B2-CTX-001: `browser_wait_for`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_list_pages`, `browser_select_page`, `browser_inspect_element`, `browser_capture_region` has `pageId` only — needs `tabId`)
3. Verify non-active tab workflows: Chrome CDP routing for background tabs, Hub registration for `browser_get_text_map` + `browser_get_semantic_graph`, `diff_snapshots` internal state for background tabs.
4. Add E2E smoke tests for context continuity under tab switching.

**Success criteria:**
- Agent can keep operating on a previously selected tab while user works elsewhere.
- No `active tab required` failure for core read/understanding flows.

---

### Priority J — Browser MCP Closeout

**Implementation status:** Waves 1-8 are implemented and committed.  
**Conservative live score:** **44/45** based on `docs/40-reviews/browser-mcp-live-eval-wave8-2026-04-07.md`.  
**Residual gap:** OCR-assisted screenshot redaction for image-only PII. Current screenshot redaction is bbox/pattern-based and intentionally does not claim OCR coverage.

**Open closeout tasks:**
1. Decide whether OCR screenshot redaction is in-scope for the browser MCP target, or whether 44/45 is the accepted end state for this release.
2. If accepted as-is, update planning docs so they no longer claim 45/45 as the current live-evaluated state.
3. Keep the implementation review trail in `docs/40-reviews/` and historical planning artifacts in `docs/50-reviews/` / `docs/60-archive/`.

**Key evidence:**
- Plan: `docs/50-reviews/M110-TC-45-45-plan.md`
- Wave 6 review: `docs/40-reviews/browser-mcp-wave6-eval-2026-04-06.md`
- Wave 7 live eval: `docs/40-reviews/browser-mcp-live-eval-wave7-2026-04-07.md`
- Wave 8 live eval: `docs/40-reviews/browser-mcp-live-eval-wave8-2026-04-07.md`

---

### Priority L — Diagram Parser/Placement Hardening (Phase 0)

**Status:** Phase A complete (plan + requirements + stubs). Awaiting implementation.

**Problem:** Reviewer findings identified 5 structural weaknesses in the diag.1 engine (568 tests) that will compound during diag.2 feature work: duplicated shape dimensions, uncontained parser exceptions, inconsistent routing contracts, shallow layout validation, and dropped opacity in scene-adapter.

**Plan:** `docs/30-development/diagram-hardening-plan.md` — 10 PRs, 4 parallel chains.  
**Requirements:** `docs/20-requirements/requirements-diagram-hardening.md` — IDs H0-01 through H0-05.

**Open tasks:**
1. PR-01 through PR-03: Shape dimension single-source-of-truth (stub in `shape-map.ts`)
2. PR-04 through PR-05: Parser exception containment
3. PR-06 through PR-07: Orthogonal routing contract normalisation
4. PR-08 through PR-09: Layout-store structural validation
5. PR-10: Scene-adapter opacity passthrough

**Success criteria:**
- All 568 existing tests pass after every PR
- Shape dimensions have one source (`shape-map.ts`)
- Parser exceptions never escape `parseMermaid()`
- `readLayout()` rejects structurally invalid JSON
- Routing point-count invariants documented and tested
- Opacity flows through scene-adapter

---

### Priority M — Diagram Flowchart Fidelity (Batch 1)

**Status:** Phase A complete (design + requirements + stubs). Awaiting test-builder (Phase B).

**Problem:** Five user-validated visual defects in flowchart rendering: trapezoid orientation reversed (cases 12/13), circle renders as oval (case 14), missing edge labels (cases 16/17/19/21), cross arrowhead not applied (case 29), HTML entity/emoji text not decoded (case 32).

**Plan:** `docs/30-development/diagram-fidelity-batch1-plan.md`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` — IDs FC-01 through FC-05.  
**Stub:** `packages/diagram/src/parser/decode-html.ts` — `decodeHtmlEntities()` stub.

**Open tasks:**
1. FC-01: Swap trapezoid geometry in `canvas-generator.ts`
2. FC-02: Enforce w===h for circle shape in `canvas-generator.ts`
3. FC-03: Fix edge label extraction in `flowchart.ts`
4. FC-04: Verify cross arrowhead passthrough parser → scene-adapter
5. FC-05: Implement `decodeHtmlEntities()` and apply in `flowchart.ts`

**Success criteria:**
- All 5 defect groups have failing tests (Phase B) then passing implementation (Phase C)
- All 568+ existing tests remain green
- No architecture changes — fixes are within the existing parser → canvas → scene pipeline

---

### Priority N — Diagram Flowchart Fidelity (Batch 2)

**Status:** Phase A complete (design + requirements + stub). Awaiting test-builder (Phase B).

**Problem:** Four user-validated visual defect groups in flowchart edge rendering: curved edges render as straight lines (cases 28/48/49), direction-unaware edge attachment produces reversed arrows (case 33), subgraph-targeted edges silently dropped (cases 35/36), and edge attachment points imprecise for curved paths (cases 48/49).

**Plan:** `docs/30-development/diagram-fidelity-batch2-plan.md`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` — IDs FC-06 through FC-09.  
**Stub:** `routeCurved()` in `packages/diagram/src/canvas/edge-router.ts`.

**Open tasks:**
1. FC-06: Implement `routeCurved()` with Bézier control points; default flowchart edges to curved routing
2. FC-07: Thread `direction` parameter through `routeEdge()` pipeline; direction-biased attachment
3. FC-08: Resolve cluster-targeted edges to cluster bounding boxes instead of dropping them
4. FC-09: Curve-tangent-aware attachment point clamping in `routeCurved()`

**Implementation order:** FC-07 → FC-08 → FC-06 → FC-09 (dependency chain)

**Success criteria:**
- All 4 defect groups have failing tests (Phase B) then passing implementation (Phase C)
- All 568+ existing tests remain green
- No architecture changes — fixes are within the existing layout → canvas → edge-router pipeline
- Each defect group is independently revertable

---

### Priority K — DEC-024 Reload-Reconnect Hardening

**Status:** Implemented and committed in `f12a8f9`.

**What is working now:**
1. Bridge deactivation uses `softDisconnect()` instead of killing the Hub immediately.
2. Hub starts a disconnect grace timer and self-terminates if no Bridge reconnects.
3. Bridge activation probes for a live Hub before spawning a new one.
4. Reloading the VS Code extension host can reconnect to the same Hub process.
5. If the Hub dies after the grace window, the next Bridge activation spawns a fresh Hub.

**Open hardening tasks:**
1. Add broader manual and automated E2E coverage for reload, full VS Code restart, and stale-session recovery.
2. Decide whether CLI MCP clients should have a smoother post-Hub-restart re-auth/session recovery path.
3. Review stale pid/port/token file cleanup edge cases and shutdown behavior under crashes.

**Key evidence:**
- ADR: `docs/10-architecture/adr-reload-reconnect.md`
- Change plan: `docs/10-architecture/reload-reconnect-change-plan.md`
- Test scenarios: `docs/10-architecture/reload-reconnect-test-scenarios.md`
- Reviews: `docs/40-reviews/reload-reconnect-phase-a.md`, `docs/40-reviews/reload-reconnect-phase-b.md`

---

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
