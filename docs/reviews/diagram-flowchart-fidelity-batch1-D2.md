## Review — diagram-flowchart-fidelity-batch1 — Phase D2

### PASS
- Tests: **819 passing, 0 failing, 0 skipped** (`pnpm test` in `packages/diagram`)
- Type check: **clean** (`pnpm typecheck` in `packages/diagram`)
- Lint: command exits clean (`pnpm lint`), output is `no lint configured yet`
- FC-01 implementation validated in code and tests:
  - Trapezoid orientation in `canvas-generator.ts` now matches Mermaid convention
  - Coverage present in `flowchart-fidelity.test.ts` (FC-01a/01b + regression checks)
- FC-02 implementation validated in code and tests:
  - Circle dimension clamp (`Math.max(w, h)`) present in `canvas-generator.ts`
  - Coverage present for circle clamp and ellipse non-regression (FC-02a/02b/02c)
- FC-03/FC-04 passthrough behavior validated:
  - Arrow labels and arrowheads propagate to rendered arrow element
  - Coverage present for non-empty/empty labels and cross-arrowhead mapping
- FC-05 decoder utility exists and is wired in parser:
  - `decodeHtmlEntities()` exported from `parser/decode-html.ts`
  - Applied to node and edge labels in `parser/flowchart.ts`

### FAIL — must fix before Phase E
- `packages/diagram/src/__tests__/flowchart-fidelity.test.ts:493` — **FC-05f test does not actually verify HTML decoding**. The input node text is already plain (`"Sales & Marketing"`), so the assertion passes even without decoding. — **Fix:** change test input to encoded text (e.g. `"Sales &amp; Marketing"`) and assert decoded output `"Sales & Marketing"`.

- `packages/diagram/src/parser/flowchart.ts:98` — **FC-04d documentation requirement is not fully satisfied.** Current comment indicates syntax (`--x`) but does not explicitly document the Excalidraw limitation and that `"bar"` is the closest approximation to Mermaid cross/X marker. — **Fix:** add explicit inline comment near `arrow_cross`/`double_arrow_cross` mapping stating Excalidraw has no native X arrowhead and `"bar"` is the closest available approximation.
