/**
 * Runtime Directives — Prompt Engine: Bundle Source of Truth
 * Requirements: requirements-runtime-directives.md Y-01, Y-04
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.getBundle() [3 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - All tests now run at assertion level (no stub-throw short-circuit)
 */

import { describe, it, expect } from "vitest";
import {
  MockRuntimeDirectiveCatalog,
  CANONICAL_CLAUSES,
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — Canonical bundle is single source of truth (Y-01, Y-04)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-01: getBundle returns non-empty clauses with unique IDs", () => {
    const bundle = catalog.getBundle();
    expect(bundle).toBeDefined();
    expect(bundle.clauses.length).toBeGreaterThan(0);
    const ids = bundle.clauses.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Y-04: All clause instructions are self-contained (no repo-only patterns)", () => {
    const bundle = catalog.getBundle();
    for (const clause of bundle.clauses) {
      expect(clause.instruction.length).toBeGreaterThan(0);
      const repoOnlyPatterns = [
        /docs\/[a-z-]+\.md/i,
        /(^|[\s("'])skills\//i,
        /\.ts\b/,
        /\.js\b/,
        /require\s*\(/,
        /import\s+/,
      ];
      for (const pattern of repoOnlyPatterns) {
        expect(pattern.test(clause.instruction)).toBe(false);
      }
    }
  });

  it("Y-01: Canonical bundle matches expected clause set", () => {
    const bundle = catalog.getBundle();
    expect(bundle.clauses.map(c => c.id)).toEqual(CANONICAL_CLAUSES.map(c => c.id));
  });
});
