/**
 * M111-EVAL — Evaluation Harness
 *
 * Scoring logic for the 9-category (A–I) evaluation checklist.
 * This module is a pure library — no MCP tool registration, no relay
 * dependency, no browser required. It is fully unit-testable with
 * mock evidence items.
 *
 * Implements B2-EV-001, B2-EV-002, B2-EV-003, B2-EV-005, B2-EV-009,
 * B2-EV-010, B2-EV-012.
 *
 * @module
 */

import type {
  CategoryScore,
  CategoryScoreResult,
  EvalCategory,
  EvidenceItem,
  GateResult,
  Scorecard,
} from "./eval-types.js";
import {
  ALL_CATEGORIES,
  G1_MIN_CATEGORY,
  G1_TOTAL,
  G2_MIN_AH,
  G2_MIN_I,
  G2_TOTAL,
  G3_TOTAL,
  isChecklistItemId,
  PASSING_MIN_CATEGORY,
  PASSING_TOTAL,
} from "./eval-types.js";
export {
  SCORING_FUNCTIONS,
  scoreDeltasEfficiency,
  scoreInteractionModel,
  scoreLayoutGeometry,
  scoreRobustness,
  scoreSecurityPrivacy,
  scoreSemanticStructure,
  scoreSessionContext,
  scoreTextExtraction,
  scoreVisualCapture,
} from "./eval-harness-scoring.js";

// ── Scorecard Helpers ────────────────────────────────────────────────────────

/**
 * B2-EV-002: Compute total score from a scorecard.
 *
 * Pure function — sums all 9 category scores.
 */
export function totalScore(scorecard: Scorecard): number {
  return ALL_CATEGORIES.reduce((sum, cat) => sum + scorecard[cat], 0);
}

/**
 * B2-EV-002: Check if a scorecard meets the passing threshold.
 *
 * Passing criteria (checklist §7):
 * - Total score ≥ 30/45
 * - No individual category score below 2
 *
 * B2-EV-010: Pure function — no side effects.
 */
export function isPassingScore(scorecard: Scorecard): boolean {
  if (totalScore(scorecard) < PASSING_TOTAL) {
    return false;
  }
  return ALL_CATEGORIES.every((cat) => scorecard[cat] >= PASSING_MIN_CATEGORY);
}

/**
 * B2-EV-009: Determine the highest gate a scorecard passes.
 *
 * Gate criteria (Browser 2.1 program):
 * - G1: total ≥ 36, no category below 3
 * - G2: total ≥ 40, A–H ≥ 4, I ≥ 3
 * - G3: total = 45 (perfect score)
 * - "none": does not pass any gate
 *
 * Returns the highest gate passed. Gates are checked from G3 down.
 *
 * B2-EV-010: Pure function — no side effects.
 */
export function checkGate(scorecard: Scorecard): GateResult {
  const total = totalScore(scorecard);

  // G3: perfect score
  if (total >= G3_TOTAL && ALL_CATEGORIES.every((cat) => scorecard[cat] === 5)) {
    return "G3";
  }

  // G2: total ≥ 40, A–H ≥ 4, I ≥ 3
  const ahCategories: readonly EvalCategory[] = [
    "session-context",
    "text-extraction",
    "semantic-structure",
    "layout-geometry",
    "visual-capture",
    "interaction-model",
    "deltas-efficiency",
    "robustness",
  ];
  if (
    total >= G2_TOTAL &&
    ahCategories.every((cat) => scorecard[cat] >= G2_MIN_AH) &&
    scorecard["security-privacy"] >= G2_MIN_I
  ) {
    return "G2";
  }

  // G1: total ≥ 36, all categories ≥ 3
  if (
    total >= G1_TOTAL &&
    ALL_CATEGORIES.every((cat) => scorecard[cat] >= G1_MIN_CATEGORY)
  ) {
    return "G1";
  }

  return "none";
}

// ── Scorecard Builder ────────────────────────────────────────────────────────

/**
 * B2-EV-001/003: Build a scorecard from category scoring results.
 *
 * Takes a map of category → CategoryScoreResult and produces a Scorecard.
 * All 9 categories must be present — throws if any is missing.
 *
 * B2-EV-010: Pure function — no side effects.
 */
export function buildScorecard(
  results: ReadonlyMap<EvalCategory, CategoryScoreResult>,
): Scorecard {
  for (const cat of ALL_CATEGORIES) {
    if (!results.has(cat)) {
      throw new Error(
        `buildScorecard: missing category "${cat}" in results map`,
      );
    }
  }

  /**
   * getScore is a narrowing helper that re-checks presence at runtime,
   * throwing on the impossible path so TypeScript does not need `!`.
   * The outer loop already guarantees every key is present; this guard
   * is a defensive belt-and-suspenders for the type checker.
   */
  const getScore = (cat: EvalCategory): CategoryScore => {
    const result = results.get(cat);
    if (result === undefined) {
      throw new Error(`buildScorecard: category "${cat}" unexpectedly missing`);
    }
    return result.score;
  };

  return {
    "session-context": getScore("session-context"),
    "text-extraction": getScore("text-extraction"),
    "semantic-structure": getScore("semantic-structure"),
    "layout-geometry": getScore("layout-geometry"),
    "visual-capture": getScore("visual-capture"),
    "interaction-model": getScore("interaction-model"),
    "deltas-efficiency": getScore("deltas-efficiency"),
    "robustness": getScore("robustness"),
    "security-privacy": getScore("security-privacy"),
  };
}

// ── Evidence Table Builder ───────────────────────────────────────────────────

/**
 * B2-EV-005: Build an evidence table from evidence items.
 *
 * Validates that all items have required fields and that each `itemId`
 * conforms to the checklist format (`/^[A-I]\d+$/`). Throws if any
 * `itemId` is malformed. Returns a readonly array sorted by `itemId`
 * for deterministic output.
 *
 * B2-EV-004: Runtime validation of `ChecklistItemId` format.
 * B2-EV-010: Pure function — no side effects.
 *
 * @throws Error if any item has an `itemId` that does not match `/^[A-I]\d+$/`.
 */
export function buildEvidenceTable(
  items: readonly EvidenceItem[],
): readonly EvidenceItem[] {
  for (const item of items) {
    if (!isChecklistItemId(item.itemId)) {
      throw new Error(
        `buildEvidenceTable: invalid itemId "${item.itemId}" — must match /^[A-I]\\d+$/`,
      );
    }
  }

  return [...items].sort((a, b) => {
    // Sort by letter first, then numerically by the number portion.
    // charAt(0) returns "" for empty strings (never undefined), avoiding the
    // `string | undefined` that bracket indexing produces. itemId is validated
    // to be non-empty above, so charAt(0) always yields the category letter.
    const aLetter = a.itemId.charAt(0);
    const bLetter = b.itemId.charAt(0);
    if (aLetter !== bLetter) {
      return aLetter.localeCompare(bLetter);
    }
    const aNum = parseInt(a.itemId.slice(1), 10);
    const bNum = parseInt(b.itemId.slice(1), 10);
    return aNum - bNum;
  });
}
