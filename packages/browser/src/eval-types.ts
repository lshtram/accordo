/**
 * M111-EVAL — Evaluation Harness Types
 *
 * Type definitions for the live scoring harness and evidence emitter.
 * These types model the 9-category (A–I) scorecard from the MCP WebView
 * Agent Evaluation Checklist, the evidence table, gate checking, and
 * multi-surface comparison.
 *
 * Implements type contracts for B2-EV-001 through B2-EV-012.
 *
 * @module
 */

// ── Evaluation Categories ────────────────────────────────────────────────────

/**
 * B2-EV-001: The 9 evaluation categories from the checklist (§2 A–I).
 *
 * Each category assesses a different dimension of page-understanding quality.
 */
export type EvalCategory =
  | "session-context"       // A
  | "text-extraction"       // B
  | "semantic-structure"    // C
  | "layout-geometry"       // D
  | "visual-capture"        // E
  | "interaction-model"     // F
  | "deltas-efficiency"     // G
  | "robustness"            // H
  | "security-privacy";     // I

/**
 * Map from category ID letter (A–I) to EvalCategory for lookup convenience.
 */
export const CATEGORY_BY_LETTER: Readonly<Record<string, EvalCategory>> = {
  A: "session-context",
  B: "text-extraction",
  C: "semantic-structure",
  D: "layout-geometry",
  E: "visual-capture",
  F: "interaction-model",
  G: "deltas-efficiency",
  H: "robustness",
  I: "security-privacy",
};

/**
 * Map from EvalCategory to category letter (A–I).
 */
export const LETTER_BY_CATEGORY: Readonly<Record<EvalCategory, string>> = {
  "session-context": "A",
  "text-extraction": "B",
  "semantic-structure": "C",
  "layout-geometry": "D",
  "visual-capture": "E",
  "interaction-model": "F",
  "deltas-efficiency": "G",
  "robustness": "H",
  "security-privacy": "I",
};

/**
 * All 9 categories in order (A → I).
 */
export const ALL_CATEGORIES: readonly EvalCategory[] = [
  "session-context",
  "text-extraction",
  "semantic-structure",
  "layout-geometry",
  "visual-capture",
  "interaction-model",
  "deltas-efficiency",
  "robustness",
  "security-privacy",
] as const;

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * B2-EV-001: Valid score range for a single category (0–5).
 *
 * Scoring guide (from checklist §7):
 * - 0 = missing
 * - 1 = minimal stub / unusable
 * - 2 = partial, major gaps
 * - 3 = usable with known limitations
 * - 4 = strong, minor gaps
 * - 5 = production-ready
 */
export type CategoryScore = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * B2-EV-001: Scorecard with one score per category (A–I).
 * Total maximum: 45. Passing: ≥ 30 with no category below 2.
 */
export interface Scorecard {
  readonly "session-context": CategoryScore;
  readonly "text-extraction": CategoryScore;
  readonly "semantic-structure": CategoryScore;
  readonly "layout-geometry": CategoryScore;
  readonly "visual-capture": CategoryScore;
  readonly "interaction-model": CategoryScore;
  readonly "deltas-efficiency": CategoryScore;
  readonly "robustness": CategoryScore;
  readonly "security-privacy": CategoryScore;
}

/**
 * B2-EV-003: Result from a category scoring function.
 *
 * Each scoring function returns a score plus a human-readable rationale
 * explaining why that score was assigned.
 */
export interface CategoryScoreResult {
  readonly score: CategoryScore;
  readonly rationale: string;
}

/**
 * B2-EV-003: Signature for a category scoring function.
 *
 * B2-EV-010: Scoring functions are pure — they receive evidence items
 * and return a deterministic score. No side effects, no network calls.
 */
export type CategoryScoringFn = (items: readonly EvidenceItem[]) => CategoryScoreResult;

// ── Evidence ─────────────────────────────────────────────────────────────────

/**
 * B2-EV-004: Category letter component for checklist item IDs.
 */
export type ChecklistCategoryLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

/**
 * B2-EV-004: Checklist item ID — template literal matching §7.1 format.
 *
 * Examples: "A1", "B2", "C5", "I4".
 * Compile-time constraint: letter (A–I) followed by a digit sequence.
 */
export type ChecklistItemId = `${ChecklistCategoryLetter}${number}`;

