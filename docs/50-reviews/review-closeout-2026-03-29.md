# Review Cycle Closeout Report

**Date:** 2026-03-29  
**Reviewers:** @reviewer (D2 gates), @project-manager (Phase E/F)  
**Scope:** All packages under `packages/` — browser2.0 modules + full project modularity review

This closeout covers two separate but related review exercises:
1. **Browser 2.0 modules** — M100 through M113 (7 modules, all D2 PASS)
2. **Full project modularity review** — all 13 packages scored and reviewed together

---

## 1. Module Completion Summary

All 7 browser2.0 modules have passed D2 review and are confirmed complete.

| Module | D2 Review | Unit Tests | Live E2E | Testing Guide |
|---|---|---|---|---|
| M100-SNAP | ✅ PASS | 142+399 passing | Not run | — |
| M101-DIFF | ✅ PASS | 27 files, 431 passing | Not run | — |
| M102-FILT | ✅ PASS | 584+197 passing | Not run | — |
| M109-WAIT | ✅ PASS | 616 passing | Not run | — |
| M111-EVAL | ✅ PASS | 299 passing | Not run | — |
| M112-TEXT | ✅ PASS | 664+335 passing | Not run | — |
| M113-SEM | ✅ PASS | 751+366 passing | ⚠️ Blocked | ✅ `testing-guide-m113-sem.md` |

**Evidence:** D2 review documents in `docs/50-reviews/m*/*D2*.md`

---

## 2. Critical Finding: `diff_snapshots` Is Broken in Live E2E

### Finding

`browser_diff_snapshots` returns `action-failed` for ALL calls in live E2E evaluation
(`mcp-webview-evaluation-e2e-2026-03-29.md`, score revised 28→26/45).

This was NOT caught by D2 review because D2 is a code-level structural review,
not a live full-stack integration test. All D2 reviews for these modules report PASS
while the feature is in fact non-functional at runtime.

### Root Cause

The D2 review checklist (per `docs/30-development/coding-guidelines.md`) verifies:
- Public API surface correctness
- Error handling coverage
- Edge case paths
- Type safety and serialization

It does NOT verify that tool registration in the Hub runtime correctly exposes
the tool, or that the CDP (Chrome DevTools Protocol) command succeeds end-to-end.

### Implication

**Every D2 PASS in the browser2.0 cycle may have a live E2E gap.** The following
were confirmed by live E2E reviews but the same gap likely exists for the others:

| Tool | D2 Status | Live E2E Status |
|---|---|---|
| `diff_snapshots` | PASS | ❌ BROKEN |
| `browser_list_pages` | Not reviewed | ❌ MISSING (not registered) |
| `browser_select_page` | Not reviewed | ❌ MISSING (not registered) |
| `browser_get_text_map` | PASS | ⚠️ Not registered at runtime |
| `browser_get_semantic_graph` | PASS | ⚠️ Not registered at runtime |

### Recommended Process Change

1. Add a **mandatory E2E smoke test** after each D2 review for any tool that touches
   external resources (CDP, DOM, browser state). The D2 checklist should include a
   "requires live E2E verification" flag.
2. `browser_diff_snapshots` must be fixed before any agent can use diff-based
   context injection in production.
3. `browser_list_pages` and `browser_select_page` are required for the tab-scoped
   targeting contract (Priority A in workplan.md).

---

## 3. Full Project Modularity Review — All Modalities

Reference: `docs/50-reviews/full-project-modularity-plugin-review-2026-03-29.md`

### Package scores (all 13 packages rated)

| Package | Readability | Modularity | Interface Clarity | Standalone Viability |
|---|---:|---:|---:|---:|
| `hub` | 6 | 5 | 7 | 8 |
| `bridge` | 5 | 5 | 6 | 3 |
| `bridge-types` | 6 | 4 | 7 | 9 |
| `comments` | 6 | 5 | 6 | 3 |
| `comment-sdk` | 7 | 6 | 7 | 8 |
| `browser-extension` | 5 | 5 | 6 | 8 |
| `browser` | 6 | 5 | 6 | 3 |
| `diagram` | 6 | 5 | 6 | 4 |
| `md-viewer` | 7 | 6 | 6 | 4 |
| `marp` | 7 | 6 | 7 | 4 |
| `script` | 7 | 7 | 7 | 5 |
| `voice` | 6 | 5 | 6 | 4 |
| `editor` | 8 | 7 | 8 | 3 |

**Overall scores:** Readability 6/10 · Modularity 5/10 · Interface clarity 6/10 · Plugin readiness 5/10

### Top 15 architectural issues (full project)

All 15 listed in the review document. The highest-priority ones affecting multiple modalities:

| # | Issue | Packages Affected |
|---|---|---|
| 1 | Bridge composition root too large (`extension.ts` ~618 LOC) | `bridge` |
| 2 | Hub server mixes routing/auth/SSE/MCP wiring (`server.ts` ~615 LOC) | `hub` |
| 3 | Browser SW mixes sync/store/relay/domain translation (`service-worker.ts` ~671 LOC) | `browser-extension` |
| 4 | Action switch monolith (`relay-actions.ts` ~712 LOC) | `browser-extension` |
| 5 | Comments extension bootstraps too many concerns (`extension.ts`) | `comments` |
| 6 | Comment store persistence coupled to VSCode fs/events | `comments` |
| 7 | Comment tools combine schema + handler logic in one file | `comments` |
| 8 | Bridge-types is a single giant index for many domains (`index.ts` ~744 LOC) | `bridge-types` |
| 9 | Browser relay mapping is stringly and manually synchronized | `browser` |
| 10 | Diagram extension orchestration + command wiring + registry in one module | `diagram` |
| 11 | Diagram panel class has too many responsibilities | `diagram` |
| 12 | Voice extension entrypoint does heavy orchestration/runtime selection | `voice` |
| 13 | md-viewer relies on internal command to fetch store adapter | `md-viewer` |
| 14 | Inconsistent contract response shapes depending on flags | `comments` |
| 15 | Browser-extension backend abstraction incomplete (not implemented adapter methods) | `browser-extension` |

