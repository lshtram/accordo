/**
 * Runtime Directives — Prompt Engine: /instructions parity
 * Requirements: requirements-runtime-directives.md Y-03
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.renderInstructions() — clause ordering [1 test]
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
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — /instructions parity with initialize (Y-03)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-03: renderInstructions renders same clause order as bundle", () => {
    const bundle = catalog.getBundle();
    const rendered = catalog.renderInstructions(FIXTURE_IDE_STATE, []);
    const clauseIds = bundle.clauses.map((c: RuntimeDirectiveClause) => c.id);
    let lastIndex = -1;
    for (const id of clauseIds) {
      const idx = rendered.indexOf(id);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("Y-03: All clause IDs appear in rendered output", () => {
    const bundle = catalog.getBundle();
    const rendered = catalog.renderInstructions(FIXTURE_IDE_STATE, []);
    for (const clause of bundle.clauses) {
      expect(rendered).toContain(clause.id);
    }
  });
});
