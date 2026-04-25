# Review: Browser Package Deep Code Review

## Findings

### High

- `packages/browser-extension/src/snapshot-versioning-runtime.ts:7` and `packages/browser/src/diff-engine-runtime.ts:22` — diff identity is built from `tag:id:text`, then deduplicated by first match in `buildNodeIndex()`. On pages with repeated sibling content (for example identical buttons/list items), distinct nodes collapse into one identity, so `diff_snapshots` can miss real adds/removes or attribute changes. **Done when:** persistent identity includes a structurally stable discriminator beyond raw text (for example DOM path/sibling position or canonical node fingerprint), diff indexing no longer collapses duplicate siblings, and regression tests cover repeated identical nodes across snapshots.

- `packages/browser/src/snapshot-retention.ts:92` and `packages/browser/src/snapshot-retention.ts:105` and `packages/browser/src/snapshot-retention.ts:174` — TTL eviction is not persisted back into `pages` on read paths. `getLatest()`/`list()`/`get()` call `evictExpired()` but keep the pruned array only in a local variable, while `listAll()` returns the unpruned map. That leaves expired snapshots resident, makes `accordo_browser_manage_snapshots` report stale entries, and creates a slow memory leak in long-lived sessions. **Done when:** every read path writes the pruned page array back into store state (or centralizes eviction in a mutating helper), `listAll()` reflects TTL-pruned state, and tests cover expiry + `listAll()`/manage tool behavior.

### Medium

- `packages/browser-extension/src/relay-privacy-redaction.ts:41` — recursive redaction rewrites **all** string values, not only human-readable text fields. That can mutate machine-readable identifiers such as `anchorKey`, `canonicalAnchorKey`, selectors, IDs, URLs, and other follow-up inputs whenever those strings contain redaction matches. This is a contract mismatch with the browser package redaction rules, which explicitly preserve structural identifiers. **Done when:** extension-side redaction is limited to declared text-bearing fields, identifier fields are preserved, and regression tests cover an inspect/page-map result whose anchor metadata contains redactable text.

- `packages/browser/src/comment-context-tool.ts:1`, `packages/browser/src/page-tool-pipeline.ts:1`, `packages/browser/src/security/redaction.ts:1`, `packages/browser/src/wait-tool.ts:1`, `packages/browser-extension/src/relay-page-frames.ts:1`, `packages/browser-extension/src/relay-actions.ts:1`, `packages/browser-extension/src/content-pins.ts:1`, `packages/browser-extension/src/content/element-inspector-detail.ts:1` — the browser family still violates the repository modularity rule in multiple production files (>150 lines). The split is materially better than earlier revisions, but these files remain central orchestration points with mixed responsibilities, which raises regression risk and makes the codebase fall short of the repo’s own quality bar. **Done when:** each production file is brought under the repo limit with narrower responsibilities, and the remaining orchestration logic is pushed into small, testable helpers.

## Open questions / assumptions

- I assumed the repo’s modularity rule is part of the review bar here, not optional guidance.
- I reviewed current HEAD plus recent browser/browser-extension history, but I did not run a live Chrome/VS Code end-to-end session; runtime findings are based on source + automated test evidence.
- I treated the browser package and browser-extension as a single contract surface, so cross-package mismatches are called out even when each side is internally tested.

## Summary

The browser family is substantially stronger than a typical extension/MCP integration: tests, typecheck, and lint are all green, and the recent decomposition clearly improved readability. But I would not call it best-in-class yet. The main residual risks are identity correctness in snapshot diffing, stale retention behavior, redaction mutating machine-readable contract fields, and unresolved modularity blockers in core runtime files. Readiness is good for continued iteration, but not yet at the repo’s highest engineering bar.
