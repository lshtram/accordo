/**
 * Runtime Directives — Contract: Traceability Invariants
 * Requirements: requirements-runtime-directives.md XY-13
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog — canonical bundle structure [4 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic assertion-level tests
 * - All tests now run at assertion level (no stub-throw short-circuit)
 * - Validates bundle structure, clause fields, requirement coverage
 */

import { describe, it, expect } from "vitest";
import type { RuntimeDirectiveClause } from "@accordo/bridge-types";
import {
  MockRuntimeDirectiveCatalog,
  CANONICAL_CLAUSES,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

// ── Validators ─────────────────────────────────────────────────────────────────

function expectValidClause(clause: RuntimeDirectiveClause): void {
  expect(clause).toHaveProperty("id");
  expect(typeof clause.id).toBe("string");
  expect(clause.id.length).toBeGreaterThan(0);

  expect(clause).toHaveProperty("summary");
  expect(typeof clause.summary).toBe("string");
  expect(clause.summary.length).toBeGreaterThan(0);

  expect(clause).toHaveProperty("instruction");
  expect(typeof clause.instruction).toBe("string");
  expect(clause.instruction.length).toBeGreaterThan(0);

  expect(clause).toHaveProperty("requirementIds");
  expect(Array.isArray(clause.requirementIds)).toBe(true);

  expect(clause).toHaveProperty("parityTargets");
  expect(Array.isArray(clause.parityTargets)).toBe(true);
}

function expectValidCanonicalBundle(bundle: {
  version: string;
  digest: string;
  clauses: readonly RuntimeDirectiveClause[];
}): void {
  expect(bundle).toHaveProperty("version");
  expect(typeof bundle.version).toBe("string");
  expect(bundle.version.length).toBeGreaterThan(0);

  expect(bundle).toHaveProperty("digest");
  expect(typeof bundle.digest).toBe("string");
  expect(bundle.digest.length).toBeGreaterThan(0);

  expect(bundle).toHaveProperty("clauses");
  expect(Array.isArray(bundle.clauses)).toBe(true);
  expect(bundle.clauses.length).toBeGreaterThan(0);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MockRuntimeDirectiveCatalog — Canonical bundle contract (XY-13)", () => {
  const catalog = new MockRuntimeDirectiveCatalog();

  it("Y-11: getBundle returns valid structure with version, digest, clauses", () => {
    const bundle = catalog.getBundle();
    expectValidCanonicalBundle(bundle);
    expect(bundle.version).toBe(CANONICAL_BUNDLE_VERSION);
    expect(bundle.digest).toBe(CANONICAL_BUNDLE_DIGEST);
  });

  it("Y-11: Each clause has non-empty requirementIds", () => {
    const bundle = catalog.getBundle();
    for (const clause of bundle.clauses) {
      expectValidClause(clause);
      expect(clause.requirementIds.length).toBeGreaterThan(0);
    }
  });

  it("XY-13: All Priority X/Y requirements map to at least one clause", () => {
    const priorityXY = [
      "XY-01", "XY-02", "XY-03", "XY-04", "XY-05", "XY-06",
      "XY-07", "XY-08", "XY-09", "XY-10", "XY-11", "XY-12", "XY-13",
    ];
    const bundle = catalog.getBundle();
    const covered = new Set<string>();
    for (const clause of bundle.clauses) {
      for (const rid of clause.requirementIds) {
        if (rid.startsWith("XY-")) covered.add(rid);
      }
    }
    for (const req of priorityXY) {
      expect(covered.has(req)).toBe(true);
    }
  });

  it("Y-01: Exactly one canonical bundle source — no duplicate clause IDs", () => {
    const bundle = catalog.getBundle();
    expectValidCanonicalBundle(bundle);
    const ids = bundle.clauses.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Y-01: All parityTargets use canonical RuntimeDirectiveParityTarget values", () => {
    const validTargets = ["initialize", "instructions", "tool-description", "diagnostics"];
    const bundle = catalog.getBundle();
    for (const clause of bundle.clauses) {
      for (const target of clause.parityTargets) {
        expect(validTargets).toContain(target);
      }
    }
  });

  it("Y-01: Canonical bundle has expected clause count", () => {
    const bundle = catalog.getBundle();
    expect(bundle.clauses).toHaveLength(CANONICAL_CLAUSES.length);
  });
});
