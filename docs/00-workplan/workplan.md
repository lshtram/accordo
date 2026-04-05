# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-05  
**Status:** Phase 1 + Phase 2 of Priority J complete. **40/45** — 5 points to go. See `docs/50-reviews/M110-TC-45-45-plan.md` for remaining TDD gaps.  
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

### Priority J — M110-TC Browser MCP: 31/45 → 45/45 (2026-04-04)

**Baseline:** 31/45 (Session:4, Text:5, Semantic:4, Layout:2, Visual:3, Interaction:3, Deltas:4, Robustness:3, Security:3)  
**Target:** 45/45  
**Plan:** `docs/50-reviews/M110-TC-45-45-plan.md`

| Phase | Gap | Effort | Score Gain | Status |
|---|---|---:|---:|:---:|
| Phase 1 | GAP-C1: A11y states; GAP-F1: actionability+eventability; GAP-H1: error taxonomy+health | 3d | +5 → 36 | ✅ DONE (`fb4b8ad`) |
| Phase 2 | GAP-E1: PNG format; GAP-E2: screenshot modes; GAP-A1: readyState; GAP-G1: retention control | 2d | +4 → 40 | ✅ DONE (E1:`3d62daf`, E2:`3d62daf`, A1:`c0d98eb`, G1:`d3244ac` + fixes:`2f6b5cd`) |
| Phase 3 | GAP-D1: geometry helpers+viewport ratios+containers; GAP-D2: z-order | 4d | +3 → 43 | |
| Phase 4 | GAP-I1: screenshot redaction+TTL | 2.5d | +2 → 45 | |

**New MCP tools:** `manage_snapshots` (GAP-G1 ✅), `browser_health` (GAP-H1 ✅)  
**Remaining:** `get_spatial_relations` (GAP-D1), screenshot redaction helper (GAP-I1)  
**Phase 2 tests:** 23 new tests (662/663 passing, 1 pre-existing flaky)  
**Phase 2 review artifacts:** `docs/reviews/M110-TC-gaps-E1-E2-A1-G1-D2.md`, `docs/reviews/M110-TC-gaps-E1-E2-A1-G1-D2-recheck.md`  
**Phase 2 testing guide:** `docs/testing-guide-m110tc-phase2.md`

---

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
