# Accordo IDE — Accomplished Tasks

**Purpose:** historical record of completed sessions/modules moved out of active workplan.

---

## Major completed milestones

| Area | Status |
|---|---|
| Phase 1 — Hub + Bridge + Editor control plane MVP | ✅ Completed |
| Comments modality (`accordo-comments`) | ✅ Completed |
| Presentations modality | ✅ Completed |
| Voice modality (`accordo-voice`) incl. hardening | ✅ Completed |
| Scripted walkthroughs (`accordo-script`) | ✅ Completed |
| Diagrams modality (`accordo-diagram`) | ✅ Completed |
| Browser extension v1 (`packages/browser-extension`) | ✅ Completed |
| Browser relay/tools v2 (`packages/browser`) | ✅ Completed |
| Unified comments contract + shared panel integration | ✅ Completed |
| Session 15: Page understanding + region capture | ✅ Completed |
| Session 15b: Browser hardening pass | ✅ Completed |
| M100-SNAP | ✅ Completed |
| M101-DIFF | ✅ Completed |
| M102-FILT | ✅ Completed |
| M109-WAIT | ✅ Completed |
| M111-EVAL | ✅ Completed |
| M112-TEXT | ✅ Completed |
| M113-SEM | ✅ Completed |
| F-2 + F-3 — Diagram style persistence (fillStyle, strokeStyle, fontFamily → layout.json) | ✅ Completed (`abba06f`, 9 new tests, 2026-03-31) |
| Phase 1 modularity — bridge-types split | ✅ Completed (`b789aa9`, 10 tests, 2026-03-29) |
| Phase 2 modularity — B1 hub/server.ts split | ✅ Completed (prior session) |
| Phase 2 modularity — B2 bridge/extension.ts split | ✅ Completed (`fdb34c4`) |
| Phase 2 modularity — B3 voice/diagram/editor splits | ✅ Completed (prior session) |
| Phase 2 modularity — B4 comments split | ✅ Completed (prior session) |
| Phase 2 modularity — B5 browser-extension split | ✅ Completed (prior session) |
| P2 cleanup — MOD-P2-11 through MOD-P2-16 | ✅ Completed (`fdb34c4`, prior session) |
| Priority 0 — browser_diff_snapshots fix (B2-CTX-000/000b) | ✅ Completed (`2a20512`) |
| Hub spawn + MCP config sync + protocol fixes | ✅ Completed (`6f1e6b0`) |

---

## Session timeline (high-level)

| Session / Phase | Outcome |
|---|---|
| Phase 1 | Control plane MVP (Hub + Bridge + Editor) completed |
| Week 6–7 | Comments core + SDK + markdown viewer completed |
| Session 8A/8B | Slidev/presentation track completed |
| Session 9 | Custom comments panel completed |
| Session 10A–10D | Voice + robustness + scripted walkthroughs completed |
| Session 11 / 11b | Diagram modality + diagram comments bridge completed |
| Session 12–14 | Browser extension foundation + relay + unified comment contract completed |
| Session 15 / 15b | Page understanding + region capture + hardening completed |
| Browser 2.x W1/W2 | M100, M101, M102, M109, M111, M112, M113 completed |
| B2-CTX-001 | Multi-tab support: browser_list_pages, browser_select_page, tabId on 5 understanding tools |
| MOD-P1-01 | Phase 1: bridge-types split into 5 domain files + barrel export + ESLint + downstream typecheck ✅ |
| MOD-P2 (B1–B5) | Phase 2: hub, bridge, voice/diagram/editor, comments, browser-extension splits ✅ |
| P2 cleanup | MOD-P2-11 through MOD-P2-16: relay helpers, merge/sync, response normalization, README ✅ |
| B2-CTX-000 | Priority 0: browser_diff_snapshots + semantic_graph fix ✅ |
| 6f1e6b0 | Hub spawn, MCP config sync, protocol contract fixes ✅ |

---

## Browser 2.x completed modules

**Note:** Browser 2.0 module reviews were conducted alongside a **full project modularity review** covering all 13 packages (see below).

| Module | Status | Evidence |
|---|---|---|
| M100-SNAP | ✅ | `docs/50-reviews/m100-snap-D2.md` |
| M101-DIFF | ✅ | `docs/50-reviews/m101-diff-D2.md` |
| M102-FILT | ✅ | `docs/50-reviews/m102-filt-D2.md` |
| M109-WAIT | ✅ | `docs/50-reviews/m109-wait-D2.md` |
| M111-EVAL | ✅ | `docs/50-reviews/m111-eval-D2.md` |
| M112-TEXT | ✅ | `docs/50-reviews/m112-text-D2b.md` |
| M113-SEM | ✅ | `docs/50-reviews/m113-sem-D2.md`, `docs/40-testing/testing-guide-m113-sem.md` |

