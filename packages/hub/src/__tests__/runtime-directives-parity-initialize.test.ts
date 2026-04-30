/**
 * Runtime Directives — Parity: initialize vs /instructions
 * Requirements: requirements-runtime-directives.md Y-02, Y-03, Y-04
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.getBundle() + renderInstructions() [4 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - All tests now run at assertion level (no stub-throw short-circuit)
 */

import { describe, it, expect } from "vitest";
import type { RuntimeDirectiveClause } from "@accordo/bridge-types";
import {
  MockRuntimeDirectiveCatalog,
  FIXTURE_IDE_STATE,
  CANONICAL_CLAUSES,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

function renderDirectives(catalog: MockRuntimeDirectiveCatalog): string {
  return catalog.renderInstructions(FIXTURE_IDE_STATE, []);
}

describe("MockRuntimeDirectiveCatalog — initialize.instructions vs /instructions parity (Y-02, Y-03, Y-04)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-02: renderInstructions includes stable ## Runtime Directives section", () => {
    const rendered = renderDirectives(catalog);
    expect(rendered).toContain("## Runtime Directives");
  });

  it("Y-02: renderInstructions includes version and digest metadata", () => {
    const rendered = renderDirectives(catalog);
    expect(rendered).toContain(`version: ${CANONICAL_BUNDLE_VERSION}`);
    expect(rendered).toContain(`digest: ${CANONICAL_BUNDLE_DIGEST}`);
  });

  it("Y-03: /instructions renders same clause order as bundle", () => {
    const bundle = catalog.getBundle();
    const rendered = renderDirectives(catalog);
    const clauseIds = bundle.clauses.map((c: RuntimeDirectiveClause) => c.id);
    let lastIndex = -1;
    for (const id of clauseIds) {
      const idx = rendered.indexOf(id);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("Y-04: Mandatory directives are self-contained (no repo-only references)", () => {
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

  it("Y-04: All canonical clauses are present in rendered output", () => {
    const rendered = renderDirectives(catalog);
    for (const clause of CANONICAL_CLAUSES) {
      expect(rendered).toContain(clause.id);
      expect(rendered).toContain(clause.summary);
      expect(rendered).toContain(clause.instruction);
    }
  });
});
