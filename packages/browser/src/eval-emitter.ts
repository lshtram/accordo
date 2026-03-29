/**
 * M111-EVAL — Evidence Emitter
 *
 * Emits evaluation results as JSON and Markdown files. This module
 * is a pure library — it receives an `EvaluationResult` and emits
 * formatted output. No MCP tool registration, no relay dependency.
 *
 * File I/O is the only side effect; the formatting functions themselves
 * are pure.
 *
 * Implements B2-EV-006, B2-EV-007, B2-EV-008, B2-EV-011.
 *
 * @module
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  EmitOptions,
  EvaluationResult,
  EvidenceItem,
  Scorecard,
} from "./eval-types.js";
import { ALL_CATEGORIES, LETTER_BY_CATEGORY } from "./eval-types.js";
import { totalScore } from "./eval-harness.js";

// ── Markdown Formatting (pure) ───────────────────────────────────────────────

/**
 * B2-EV-007: Format a scorecard as a Markdown table (checklist §7 format).
 *
 * Returns a multi-line string with a table of categories, letters,
 * scores, and a total row.
 *
 * Pure function — no side effects.
 */
export function formatScorecardMarkdown(scorecard: Scorecard): string {
  const rows = ALL_CATEGORIES.map((cat) => {
    const letter = LETTER_BY_CATEGORY[cat];
    const score = scorecard[cat];
    return `| ${letter} | ${cat} | ${score}/5 |`;
  });

  const total = totalScore(scorecard);
  const header = [
    "| Letter | Category | Score |",
    "|--------|----------|-------|",
  ];
  const footer = [
    `| — | **Total** | **${total}/45** |`,
  ];

  return [...header, ...rows, ...footer].join("\n");
}

/**
 * B2-EV-007: Format evidence items as a Markdown table (checklist §7.1 format).
 *
 * Returns a multi-line string with columns: Item ID, Status, Tool Calls, Summary.
 *
 * Pure function — no side effects.
 */
export function formatEvidenceTableMarkdown(
  items: readonly EvidenceItem[],
): string {
  const header = [
    "| Item ID | Status | Tool Calls | Summary |",
    "|---------|--------|------------|---------|",
  ];

  const rows = items.map((item) => {
    const toolCalls = item.toolCalls.join(", ");
    return `| ${item.itemId} | ${item.status} | ${toolCalls} | ${item.summary} |`;
  });

  return [...header, ...rows].join("\n");
}

/**
 * B2-EV-007: Format a complete evaluation result as a Markdown report.
 *
 * Combines metadata header, scorecard table, and evidence table into
 * a single Markdown document.
 *
 * Pure function — no side effects.
 */
export function formatEvaluationMarkdown(result: EvaluationResult): string {
  const sections: string[] = [
    `# Evaluation Report`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Run ID | ${result.runId} |`,
    `| Timestamp | ${result.timestamp} |`,
    `| Surface | ${result.surface} |`,
    `| Gate Result | ${result.gateResult} |`,
    ``,
    `## Scorecard`,
    ``,
    formatScorecardMarkdown(result.scorecard),
    ``,
    `## Evidence Table`,
    ``,
    formatEvidenceTableMarkdown(result.evidenceTable),
  ];

  return sections.join("\n");
}

/** Default output directory used when `EmitOptions.outputDir` is omitted. */
const DEFAULT_OUTPUT_DIR = "docs/reviews/";

// ── Filename Generation ──────────────────────────────────────────────────────

/**
 * Build a filename-safe timestamp segment from an ISO 8601 string.
 *
 * Replaces colons and dots with dashes so the string is valid on all OSes.
 */
function timestampToFilePart(timestamp: string): string {
  // 2026-03-28T00:00:00.000Z → 2026-03-28T00-00-00-000Z
  return timestamp.replace(/[:.]/g, "-");
}

/**
 * Build the base filename (without extension) for an evidence file.
 *
 * Format: `{prefix}-{surface}-{timestamp}`
 *
 * B2-EV-008: Different surfaces produce different filenames because
 * `surface` is part of the name.
 */
function buildBaseFilename(result: EvaluationResult, options: EmitOptions): string {
  const prefix = options.filenamePrefix ?? result.surface;
  const timePart = timestampToFilePart(result.timestamp);
  return `${prefix}-${result.surface}-${timePart}`;
}

// ── JSON Evidence Emitter ────────────────────────────────────────────────────

/**
 * B2-EV-006: Emit evaluation result as machine-readable JSON.
 *
 * Writes a JSON file containing the full `EvaluationResult` to the
 * configured output directory. The file name includes the surface
 * name and timestamp for uniqueness.
 *
 * B2-EV-008: The surface field in the result enables multi-surface
 * comparison — each surface produces its own file.
 *
 * B2-EV-011: The JSON document contains all required metadata fields.
 *
 * @returns The absolute path of the written file.
 */
export async function emitJsonEvidence(
  result: EvaluationResult,
  options: EmitOptions = {},
): Promise<string> {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  const filename = `${buildBaseFilename(result, options)}.json`;
  const filePath = join(outputDir, filename);
  const content = JSON.stringify(result, null, 2);

  await writeFile(filePath, content, { encoding: "utf-8" });

  return filePath;
}

// ── Markdown Evidence Emitter ────────────────────────────────────────────────

/**
 * B2-EV-007: Emit evaluation result as a human-readable Markdown report.
 *
 * Writes a Markdown file containing the scorecard table (§7 format)
 * and evidence table (§7.1 format) to the configured output directory.
 *
 * B2-EV-008: The surface field in the result enables multi-surface
 * comparison — each surface produces its own file.
 *
 * @returns The absolute path of the written file.
 */
export async function emitMarkdownEvidence(
  result: EvaluationResult,
  options: EmitOptions = {},
): Promise<string> {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  const filename = `${buildBaseFilename(result, options)}.md`;
  const filePath = join(outputDir, filename);
  const content = formatEvaluationMarkdown(result);

  await writeFile(filePath, content, { encoding: "utf-8" });

  return filePath;
}