/**
 * B2-EV-004: Runtime validation regex for checklist item IDs.
 *
 * Matches one letter A–I followed by one or more digits.
 */
export const CHECKLIST_ITEM_ID_PATTERN: RegExp = /^[A-I]\d+$/;

/**
 * B2-EV-004: Validate that a string is a well-formed checklist item ID.
 *
 * Returns true for strings matching /^[A-I]\d+$/ (e.g. "A1", "B12").
 * Returns false for malformed IDs (e.g. "Z1", "A", "a1", "A0B").
 */
export function isChecklistItemId(value: string): value is ChecklistItemId {
  return CHECKLIST_ITEM_ID_PATTERN.test(value);
}

/**
 * B2-EV-004: Status of a single evidence item.
 */
export type EvidenceStatus = "pass" | "partial" | "fail" | "skip";

/**
 * B2-EV-004: A single evidence item matching checklist §7.1.
 *
 * Each item corresponds to a specific checklist sub-item (e.g. "A1", "B2")
 * and records the tool calls used, the assessment result, and a summary.
 */
export interface EvidenceItem {
  /** Checklist item ID (e.g. "A1", "A2", "B1", etc.) — typed to enforce format. */
  readonly itemId: ChecklistItemId;
  /** Which category this item belongs to. */
  readonly category: EvalCategory;
  /** Assessment status. */
  readonly status: EvidenceStatus;
  /** Tool names used to evaluate this item. */
  readonly toolCalls: readonly string[];
  /** Human-readable evidence summary. */
  readonly summary: string;
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * B2-EV-008: Identifier for the MCP surface being evaluated.
 *
 * The Browser 2.1 program benchmarks three surfaces each cycle.
 */
export type EvalSurface = "accordo-mcp" | "playwright-mcp" | "chrome-devtools";

// ── Gate Results ─────────────────────────────────────────────────────────────

/**
 * B2-EV-009: Gate identifiers from the Browser 2.1 program.
 *
 * - G1: 36+/45, no category below 3
 * - G2: 40+/45, A–H ≥ 4, I ≥ 3
 * - G3: 45/45, all categories 5/5
 * - "none": does not pass any gate
 */
export type GateResult = "G1" | "G2" | "G3" | "none";

// ── Evaluation Result ────────────────────────────────────────────────────────

/**
 * B2-EV-011: Complete evaluation result for a single surface.
 *
 * Contains all data needed to emit JSON and Markdown evidence reports.
 */
export interface EvaluationResult {
  /** Unique run identifier. */
  readonly runId: string;
  /** ISO 8601 timestamp of the evaluation run. */
  readonly timestamp: string;
  /** Which MCP surface was evaluated. */
  readonly surface: EvalSurface;
  /** B2-EV-001: The 9-category scorecard. */
  readonly scorecard: Scorecard;
  /** B2-EV-005: Evidence table — one item per checklist sub-item. */
  readonly evidenceTable: readonly EvidenceItem[];
  /** B2-EV-009: Highest gate passed. */
  readonly gateResult: GateResult;
}

// ── Emitter Options ──────────────────────────────────────────────────────────

/**
 * B2-EV-006/007: Options for evidence emission.
 */
export interface EmitOptions {
  /** Output directory path. Defaults to "docs/reviews/" when omitted. */
  readonly outputDir?: string;
  /** Optional filename prefix (default: surface name). */
  readonly filenamePrefix?: string;
}

// ── Passing Criteria Constants ───────────────────────────────────────────────

/** B2-EV-002: Minimum total score to pass. */
export const PASSING_TOTAL = 30;

/** B2-EV-002: Minimum score any single category can have to pass. */
export const PASSING_MIN_CATEGORY = 2;

/** Maximum possible total score (9 categories × 5). */
export const MAX_TOTAL = 45;

/** B2-EV-009: G1 minimum total. */
export const G1_TOTAL = 36;

/** B2-EV-009: G1 minimum per category. */
export const G1_MIN_CATEGORY = 3;

/** B2-EV-009: G2 minimum total. */
export const G2_TOTAL = 40;

/** B2-EV-009: G2 minimum for categories A–H. */
export const G2_MIN_AH = 4;

/** B2-EV-009: G2 minimum for category I. */
export const G2_MIN_I = 3;

/** B2-EV-009: G3 perfect score. */
export const G3_TOTAL = 45;