### VSCode-independent mode gaps (critical for long-term architecture)

Two critical extractions needed before non-VSCode runtime is possible:

1. **`comments-core` extraction** — `comment-store.ts` must be split so domain logic has no `vscode` imports, with a `CommentRepository` interface and `VscodeCommentRepository` / `NodeFsCommentRepository` adapters.

2. **`bridge-core` extraction** — bridge transport/registry/command router must be separated from the VSCode extension host adapter, enabling a future `bridge-node-host` for headless operation.

### Target architecture (4 layers)

```
Layer 1 — Pure cores (no VSCode)
  @accordo/bridge-types (split by domain)
  @accordo/comments-core
  @accordo/bridge-core
  @accordo/comment-sdk

Layer 2 — Host adapters
  accordo-bridge (VSCode host)
  bridge-node-host (future headless)
  accordo-comments (VSCode adapter)
  comments-node-service (future)

Layer 3 — Feature plugins
  editor, diagram, md-viewer, marp, script, voice, browser relay

Layer 4 — Runtime profiles
  VSCode profile: Bridge(VSCode) + selected plugins
  Headless profile: bridge-node-host + selected plugins
```

### Recommended process improvement

The D2 review checklist (per `coding-guidelines.md`) is a code-level structural review. It does NOT verify:
- Live tool registration in the Hub runtime
- CDP command success end-to-end
- Cross-package contract consistency
- VSCode-independent readiness

**Proposed additions to D2 checklist:**
1. "Requires live E2E" flag for tools that touch external runtimes (CDP, DOM, browser state)
2. Cross-package interface drift check — are contracts staying in sync across packages?
3. VSCode import audit — does this module have any `vscode` imports it shouldn't?

---

## 4. Module-by-Module Live E2E Status

### M113-SEM (most thoroughly tested)
- **E2E live run:** `m113-sem-E-user-journey-live-2026-03-29.md`
- **Finding:** Module is blocked at runtime — `browser_get_text_map` and
  `browser_get_semantic_graph` are not in the live Hub tool registry despite
  passing unit tests.
- **Action:** Tool registration plumbing must be fixed for these tools to be usable.

### `mcp-webview` integration (browser bridge)
- **E2E e2e run:** `mcp-webview-evaluation-e2e-2026-03-29.md`
- **Finding:** Score 26/45. `diff_snapshots` completely non-functional.
  `browser_list_pages` absent. Implicit DOM reading flows underperform.
- **Action:** Fix `diff_snapshots` first; then add multi-tab tools.

---

## 5. Completed Review Artifacts

All review documents are in `docs/50-reviews/`:

### M100-SNAP
- `m100-snap-A.md`, `m100-snap-B.md`, `m100-snap-D2.md`

### M101-DIFF
- `m101-diff-A.md`, `m101-diff-B.md`, `m101-diff-D2.md`

### M102-FILT
- `m102-filt-A.md`, `m102-filt-B.md`, `m102-filt-B2.md`, `m102-filt-D2.md`

### M109-WAIT
- `m109-wait-A.md`, `m109-wait-B.md`, `m109-wait-D2.md`

### M111-EVAL
- `m111-eval-A.md`, `m111-eval-B.md`, `m111-eval-D2.md`

### M112-TEXT
- `m112-text-A.md`, `m112-text-B.md`, `m112-text-B2.md`, `m112-text-B3.md`,
  `m112-text-D2.md`, `m112-text-D2b.md`

### M113-SEM
- `m113-sem-A.md`, `m113-sem-A-stub.md`, `m113-sem-B.md`, `m113-sem-D2.md`,
  `m113-sem-E-user-journey-live-2026-03-29.md`

### Cross-cutting evaluations
- `mcp-webview-evaluation-e2e-2026-03-29.md` — E2E scorecard
- `mcp-webview-evaluation-live-2026-03-29.md` — Live session run
- `full-project-modularity-plugin-review-2026-03-29.md` — Full project modularity review
- `browser-stack-readability-modularity-review-2026-03-29.md` — Browser stack modularity

---

## 6. Recommendations

### Immediate (do today)

1. **Fix `diff_snapshots`** — this blocks all diff-based agent workflows. Requires CDP
   `DOM.compareDeep-equivalent` investigation or alternative implementation.
2. **Fix tool registration** for `browser_get_text_map` and `browser_get_semantic_graph`
   in the Hub runtime so M113-SEM can actually be used.
3. **Add `browser_list_pages` + `browser_select_page`** — required for Priority A
   tab-scoped targeting contract.

### Short-term (this week)

4. Run live E2E smoke tests for each remaining browser tool that touches CDP/DOM.
5. Update D2 review checklist to include a "live E2E required" flag for CDP-dependent tools.
6. Begin Wave 1 modularity cleanup (workplan.md items MOD-W1-01 through MOD-W1-07).

### Process improvement

7. **D2 + live E2E gate:** Add a step after D2 for browser tools that depend on external
   runtimes (CDP, DOM) — run a minimal live smoke before declaring a module "done."
8. **Testing guide discipline:** Ensure every module with user-visible output gets a
   Phase D3 testing guide (only M113-SEM has one currently).
