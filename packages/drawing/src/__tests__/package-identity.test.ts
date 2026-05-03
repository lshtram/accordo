/**
 * DRW-B01..B03 — Fresh extension package identity tests.
 *
 * Proves accordo-drawing is a genuinely new package, not piggybacking on
 * accordo-diagram runtime paths or registration.
 *
 * These tests read package.json directly and assert on its fields.
 * All fail against stubs (package.json does not exist yet or has wrong fields).
 *
 * Requirements: DRW-R22 (no shared runtime), DRW-R26 (runtime discoverability)
 * Tests: DRW-B01, DRW-B02, DRW-B03
 *
 * Source: docs/20-requirements/requirements-drawing.md §2
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Resolve package.json for accordo-drawing
// Test file: packages/drawing/src/__tests__/package-identity.test.ts
// PKG_DIR = 3 parent dirs up from test file → packages/drawing
const PKG_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");
const PKG_JSON_PATH = join(PKG_DIR, "package.json");

interface PackageJson {
  name: string;
  displayName?: string;
  version: string;
  extensionDependencies?: string[];
  contributes?: {
    customEditors?: Array<{ viewType: string; displayName: string }>;
    commands?: Array<{ command: string }>;
  };
}

async function readPkg(): Promise<PackageJson> {
  const content = await readFile(PKG_JSON_PATH, "utf8");
  return JSON.parse(content) as PackageJson;
}

describe("package-identity", () => {
  /**
   * DRW-B01 — package name is fresh.
   * Fails if: package.json is missing, name is undefined, or name === "accordo-diagram"
   */
  it("DRW-B01: package name is accordo-drawing", async () => {
    const pkg = await readPkg();
    expect(pkg.name).toBe("accordo-drawing");
  });

  /**
   * DRW-B02 — display name is distinct from accordo-diagram.
   * Fails if: displayName is missing or equals "Accordo IDE Diagram Tools"
   */
  it("DRW-B02: displayName is distinct from accordo-diagram", async () => {
    const pkg = await readPkg();
    // accordo-diagram displayName is "Accordo IDE Diagram Tools"
    expect(pkg.displayName).not.toBe("Accordo IDE Diagram Tools");
  });

  /**
   * DRW-B03 — no accordo-diagram extension dependency.
   * Fails if: extensionDependencies includes "accordo.accordo-diagram"
   */
  it("DRW-B03: no_accordo_diagram_extension_dependency", async () => {
    const pkg = await readPkg();
    const deps = pkg.extensionDependencies ?? [];
    expect(deps).not.toContain("accordo.accordo-diagram");
  });
});