---

## Completion artifacts (latest cycle)

- **Review cycle closeout:** `docs/50-reviews/review-closeout-2026-03-29.md`
- **Full project modularity review:** `docs/50-reviews/full-project-modularity-plugin-review-2026-03-29.md`
  - Scores all 13 packages: Readability 6/10 · Modularity 5/10 · Interface clarity 6/10 · Plugin readiness 5/10
  - 15 architectural issues catalogued across all packages
  - 4-layer target architecture proposed (pure cores → host adapters → feature plugins → runtime profiles)
- Testing guide: `docs/40-testing/testing-guide-m113-sem.md`
- Reviews (all 32 files in `docs/50-reviews/`):
  - M100: `m100-snap-A.md`, `m100-snap-B.md`, `m100-snap-D2.md`

## Diagram bug fixes (2026-03-31)

| Fix | Root cause | Solution | Evidence |
|---|---|---|---|
| **G-2** Alt+click on edges didn't open comment dialog | Hit-test AABB used el.width/el.height which are always 0 for arrow elements (geometry lives in points[] polyline) | `hitsEdgePolyline()`: point-to-polyline distance test with 8px threshold; `edgePolylineMidpoint()`: arc-length walk to midpoint | `64b76b8`, `docs/reviews/g2-edge-hit-testing-phase{1,2,3}.md`, 541 tests pass |
| **G-3** Comment pins don't track viewport on pan/zoom | PinPositioner listened for DOM scroll events; Excalidraw pans via CSS transforms (internal state), so reposition never fired | `sdk.reposition()`: in-place style.left/top updates via PinPositioner._repositionHandler; `repositionPins(zoom?)` calls `_updatePinSizeCss` on zoom | `271b02f`, `docs/reviews/g3-pin-viewport-tracking-phase{1,2,3}.md`, 590 tests pass |
| **F-2/F-3** fillStyle/strokeStyle/fontFamily not persisted | `detectNodeMutations()` missed fillStyle/strokeStyle/fontFamily fields; `toExcalidrawPayload()` hardcoded fillStyle | Added field detection + REVERSE_FONT_FAMILY_MAP | `abba06f` |
| **patchHandler** new nodes not collision-resolved | `patchHandler` never called `placeNodes()` before `writeLayout()`; new nodes went to `unplaced[]` | `ReconcileResult` now includes `diagram: ParsedDiagram`; `patchHandler` calls `placeNodes()` before write | `fa87eb9`, `docs/reviews/patch-handler-placement-bugfix.md` |
  - M101: `m101-diff-A.md`, `m101-diff-B.md`, `m101-diff-D2.md`
  - M102: `m102-filt-A.md`, `m102-filt-B.md`, `m102-filt-B2.md`, `m102-filt-D2.md`
  - M109: `m109-wait-A.md`, `m109-wait-B.md`, `m109-wait-D2.md`
  - M111: `m111-eval-A.md`, `m111-eval-B.md`, `m111-eval-D2.md`
  - M112: `m112-text-A.md`, `m112-text-B.md`, `m112-text-B2.md`, `m112-text-B3.md`, `m112-text-D2.md`, `m112-text-D2b.md`
  - M113: `m113-sem-A.md`, `m113-sem-A-stub.md`, `m113-sem-B.md`, `m113-sem-D2.md`, `m113-sem-E-user-journey-live-2026-03-29.md`
  - Cross-cutting: `mcp-webview-evaluation-e2e-2026-03-29.md`, `mcp-webview-evaluation-live-2026-03-29.md`
  - Modularity: `full-project-modularity-plugin-review-2026-03-29.md`, `browser-stack-readability-modularity-review-2026-03-29.md`

---

## Notes

- Active planning now lives in `docs/00-workplan/workplan.md` and should include only open work.
- Historical detailed plans and old workplans remain under `docs/90-archive/`.
- New completions should be appended here immediately after Phase F.

## Infrastructure & Maintenance
| Task | Status | Evidence |
|---|---|---|
| Merge `browser2.0` into `main` | ✅ | Full monorepo test suite green on `main`. Worktree deleted. |
