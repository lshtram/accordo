# Browser Tools Full Remediation Plan

## Goal
Fix the fresh browser-tools review blockers from current HEAD/current working tree, verify affected packages, and finish with an evidence-based re-score against `docs/30-development/mcp-webview-agent-evaluation-checklist.md`.

## Phases
- [x] Phase 1 — Gather baseline evidence and review findings
- [x] Phase 2 — Fix browser-extension typecheck/lint blockers
- [x] Phase 3 — Align browser runtime tool descriptions/docs with implementation
- [x] Phase 4 — Refactor browser-tool modularity violations in current scope
- [x] Phase 5 — Run verification (tests, lint, typecheck) and re-score checklist

## Current focus
Static remediation phases are complete. Live-tool quality item 1 is committed; item 2 (`diff_snapshots` retained snapshot coherence) is implemented and awaiting final reviewer approval.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| `python: command not found` when running session catchup | 1 | Switched to `python3` |
| `packages/browser-extension` full test failed in `relay-actions-diff.test.ts` after modularity refactor | 1 | Restored local/content-script `get_page_map` snapshot save before response |
| Final review found local `get_page_map` pagination test asserted metadata/order label only | 1 | Moved regression coverage to dedicated 38-line test asserting `nodeId`, `uid`, `ref`, and text order |
| Live `diff_snapshots` reported `snapshot-not-found` for a snapshot listed in `availableSnapshotIds` | 1 | Classified as real defect; no implementation fix attempted in phase 1 |
| Live `inspect_element` silently resolved a stale `uid`/`ref` to a different element | 1 | Classified as real identity-contract defect; no implementation fix attempted in phase 1 |
| Live `get_spatial_relations` returned only `action-failed` for mixed `nodeIds`/`uids` | 1 | Classified as evaluator misuse plus poor error taxonomy; valid-call proof remains for fix phase |
| First item 1 implementation used generic browser snapshot retention for stale/current classification | 1 | Rejected and moved classification to browser-extension content page-map owner registry |
| Reviewer found resolver could still fall back from `ref`/`nodeId` to anchorKey/selector | 1 | Reordered resolver precedence and added no-fallback tests |
| Reviewer found mixed valid requests could still strip snapshot handles during inspect payload normalization | 1 | Reworked inspect payload precedence and route dispatch; added mixed valid-request tests |
| Item 2 reviewer found both-omitted diff selected a per-page Map entry instead of global retained recency | 1 | Reworked retained-pair helper to sort all retained snapshots by `capturedAt` |
| Item 2 reviewer found recovered tabId applied to cross-page explicit diffs | 1 | Added same-page guard and regression test |
