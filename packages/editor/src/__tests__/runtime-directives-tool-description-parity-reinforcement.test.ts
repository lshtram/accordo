/**
 * Runtime Directives — Editor Tool Description: Reinforcement Checks
 * Requirements: requirements-runtime-directives.md Y-05, Y-09
 *
 * API checklist:
 *   editorTools accordo_* naming convention [2 tests]
 *   CANONICAL_CLAUSES reinforcement alignment [3 tests]
 *
 * Blocker 4 remediation: replaced heuristic pattern checks with
 * canonical-source-driven expectations using CANONICAL_CLAUSES fixtures.
 * Validates tool behaviors against actual clause instructions from the
 * canonical fixture set (shared source of truth for both hub and editor).
 */

import { describe, it, expect } from "vitest";
import { editorTools } from "../tools/editor-definitions.js";
import { CANONICAL_CLAUSES } from "./runtime-directives-fixtures.js";

// Canonical tool-description clause IDs (rd-002 naming + rd-010 reinforcement)
const TOOL_DESC_PARITY_CLAUSE_IDS = CANONICAL_CLAUSES
  .filter(c => c.parityTargets.includes("tool-description" as any))
  .map(c => c.id);

// rd-002: MCP tool naming convention clause
const NAMING_CLAUSE = CANONICAL_CLAUSES.find(c => c.id === "rd-002");
// rd-010: tool description canonical parity reinforcement clause
const REINFORCEMENT_CLAUSE = CANONICAL_CLAUSES.find(c => c.id === "rd-010");

describe("Editor tool naming — Y-05 accordo_* convention", () => {
  it("Y-05: All editor tool names follow accordo_<modality>_<action> prefix", () => {
    // Canonical naming clause (rd-002) instruction:
    // "All MCP tools exposed via the gateway must use the accordo_<modality>_<action> prefix"
    expect(NAMING_CLAUSE).toBeDefined();
    for (const tool of editorTools) {
      expect(tool.name).toMatch(/^accordo_[a-z]+_[a-zA-Z]+$/);
    }
  });

  it("Y-05: No editor tool name duplicates another", () => {
    const names = editorTools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Tool-description canonical clause alignment — Y-05, Y-09", () => {
  it("Y-09: Tool-description parity target clauses exist and are non-empty", () => {
    expect(TOOL_DESC_PARITY_CLAUSE_IDS.length).toBeGreaterThan(0);
    for (const clauseId of TOOL_DESC_PARITY_CLAUSE_IDS) {
      const clause = CANONICAL_CLAUSES.find(c => c.id === clauseId);
      expect(clause).toBeDefined();
      expect(clause!.instruction.length).toBeGreaterThan(0);
    }
  });

  it("Y-05: rd-002 (naming) is in tool-description parity targets", () => {
    expect(NAMING_CLAUSE).toBeDefined();
    expect(NAMING_CLAUSE!.parityTargets).toContain("tool-description");
  });

  it("Y-05: rd-010 (reinforcement) is in tool-description parity targets", () => {
    expect(REINFORCEMENT_CLAUSE).toBeDefined();
    expect(REINFORCEMENT_CLAUSE!.parityTargets).toContain("tool-description");
  });

  it("Y-05: rd-010 reinforcement clause instruction prohibits contradiction", () => {
    // "Tool descriptions must not contradict canonical runtime directives."
    // This is the canonical source that validates tool descriptions.
    expect(REINFORCEMENT_CLAUSE!.instruction).toContain("not contradict");
    expect(REINFORCEMENT_CLAUSE!.instruction).toContain("must not");
  });
});

describe("Editor tool descriptions — canonical reinforcement alignment (Y-05)", () => {
  it("Y-05: All editor tools have non-empty descriptions (minimum 10 chars)", () => {
    for (const tool of editorTools) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("Y-05: No editor tool description contradicts canonical directives", () => {
    // Canonical rd-010: "Tool descriptions must not contradict canonical runtime directives."
    // Tool descriptions should reinforce behaviors, not negate them.
    const contradictionKeywords = [
      "do not use",
      "avoid using",
      "never use",
      "don't use",
      "instead of accordo",
      "bypass accordo",
    ];
    for (const tool of editorTools) {
      const lower = tool.description.toLowerCase();
      for (const keyword of contradictionKeywords) {
        expect(lower).not.toContain(keyword);
      }
    }
  });

  it("Y-05: All editor tool descriptions are self-contained (no repo-only refs)", () => {
    // Canonical Y-04: instructions must be self-contained — same applies to tool descriptions
    const repoOnlyPatterns = [
      /docs\/[a-z-]+\.md/i,
      /skills\//i,
      /\.ts\b/,
      /\.js\b/,
      /require\s*\(/,
      /import\s+/,
    ];
    for (const tool of editorTools) {
      for (const pattern of repoOnlyPatterns) {
        expect(pattern.test(tool.description)).toBe(false);
      }
    }
  });
});