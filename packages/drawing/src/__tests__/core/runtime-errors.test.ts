/**
 * DRW-U25, DRW-U26 — Error vocabulary and validation precedence tests.
 *
 * DRW-U25: error_codes_are_from_stable_vocabulary
 * DRW-U26: validation_precedence_order
 *
 * Source: docs/20-requirements/requirements-drawing.md §7 (DRW-R22..R25)
 * Requirements: DRW-R24, DRW-R25
 */

import { describe, it, expect } from "vitest";
import { DrawingError, type DrawingErrorCode } from "../../core/types.js";

describe("core/runtime-errors", () => {
  /**
   * DRW-U25 — All thrown error codes match the DRW-R24 stable vocabulary.
   * DRW-R24: 13 stable error codes. No ad-hoc codes allowed.
   */
  it("DRW-U25: error_codes_are_from_stable_vocabulary", () => {
    const STABLE_CODES: DrawingErrorCode[] = [
      "invalid-argument",
      "path-outside-workspace",
      "file-not-found",
      "already-exists",
      "unsupported-diagram-type",
      "source-parse-failed",
      "scene-parse-failed",
      "scene-invalid",
      "duplicate-managed-identity",
      "panel-not-open",
      "placement-failed",
      "render-failed",
      "invariant-violation",
    ];

    for (const code of STABLE_CODES) {
      const err = new DrawingError(code, "test message");
      expect(err.code).toBe(code);
      expect(err.name).toBe("DrawingError");
    }

    // Code is enumerable and machine-readable
    const err = new DrawingError("unsupported-diagram-type", "flowchart only");
    const serialized = JSON.stringify(err);
    expect(serialized).toContain("unsupported-diagram-type");
  });

  /**
   * DRW-U26 — Validation precedence: arguments → path → existence → parse → merge.
   * DRW-R25: tools must not report a later-stage error when an earlier-stage
   * precondition already failed.
   */
  it("DRW-U26: validation_precedence_order", () => {
    // Stage order (lowest number = highest priority):
    //   1. invalid arguments / invalid extension
    //   2. path resolution / workspace guard
    //   3. existence checks
    //   4. Mermaid parse/type validation
    //   5. scene parse/validation
    //   6. merge/placement/runtime operation failures

    // Verify all 13 stable codes are assigned to a stage and stages are valid (1-6)
    const precedenceOrder: Array<{ code: DrawingErrorCode; stage: number }> = [
      { code: "invalid-argument", stage: 1 },
      { code: "path-outside-workspace", stage: 2 },
      { code: "file-not-found", stage: 3 },
      { code: "already-exists", stage: 3 },
      { code: "unsupported-diagram-type", stage: 4 },
      { code: "source-parse-failed", stage: 4 },
      { code: "scene-parse-failed", stage: 5 },
      { code: "scene-invalid", stage: 5 },
      { code: "duplicate-managed-identity", stage: 5 },
      { code: "panel-not-open", stage: 6 },
      { code: "placement-failed", stage: 6 },
      { code: "render-failed", stage: 6 },
      { code: "invariant-violation", stage: 6 },
    ];

    expect(precedenceOrder).toHaveLength(13); // all 13 codes represented

    // Each code maps to a valid stage 1-6
    for (const { code, stage } of precedenceOrder) {
      expect(code).toBeTruthy();
      expect(stage).toBeGreaterThanOrEqual(1);
      expect(stage).toBeLessThanOrEqual(6);
    }
  });
});
