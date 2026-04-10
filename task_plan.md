# Browser Extension Remediation Plan

## Goal
Fix the independent review findings for `packages/browser-extension` one by one, verify the package is green, and finish with an independent re-review.

## Phases
- [x] Phase 1 — Gather baseline evidence and review findings
- [ ] Phase 2 — Fix high-severity privacy/capture issues
- [ ] Phase 3 — Fix navigation/control failures
- [ ] Phase 4 — Address medium-severity security/maintainability issues that are in scope for code changes now
- [ ] Phase 5 — Run verification (tests, lint, typecheck) and get independent review

## Current focus
Continue high-severity fixes. First capture-path remediation is complete; navigation/control failures are next.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| `python: command not found` when running session catchup | 1 | Switched to `python3` |
