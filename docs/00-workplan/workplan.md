# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-04  
**Status:** Wave 1 + Priority 0 + Priority H (diagram flowchart debt) complete. Browser MCP evaluation: **31/45 → 45/45 plan** at `docs/50-reviews/M110-TC-45-45-plan.md`. All P2 security features complete + live verified.  
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

| Phase | Gap | Effort | Score Gain |
|---|---|---:|---|
| Phase 1 | GAP-C1: A11y states; GAP-F1: actionability+eventability; GAP-H1: error taxonomy+health | 3d | +5 → 36 |
| Phase 2 | GAP-E1: PNG format; GAP-E2: screenshot modes; GAP-A1: readyState | 1.5d | +3 → 39 |
| Phase 3 | GAP-D1: geometry helpers+viewport ratios+containers; GAP-D2: z-order | 4d | +3 → 42 |
| Phase 4 | GAP-G1: retention control; GAP-I1: screenshot redaction+TTL | 3d | +3 → 45 |

**3 new MCP tools:** `get_spatial_relations`, `manage_snapshots`, `browser_health`  
**2 new content script modules:** `spatial-helpers.ts`, screenshot redaction helper  
**Total: ~11.5 days**

---

### Priority A — Browser continuity for agents (MUST-HAVE)

| Item | Status | Evidence |
|---|---|---|
| **AudioQueue** — singleton audio player with receipt-based FIFO sequencing | ✅ **DONE** (`1a419d6`) | 368 tests passing; 29 audio-queue tests; Phase A→B→C→D→D3→E complete |

**AudioQueue detail:** `packages/voice/src/core/audio/audio-queue.ts` + integration into `streamingSpeak()` (AQ-INT-01), `doSpeakText()` (AQ-INT-02), `createReadAloudTool()` (AQ-INT-03). Prevents O(N×sentences) aplay process explosion from overlapping fire-and-forget streaming calls. Root cause was two-fold: (1) streamingSpeak pre-spawned next player before current finished, and (2) every sentence in a streaming call spawned its own player without any serialization. Fix: single persistent process playing chunks sequentially via FIFO queue, each enqueue() returns a receipt Promise that resolves when that chunk finishes. Review artifacts: `docs/reviews/audio-queue-phase-a.md`, `docs/reviews/audio-queue-phase-a-review.md`, `docs/reviews/audio-queue-phase-c-assessment.md`, `docs/reviews/audio-queue-phase-d.md`. Testing guide: `docs/30-development/testing-guide-audio-queue.md`.


---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
