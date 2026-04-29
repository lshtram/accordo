# Browser MCP WebView Checklist Review — 2026-04-29

**Verdict:** APPROVED
**Score:** 36 / 45
**Rubric:** `docs/30-development/mcp-webview-agent-evaluation-checklist.md`
**Scope:** `packages/browser`, `packages/browser-extension`, browser MCP requirements

---

## Context

This independent reviewer pass followed the browser live-tool hardening series ending in:

- `ff1bbcc` — inspect element stale snapshot handles
- `5da9d79` — diff snapshot resolution
- `a229642` — local snapshot management
- `e73331b` — browser tool contract hardening
- `0d2c8c2` — machine identifiers preserved during browser-package redaction
- `38bbe5e` — spatial relation request validation
- `32de1ea` — browser requirements formatting cleanup
- `f390181` — browser/browser-extension redaction metadata and identifier preservation

The prior checklist review scored **29 / 45** and failed primarily because privacy redaction corrupted runtime identifiers and then reported `redactionApplied:false` despite substituted PII. The final redaction fix was independently approved before this closeout review.

---

## Scorecard

| Category | Score | Notes |
|---|---:|---|
| Session & Context | 4 | Health, tab listing, page-map, wait surfaces, multi-tab support, and iframe metadata verified. |
| Text Extraction | 5 | Visible text map includes raw/normalized text, UID/bounds, reading order, visibility; benchmark enforces >=95% mapping coverage. |
| Semantic Structure | 4 | Semantic graph exposes landmarks, outline, forms; DOM excerpt works. Live inspect was not cleanly re-proven in this wrapper. |
| Layout/Geometry | 4 | Page map includes bounds, viewport ratio, z-index, occlusion, container linkage; spatial-relations contract/tests are strong. |
| Visual Capture | 4 | Viewport/full-page capture succeeds with file-ref artifacts, format options, snapshot linkage, and screenshot redaction metadata. |
| Interaction Model | 3 | Interactive inventory is good; actionability/eventability are well-tested; live inspect verification remains less ergonomic. |
| Deltas/Efficiency | 4 | Snapshot IDs, diff, pagination, filtering, and artifact indirection are present. |
| Robustness | 4 | Structured errors, retry metadata, wait primitives, and timeout semantics are implemented and tested. |
| Security/Privacy | 4 | Redaction now preserves identifiers, reports `redactionApplied:true` when substitutions occur, and includes audit/session/telemetry disclosures. |

**Total:** 36 / 45

---

## Pass Rubric

| Requirement | Status | Evidence |
|---|---|---|
| No category below 2 | PASS | Lowest score is Interaction Model at 3. |
| Must-have visible text extraction with >=95% element mapping coverage | PASS | `packages/browser-extension/tests/text-map-coverage-benchmark.test.ts` |
| Must-have semantic structure via DOM + accessibility surfaces | PASS | Live `accordo_browser_get_semantic_graph`, live `accordo_browser_get_dom_excerpt` |
| Must-have spatial/layout context includes target bboxes | PASS | Live page-map bounds/viewport/z-order/occlusion/container fields; spatial tests |
| Must-have screenshot capture supports viewport + full-page + region | PASS | Live viewport/full-page capture; region tests |
| Must-have stable `nodeId` within snapshot | PASS | Live page-map/text-map/semantic graph and snapshot-versioning suites |
| Total score >= 30 / 45 | PASS | 36 / 45 |

---

## Verification Evidence

- Browser scoped worktree clean before review: `packages/browser`, `packages/browser-extension`, `docs/20-requirements/requirements-browser-mcp.md`.
- Browser relay health: connected, no recent errors, telemetry disabled, session isolation disclosed as shared profile.
- Safe live tab: `https://jeremysiskind.com/jazz-piano-fundamentals-unit-two/`, with browser control granted.
- `accordo_browser_get_page_map` live proof: metadata, bounds, occlusion/z-order/container fields, pagination metadata, audit ID.
- `accordo_browser_get_text_map` live proof: raw/normalized text, UID/bounds, reading order, visibility, identifier-safe redaction.
- `accordo_browser_get_semantic_graph` live proof: landmarks, outline, forms, identifier-safe redaction, `redactionApplied:true` on PII substitution.
- `accordo_browser_get_dom_excerpt` live proof: sanitized excerpt and preserved envelope/anchor metadata under `redactPII:true`.
- `accordo_browser_capture_region` live proof: viewport/full-page file-ref artifacts and snapshot linkage.
- `accordo_browser_wait_for` live proof: wait primitive succeeded.
- `accordo_browser_diff_snapshots` live proof: delta API returned change summary with fresh snapshot capture.
- Automated verification before the final redaction commit:
  - `pnpm --filter accordo-browser test` — 85 files / 1279 tests.
  - `pnpm --filter accordo-browser typecheck`.
  - `pnpm --filter accordo-browser lint`.
  - `pnpm --filter accordo-browser build`.
  - `pnpm --filter ./packages/browser-extension test` — 84 files / 1462 tests.
  - `pnpm --filter ./packages/browser-extension typecheck`.
  - `pnpm --filter ./packages/browser-extension lint`.
  - `pnpm --filter ./packages/browser-extension build`.

---

## Future Improvements

These are **non-blocking** follow-ups from the approved review:

1. Reduce redaction false positives. Live review observed a benign YouTube URL fragment partially redacted; metadata identifiers are now protected, but ordinary text can still be over-masked.
2. Improve live wrapper ergonomics for `inspect_element` and `get_spatial_relations`; tests cover the behavior, but live omission/argument handling is awkward for reviewers and agents.
3. Tighten screenshot retention metadata; live retained screenshot records may report `width: 0` / `height: 0` even after successful captures.
4. Decide whether OCR-assisted screenshot redaction is in scope for a future release; current screenshot redaction is not OCR-based and does not claim image-only PII coverage.

---

## Conclusion

The browser MCP/WebView surface meets the checklist pass bar and is approved for production agent workflows with the residual improvements above tracked for future hardening.
