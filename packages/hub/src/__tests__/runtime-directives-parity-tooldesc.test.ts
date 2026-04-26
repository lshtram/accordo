/**
 * Runtime Directives — Parity: tool-description reinforcement
 * Requirements: requirements-runtime-directives.md Y-05
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.getBundle() tool-description clauses [2 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - Validates that tool-description parity targets have non-empty instructions
 * - Adds explicit clause ID + instruction length assertions
 */

import { describe, it, expect } from "vitest";
import {
  MockRuntimeDirectiveCatalog,
  CANONICAL_CLAUSES,
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — tool-description reinforcement (Y-05)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-05: clauses targeting tool-description have non-empty instructions", () => {
    const bundle = catalog.getBundle();
    const toolDescClauses = bundle.clauses.filter(c =>
      c.parityTargets.includes("tool-description" as any),
    );
    expect(toolDescClauses.length).toBeGreaterThan(0);
    for (const clause of toolDescClauses) {
      expect(clause.instruction.length).toBeGreaterThan(0);
    }
  });

  it("Y-05: All tool-description clauses have valid IDs and summaries", () => {
    const bundle = catalog.getBundle();
    const toolDescClauses = bundle.clauses.filter(c =>
      c.parityTargets.includes("tool-description" as any),
    );
    for (const clause of toolDescClauses) {
      expect(clause.id).toMatch(/^rd-\d{3}$/);
      expect(clause.summary.length).toBeGreaterThan(0);
      expect(clause.instruction.length).toBeGreaterThan(10);
    }
  });

  it("Y-05: Canonical clauses include skill-routing directive", () => {
    const bundle = catalog.getBundle();
    const skillRouting = bundle.clauses.find(c => c.id === "rd-001");
    expect(skillRouting).toBeDefined();
    expect(skillRouting!.parityTargets).toContain("tool-description");
  });
});
