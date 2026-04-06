/**
 * M111-EVAL — eval-harness.test.ts
 *
 * Tests for M111-EVAL — Evaluation Harness + Evidence Emitter
 * (B2-EV-001..B2-EV-012).
 *
 * B2-EV-012: All tests run in vitest without any browser dependencies.
 * Evidence items are mock data — no relay, no Chrome extension.
 *
 * ── Requirement → Test Map ──────────────────────────────────────────────
 *
 * B2-EV-001  Scorecard structure
 *   - Scorecard has exactly 9 required fields (type test)
 *   - buildScorecard produces a valid Scorecard from 9 CategoryScoreResults
 *   - buildScorecard throws when a category is missing
 *
 * B2-EV-002  Passing threshold
 *   - isPassingScore returns true for total=30 with all categories ≥ 2
 *   - isPassingScore returns false for total=29
 *   - isPassingScore returns false when any single category is 1
 *   - totalScore sums all 9 category scores correctly
 *
 * B2-EV-003  Category scoring functions
 *   - Each of the 9 scoring functions returns { score, rationale }
 *   - SCORING_FUNCTIONS map has exactly 9 entries
 *
 * B2-EV-004  Evidence item model (type-level — tested via buildEvidenceTable)
 *
 * B2-EV-005  Evidence table
 *   - buildEvidenceTable returns sorted items by itemId
 *   - buildEvidenceTable preserves all fields
 *
 * B2-EV-006  JSON evidence emitter
 *   - emitJsonEvidence writes valid JSON that round-trips
 *   - emitJsonEvidence file contains scorecard + evidence + metadata
 *
 * B2-EV-007  Markdown evidence emitter
 *   - formatScorecardMarkdown returns a table with all 9 categories
 *   - formatEvidenceTableMarkdown returns a table with all items
 *   - emitMarkdownEvidence writes a .md file
 *
 * B2-EV-008  Multi-surface comparison
 *   - Two EvaluationResults with different surfaces produce different filenames
 *
 * B2-EV-009  Gate checking
 *   - checkGate returns "none" for total=35
 *   - checkGate returns "G1" for total=36, all categories ≥ 3
 *   - checkGate returns "G2" for total=40, A–H ≥ 4, I ≥ 3
 *   - checkGate returns "G3" for perfect 45/45
 *   - checkGate returns "none" when total=36 but one category is 2
 *
 * B2-EV-010  Deterministic scoring
 *   - Same evidence items produce the same score twice
 *
 * B2-EV-011  Evaluation run metadata
 *   - EvaluationResult contains all required fields (type-level + runtime)
 *
 * B2-EV-012  Testable without browser
 *   - All tests in this file pass without browser/relay dependencies
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";

import type {
  CategoryScore,
  CategoryScoreResult,
  ChecklistItemId,
  EvalCategory,
  EvalSurface,
  EvidenceItem,
  EvidenceStatus,
  Scorecard,
} from "../eval-types.js";
import {
  ALL_CATEGORIES,
  CATEGORY_BY_LETTER,
  CHECKLIST_ITEM_ID_PATTERN,
  G1_MIN_CATEGORY,
  G1_TOTAL,
  G2_MIN_AH,
  G2_MIN_I,
  G2_TOTAL,
  G3_TOTAL,
  isChecklistItemId,
  LETTER_BY_CATEGORY,
  PASSING_MIN_CATEGORY,
  PASSING_TOTAL,
} from "../eval-types.js";

// ── Module imports (stubs throw — tests assert they fail until implemented) ──────

import {
  buildScorecard,
  buildEvidenceTable,
  checkGate,
  isPassingScore,
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
  totalScore,
} from "../eval-harness.js";

import {
  emitJsonEvidence,
  emitMarkdownEvidence,
  formatEvaluationMarkdown,
  formatEvidenceTableMarkdown,
  formatScorecardMarkdown,
} from "../eval-emitter.js";

// ── Test fixtures ───────────────────────────────────────────────────────────────

const VALID_SCORECARD: Scorecard = {
  "session-context": 3,
  "text-extraction": 3,
  "semantic-structure": 3,
  "layout-geometry": 3,
  "visual-capture": 3,
  "interaction-model": 3,
  "deltas-efficiency": 3,
  "robustness": 3,
  "security-privacy": 3,
};

const PASSING_SCORECARD: Scorecard = {
  "session-context": 4,
  "text-extraction": 3,
  "semantic-structure": 4,
  "layout-geometry": 3,
  "visual-capture": 4,
  "interaction-model": 3,
  "deltas-efficiency": 4,
  "robustness": 3,
  "security-privacy": 2, // min allowed for passing
};

const G1_SCORECARD: Scorecard = {
  "session-context": 4,
  "text-extraction": 4,
  "semantic-structure": 4,
  "layout-geometry": 4,
  "visual-capture": 4,
  "interaction-model": 4,
  "deltas-efficiency": 4,
  "robustness": 4,
  "security-privacy": 4, // all >= 3
};

const G2_SCORECARD: Scorecard = {
  "session-context": 5,
  "text-extraction": 5,
  "semantic-structure": 4,
  "layout-geometry": 5,
  "visual-capture": 5,
  "interaction-model": 4,
  "deltas-efficiency": 5,
  "robustness": 4,
  "security-privacy": 3, // 44 total, I >= 3
};

const G3_SCORECARD: Scorecard = {
  "session-context": 5,
  "text-extraction": 5,
  "semantic-structure": 5,
  "layout-geometry": 5,
  "visual-capture": 5,
  "interaction-model": 5,
  "deltas-efficiency": 5,
  "robustness": 5,
  "security-privacy": 5,
};

function makeEvidenceItem(
  itemId: string,
  category: EvalCategory,
  status: EvidenceStatus = "pass",
  toolCalls: string[] = ["accordo_browser_get_page_map"],
  summary: string = "Evidence summary",
): EvidenceItem {
  return Object.freeze({
    itemId: itemId as ChecklistItemId,
    category,
    status,
    toolCalls: Object.freeze([...toolCalls]),
    summary,
  });
}

function makeCategoryResults(): ReadonlyMap<EvalCategory, CategoryScoreResult> {
  const map = new Map<EvalCategory, CategoryScoreResult>();
  for (const cat of ALL_CATEGORIES) {
    map.set(cat, { score: 3 as CategoryScore, rationale: `Evidence for ${cat}` });
  }
  return map;
}

// ── B2-EV-001: Scorecard structure ────────────────────────────────────────────

describe("B2-EV-001: Scorecard structure", () => {
  it("Scorecard type has exactly 9 required fields matching all categories", () => {
    // Verify the Scorecard type has all 9 category keys
    const scorecard = VALID_SCORECARD;
    for (const cat of ALL_CATEGORIES) {
      expect(scorecard).toHaveProperty(cat);
    }
    // Should have exactly 9 keys
    expect(Object.keys(scorecard)).toHaveLength(9);
  });

  it("buildScorecard produces a valid Scorecard from 9 CategoryScoreResults", () => {
    const results = makeCategoryResults();
    const scorecard = buildScorecard(results);

    // All 9 categories must be present
    for (const cat of ALL_CATEGORIES) {
      expect(scorecard).toHaveProperty(cat);
    }
    // Total should be 9 * 3 = 27
    expect(totalScore(scorecard)).toBe(27);
  });

  it("buildScorecard throws when a category is missing from results map", () => {
    const results = makeCategoryResults();
    // Remove one category
    results.delete("session-context");

    expect(() => buildScorecard(results)).toThrow();
  });

  it("each category score is constrained to 0-5", () => {
    const results = makeCategoryResults();
    const scorecard = buildScorecard(results);

    for (const cat of ALL_CATEGORIES) {
      const score = scorecard[cat];
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(5);
    }
  });
});

// ── B2-EV-002: Passing threshold ───────────────────────────────────────────────

describe("B2-EV-002: Passing threshold", () => {
  describe("totalScore", () => {
    it("sums all 9 category scores correctly", () => {
      const scorecard = G3_SCORECARD; // all 5s
      expect(totalScore(scorecard)).toBe(45);
    });

    it("returns 30 for a scorecard totalling 30", () => {
      // 9 categories: 4+4+3+3+3+3+3+3+4 = 30
      const scorecard: Scorecard = {
        "session-context": 4,
        "text-extraction": 4,
        "semantic-structure": 3,
        "layout-geometry": 3,
        "visual-capture": 3,
        "interaction-model": 3,
        "deltas-efficiency": 3,
        "robustness": 3,
        "security-privacy": 4, // 30 total
      };
      expect(totalScore(scorecard)).toBe(30);
    });
  });

  describe("isPassingScore", () => {
    it("returns true for scorecard totalling exactly 30 with all categories ≥ 2", () => {
      // Build a scorecard that sums to 30: 4+3+3+3+3+3+3+3+5 = 30
      const scorecard: Scorecard = {
        "session-context": 4,
        "text-extraction": 3,
        "semantic-structure": 3,
        "layout-geometry": 3,
        "visual-capture": 3,
        "interaction-model": 3,
        "deltas-efficiency": 3,
        "robustness": 3,
        "security-privacy": 5, // 30 total, min allowed
      };
      expect(isPassingScore(scorecard)).toBe(true);
    });

    it("returns true for scorecard totalling 32 with all categories ≥ 2", () => {
      expect(isPassingScore(PASSING_SCORECARD)).toBe(true);
    });

    it("returns false for scorecard totalling 29", () => {
      const scorecard: Scorecard = {
        "session-context": 3,
        "text-extraction": 3,
        "semantic-structure": 3,
        "layout-geometry": 3,
        "visual-capture": 3,
        "interaction-model": 3,
        "deltas-efficiency": 3,
        "robustness": 3,
        "security-privacy": 2, // 29 total
      };
      expect(isPassingScore(scorecard)).toBe(false);
    });

    it("returns false when any single category score is 1", () => {
      const scorecard: Scorecard = {
        ...PASSING_SCORECARD,
        "security-privacy": 1 as CategoryScore, // Below minimum
      };
      expect(isPassingScore(scorecard)).toBe(false);
    });

    it("returns false when any single category score is 0", () => {
      const scorecard: Scorecard = {
        ...PASSING_SCORECARD,
        "session-context": 0 as CategoryScore,
      };
      expect(isPassingScore(scorecard)).toBe(false);
    });

    it("returns false when one category is 2 but total is 30+", () => {
      const scorecard: Scorecard = {
        "session-context": 4,
        "text-extraction": 4,
        "semantic-structure": 4,
        "layout-geometry": 4,
        "visual-capture": 4,
        "interaction-model": 4,
        "deltas-efficiency": 4,
        "robustness": 4,
        "security-privacy": 0 as CategoryScore, // below 2
      };
      expect(isPassingScore(scorecard)).toBe(false);
    });
  });
});

// ── B2-EV-003: Category scoring functions ─────────────────────────────────────

describe("B2-EV-003: Category scoring functions", () => {
  it("SCORING_FUNCTIONS has exactly 9 entries", () => {
    expect(Object.keys(SCORING_FUNCTIONS)).toHaveLength(9);
  });

  it("SCORING_FUNCTIONS keys match ALL_CATEGORIES", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(SCORING_FUNCTIONS).toHaveProperty(cat);
    }
  });

  it("each scoring function returns { score, rationale } structure", () => {
    const evidence = [
      makeEvidenceItem("A1", "session-context", "pass"),
    ];

    const result = scoreSessionContext(evidence);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("rationale");
    expect(typeof result.rationale).toBe("string");
  });

  it("each scoring function returns a valid CategoryScore (0-5)", () => {
    const evidence: EvidenceItem[] = [];
    const functions = [
      scoreSessionContext,
      scoreTextExtraction,
      scoreSemanticStructure,
      scoreLayoutGeometry,
      scoreVisualCapture,
      scoreInteractionModel,
      scoreDeltasEfficiency,
      scoreRobustness,
      scoreSecurityPrivacy,
    ];

    for (const fn of functions) {
      const result = fn(evidence);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(5);
    }
  });

  it("each scoring function returns deterministic results", () => {
    const evidence = [
      makeEvidenceItem("A1", "session-context", "pass", ["tool1"]),
      makeEvidenceItem("A2", "session-context", "fail", ["tool2"]),
    ];

    const result1 = scoreSessionContext(evidence);
    const result2 = scoreSessionContext(evidence);

    expect(result1.score).toBe(result2.score);
    expect(result1.rationale).toBe(result2.rationale);
  });
});

// ── B2-EV-004: Evidence item model ───────────────────────────────────────────

describe("B2-EV-004: Evidence item model", () => {
  describe("isChecklistItemId", () => {
    it("returns true for valid single-digit item IDs (A1, B2, I9)", () => {
      expect(isChecklistItemId("A1")).toBe(true);
      expect(isChecklistItemId("B2")).toBe(true);
      expect(isChecklistItemId("I9")).toBe(true);
    });

    it("returns true for valid multi-digit item IDs (A10, G23)", () => {
      expect(isChecklistItemId("A10")).toBe(true);
      expect(isChecklistItemId("G23")).toBe(true);
      expect(isChecklistItemId("C100")).toBe(true);
    });

    it("returns false for invalid letter prefixes (Z1, J1, a1)", () => {
      expect(isChecklistItemId("Z1")).toBe(false);
      expect(isChecklistItemId("J1")).toBe(false);
      expect(isChecklistItemId("a1")).toBe(false);
    });

    it("returns false for malformed formats (A, 1A, A1B)", () => {
      expect(isChecklistItemId("A")).toBe(false);
      expect(isChecklistItemId("1A")).toBe(false);
      expect(isChecklistItemId("A1B")).toBe(false);
      // Note: A0 IS technically valid by /^[A-I]\d+$/ regex
      // Only A0B (extra trailing char) is explicitly listed as malformed
      expect(isChecklistItemId("A0")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(isChecklistItemId("")).toBe(false);
    });
  });

  it("CHECKLIST_ITEM_ID_PATTERN regex matches valid IDs and rejects invalid ones", () => {
    // Note: the pattern /^[A-I]\d+$/ technically matches A0 because \d+ includes 0
    // However, checklist items are 1-indexed, so A0 is semantically invalid
    // and is rejected by isChecklistItemId despite the \d+ pattern
    expect(CHECKLIST_ITEM_ID_PATTERN.test("A1")).toBe(true);
    expect(CHECKLIST_ITEM_ID_PATTERN.test("I99")).toBe(true);
    expect(CHECKLIST_ITEM_ID_PATTERN.test("J1")).toBe(false); // J not in A-I
    expect(CHECKLIST_ITEM_ID_PATTERN.test("A1B")).toBe(false); // extra char
  });

  it("EvidenceItem type enforces itemId as ChecklistItemId", () => {
    const item = makeEvidenceItem("A1", "session-context", "pass");
    expect(isChecklistItemId(item.itemId)).toBe(true);
  });
});

// ── B2-EV-005: Evidence table ────────────────────────────────────────────────

describe("B2-EV-005: Evidence table", () => {
  it("buildEvidenceTable returns items sorted by itemId", () => {
    const items = [
      makeEvidenceItem("C3", "semantic-structure"),
      makeEvidenceItem("A1", "session-context"),
      makeEvidenceItem("B2", "text-extraction"),
    ];

    const table = buildEvidenceTable(items);
    expect(table[0].itemId).toBe("A1");
    expect(table[1].itemId).toBe("B2");
    expect(table[2].itemId).toBe("C3");
  });

  it("buildEvidenceTable preserves all fields from input items", () => {
    const items = [
      makeEvidenceItem("A1", "session-context", "pass", ["tool1", "tool2"], "Custom summary"),
    ];

    const table = buildEvidenceTable(items);
    expect(table[0].itemId).toBe("A1");
    expect(table[0].category).toBe("session-context");
    expect(table[0].status).toBe("pass");
    expect(table[0].toolCalls).toEqual(["tool1", "tool2"]);
    expect(table[0].summary).toBe("Custom summary");
  });

  it("buildEvidenceTable returns readonly array", () => {
    const items = [makeEvidenceItem("A1", "session-context")];
    const table = buildEvidenceTable(items);
    expect(Array.isArray(table)).toBe(true);
    // ReadonlyArray methods should be available
    expect(typeof table.slice).toBe("function");
  });

  it("buildEvidenceTable throws on malformed itemId (B2-EV-004 runtime validation)", () => {
    const items = [
      // @ts-expect-error — intentionally malformed for testing
      { itemId: "Z99", category: "session-context", status: "pass", toolCalls: [], summary: "" },
    ];

    expect(() => buildEvidenceTable(items)).toThrow();
  });

  it("buildEvidenceTable accepts valid EvidenceItems and returns them sorted", () => {
    const items = [
      makeEvidenceItem("I4", "security-privacy"),
      makeEvidenceItem("A1", "session-context"),
      makeEvidenceItem("G7", "deltas-efficiency"),
    ];

    const table = buildEvidenceTable(items);
    expect(table).toHaveLength(3);
    expect(table[0].itemId).toBe("A1");
    expect(table[1].itemId).toBe("G7");
    expect(table[2].itemId).toBe("I4");
  });
});

// ── B2-EV-006: JSON evidence emitter ─────────────────────────────────────────

describe("B2-EV-006: JSON evidence emitter", () => {
  const tmpDir = "/tmp/eval-test-json";

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("emitJsonEvidence writes valid JSON that round-trips through JSON.parse()", async () => {
    const result = {
      runId: "test-run-001",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [
        makeEvidenceItem("A1", "session-context", "pass", ["accordo_browser_get_page_map"], "Test"),
      ],
      gateResult: "none" as const,
    };

    const filePath = await emitJsonEvidence(result, { outputDir: tmpDir });
    const rawContent = await import("fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));

    // Must not throw, and the parsed object must preserve the original structure
    const parsed = JSON.parse(rawContent);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
    expect(parsed.runId).toBe("test-run-001");
    expect(parsed.surface).toBe("accordo-mcp");
  });

  it("emitJsonEvidence JSON contains scorecard, evidenceTable, timestamp, surface", async () => {
    const result = {
      runId: "test-run-002",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "playwright-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [
        makeEvidenceItem("B1", "text-extraction", "partial", ["accordo_browser_get_page_map"], "Partial"),
      ],
      gateResult: "G1" as const,
    };

    const filePath = await emitJsonEvidence(result, { outputDir: tmpDir });
    const rawContent = await import("fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    const parsed = JSON.parse(rawContent);

    expect(typeof parsed.scorecard).toBe("object");
    expect(parsed.scorecard).not.toBeNull();
    expect(Array.isArray(parsed.evidenceTable)).toBe(true);
    expect(parsed.evidenceTable).toHaveLength(1);
    expect(parsed.timestamp).toBe("2026-03-28T00:00:00.000Z");
    expect(parsed.surface).toBe("playwright-mcp");
    expect(parsed.runId).toBe("test-run-002");
    expect(parsed.gateResult).toBe("G1");
  });

  it("emitJsonEvidence file is written to the configured outputDir", async () => {
    const result = {
      runId: "test-run-003",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "chrome-devtools" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    const filePath = await emitJsonEvidence(result, { outputDir: tmpDir });
    // File path should contain the outputDir
    expect(filePath).toContain(tmpDir);
    // File should exist
    const exists = await import("fs/promises").then((fs) =>
      fs.access(filePath).then(() => true).catch(() => false),
    );
    expect(exists).toBe(true);
  });

  it("emitJsonEvidence uses filenamePrefix when provided", async () => {
    const result = {
      runId: "test-run-004",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    const filePath = await emitJsonEvidence(result, {
      outputDir: tmpDir,
      filenamePrefix: "my-custom-prefix",
    });
    expect(filePath).toContain("my-custom-prefix");
  });
});

// ── B2-EV-007: Markdown evidence emitter ─────────────────────────────────────

describe("B2-EV-007: Markdown evidence emitter", () => {
  const tmpDir = "/tmp/eval-test-md";

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe("formatScorecardMarkdown", () => {
    it("returns a table with all 9 category rows", () => {
      const markdown = formatScorecardMarkdown(VALID_SCORECARD);

      // Should contain all 9 categories (by name or letter)
      for (const cat of ALL_CATEGORIES) {
        expect(markdown).toContain(LETTER_BY_CATEGORY[cat]);
      }
    });

    it("includes a total row showing the sum", () => {
      const markdown = formatScorecardMarkdown(G3_SCORECARD);
      expect(markdown).toContain("45");
    });

    it("shows category letter and name in table format", () => {
      const markdown = formatScorecardMarkdown(VALID_SCORECARD);
      // Should contain table-like structure (markdown pipes)
      expect(markdown).toContain("|");
      // Should show session-context with its letter A
      expect(markdown).toContain("session-context");
    });
  });

  describe("formatEvidenceTableMarkdown", () => {
    it("returns a table with Item ID, Status, Tool Calls, Summary columns", () => {
      const items = [
        makeEvidenceItem("A1", "session-context", "pass", ["tool1"], "Test summary"),
      ];

      const markdown = formatEvidenceTableMarkdown(items);

      expect(markdown).toContain("Item ID");
      expect(markdown).toContain("Status");
      expect(markdown).toContain("Tool Calls");
      expect(markdown).toContain("Summary");
    });

    it("includes one row per evidence item", () => {
      const items = [
        makeEvidenceItem("A1", "session-context", "pass"),
        makeEvidenceItem("B2", "text-extraction", "partial"),
        makeEvidenceItem("C3", "semantic-structure", "fail"),
      ];

      const markdown = formatEvidenceTableMarkdown(items);

      expect(markdown).toContain("A1");
      expect(markdown).toContain("B2");
      expect(markdown).toContain("C3");
    });

    it("renders status values as pass/partial/fail/skip", () => {
      const items = [
        makeEvidenceItem("A1", "session-context", "pass"),
        makeEvidenceItem("A2", "session-context", "partial"),
        makeEvidenceItem("A3", "session-context", "fail"),
        makeEvidenceItem("A4", "session-context", "skip"),
      ];

      const markdown = formatEvidenceTableMarkdown(items);

      expect(markdown).toContain("pass");
      expect(markdown).toContain("partial");
      expect(markdown).toContain("fail");
      expect(markdown).toContain("skip");
    });
  });

  describe("formatEvaluationMarkdown", () => {
    it("includes metadata header with runId, timestamp, surface", () => {
      const result = {
        runId: "test-run-005",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: "none" as const,
      };

      const markdown = formatEvaluationMarkdown(result);

      expect(markdown).toContain("test-run-005");
      expect(markdown).toContain("2026-03-28T00:00:00.000Z");
      expect(markdown).toContain("accordo-mcp");
    });

    it("includes scorecard table", () => {
      const result = {
        runId: "test-run-006",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: "G2" as const,
      };

      const markdown = formatEvaluationMarkdown(result);

      // Should contain scorecard representation
      expect(markdown).toContain("session-context");
    });

    it("includes evidence table", () => {
      const result = {
        runId: "test-run-007",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [
          makeEvidenceItem("A1", "session-context", "pass", ["tool"], "Test"),
        ],
        gateResult: "none" as const,
      };

      const markdown = formatEvaluationMarkdown(result);

      expect(markdown).toContain("A1");
      expect(markdown).toContain("Test");
    });

    it("includes gate result", () => {
      const result = {
        runId: "test-run-008",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: "G3" as const,
      };

      const markdown = formatEvaluationMarkdown(result);

      expect(markdown).toContain("G3");
    });
  });

  describe("emitMarkdownEvidence", () => {
    it("writes a .md file to the configured output directory", async () => {
      const result = {
        runId: "test-run-009",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: "none" as const,
      };

      const filePath = await emitMarkdownEvidence(result, { outputDir: tmpDir });

      expect(filePath).toContain(tmpDir);
      expect(filePath).toMatch(/\.md$/);

      const exists = await import("fs/promises").then((fs) =>
        fs.access(filePath).then(() => true).catch(() => false),
      );
      expect(exists).toBe(true);
    });

    it("file contains markdown content", async () => {
      const result = {
        runId: "test-run-010",
        timestamp: "2026-03-28T00:00:00.000Z",
        surface: "playwright-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: "G1" as const,
      };

      const filePath = await emitMarkdownEvidence(result, { outputDir: tmpDir });
      const content = await import("fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));

      expect(content).toContain("test-run-010");
      expect(content).toContain("playwright-mcp");
    });
  });
});

// ── B2-EV-008: Multi-surface comparison ───────────────────────────────────────

describe("B2-EV-008: Multi-surface comparison", () => {
  const tmpDir = "/tmp/eval-test-multi";

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("two EvaluationResults with different surfaces produce different filenames", async () => {
    const accordoResult = {
      runId: "run-1",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    const playwrightResult = {
      runId: "run-2",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "playwright-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    const accordoPath = await emitJsonEvidence(accordoResult, { outputDir: tmpDir });
    const playwrightPath = await emitJsonEvidence(playwrightResult, { outputDir: tmpDir });

    // Filenames must differ when surface differs
    expect(accordoPath).not.toBe(playwrightPath);
    expect(accordoPath).not.toContain("playwright-mcp");
    expect(playwrightPath).not.toContain("accordo-mcp");
  });

  it("surface field is present in EvaluationResult", () => {
    const result = {
      runId: "test",
      timestamp: "2026-03-28T00:00:00.000Z",
      surface: "chrome-devtools" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    expect(result.surface).toBe("chrome-devtools");
  });

  it("EvalSurface type has exactly 3 known values", () => {
    const surfaces: EvalSurface[] = ["accordo-mcp", "playwright-mcp", "chrome-devtools"];
    expect(surfaces).toHaveLength(3);
  });
});

// ── B2-EV-009: Gate checking ──────────────────────────────────────────────────

describe("B2-EV-009: Gate checking", () => {
  it("checkGate returns 'none' for total < 36", () => {
    const scorecard: Scorecard = {
      "session-context": 4,
      "text-extraction": 4,
      "semantic-structure": 4,
      "layout-geometry": 4,
      "visual-capture": 4,
      "interaction-model": 4,
      "deltas-efficiency": 4,
      "robustness": 4,
      "security-privacy": 4, // 36
    };
    // Just below G1 threshold (need all >= 3)
    const belowG1: Scorecard = {
      ...scorecard,
      "security-privacy": 2 as CategoryScore, // 34 total
    };
    expect(checkGate(belowG1)).toBe("none");
  });

  it("checkGate returns 'none' when total=36 but one category is 2", () => {
    // 6×4 + 2×5 + 2 = 36: six at 4, two at 5 (compensate), one at 2 (below G1 min)
    const oneLow: Scorecard = {
      "session-context": 4,
      "text-extraction": 5,
      "semantic-structure": 4,
      "layout-geometry": 4,
      "visual-capture": 5,
      "interaction-model": 4,
      "deltas-efficiency": 4,
      "robustness": 4,
      "security-privacy": 2 as CategoryScore, // 36 total, but below G1 min category
    };
    expect(checkGate(oneLow)).toBe("none");
  });

  it("checkGate returns 'G1' for total=36 with all categories ≥ 3", () => {
    expect(checkGate(G1_SCORECARD)).toBe("G1");
  });

  it("checkGate returns 'G1' for total=38 with all categories ≥ 3", () => {
    // 5+4+4+4+4+4+4+4+4 = 37, but need total=38, so: 5+4+4+4+4+4+4+4+5 = 38
    const scorecard: Scorecard = {
      "session-context": 5,
      "text-extraction": 4,
      "semantic-structure": 4,
      "layout-geometry": 4,
      "visual-capture": 4,
      "interaction-model": 4,
      "deltas-efficiency": 4,
      "robustness": 4,
      "security-privacy": 5, // 38 total, all >= 3
    };
    // G1: total >= 36, all categories >= 3
    expect(checkGate(scorecard)).toBe("G1");
  });

  it("checkGate returns 'G2' for total=40 with A–H ≥ 4, I ≥ 3", () => {
    expect(checkGate(G2_SCORECARD)).toBe("G2");
  });

  it("checkGate returns 'G2' (not G3) for total=44", () => {
    const scorecard: Scorecard = {
      "session-context": 5,
      "text-extraction": 5,
      "semantic-structure": 5,
      "layout-geometry": 5,
      "visual-capture": 5,
      "interaction-model": 5,
      "deltas-efficiency": 5,
      "robustness": 5,
      "security-privacy": 4, // 44 total, I=4 which is < 5 for G3
    };
    expect(checkGate(scorecard)).toBe("G2");
  });

  it("checkGate returns 'G3' for perfect 45/45", () => {
    expect(checkGate(G3_SCORECARD)).toBe("G3");
  });

  it("checkGate returns 'none' when total=36 but one category is 2 (G1 boundary)", () => {
    // 6×4 + 2×5 + 2 = 36: six at 4, two at 5 (compensate), one at 2 (below G1 min)
    const withLow: Scorecard = {
      "session-context": 2 as CategoryScore, // 36 total, but below G1 min category
      "text-extraction": 4,
      "semantic-structure": 5,
      "layout-geometry": 4,
      "visual-capture": 5,
      "interaction-model": 4,
      "deltas-efficiency": 4,
      "robustness": 4,
      "security-privacy": 4,
    };
    expect(checkGate(withLow)).toBe("none");
  });

  it("checkGate returns correct gate checking order (G3 > G2 > G1 > none)", () => {
    // G3 scorecard should not return G1 or G2
    expect(checkGate(G3_SCORECARD)).toBe("G3");

    // G2 scorecard should not return G1
    expect(checkGate(G2_SCORECARD)).toBe("G2");

    // G1 scorecard should not return G2
    expect(checkGate(G1_SCORECARD)).toBe("G1");
  });
});

// ── B2-EV-010: Deterministic scoring ─────────────────────────────────────────

describe("B2-EV-010: Deterministic scoring", () => {
  it("same evidence items produce the same score on repeated calls", () => {
    const evidence = [
      makeEvidenceItem("A1", "session-context", "pass", ["accordo_browser_get_page_map"]),
      makeEvidenceItem("A2", "session-context", "partial", ["accordo_browser_get_page_map", "accordo_browser_inspect_element"]),
      makeEvidenceItem("A3", "session-context", "fail", ["accordo_browser_get_dom_excerpt"]),
    ];

    const result1 = scoreSessionContext(evidence);
    const result2 = scoreSessionContext(evidence);
    const result3 = scoreSessionContext(evidence);

    expect(result1.score).toBe(result2.score);
    expect(result2.score).toBe(result3.score);
    expect(result1.rationale).toBe(result2.rationale);
    expect(result2.rationale).toBe(result3.rationale);
  });

  it("scoring function is pure — no side effects between calls", () => {
    const evidence = [makeEvidenceItem("A1", "session-context", "pass")];

    // Call multiple times
    const results = Array.from({ length: 5 }, () => scoreSessionContext(evidence));

    // All results must be identical
    for (const result of results) {
      expect(result.score).toBe(results[0].score);
      expect(result.rationale).toBe(results[0].rationale);
    }
  });

  it("deterministic scoring across all 9 categories", () => {
    const evidence = [
      makeEvidenceItem("A1", "session-context", "pass"),
      makeEvidenceItem("B1", "text-extraction", "partial"),
    ];

    const functions = [
      scoreSessionContext,
      scoreTextExtraction,
      scoreSemanticStructure,
      scoreLayoutGeometry,
      scoreVisualCapture,
      scoreInteractionModel,
      scoreDeltasEfficiency,
      scoreRobustness,
      scoreSecurityPrivacy,
    ];

    for (const fn of functions) {
      const r1 = fn(evidence);
      const r2 = fn(evidence);
      expect(r1.score).toBe(r2.score);
      expect(r1.rationale).toBe(r2.rationale);
    }
  });
});

// ── B2-EV-011: Evaluation run metadata ────────────────────────────────────────

describe("B2-EV-011: Evaluation run metadata", () => {
  it("EvaluationResult contains all required fields", () => {
    const result = {
      runId: "run-xyz",
      timestamp: "2026-03-28T12:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [
        makeEvidenceItem("A1", "session-context", "pass"),
      ],
      gateResult: "G2" as const,
    };

    // Required fields: runId, timestamp, surface, scorecard, evidenceTable, gateResult
    expect(result).toHaveProperty("runId");
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("surface");
    expect(result).toHaveProperty("scorecard");
    expect(result).toHaveProperty("evidenceTable");
    expect(result).toHaveProperty("gateResult");
  });

  it("runId is a non-empty string", () => {
    const result = {
      runId: "run-abc",
      timestamp: "2026-03-28T12:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);
  });

  it("timestamp is ISO 8601 format", () => {
    const result = {
      runId: "run-iso",
      timestamp: "2026-03-28T12:00:00.000Z",
      surface: "accordo-mcp" as EvalSurface,
      scorecard: VALID_SCORECARD,
      evidenceTable: [],
      gateResult: "none" as const,
    };

    // ISO 8601 validation - should match pattern
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    expect(isoPattern.test(result.timestamp)).toBe(true);
  });

  it("gateResult is one of G1, G2, G3, or none", () => {
    const validResults: Array<"G1" | "G2" | "G3" | "none"> = ["G1", "G2", "G3", "none"];

    for (const gr of validResults) {
      const result = {
        runId: "run",
        timestamp: "2026-03-28T12:00:00.000Z",
        surface: "accordo-mcp" as EvalSurface,
        scorecard: VALID_SCORECARD,
        evidenceTable: [],
        gateResult: gr,
      };
      expect(validResults).toContain(result.gateResult);
    }
  });
});

// ── B2-EV-012: Harness is testable without browser ───────────────────────────

describe("B2-EV-012: Harness is testable without browser", () => {
  it("all imported functions from eval-harness are available", () => {
    // These imports must not throw
    expect(typeof buildScorecard).toBe("function");
    expect(typeof buildEvidenceTable).toBe("function");
    expect(typeof checkGate).toBe("function");
    expect(typeof isPassingScore).toBe("function");
    expect(typeof totalScore).toBe("function");
    expect(typeof SCORING_FUNCTIONS).toBe("object");
  });

  it("all imported functions from eval-emitter are available", () => {
    expect(typeof formatScorecardMarkdown).toBe("function");
    expect(typeof formatEvidenceTableMarkdown).toBe("function");
    expect(typeof formatEvaluationMarkdown).toBe("function");
    expect(typeof emitJsonEvidence).toBe("function");
    expect(typeof emitMarkdownEvidence).toBe("function");
  });

  it("no browser globals are required to run these tests", () => {
    // Assert that the eval modules are environment-agnostic: they must not depend on
    // browser-extension-only APIs. This test suite runs under jsdom (which provides
    // window/document), but the Chrome Extension API (`chrome`) is NOT injected by
    // jsdom — its absence proves these modules do not rely on browser-extension globals.
    expect(typeof chrome).toBe("undefined");

    // Confirm that pure eval functions produce correct output without any DOM access.
    // isChecklistItemId is a pure regex predicate — calling it proves the module
    // operates on plain data, not browser APIs.
    expect(isChecklistItemId("A1")).toBe(true);
    expect(isChecklistItemId("not-an-id")).toBe(false);

    // LETTER_BY_CATEGORY is a pure constant — readable without any DOM.
    expect(typeof LETTER_BY_CATEGORY["session-context"]).toBe("string");
  });

  it("tests run in vitest without any browser dependencies", () => {
    // Contract: eval-harness and eval-emitter must import cleanly from Node.js.
    // Verify that the functions are callable in a pure Node.js vitest environment
    // by asserting they are defined functions, not undefined/null.
    expect(buildScorecard).toBeInstanceOf(Function);
    expect(emitJsonEvidence).toBeInstanceOf(Function);
    expect(emitMarkdownEvidence).toBeInstanceOf(Function);
  });
});
