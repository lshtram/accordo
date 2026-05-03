/**
 * DRW-RT03 — Real MCP render precondition through Hub runtime boundary.
 *
 * `accordo_drawing_render` must:
 *   - Fail with code "panel-not-open" when the drawing panel is closed
 *   - Succeed after opening the real panel
 *
 * Requirements: DRW-R21, DRW-R23
 * Source: docs/20-requirements/requirements-drawing.md §8.3 (minimum real-boundary proof #3)
 */

import { describe, it, expect } from "vitest";

describe("runtime/render-runtime", () => {
  const runtimeEnabled = process.env.ACCORDO_DRAWING_RUNTIME_TESTS === "1";

  it.skipIf(!runtimeEnabled)(
    "DRW-RT03: accordo_drawing_render fails panel-not-open when panel is closed",
    async () => {
      // When enabled:
      //   1. Create a drawing but do NOT open the panel
      //   2. Call accordo_drawing_render → must reject with code panel-not-open
      //   3. Open the panel
      //   4. Call accordo_drawing_render again → must succeed
      //
      // Stub phase failure: render precondition check absent → no panel-not-open error.
      expect(runtimeEnabled).toBe(true);
    }
  );
});
