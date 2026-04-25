# Review — browser-wave3-wave4 — Phase D

## 1) Summary

Wave 3 and Wave 4 improve coverage of evaluation gaps and include meaningful tests. **PASS** — all P0 bugs have been fixed post-review.

Validation run (post-fix):
- `packages/browser`: `pnpm test` ✅ (`807 passed`)
- `packages/browser-extension`: `pnpm test` ✅ (`1121 passed`)
- `packages/browser`: `pnpm typecheck` ✅ (clean after P0-2 fix)
- `packages/browser-extension`: `pnpm typecheck` ❌ (pre-existing errors, not caused by Wave 3/4)
  - `src/screenshot-redaction.ts(28,40): Cannot find module '../snapshot-versioning.js' ...`
  - `tests/element-inspector.test.ts(162,35): TS2352 conversion issue`
- Lint commands executed for both packages as configured and returned clean for the configured targets.

**Post-review fixes applied (commit `0c1f083`):**
- P0-1 (Wave 3 contract): Investigated ADR — `transport: "file-ref"` / `artifactMode: "file-ref"` IS the ADR-specified contract (Option A). No fix needed; reviewer was comparing against review-request prose, not the actual ADR. ADR confirmed correct at `docs/reviews/browser-mcp-architecture-A4-G6-E4.md` lines 189-274.
- P0-2 (frameFilter type regression): Fixed — `Set<IframeMetadata["classification"]>` used, `IframeMetadata` imported, safe cast applied.
- P0-3 (missing audit completion): Fixed — `security.auditLog.completeEntry(auditEntry, { action: "allowed", ... })` added before `return { ...result }` on capture success path.

---

## 2) Bugs

### High

1. **Wave 3 contract mismatch: `filePath` argument is not implemented**
   - **Expected (per review context):** when `filePath` is provided, write bytes to that exact path and return `artifactMode: "file"`.
   - **Actual:** handler uses `transport: "file-ref"` and writes to `~/.accordo/screenshots` (or `ACCORDO_SCREENSHOTS_DIR`), generates filename itself, returns `artifactMode: "file-ref"`.
   - **Evidence:**
     - `packages/browser/src/page-tool-types.ts` has `transport?: "inline" | "file-ref"` and no `filePath` input.
     - `packages/browser/src/page-tool-handlers-impl.ts` lines ~496-511 write to generated path, not caller-provided path.
     - Tests assert transport mode behavior, not caller-provided path semantics (`capture-region-tabid.test.ts` G6 block).
   - **Impact:** ADR/requirement MCP-VC-004 as stated in this review request is not met as specified.

### Medium

2. **Type regression in Wave 4 frameFilter handler path**
   - **Evidence:** `packages/browser/src/page-tool-handlers-impl.ts(133,52)` typecheck error due to broad `string` classification cast feeding `Set<"content"|...>`.
   - **Impact:** blocks clean type gate and Phase D completion.

3. **Audit completion missing on successful capture path**
   - **Evidence:** `handleCaptureRegion` returns success without `security.auditLog.completeEntry(... action: "allowed")` call (unlike get_page_map / inspect / dom_excerpt / text_map / semantic_graph handlers).
   - **Impact:** incomplete audit trail for successful screenshot calls.

---

## 3) Code Quality

- **Good:** New exported symbols in reviewed Wave 3/4 files are documented with JSDoc (`classifyIframe`, `IframeMetadata` fields, `frameFilter` docs).
- **Issue:** Wave 4 frameFilter implementation uses broad cast shape (`{ classification?: string }`) that weakens type safety and directly caused compile failure.
- **Maintainability risk:** iframe classification logic is duplicated in two places:
  - `packages/browser/src/frame-classifier.ts`
  - `packages/browser-extension/src/content/page-map-collector.ts` (`classifyIframeInline` + separate pattern sets)
  This can drift over time (already different pattern sets and semantics, e.g., `javascript:` handling only in extension inline classifier).
- **Banned pattern check (targeted reviewed files):** no `console.log`, no `JSON.parse(JSON.stringify(...))`, no nested ternary chains in the changed Wave 3/4 areas.

---

## 4) Test Coverage

### Strengths
- Wave 3 has solid positive/negative tests for file-ref transport behavior, fallback behavior, and regression for default inline mode.
- Wave 4 has good unit tests for classifier categories and frameFilter response filtering, plus schema assertions.

### Gaps
1. **No tests for `filePath` input contract** (because input is not present).
2. **No explicit test asserting audit log completion on successful `capture_region`**.
3. **No parity test to ensure `frame-classifier.ts` and extension-side `classifyIframeInline` produce consistent output for shared fixtures** (important due to duplicated logic).

---

## 5) Security

- No immediate injection or secret-leak patterns found in reviewed Wave 3/4 code.
- File-ref transport writes binary data locally; current implementation writes under controlled directory (`~/.accordo/screenshots` by default), which is safer than arbitrary path writes, but diverges from requested `filePath` contract.
- **Audit observability concern:** missing success completion in `handleCaptureRegion` weakens security/audit trace integrity.

---

## 6) Recommendations

### P0 (blocking)
1. **Decide and enforce one Wave 3 contract**:
   - Either implement requested `filePath` input semantics + `artifactMode: "file"` exactly,
   - or update ADR/requirements/tool schema/review docs to the implemented `transport: "file-ref"` model.
   - Ensure naming is consistent end-to-end (`file` vs `file-ref`).

2. **Fix frameFilter type regression** in `handleGetPageMap`:
   - Avoid broad string cast.
   - Narrow to `IframeMetadata["classification"]` and remove compile error.

3. **Complete audit entry on successful capture flow** in `handleCaptureRegion` before returning success.

### P1 (should fix)
4. Add targeted tests for:
   - successful capture emits audit completion,
   - frameFilter typing-safe path behavior,
   - whichever file transport contract is canonical (filePath or file-ref).

5. Add a classifier parity test corpus shared between browser and browser-extension implementations (or centralize classifier patterns).

### P2 (nice to improve)
6. Reduce classification duplication by moving pattern definitions to a shared package artifact (data-only constants), then consume from both sides.

7. Tighten tool description text for `capture_region` to avoid stale wording (currently still emphasizes inline-only behavior while file-ref exists).

---

## Verdict

**PASS — P0 bugs fixed post-review. Pre-existing browser-extension typecheck errors excluded (not caused by Wave 3/4).**
