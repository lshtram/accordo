# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-03-29  
**Status:** ACTIVE  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### 🔴 Priority 0 — Critical fixes (D2 review gap — found via live E2E)

**Source:** `docs/50-reviews/review-closeout-2026-03-29.md`  
**Problem:** D2 reviews reported PASS for all browser2.0 modules, but live E2E
evaluation found `diff_snapshots` returns `action-failed` for ALL calls. This
means diff-based agent workflows are completely non-functional in production.

**Why D2 missed this:** D2 is a code-level structural review; it does not verify
that the Hub runtime correctly registers tools or that CDP commands succeed
end-to-end.

**Planned deliverables:**
1. Fix `browser_diff_snapshots` — CDP `DOM.compareDeep` equivalent or reimplementation. Live E2E confirmed: returns `action-failed` for ALL calls.
2. Fix tool registration for `browser_get_text_map` and `browser_get_semantic_graph`
   in Hub runtime (M113-SEM is blocked at runtime despite passing D2).
3. Add smoke test to D2 checklist: "requires live E2E" flag for CDP/DOM-dependent tools.
   *(Reference: `docs/50-reviews/review-closeout-2026-03-29.md` §6)*.

**Success criteria:** `diff_snapshots` returns valid diff output (not `action-failed`)
for a simple DOM change scenario.

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

### Priority B — Wave 1 modularity cleanup (from readability/modularity review)

Reference: `docs/50-reviews/browser-stack-readability-modularity-review-2026-03-29.md`,
`docs/50-reviews/full-project-modularity-plugin-review-2026-03-29.md`

**Execution model:** Phase 1 (sequential foundation) → Phase 2 (parallel, 5 agents)

---

#### Phase 1 — Foundation (sequential, 1 agent)

**Goal:** Split the shared `bridge-types` interface contract and update all consumers.
This unblocks all Phase 2 agents — after Phase 1, every remaining task is package-internal.

**Agent A1 — bridge-types split + consumer update**

| Package | Files | Action |
|---|---|---|
| `bridge-types` | `src/index.ts` (split → 5 new + barrel) | `ide-types.ts`, `tool-types.ts`, `ws-types.ts`, `comment-types.ts`, `constants.ts` + barrel `index.ts` |
| `browser` | `src/**/*.ts` (import path updates only) | Update direct imports from old `bridge-types` paths to barrel |
| `script` | `src/**/*.ts` (import path updates only) | Same import path updates |
| All 13 packages | — | `pnpm -r typecheck` + `pnpm -r test` + `pnpm -r build` all green before Phase 2 |

**Phase 1 gate (all must pass before Phase 2 launches):**
- `pnpm -r typecheck` — zero type errors
- `pnpm -r test` — all tests green
- `pnpm -r build` — all packages build cleanly
- No `@accordo/bridge-types/*` subpath imports introduced anywhere (CI grep check)

**Barrel export enforcement (permanent):**
- `no-restricted-imports` lint rule banning `@accordo/bridge-types/*` subpath imports
- `package.json exports` field maintained without subpath entries

---

#### Phase 2 — Parallel (5 agents, truly independent after Phase 1)

All work is package-internal. No cross-package coordination. File sets confirmed disjoint
(explore agent verified: no two agents touch the same file).

Each agent's success criteria (measurable):
- **API parity:** exported symbol set unchanged (or explicitly documented delta list)
- **Behavior parity:** package tests unchanged and green
- **Type parity:** `tsc --noEmit` clean for the package
- **Build parity:** package build clean
- **Size target:** original file reduced to <250 LOC; no new file exceeds 300 LOC
- **No import regression:** no new cross-package runtime deps introduced
- **No route/security drift (hub/bridge):** auth and endpoint contract tests must pass

| Agent | Package | Files Touched | What is done |
|---|---|---|---|
| **B1** | `hub` | `server.ts` (trimmed) + 4 new | Split 615-line `server.ts` into `server-routing.ts`, `server-sse.ts`, `server-mcp.ts`, `server-reauth.ts`; original becomes delegation shell |
| **B2** | `bridge` | `extension.ts` (trimmed) + 3 new | Split 618-line `extension.ts` into `extension-bootstrap.ts`, `extension-composition.ts`, `extension-service-factory.ts`; original becomes thin bootstrap/composition |
| **B3** | `voice` + `diagram` + `editor` | 3 packages, 1 file each (each trimmed + 2-3 new) | Split `voice/extension.ts` (776 LOC), `diagram/webview/panel.ts` (763 LOC), `editor/tools/editor.ts` (594 LOC) each into focused modules; fully parallel to each other and to B1/B2 |
| **B4** | `comments` | 2 files each (each trimmed + 2 new) | B4a: extract `comment-repository.ts` (zero vscode imports) + `vscode-comment-repository.ts`; B4b: split `comment-tools.ts` into `definitions` + `handlers`; **sequential within agent** — B4a first, then B4b |
| **B5** | `browser-extension` | 2 god files split | B5a: create `relay-actions` per-feature handlers + `relay-forwarder.ts` + compatibility shim; B5b: split `service-worker.ts` into focused modules; **sequential within agent** — create shim first, split service-worker, remove shim |

**Internal sequences (non-negotiable):**
- B4: B4a (`comment-store`) → B4b (`comment-tools`) because tools depend on store behavior
- B5: create compatibility shim for `relay-actions` → split `service-worker` → remove shim because `service-worker` imports from `relay-actions`

