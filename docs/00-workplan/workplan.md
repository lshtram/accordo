# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-03-29  
**Status:** ACTIVE  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### Priority A — Browser continuity for agents (MUST-HAVE)

**Problem:** current `browser_*` tools are active-tab scoped, so agent context can break when users switch tabs.  
**Requirement:** if a tab is open, agent must be able to keep reading/inspecting it without forcing user focus.

**Planned deliverables:**
1. Add tab-scoped targeting contract across `browser_*` tools (e.g., `tabId`/`pageId`).
2. Add page listing + selection/targeting support on browser tool surface.
3. Ensure wait/text/semantic/diff workflows work on non-active tabs.
4. Add E2E tests for context continuity under tab switching.

**Success criteria:**
- Agent can keep operating on a previously selected tab while user works elsewhere.
- No `active tab required` failure for core read/understanding flows.

---

### Priority B — Wave 1 modularity cleanup (from readability/modularity review)

Reference: `docs/50-reviews/browser-stack-readability-modularity-review-2026-03-29.md`

The following conclusions are now first-class backlog items:

#### P1 (must start first)
1. Split `packages/browser-extension/src/service-worker.ts` into focused modules:
   - `message-router.ts`
   - `comment-sync-service.ts`
   - `relay-sync.ts`
   - `bootstrap.ts`
2. Split `packages/browser-extension/src/relay-actions.ts` and extract shared forwarding helper:
   - `relay-forwarder.ts`
3. Split `packages/bridge/src/extension.ts` into bootstrap/composition units.
4. Split `packages/hub/src/server.ts` into routing/SSE/MCP/reauth modules.
5. Reduce coupling in comments package hot spots (`extension.ts`, `comment-tools.ts`, `comment-store.ts`).
6. Decompose oversized shared type surface (`packages/bridge-types/src/index.ts`) into domain files with barrel export.
7. Centralize browser relay action/message constants into a single shared contract source.

#### P2 (immediately after P1)
8. Remove repeated forwarding/error boilerplate in browser-extension relay paths.
9. Consolidate repeated merge/sync pathways in service worker.
10. Align docs/examples with real exported Bridge API surface.

**Success criteria:**
- No multi-domain god files in top hotspot list.
- Shared contracts are single-source and drift-resistant.
- New contributor can locate feature ownership by module name quickly.

---

### Priority C — E2E evaluation follow-through

Reference: `docs/50-reviews/mcp-webview-evaluation-e2e-2026-03-29.md`

Current score: **28/45**.

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

1. **B2-CTX-001** — tab-scoped targeting contract + tool plumbing (Priority A).
2. **B2-CTX-002** — non-active-tab E2E continuity suite.
3. **MOD-W1-01** — service-worker decomposition.
4. **MOD-W1-02** — relay-actions decomposition + relay-forwarder extraction.
5. **MOD-W1-03** — shared relay contracts single-source centralization.
6. **MOD-W1-04** — bridge extension decomposition.
7. **MOD-W1-05** — hub server decomposition.
8. **MOD-W1-06** — comments package hotspot decomposition.
9. **MOD-W1-07** — bridge-types domain split.
10. **TD-CROSS-2** — uniform logging migration.
11. **M95-VA** — visual annotation layer planning kickoff.

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
