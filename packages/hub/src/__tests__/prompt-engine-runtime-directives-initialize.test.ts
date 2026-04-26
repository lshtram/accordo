/**
 * Runtime Directives — Prompt Engine: initialize rendering
 * Requirements: requirements-runtime-directives.md Y-02
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.renderInstructions() [2 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - All tests now run at assertion level (no stub-throw short-circuit)
 */

import { describe, it, expect } from "vitest";
import {
  MockRuntimeDirectiveCatalog,
  FIXTURE_IDE_STATE,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — Runtime Directives in initialize prompt (Y-02)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-02: renderInstructions includes ## Runtime Directives section", () => {
    const rendered = catalog.renderInstructions(FIXTURE_IDE_STATE, []);
    expect(rendered).toContain("## Runtime Directives");
  });

  it("Y-02: renderInstructions includes version and digest metadata", () => {
    const rendered = catalog.renderInstructions(FIXTURE_IDE_STATE, []);
    expect(rendered).toContain(`version: ${CANONICAL_BUNDLE_VERSION}`);
    expect(rendered).toContain(`digest: ${CANONICAL_BUNDLE_DIGEST}`);
  });
});
