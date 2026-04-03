# accordo-diagram — Requirements Specification

**Package:** `accordo-diagram`  
**Type:** VS Code extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-15  
**Last updated:** 2026-04-03  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)  
**Workplan:** `docs/00-workplan/workplan.md`

---

## 1. Purpose

Accordo Diagram renders Mermaid diagram files (`.mmd`) inside a VS Code webview using Excalidraw as the canvas engine. Agents can create, patch, and style diagrams via MCP tools; users can interact with the canvas directly. Comment threads can be pinned to diagram nodes, edges, and clusters.

---

## 2. Implementation Status

All diagram work completed in Sessions 11/11b and subsequent Priority H sessions.

### diag.1 — Core engine (A1–A17) ✅

| ID | Module | Evidence |
|---|---|---|
| A1 | Internal types (`types.ts`) | ✅ Done — 36 type tests |
| A2 | Flowchart parser (`adapter.ts`, `flowchart.ts`) | ✅ Done — 67 parser tests |
| A3 | Layout store (`layout-store.ts`) | ✅ Done — 54 tests |
| A4 | Auto-layout dispatch (`auto-layout.ts`) | ✅ Done — 36 tests |
| A5 | Edge identity (`edge-identity.ts`) | ✅ Done — 22 tests |
| A6 | Unplaced node placement + collision avoidance (`placement.ts`) | ✅ Done — 24 tests |
| A7 | Reconciler (`reconciler.ts`) | ✅ Done — 36 tests |
| A8 | Shape map (`shape-map.ts`) | ✅ Done — 15 tests |
| A9 | Edge router (`edge-router.ts`) | ✅ Done — 15 tests |
| A10 | Canvas generator (`canvas-generator.ts`) | ✅ Done — 33 tests |
| A11 | Protocol types (`protocol.ts`) | ✅ Done — type-only |
| A14 | MCP tool definitions (`diagram-tools.ts`) | ✅ Done — 52 tests |
| A15 | Webview panel (`panel.ts`) | ✅ Done — 16 tests |
| A16 | Webview frontend (`webview.ts`) | ✅ Done — manual + `html.test.ts` |
| A17 | Extension entry (`extension.ts`) | ✅ Done — 13 tests |

**Total: 568 tests passing.**

### A18 — Diagram Comments Bridge ✅

Full three-layer integration: `DiagramCommentsBridge` class + `diagram-comments-bridge.test.ts` (A18-T01..T12) + webview Alt+click overlay + pin rendering.

| ID | Requirement | Status |
|---|---|---|
| A18-R01 | Panel calls `getSurfaceAdapter`, passes to bridge | ✅ Done |
| A18-R02 | Bridge routes `comment:create` → `adapter.createThread()` | ✅ Done |
| A18-R03 | Bridge routes `comment:reply` → `adapter.reply()` | ✅ Done |
| A18-R04 | Bridge routes `comment:resolve` → `adapter.resolve()` | ✅ Done |
| A18-R05 | Bridge routes `comment:reopen` → `adapter.reopen()` | ✅ Done |
| A18-R06 | Bridge routes `comment:delete` → `adapter.delete()` | ✅ Done |
| A18-R07 | `loadThreadsForUri` → `getThreadsForUri` → posts `comments:load` | ✅ Done |
| A18-R08 | `onChanged` → full reload via `comments:load` | ✅ Done |
| A18-R09 | `comment:create` message carries non-empty `body` | ✅ Done |
| A18-R09b | Custom inline Alt+click input overlay (not SDK default) | ✅ Done |
| A18-R10 | Unknown message type → silently ignored | ✅ Done |
| A18-R11 | Adapter `undefined` → bridge inert, no crash | ✅ Done |
| A18-R12 | `dispose()` cleans up subscriptions | ✅ Done |
| A18-R13 | Full blockId string stored verbatim in `nodeId` | ✅ Done |
| A18-R14 | Orphaned threads visible in panel; no canvas pin | ✅ Done |
| A18-R15 | No changes to comment-sdk, comments, or bridge packages | ✅ Done |

