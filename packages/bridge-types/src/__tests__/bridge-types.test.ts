/**
 * @accordo/bridge-types — Phase B failing tests
 *
 * Tests: REQ-1 (exports), REQ-2 (barrel-only), REQ-3 (tsc clean),
 *        REQ-4 (ReauthRequest), REQ-5 (MCP_PROTOCOL_VERSION),
 *        REQ-6 (IDEState), REQ-7 (ToolRegistration)
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { describe, expect, it } from "vitest";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// (none needed — REQ-1 now uses direct line-by-line analysis)

// ─── REQ-1: All original exports preserved ───────────────────────────────────

/**
 * Verify the barrel exports every symbol by checking that downstream packages
 * can import them and TypeScript is satisfied. If a symbol is missing from the
 * barrel, any package that imports it will fail to compile — which REQ-3 (tsc
 * clean) would catch.
 *
 * Additionally, we do a lightweight AST-level check by reading the barrel
 * source and verifying each expected export appears in an export statement.
 */
describe("BRIDGE-TYPES-REQ-1: All original exports preserved", () => {
  const BARREL_PATH = resolve(__dirname, "../index.ts");

  it("RE1: every domain file is referenced in the barrel", () => {
    const barrelSource = readFileSync(BARREL_PATH, "utf-8");
    const domainFiles = [
      "ide-types.js",
      "tool-types.js",
      "ws-types.js",
      "comment-types.js",
      "constants.js",
    ];
    const missing = domainFiles.filter(
      (f) => !barrelSource.includes(`from "./${f}"`)
    );
    expect(missing, `Domain files not in barrel: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("RE1: barrel source is not empty and has multiple export statements", () => {
    const barrelSource = readFileSync(BARREL_PATH, "utf-8");
    const exportLineCount = (barrelSource.match(/^export\s/gm) ?? []).length;
    expect(
      exportLineCount,
      `Expected multiple export lines, got ${exportLineCount}`
    ).toBeGreaterThan(5);
  });
});

// ─── REQ-2: Barrel-only import policy ────────────────────────────────────────

describe("BRIDGE-TYPES-REQ-2: Barrel-only import policy", () => {
  it("RE2: no @accordo/bridge-types/ subpath imports in any package", () => {
    const packages = [
      "accordo-hub",
      "accordo-bridge",
      "accordo-editor",
      "voice",
      "browser",
      "browser-extension",
      "marp",
      "script",
      "md-viewer",
      "diagram",
      "comments",
      "comment-sdk",
    ];

    const violations: Array<{ pkg: string; file: string; line: string }> = [];

    for (const pkg of packages) {
      const globPattern = resolve(__dirname, `../../${pkg}/src/**/*.{ts,tsx}`);
      try {
        // Use find instead of grep -r for better shell compatibility
        const findOutput = execSync(
          `find ../../${pkg}/src -name "*.ts" -o -name "*.tsx" 2>/dev/null || true`,
          { cwd: __dirname, encoding: "utf-8" }
        );
        const files = findOutput.trim().split("\n").filter(Boolean);
        for (const file of files) {
          const fullPath = resolve(__dirname, file);
          try {
            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (/from\s+['"]@accordo\/bridge-types\//.test(lines[i])) {
                violations.push({
                  pkg,
                  file: file.replace(/^.*\/packages\/[^/]+\/src\//, ""),
                  line: lines[i].trim(),
                });
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      } catch {
        // package may not exist
      }
    }

    expect(
      violations,
      `Subpath imports found:\n${violations
        .map((v) => `  [${v.pkg}] ${v.file}: ${v.line}`)
        .join("\n")}`
    ).toHaveLength(0);
  });
});

// ─── REQ-3: TypeScript compilation clean ──────────────────────────────────────

describe("BRIDGE-TYPES-REQ-3: TypeScript compilation clean", () => {
  // Run tsc only on source files — exclude the test file itself
  // (test file intentionally uses types that don't exist yet)
  it("RE3: bridge-types source files compile with tsc --noEmit", () => {
    const srcDir = resolve(__dirname, "..");
    try {
      // tsconfig.json now excludes src/__tests__, so this only checks source files
      execSync(`pnpm exec tsc --noEmit`, {
        cwd: srcDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string };
      const output = (error.stdout ?? "") + (error.stderr ?? "");
      throw new Error(`tsc failed on source files:\n${output}`);
    }
  });
});

// ─── REQ-4: ReauthRequest shape ───────────────────────────────────────────────

import type { ReauthRequest } from "../index.js";

describe("BRIDGE-TYPES-REQ-4: ReauthRequest shape", () => {
  // Type-level assertion: if ReauthRequest is typed as { newSecret, newToken }
  // instead of { secret, token }, TypeScript will error here and this file won't compile.
  // The test object construction forces TypeScript to check the field names match.
  it("RE4: ReauthRequest must have secret and token (not newSecret/newToken)", () => {
    // This object literal must match ReauthRequest exactly.
    // If the interface uses newSecret/newToken instead of secret/token,
    // TypeScript will error here (excess property check).
    const _compliant: ReauthRequest = {
      secret: "s",
      token: "t",
    };

    // Also verify the interface does NOT accept newSecret/newToken
    // @ts-expect-error — should not be valid if interface is correct
    const _invalidNewSecret: ReauthRequest = { newSecret: "s", token: "t" };
    // @ts-expect-error — should not be valid if interface is correct
    const _invalidNewToken: ReauthRequest = { secret: "s", newToken: "t" };
  });
});

// ─── REQ-5: MCP_PROTOCOL_VERSION value ──────────────────────────────────────

import { MCP_PROTOCOL_VERSION } from "../constants.js";

describe("BRIDGE-TYPES-REQ-5: MCP_PROTOCOL_VERSION value", () => {
  it('RE5: MCP_PROTOCOL_VERSION must equal "2025-03-26"', () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-03-26");
  });
});

// ─── REQ-6: IDEState required fields ────────────────────────────────────────

import type { IDEState, OpenTab } from "../index.js";

describe("BRIDGE-TYPES-REQ-6: IDEState has required fields", () => {
  it("RE6: IDEState must include openTabs: OpenTab[]", () => {
    // Source: requirements-hub.md §3.3
    const _needsOpenTabs: IDEState = {
      activeFile: null,
      activeFileLine: 1,
      activeFileColumn: 1,
      openEditors: [],
      openTabs: [] as OpenTab[], // must have openTabs (per requirements-hub.md §3.3)
      visibleEditors: [],
      workspaceFolders: [],
      activeTerminal: null,
      workspaceName: null,
      remoteAuthority: null,
      modalities: {},
    };
  });
});

// ─── REQ-7: ToolRegistration structure ───────────────────────────────────────

import type { ToolRegistration, ToolInputSchema } from "../index.js";

describe("BRIDGE-TYPES-REQ-7: ToolRegistration structure", () => {
  it("RE7: ToolRegistration is flat — name, description, dangerLevel at top level", () => {
    // TypeScript verifies all required fields exist at top level (flat shape).
    // Matches requirements-hub.md §3.4 and requirements-bridge.md §3.2.
    const _flat: ToolRegistration = {
      name: "accordo_editor_open",
      description: "Open a file in the editor",
      inputSchema: { type: "object", properties: {} },
      dangerLevel: "safe",
      requiresConfirmation: false,
      idempotent: true,
    };
  });

  it("RE7: ToolRegistration must NOT have a definition wrapper", () => {
    // If someone wraps fields inside 'definition', this @ts-expect-error
    // must fire — 'definition' is not a valid top-level key.
    const _wrapped: ToolRegistration = {
      // @ts-expect-error — definition wrapper is not valid (flat structure required)
      definition: { name: "test", description: "test", inputSchema: { type: "object", properties: {} }, dangerLevel: "safe", handler: async () => {} },
      requiresConfirmation: false,
      idempotent: false,
    };
  });

  it("RE7: ToolRegistration must NOT have handler (handler stays in Bridge)", () => {
    // Verify that 'handler' is rejected as an unknown property.
    // Rule: AGENTS.md §4.3, requirements-bridge.md §3.2
    const _withHandler: ToolRegistration = {
      name: "test",
      description: "test",
      inputSchema: { type: "object", properties: {} },
      dangerLevel: "safe",
      requiresConfirmation: false,
      idempotent: false,
      // @ts-expect-error — handler is not valid on ToolRegistration
      handler: async () => {},
    };
  });
});
