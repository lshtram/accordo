# Browser MCP Review Loop Retrospective — 2026-04-30

## Summary

For several days, Browser MCP review cycles repeatedly produced scores around 27-30/45, followed by 6-8 recommended fixes. After those fixes were implemented and accepted by a reviewer, a later fresh review reintroduced similar categories of findings under a different live setup, page selection, or interpretation of `docs/30-development/mcp-webview-agent-evaluation-checklist.md`.

This is not primarily an implementation discipline problem. It is a review-contract problem: the target for 5/5 was not fixed tightly enough before implementation.

## Evidence

Recent review artifacts show the pattern:

- `docs/50-reviews/browser-mcp-checklist-review-2026-04-29.md` approved the surface at 36/45 with no blockers.
- `docs/50-reviews/browser-closeout-review-2026-04-30.md` reviewed a focused closeout diff and accepted remediation after follow-up.
- `docs/50-reviews/browser-mcp-fresh-5-target-review-2026-04-30.md` performed a fresh broad review and scored 27/45.

The fresh review used different live evidence, included unavailable `chrome-devtools_*` tooling as scoring blockers, and tested against different public pages. That made the target move even after the prior focused issues were resolved.

## Root Causes

1. **Checklist ambiguity:** The scoring guide says `5 = production-ready`, but does not define exact test pages, exact tool calls, or exact expected outputs per category.
2. **Mixed evidence sources:** Reviewers switch between live Accordo tools, `chrome-devtools_*` tools, code/tests, and docs without a hierarchy for conflicts.
3. **Environment leakage into product scoring:** Missing DevTools connectivity was sometimes scored as an Accordo browser deficiency, even though it may be a review-harness issue.
4. **No canonical fixture:** Public pages vary over time and across sessions; they are useful smoke targets but weak acceptance fixtures.
5. **No locked acceptance gate:** Fix lists were treated as guidance, not as a binding contract that guarantees 5/5 once passed.
6. **Fresh reviews did not reconcile prior evidence:** Later reviewers could restart from a blank interpretation rather than explaining why earlier accepted evidence was invalid.

## Decision

Stop doing open-ended fresh browser reviews until a fixed scoring protocol is in place.

Future browser MCP work must follow `docs/30-development/browser-mcp-5-score-contract.md`. Reviewers may still use `docs/30-development/mcp-webview-agent-evaluation-checklist.md`, but the browser score is determined by the contract's acceptance matrix, evidence precedence rules, and environment preconditions.

## New Operating Rules

1. **No moving target:** A category gets 5/5 when its contract acceptance criteria pass. A reviewer may not add new criteria during the scoring pass.
2. **Separate product failures from environment failures:** If `chrome-devtools_*` is unavailable, record it under review-harness readiness unless the contract says the browser product owns that capability.
3. **Use canonical fixtures first:** Public pages can supplement evidence, but they cannot be the primary 5/5 gate.
4. **Reconcile prior reviews:** Every fresh review must cite the previous browser score and explain any score regression.
5. **One gap ledger:** New findings must either map to an existing contract row or propose a contract amendment before implementation work begins.

## Next Steps

1. Build or choose the canonical browser fixture page described in `docs/40-testing/testing-guide-browser-5-score-fixture.md`.
2. Convert the contract rows into an executable live smoke harness where practical.
3. Fix only failures against the contract matrix.
4. Re-run the same matrix and score mechanically.

## Success Definition

The review loop is fixed when two independent reviewers, using the same contract and fixture, produce the same category scores from the same evidence bundle.
