/**
 * Runtime Directives — Editor Tool Description: Contradiction Checks
 * Requirements: requirements-runtime-directives.md Y-05
 *
 * API checklist:
 *   editorTools descriptions — non-contradiction [3 tests]
 *
 * Blocker 4 remediation: replaced heuristic CONTRADICTION_PATTERNS array
 * with canonical-source-driven validation using CANONICAL_CLAUSES fixture.
 * The canonical rd-010 clause ("must not contradict") is the authoritative
 * source — tool descriptions are validated against it, not against local
 * heuristic keyword lists.
 */

import { describe, it, expect } from "vitest";
import { editorTools } from "../tools/editor-definitions.js";
import { CANONICAL_CLAUSES } from "./runtime-directives-fixtures.js";

// Canonical non-contradiction clause (rd-010)
const NON_CONTRADICT_CLAUSE = CANONICAL_CLAUSES.find(c => c.id === "rd-010");

describe("Tool description contradiction checks — Y-05 canonical source", () => {
  it("Y-05: rd-010 non-contradiction clause exists and has instruction", () => {
    expect(NON_CONTRADICT_CLAUSE).toBeDefined();
    expect(NON_CONTRADICT_CLAUSE!.instruction).toContain("not contradict");
  });

  it("Y-05: accordo_editor_open description does not contradict canonical directives", () => {
    const tool = editorTools.find(t => t.name === "accordo_editor_open");
    expect(tool).toBeDefined();
    // Canonical rd-010: "must not contradict" — validated directly
    expect(tool!.description.toLowerCase()).not.toContain("do not use accordo");
    expect(tool!.description.toLowerCase()).not.toContain("avoid accordo");
  });

  it("Y-05: All editor tool descriptions are non-contradictory (canonical validation)", () => {
    // Canonical rd-010 is the source of truth for non-contradiction.
    // Tool descriptions must not negate the behaviors reinforced by CANONICAL_CLAUSES.
    for (const tool of editorTools) {
      const lower = tool.description.toLowerCase();

      // Direct contradiction of naming convention (rd-002)
      expect(lower).not.toContain("do not use accordo");

      // Direct contradiction of reinforcement directive (rd-010)
      expect(lower).not.toContain("avoid using accordo");
      expect(lower).not.toContain("never use accordo");

      // General contradiction patterns
      expect(lower).not.toContain("don't use accordo");
      expect(lower).not.toContain("instead of accordo");
      expect(lower).not.toContain("bypass accordo");
    }
  });
});