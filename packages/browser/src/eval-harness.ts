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
  CategoryScoringFn,
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

  return {
    // Non-null assertion justified: presence checked by the loop above
    "session-context": results.get("session-context")!.score,
    "text-extraction": results.get("text-extraction")!.score,
    "semantic-structure": results.get("semantic-structure")!.score,
    "layout-geometry": results.get("layout-geometry")!.score,
    "visual-capture": results.get("visual-capture")!.score,
    "interaction-model": results.get("interaction-model")!.score,
    "deltas-efficiency": results.get("deltas-efficiency")!.score,
    "robustness": results.get("robustness")!.score,
    "security-privacy": results.get("security-privacy")!.score,
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
    // Sort by letter first, then numerically by the number portion
    const aLetter = a.itemId[0];
    const bLetter = b.itemId[0];
    if (aLetter !== bLetter) {
      // Non-null assertion justified: itemId is non-empty and validated above
      return aLetter!.localeCompare(bLetter!);
    }
    const aNum = parseInt(a.itemId.slice(1), 10);
    const bNum = parseInt(b.itemId.slice(1), 10);
    return aNum - bNum;
  });
}

// ── Category Scoring Helpers ─────────────────────────────────────────────────

/**
 * Compute a deterministic score from evidence items for a given category.
 *
 * Scoring algorithm (B2-EV-010: pure, deterministic):
 * - Count pass / partial / fail / skip items for the category
 * - If no items: score 0
 * - If all pass: score 5
 * - If passRate ≥ 0.8: score 4
 * - If passRate ≥ 0.6: score 3
 * - If passRate ≥ 0.4: score 2
 * - If passRate > 0: score 1
 * - If all fail: score 0
 *
 * "partial" counts as 0.5 pass.
 */
function scoreCategory(
  items: readonly EvidenceItem[],
  category: EvalCategory,
  categoryLabel: string,
): CategoryScoreResult {
  // Filter to items relevant to this category, plus items with no category
  // filter (scoring functions receive all evidence and select their own items).
  // Per the API contract, each scoring function receives ALL evidence items
  // and scores its own category based on those items matching the category.
  const relevant = items.filter((item) => item.category === category);

  if (relevant.length === 0) {
    return {
      score: 0 as CategoryScore,
      rationale: `No evidence items found for category ${categoryLabel}.`,
    };
  }

  // Compute weighted pass count (partial = 0.5)
  let weightedPasses = 0;
  let fails = 0;
  for (const item of relevant) {
    if (item.status === "pass") {
      weightedPasses += 1;
    } else if (item.status === "partial") {
      weightedPasses += 0.5;
    } else if (item.status === "fail") {
      fails += 1;
    }
    // "skip" contributes neither passes nor failures to the rate
  }

  const total = relevant.length;
  const passRate = weightedPasses / total;

  let score: CategoryScore;
  if (passRate >= 1.0) {
    score = 5;
  } else if (passRate >= 0.8) {
    score = 4;
  } else if (passRate >= 0.6) {
    score = 3;
  } else if (passRate >= 0.4) {
    score = 2;
  } else if (weightedPasses > 0) {
    score = 1;
  } else {
    score = 0;
  }

  const passCount = relevant.filter((i) => i.status === "pass").length;
  const partialCount = relevant.filter((i) => i.status === "partial").length;
  const failCount = relevant.filter((i) => i.status === "fail").length;
  const rationale =
    `Category ${categoryLabel}: ${passCount} pass, ${partialCount} partial, ` +
    `${failCount} fail out of ${total} items (weighted pass rate: ${(passRate * 100).toFixed(0)}%).`;

  return { score, rationale };
}

// ── Category Scoring Functions ───────────────────────────────────────────────

/**
 * B2-EV-003: Category scoring function for A — Session & Context.
 *
 * Evaluates evidence items for page metadata, load state, tab context,
 * and iframe awareness.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreSessionContext: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "session-context", "A (Session & Context)");
};

/**
 * B2-EV-003: Category scoring function for B — Text Extraction.
 *
 * Evaluates evidence items for visible text accuracy, source mapping,
 * and visibility flags.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreTextExtraction: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "text-extraction", "B (Text Extraction)");
};

/**
 * B2-EV-003: Category scoring function for C — Semantic Structure.
 *
 * Evaluates evidence items for DOM snapshot quality, a11y tree,
 * landmarks, and form structure.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreSemanticStructure: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "semantic-structure", "C (Semantic Structure)");
};

/**
 * B2-EV-003: Category scoring function for D — Layout & Geometry.
 *
 * Evaluates evidence items for bounding boxes, z-order,
 * and viewport intersection data.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreLayoutGeometry: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "layout-geometry", "D (Layout & Geometry)");
};

/**
 * B2-EV-003: Category scoring function for E — Visual Capture.
 *
 * Evaluates evidence items for screenshot quality, region capture,
 * and format support.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreVisualCapture: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "visual-capture", "E (Visual Capture)");
};

/**
 * B2-EV-003: Category scoring function for F — Interaction Model.
 *
 * Evaluates evidence items for interactive element discovery
 * and actionability inventory.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreInteractionModel: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "interaction-model", "F (Interaction Model)");
};

/**
 * B2-EV-003: Category scoring function for G — Deltas & Efficiency.
 *
 * Evaluates evidence items for snapshot versioning, delta quality,
 * and filtering capabilities.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreDeltasEfficiency: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "deltas-efficiency", "G (Deltas & Efficiency)");
};

/**
 * B2-EV-003: Category scoring function for H — Robustness.
 *
 * Evaluates evidence items for wait primitives, timeout handling,
 * and error taxonomy quality.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreRobustness: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "robustness", "H (Robustness)");
};

/**
 * B2-EV-003: Category scoring function for I — Security & Privacy.
 *
 * Evaluates evidence items for redaction, origin policies,
 * and audit trail quality.
 *
 * B2-EV-010: Pure function — deterministic scoring from evidence.
 */
export const scoreSecurityPrivacy: CategoryScoringFn = (
  items: readonly EvidenceItem[],
): CategoryScoreResult => {
  return scoreCategory(items, "security-privacy", "I (Security & Privacy)");
};

/**
 * B2-EV-003: Lookup map from category to its scoring function.
 *
 * Used by the harness to score each category dynamically.
 */
export const SCORING_FUNCTIONS: Readonly<Record<EvalCategory, CategoryScoringFn>> = {
  "session-context": scoreSessionContext,
  "text-extraction": scoreTextExtraction,
  "semantic-structure": scoreSemanticStructure,
  "layout-geometry": scoreLayoutGeometry,
  "visual-capture": scoreVisualCapture,
  "interaction-model": scoreInteractionModel,
  "deltas-efficiency": scoreDeltasEfficiency,
  "robustness": scoreRobustness,
  "security-privacy": scoreSecurityPrivacy,
};
