/**
 * Runtime Directives — Contract: Type Import and Structural Shape
 * Requirements: requirements-runtime-directives.md Y-01, Y-06
 *
 * API checklist:
 *   StubRuntimeDirectiveCatalog — structural [1 test]
 *   Exported contract types — compile-time [1 test]
 */

import { describe, it, expect } from "vitest";
import type {
  RuntimeDirectiveBundle,
  RuntimeDirectivePublication,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectiveCatalog,
  RuntimeDirectiveClause,
  RuntimeDirectiveOwnership,
} from "@accordo/bridge-types";
import { StubRuntimeDirectiveCatalog } from "../runtime-directives.js";

describe("StubRuntimeDirectiveCatalog — structural shape (Y-01)", () => {
  it("Y-01: StubRuntimeDirectiveCatalog implements all RuntimeDirectiveCatalog methods", () => {
    const catalog = new StubRuntimeDirectiveCatalog();
    expect(catalog).toBeDefined();
    expect(typeof catalog.getBundle).toBe("function");
    expect(typeof catalog.getPublication).toBe("function");
    expect(typeof catalog.renderInstructions).toBe("function");
    expect(typeof catalog.recordReceipt).toBe("function");
    expect(typeof catalog.validateParity).toBe("function");
    expect(typeof catalog.getDiagnostics).toBe("function");
  });
});

describe("Exported contract types — compile-time (Y-06)", () => {
  it("Y-06: All RuntimeDirective* types import cleanly from @accordo/bridge-types", () => {
    // Compile-time check — if these pass, types are exported correctly.
    const _bundle: RuntimeDirectiveBundle = null as unknown as RuntimeDirectiveBundle;
    const _publication: RuntimeDirectivePublication = null as unknown as RuntimeDirectivePublication;
    const _diagnostics: RuntimeDirectiveDiagnostics = null as unknown as RuntimeDirectiveDiagnostics;
    const _catalog: RuntimeDirectiveCatalog = null as unknown as RuntimeDirectiveCatalog;
    const _clause: RuntimeDirectiveClause = null as unknown as RuntimeDirectiveClause;
    const _ownership: RuntimeDirectiveOwnership = null as unknown as RuntimeDirectiveOwnership;
    expect(true).toBe(true);
  });
});
