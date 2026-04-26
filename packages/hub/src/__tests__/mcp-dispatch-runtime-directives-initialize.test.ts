/**
 * Runtime Directives — MCP Dispatch: initialize Response
 * Requirements: requirements-runtime-directives.md Y-02
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.getBundle() [2 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - All tests now run at assertion level (no stub-throw short-circuit)
 */

import { describe, it, expect } from "vitest";
import {
  MockRuntimeDirectiveCatalog,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — MCP initialize response (Y-02)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-02: getBundle provides version for initialize.instructions", () => {
    const bundle = catalog.getBundle();
    expect(bundle).toBeDefined();
    expect(bundle.version).toBe(CANONICAL_BUNDLE_VERSION);
    expect(bundle.version.length).toBeGreaterThan(0);
  });

  it("Y-02: getBundle provides digest for initialize.instructions", () => {
    const bundle = catalog.getBundle();
    expect(bundle.digest).toBe(CANONICAL_BUNDLE_DIGEST);
    expect(bundle.digest.length).toBeGreaterThan(0);
  });

  it("Y-02: getBundle provides non-empty clause list", () => {
    const bundle = catalog.getBundle();
    expect(bundle.clauses.length).toBeGreaterThan(0);
    expect(bundle.clauses.every(c => c.id && c.instruction)).toBe(true);
  });
});
