# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-16
**Status:** Live E2E module testing session completed. Four modalities tested (MD viewer ✅, Marp presentation ⚠️, Diagram ✅, Browser tab ❌). Three new technical debt items identified: (1) comment store silo between VS Code and browser extension, (2) comments panel navigation failures across modalities, (3) Marp user-left comment dismisses presentation on click.  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### ~~Priority 0 — Critical fixes (D2 review gap — found via live E2E)~~ ✅ RESOLVED

`browser_diff_snapshots` action-failed cascade fixed via B2-CTX-000 (`2a20512`). Root cause was `browser_get_semantic_graph` content-script stub throwing "not implemented". Semantic graph now implemented via `collectSemanticGraph()`. Remaining item (D2-001: add "requires live E2E" flag to checklist) moved to Later queue.

---

### ~~Priority A — Browser continuity for agents~~ ✅ COMPLETE (2026-04-13)

**Problem solved:** `browser_*` tools now support explicit `tabId` targeting across all understanding tools — agents can keep operating on a previously selected tab while the user works elsewhere.

**What was delivered:**
1. ✅ `browser_list_pages` + `browser_select_page` — prerequisite tab targeting (`2a1cf9b`, `9c3fa9f`)
2. ✅ `tabId` on 7 tools: `browser_wait_for`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_list_pages`, `browser_select_page`, `browser_inspect_element`, `browser_capture_region` (wave 8, `94b41ba`)
3. ✅ `browser_diff_snapshots` relay payload now forwards `tabId` to Chrome extension (`packages/browser/src/diff-tool.ts` — Phase 1 fix, 2026-04-13)
4. ✅ Chrome extension `handleDiffSnapshots` bypasses SW in-memory fast-path when explicit `tabId` is present — routes directly to content-script store, which is authoritative per-tab (`packages/browser-extension/src/relay-capture-handler.ts` — Phase 2 fix, 2026-04-13)
5. ✅ E2E smoke tests added: B2-CTX-006 tests in `diff-snapshots-tabid.test.ts` (+2 tests → 985 total) and `relay-actions-diff.test.ts` (+2 tests → 1194 total)

**All tests green:** `browser` 985/985, `browser-extension` 1194/1194.

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

### ~~Priority O — Browser Relay Auth Phase 2 — Pairing Flow~~ ✅ COMPLETE

**What was delivered:** Replaced the native messaging approach (which required system-level install scripts) with a simpler in-band pairing flow. No native host, no install step.

**Flow:**
1. Agent calls `accordo_browser_pair` MCP tool → relay issues a one-time code (`NNNN-NNNN`, 5-min TTL)
2. User copies code into the browser extension popup's "VS Code code:" field and clicks Connect
3. Popup POSTs to `/pair/confirm` → relay validates code, returns token
4. Token stored in `chrome.storage.local` → extension auto-connects

**Files changed:**
- `packages/browser/src/shared-relay-server.ts` — added `generatePairCode()`, `/pair/code` (GET) and `/pair/confirm` (POST) endpoints with origin security
- `packages/browser/src/extension.ts` — added `accordo_browser_pair` MCP tool via `buildPairTool()`
- `packages/browser-extension/src/relay-bridge.ts` — removed hardcoded token, reads from `chrome.storage.local`; code 1008 clears stored token
- `packages/browser-extension/src/popup.ts` — added `renderPairingSection()` pairing UI banner
- `packages/browser-extension/src/manifest.json` — removed `"nativeMessaging"` permission

**Tests:** `relay-bridge.test.ts` 5/5, `shared-relay-server.test.ts` 24/24 — all passing.

---

### Priority P — Comment Store Unification: VS Code ↔ Browser Extension

**Status:** Discovery (live testing, 2026-04-16)

**Problem:** The VS Code `accordo-comment-store` and the browser extension's local `store.ts` are completely siloed. Agent-created comments (via `accordo_comment_create` / `accordo_comment_reply`) go only to the VS Code store. The browser extension's pin rendering layer (`content/comment-ui.ts`) reads only from its own local store.

**Observed symptoms:**
- User comment on GitHub Copilot page → pin visible in browser ✅
- Agent reply to same thread (via `accordo_comment_reply`) → not visible as pin ❌
- Agent comment on same GitHub page (via `accordo_comment_create`) → not visible as pin ❌
- Agent comment on "Usage" h3 heading → not visible as pin ❌
- Agent comment on "MCP Dispatch" node in diagram → pin visible ✅

**Root cause:** `VscodeRelayAdapter` in `packages/browser-extension/src/adapters/comment-backend.ts` is a stub — all methods throw `"not implemented — stub for Wave 2 W2-A"`. The adapter factory `selectAdapter()` also throws. There is no path for VS Code comment store events to reach the browser extension's local store.

**Scope of impact:**
- All browser-tab surface comments created by the agent are invisible in the browser
- All browser-tab surface replies by the agent are invisible in the browser
- Only user-initiated browser comments are visible as pins in the browser

**Open tasks:**
1. Implement `VscodeRelayAdapter.listThreads()` — route to VS Code comment store via MCP/Bridge
2. Implement `VscodeRelayAdapter.createThread()` — bridge comment creation events to VS Code store
3. Implement `VscodeRelayAdapter.reply()` — bridge reply events to VS Code store
4. Implement `selectAdapter()` factory — detect VS Code relay availability at runtime
5. Add bidirectional sync: VS Code store changes → browser extension store (comment:create/update events)
6. Consider: should agent-created browser-tab comments go through the browser extension's relay-first path instead of direct to VS Code store?

**Key files:**
- `packages/browser-extension/src/adapters/comment-backend.ts` — stub adapter (all throw)
- `packages/browser-extension/src/relay-comment-handlers.ts` — browser extension's own comment handlers (separate store)
- `packages/browser-extension/src/store.ts` — browser extension's local comment store
- `packages/comments/src/panel/navigation-router.ts` — VS Code comment panel navigation logic

---

### Priority Q — Comments Panel Navigation: Focus to Surface

**Status:** Discovery (live testing, 2026-04-16)

**Problem:** When clicking a comment in the VS Code comments panel, the navigation to the correct surface/view is inconsistent or fails across modalities. Observed symptom: browser extension tab shows "not connected" in the comments panel even though the relay is healthy (`accordo_browser_health` returns `connected: true`).

**Observed symptoms:**
- Comments panel shows browser threads with surface type `browser` but clicking them reports relay as disconnected
- Comments on Marp slides: user-left comment → clicking dismisses the presentation view entirely
- Comments on text/MD preview: clicking navigates but may not scroll to the correct line/anchor

**Root cause area:** `navigation-router.ts` `navigateToThread()` — the command dispatched when focusing a comment from the panel. The router uses `CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD` for text surfaces, but different commands for different surface types. The browser surface handler may be routing to the wrong command or the wrong VS Code context.

**Open tasks:**
1. Map all surface types (`text`, `slide`, `diagram`, `browser`) to the correct focus/navigation command
2. Verify that `accordo_preview_internal_focusThread` is correctly routing browser-surface threads to the right handler
3. Verify that browser relay health (`connected: true`) is correctly reflected in the comments panel for all tab states
4. Fix: clicking user-left Marp slide comment should NOT dismiss the presentation — only open/highlight the pin

**Key files:**
- `packages/comments/src/panel/navigation-router.ts` — `navigateToThread()` dispatch logic
- `packages/marp/src/extension.ts` — Marp-specific `focusThread` handler vs generic preview handler
- `packages/md-viewer/src/extension.ts` — preview focus handler

---

### Priority R — Marp Slide Comment: User-left vs Agent-left Behaviour Divergence

**Status:** Discovery (live testing, 2026-04-16)

**Problem:** On Marp presentations, clicking a user-left comment pin causes the presentation view to close/dismiss. Clicking an agent-left comment pin keeps the presentation open and correctly highlights the pin.

**Root cause area:** The `comments:focus` message handler in `marp-webview-html.ts` calls `sdk.openPopover()`. This is the same path for both user and agent comments. The difference likely lies in how the focus command is dispatched from the comments panel — user-left comments may be going through `navigation-router.ts` → `CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD` which routes to VS Code's generic preview handler, while agent-left comments may be going through a different path (perhaps Marp's internal `focusThread` command registered in `extension.ts`).

**What works:** Agent-left comment focus → `accordo.presentation.internal.focusThread` → `goTo(slideIndex)` + `sdk.openPopover(threadId)` ✅

**What fails:** User-left comment focus → likely routes via `accordo_preview_internal_focusThread` → generic preview handler → may call something that closes the webview panel ❌

**Open tasks:**
1. Trace the exact dispatch path for user-left slide comment → find where it diverges from agent-left
2. Align both paths to use Marp's internal `focusThread` command for slide surfaces
3. Verify `goTo()` + `openPopover()` sequence is identical for both cases
4. Add test: clicking any comment pin on a slide should never close the presentation

**Key files:**
- `packages/marp/src/extension.ts` — `accordo.presentation.internal.focusThread` command
- `packages/marp/src/marp-webview-html.ts` — `comments:focus` handler with `sdk.openPopover()`
- `packages/comments/src/panel/navigation-router.ts` — surface type → command dispatch

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
