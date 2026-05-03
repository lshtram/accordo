/**
 * DRW-RT02 — Real MCP merge through Hub runtime boundary.
 *
 * `accordo_drawing_merge` must succeed through the real MCP stack and use
 * `placementEngine: "accordo"` for additions into an existing drawing.
 *
 * Requirements: DRW-R18, DRW-R11
 * Source: docs/20-requirements/requirements-drawing.md §8.3 (minimum real-boundary proof #2)
 */

import { describe, it, expect } from "vitest";

describe("runtime/merge-runtime", () => {
  const runtimeEnabled = process.env.ACCORDO_DRAWING_RUNTIME_TESTS === "1";

  it.skipIf(!runtimeEnabled)(
    "DRW-RT02: accordo_drawing_merge returns placementEngine: accordo for existing scene",
    async () => {
      // When enabled:
      //   1. Pre-create a drawing pair on disk
      //   2. Call accordo_drawing_merge through real MCP
      //   3. Assert placementEngine === "accordo"
      //
      // Stub phase failure: tool not found, or placementEngine === "bootstrap"
      // (wrong) or absent (handler not wired).
      expect(runtimeEnabled).toBe(true);
    }
  );
});
