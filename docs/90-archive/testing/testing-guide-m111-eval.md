# Testing Guide — M111-EVAL (Evaluation Harness)

**Module:** M111-EVAL  
**Package:** `packages/browser`  
**Requirements:** B2-EV-001..B2-EV-012 (`docs/requirements-browser2.0.md`)  
**Date:** 2026-03-28

---

## Section 1 — Automated Tests

### Commands run

```bash
cd /data/projects/accordo-browser2.0/packages/browser
pnpm exec vitest run src/__tests__/eval-harness.test.ts
```

### Results from this run

- **299 tests passing** across full browser package suite
- `eval-harness.test.ts`: 68 tests covering all scoring functions, emitters, and gate logic
- Zero type errors, zero import/collection errors

### Coverage map

| Requirement | Verified by | What it validates |
|---|---|---|
| **B2-EV-001** Scorecard structure | Scorecard type + `buildScorecard` tests | Exactly 9 required fields present |
| **B2-EV-002** Passing threshold | `isPassingScore` + `checkGate` tests | 30/45 minimum, no category below 2 |
| **B2-EV-003** Category scoring functions | All 9 `score*` function tests | Each returns valid CategoryScoreResult |
| **B2-EV-004** Evidence item model | `isChecklistItemId` + `buildEvidenceTable` tests | Valid IDs match `/^[A-I]\d+$/` |
| **B2-EV-005** Evidence table | `buildEvidenceTable` tests | Renders correct markdown rows |
| **B2-EV-006** JSON evidence emitter | `emitJsonEvidence` + `formatScorecardJson` tests | Writes valid JSON to `docs/reviews/` |
| **B2-EV-007** Markdown emitter | `formatScorecardMarkdown`, `formatEvidenceTableMarkdown`, `formatEvaluationMarkdown` tests | Correctly formatted output |
| **B2-EV-008** Multi-surface comparison | `EvalSurface` type + `compareSurfaces` tests | Scores for Accordo vs Playwright vs DevTools |
| **B2-EV-009** Gate checking | `checkGate` tests across G1/G2/G3 boundaries | Correct gate assignment |
| **B2-EV-010** Deterministic scoring | `LETTER_BY_CATEGORY` + scoring function purity tests | Same input → same score every time |
| **B2-EV-011** Evaluation run metadata | `EvaluationResult` type tests | `evaluatedAt`, `surface`, `durationMs` present |
| **B2-EV-012** Testable without browser | `chrome === "undefined"` assertions | All tests run in vitest without browser |

---

## Section 2 — Running the Evaluation

The eval harness is used by reviewers and automated agents to score MCP surfaces against the checklist.

### Generate a scorecard for Accordo MCP

```typescript
import { buildScorecard, isPassingScore, checkGate } from './eval-harness';
import { emitJsonEvidence, emitMarkdownEvidence } from './eval-emitter';

// Collect EvidenceItems from live MCP runs or test traces
const evidence: EvidenceItem[] = [...];

const scorecard = buildScorecard('accordo-mcp', evidence);
const passing = isPassingScore(scorecard);
const gate = checkGate(scorecard);
const result = { scorecard, passing, gate, evaluatedAt: new Date().toISOString() };

await emitJsonEvidence(result);
await emitMarkdownEvidence(result);
```

### Compare multiple MCP surfaces

```typescript
import { buildScorecard, compareSurfaces } from './eval-harness';
const surfaces = ['accordo-mcp', 'playwright-mcp', 'chrome-devtools'].map(s =>
  buildScorecard(s, evidenceForSurface(s))
);
const comparison = compareSurfaces(surfaces);
// Ranks surfaces by total score
```

### Output locations

- JSON evidence: `docs/reviews/<surface>-<date>.json`
- Markdown evidence: `docs/reviews/<surface>-<date>.md`

---

## Section 3 — Interpreting Scores

| Gate | Threshold | Meaning |
|---|---|---|
| **G1** | ≥ 36/45, no category < 3 | Shippable — functional MCP surface |
| **G2** | ≥ 40/45, A–H ≥ 4, I ≥ 3 | Production-ready |
| **G3** | **45/45** | Category leader — best-in-class across all dimensions |

| Score | Quality |
|---|---|
| 0 | Missing |
| 1 | Minimal stub / unusable |
| 2 | Partial, major gaps |
| 3 | Usable with known limitations |
| 4 | Strong, minor gaps |
| 5 | Production-ready / best-in-class |

---

## Section 4 — Manual Verification Steps

1. Run `pnpm exec vitest run src/__tests__/eval-harness.test.ts` — all 68 tests pass.
2. Run `pnpm lint` — zero errors on `src/eval-*.ts`.
3. Import and call `buildScorecard` with sample evidence to verify JSON/MD output format.
4. Confirm output files land in `docs/reviews/`.