**Webview (manual verification — A18-W01..W05):**

| ID | Requirement | Status |
|---|---|---|
| A18-W01 | `sdk.init()` with canvas-aware `coordinateToScreen` | ✅ Verified |
| A18-W02 | Alt+click hit-test → blockId via IdMap | ✅ Verified |
| A18-W03 | `comments:load` → `sdk.loadThreads(threads)` | ✅ Verified |
| A18-W04 | Pin positions correct after scroll/zoom/resize | ✅ Verified |
| A18-W05 | Submit posts `comment:create`; Escape/outside-click dismiss | ✅ Verified |

### Priority H — Flowchart Debt Cleanup ✅

Phase S (simple fixes, developer → reviewer):

| ID | Issue | Evidence |
|---|---|---|
| S-01 | C4: Deterministic seed (Math.random → FNV-1a hash of mermaidId) | ✅ `2f9cb32` |
| S-02 | C5: Protocol message stubs (no-op handlers for canvas:edge-routed, canvas:node-added, etc.) | ✅ `2f9cb32` |
| S-03 | H1: Roundness comment (`{ type: 2 }` = PROPORTIONAL_RADIUS) | ✅ `2f9cb32` |
| S-04 | C1: Rename updates edge keys (scan `layout.edges` for oldId) | ✅ `2f9cb32` + 3 tests |
| S-05 | C2: BT/RL placement (full 4-direction switch for crossDx/crossDy/flowDx/flowDy) | ✅ `2f9cb32` + 2 tests |
| S-06 | H4: Self-loop in all routing modes (factored out of `routeAuto` into `routeEdge` dispatch) | ✅ `2f9cb32` |
| S-07 | M7: cluster.parent from membership (parseFlowchart: if cluster X lists Y as member, Y.parent = X) | ✅ `2f9cb32` |
| S-08 | BT/RL fresh layout bug (pass `rankdir: parsed.direction` to `computeInitialLayout`) | ✅ `2f9cb32` |
| S-09 | Mermaid parsing cleanup (use `diag.db` public API, TB→TD normalization, text/label priority swap) | ✅ `2f9cb32` + 2 tests |

Phase T (TDD features):

| ID | Feature | Evidence |
|---|---|---|
| T-01 | H7: `edgeStyles` argument in `accordo_diagram_patch` (`strokeColor`, `strokeWidth`, `strokeStyle`, `routing` per edge key) | ✅ `b604678` — 558 tests, testing guide |

Phase D (deferred research → implemented):

| ID | Issue | Evidence |
|---|---|---|
| D-02 | H5: Edge strokeDash passthrough via `detectNodeMutations` + canvas-generator read-path | ✅ `810d6e0` |
| D-04 | H6: Z-shape multi-waypoint routing via H-first staircase | ✅ `4eb4104` |

### Bug Fixes (live testing 2026-03-31) ✅

Priority F — Diagram tool gaps:

| ID | Gap | Evidence |
|---|---|---|
| F-1 | Style persistence: position changes saved correctly | ✅ Fixed |
| F-2 | fillType (fillStyle, strokeStyle) not saved to layout.json | ✅ `abba06f` |
| F-3 | fontFamily not saved to layout.json | ✅ `abba06f` |
| F-4 | Style guide updates (newline `\n`, dark font color) | ✅ Done |
| F-5 | `normalizeLabel()` converts Mermaid `\n` → actual newline for Excalidraw | ✅ Done |
| F-6 | Ctrl+F search in accordo markdown preview | ✅ Done |

Priority G — Comments bugs:

| ID | Gap | Evidence |
|---|---|---|
| G-1 | Comments on .md files in accordo markdown preview not rendering | ✅ Done |
| G-2 | Alt+click on diagram edges inconsistently opens comment dialog | ✅ `64b76b8` — edge hit-testing via point-to-polyline distance (8px threshold) |
| G-3 | Comment pins don't track diagram viewport movement | ✅ `271b02f` — in-place reposition on pan; `_updatePinSizeCss` on zoom |