**After Phase 2:** merge each agent's branch, run full `pnpm -r typecheck + test + build`, then proceed to P2 items.

---

#### P2 (after Phase 1 + Phase 2 complete)

11. Remove repeated forwarding/error boilerplate in browser-extension relay paths.
12. Consolidate repeated merge/sync pathways in service worker.
13. Normalize comments tool response shapes to reduce caller-specific wrappers.
14. Extract `bridge-core` with `HostEnvironment` interface (requires B2 complete first).
15. Extract `comments-node-service` adapter (requires B4a complete first).
16. Align docs/examples with real exported Bridge API surface.

---

### Priority C — E2E evaluation follow-through

Reference: `docs/50-reviews/mcp-webview-evaluation-e2e-2026-03-29.md`

Current score: **26/45** (revised down after live E2E run found `diff_snapshots` completely broken).

Targeted upgrades:
1. Multi-tab targeting support (Priority A) — largest productivity impact.
2. Improve `browser_diff_snapshots` reliability for implicit DOM flows.
3. Add explicit geometry helpers (`leftOf/above/contains/overlap/distance`).
4. Add viewport + full-page screenshot APIs on `browser_*` surface.
5. Add explicit privacy/audit/retention controls on browser tool surface.

---

### Priority D — Cross-project backlog (non-browser, still open)

These items were pending in prior plans and remain in scope. They are not browser-only work and must stay visible in the active workplan.

#### D1. Wave 1 modularity tasks outside browser stack

1. `packages/bridge/src/extension.ts` decomposition (bootstrap/orchestrator/api-factory split).
2. `packages/hub/src/server.ts` decomposition (router/SSE/MCP/reauth split).
3. `packages/comments` hotspot decomposition:
   - `extension.ts`
   - `comment-tools.ts`
   - `comment-store.ts`
4. `packages/bridge-types/src/index.ts` domain split with stable barrel export.
5. Voice and diagram hotspot splits from modularity wave plan:
   - `packages/voice/src/extension.ts`
   - `packages/diagram/src/webview/panel.ts`

#### D2. Cross-cutting technical debt still open

1. **TD-CROSS-2 (uniform logging):**
   - VSCode packages to `LogOutputChannel`
   - Hub structured logger (`pino`)
   - consistent logger interface and test mocks

#### D3. Outstanding non-browser validation/documentation tasks

1. Session 11b D3 manual checklist completion (diagram comments bridge).
2. Voice deferred item: inter-sentence silence investigation/trim strategy.
3. Documentation reorganization closeout:
   - remove stale duplicate index references
   - keep active vs archive boundaries explicit
   - keep package/module map docs up to date

#### D4. Planned next non-browser product module

1. **M95-VA Visual Annotation Layer** (next queued product module from earlier plan baseline).

---

## 2) Next Execution Queue (in order)

**Priority 0 (must fix before any new work)**
0. **B2-CTX-000** — fix `browser_diff_snapshots` (returns `action-failed` for ALL calls; CDP investigation required).
1. **B2-CTX-000b** — fix `browser_get_text_map` + `browser_get_semantic_graph` Hub registration (M113-SEM blocked despite D2 PASS).

**Priority A Item 2 — Tab-scoped targeting contract (only 2 tools missing)**
2. **B2-CTX-002** — add `tabId` param to `browser_capture_region`.
3. **B2-CTX-003** — add `tabId` param to `browser_diff_snapshots`.

**Priority A Item 3 — Non-active tab workflows**
4. **B2-CTX-004** — verify CDP routing for background tabs, Hub registration for text_map + semantic_graph, `diff_snapshots` internal state for non-active tabs.

**Priority A Item 4 — E2E smoke tests**
5. **B2-CTX-005** — E2E continuity tests under tab switching (Playwright or similar).

**Phase 1 — bridge-types split (1 agent, unblocks everything)**
6. **MOD-P1-01** — `bridge-types` domain split + barrel export + consumer import updates.

**Phase 2 — fully parallel (5 agents, after Phase 1 gate)**
7. **MOD-P2-B1** — `hub/server.ts` decomposition.
8. **MOD-P2-B2** — `bridge/extension.ts` decomposition.
9. **MOD-P2-B3** — `voice` + `diagram` + `editor` leaf splits (3 packages, 1 agent).
10. **MOD-P2-B4** — `comments` comment-store extraction + comment-tools split (sequential B4a→B4b).
11. **MOD-P2-B5** — `browser-extension` relay-actions + service-worker split (sequential B5a→B5b→cleanup).

**After Phase 2 (P2 items)**
12. **MOD-P2-11** — remove repeated forwarding/error boilerplate in browser-extension.
13. **MOD-P2-12** — consolidate repeated merge/sync pathways in service worker.
14. **MOD-P2-13** — normalize comments tool response shapes.
15. **MOD-P2-14** — extract `bridge-core` with `HostEnvironment` interface (needs B2).
16. **MOD-P2-15** — extract `comments-node-service` adapter (needs B4a).
17. **MOD-P2-16** — align docs/examples with real exported Bridge API surface.

**Later (not in current wave)**
18. **D2-001** — add "requires live E2E" flag to D2 checklist for CDP/DOM tools.
19. **TD-CROSS-2** — uniform logging migration.
20. **M95-VA** — visual annotation layer planning kickoff.

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
