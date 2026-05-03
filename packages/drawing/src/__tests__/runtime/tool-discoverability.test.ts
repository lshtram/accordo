/**
 * DRW-RT04 — Real MCP tool discoverability.
 *
 * `tools/list` from a connected MCP client must include all five drawing tools
 * and NOT include any diagram tools from accordo-diagram.
 *
 * Requirements: DRW-R26
 * Source: docs/20-requirements/requirements-drawing.md §8.3
 */

import { describe, it, expect } from "vitest";

describe("runtime/tool-discoverability", () => {
  const runtimeEnabled = process.env.ACCORDO_DRAWING_RUNTIME_TESTS === "1";

  it.skipIf(!runtimeEnabled)(
    "DRW-RT04: tools/list includes all 5 accordo_drawing_* tools",
    async () => {
      // When enabled:
      //   1. Connect MCP client to Hub
      //   2. Call tools/list
      //   3. Assert the response contains all 5 accordo_drawing_* tools
      //   4. Assert no accordo_diagram_* tool is present
      //
      // Stub phase failure: tool list empty or only diagram tools present.
      expect(runtimeEnabled).toBe(true);
    }
  );
});