### Edge strokeStyle fix (2026-04-03) ✅

StrokeStyle on edges was silently dropped by `detectNodeMutations` (edge mermaidIds excluded from all style detection). Fix:

| Part | Change | Evidence |
|---|---|---|
| `message-handler.ts` | strokeStyle emitted for all non-text non-label elements including edges | ✅ `9e372c3` |
| `panel-core.ts` | `handleNodeStyled` routes edge IDs (containing `->`) to `patchEdge(layout.edges)` | ✅ `9e372c3` |

---

## 3. Open Items

### D-03 — Curved Routing (NEXT)

**Research:** `docs/reviews/D-03-curved-routing-research.md` ✅  
**Approach:** Catmull-Rom spline interpolation — generate 16–20 intermediate points along a smooth curve; Excalidraw natively renders smooth curves through multi-point `points` array.

**Files to touch:** `packages/diagram/src/canvas/edge-router.ts`, `edge-router.test.ts`

**Implementation plan:**
1. Add `routeCurved()` stub; remove `"curved" → "auto"` alias in `routeEdge` switch
2. Implement Catmull-Rom spline sampling
3. Handle self-loop curves (rounded rectangle variant)
4. Handle N-waypoint case (curve through waypoints)

### D-01 — Shape Fidelity (DEFERRED)

**Research:** `docs/reviews/D-01-shape-fidelity-research.md`  
**Finding:** Excalidraw has no native hexagon/cylinder/parallelogram types. Improved approximations require polygon-based workarounds that add complexity without achieving true native fidelity.  
**Recommendation:** Keep current diamond/rectangle approximations. Not worth the effort for marginal gain.

### diag.2 — Future Modules (NOT STARTED)

Full list in `docs/10-architecture/diagram-architecture.md §18`. Key items:

| Module | Notes |
|---|---|
| Fine-grained topology tools | `add_node`, `remove_node`, `add_edge`, `remove_edge`, `add_cluster` |
| Layout tools | `move_node`, `resize_node`, `set_node_style`, `set_edge_routing` |
| Additional parsers | classDiagram, stateDiagram-v2, erDiagram, mindmap |
| Undo/redo | Operation log (50-entry ring buffer) |
| Full shape fidelity | hexagon, cylinder, parallelogram canvas approximations |
| Draw-on animation | Progressive element loading at render time |
| Dirty-canvas guard | Merge human layout + agent topology changes |

---

## 4. Requirements Traceability

| Feature | Req ID | Test ID | Commit |
|---|---|---|---|
| Internal types | A1 | type compilation | — |
| Flowchart parser | A2 | 67 parser tests | — |
| Layout store | A3 | 54 tests | — |
| Auto-layout | A4 | 36 tests | — |
| Edge identity | A5 | 22 tests | — |
| Placement | A6 | 24 tests | — |
| Reconciler | A7 | 36 tests | — |
| Shape map | A8 | 15 tests | — |
| Edge router | A9 | 15 tests | — |
| Canvas generator | A10 | 33 tests | — |
| MCP tools | A14 | 52 tests | — |
| Webview panel | A15 | 16 tests | — |
| Extension entry | A17 | 13 tests | — |
| Comments bridge | A18 | A18-T01..T12 (12 tests) | Session 11/11b |
| edgeStyles in patch | T-01 | DT-60, DT-61, CG-36..CG-38 | `b604678` |
| strokeDash on edges | D-02 | CG-34, CG-35, DT-67, WF-17 | `810d6e0` |
| Z-shape waypoints | D-04 | ER-16..ER-25 (8 tests) | `4eb4104` |
| Edge strokeStyle persistence | — | — | `9e372c3` |
| fillStyle/strokeStyle/fontFamily persistence | F-2, F-3 | 9 new tests | `abba06f` |
| Edge hit-testing for comments | G-2 | 541 tests pass | `64b76b8` |
| Pin viewport tracking | G-3 | 590 tests pass | `271b02f` |

**Grand total: 568 tests passing.**
