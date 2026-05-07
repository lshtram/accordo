/**
 * DRW-B07, DRW-B08 — Fresh VS Code custom editor registration.
 *
 * Proves the drawing custom editor has a distinct viewType and selector
 * from accordo-diagram.diagramEditor.
 *
 * Tests read package.json contributes.customEditors and assert:
 *   - viewType is NOT accordo-diagram.diagramEditor
 *   - selector is NOT exactly the diagram editor selector (filenamePattern: "*.mmd")
 *
 * DRW-B07: drawing_custom_editor_viewtype_is_fresh
 * DRW-B08: drawing_custom_editor_selector_is_distinct
 *
 * Source: docs/20-requirements/requirements-drawing.md §1, §2
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Test file: packages/drawing/src/__tests__/extension-manifest.test.ts
// 3 parent dirs up → packages/drawing
const PKG_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");
const PKG_JSON_PATH = join(PKG_DIR, "package.json");

interface PackageJson {
  activationEvents?: string[];
  contributes?: {
    customEditors?: Array<{
      viewType: string;
      displayName: string;
      selector?: Array<{ filenamePattern?: string }>;
    }>;
    commands?: Array<{
      command: string;
      title: string;
    }>;
  };
}

async function readPkg(): Promise<PackageJson> {
  const content = await readFile(PKG_JSON_PATH, "utf8");
  return JSON.parse(content) as PackageJson;
}

describe("extension-manifest", () => {
  /**
   * DRW-B07 — drawing custom editor viewType is NOT the diagram editor viewType.
   * Fails if: viewType equals "accordo-diagram.diagramEditor"
   */
  it("DRW-B07: drawing_custom_editor_viewtype_is_fresh", async () => {
    const pkg = await readPkg();
    const editors = pkg.contributes?.customEditors ?? [];
    expect(editors.length).toBeGreaterThan(0);

    for (const editor of editors) {
      expect(editor.viewType).not.toBe("accordo-diagram.diagramEditor");
    }
  });

  /**
   * DRW-B08 — drawing custom editor selector is distinct from diagram editor.
   * The diagram editor uses filenamePattern: "*.mmd".
   * The drawing editor uses filenamePattern: "*.excalidraw".
   * Fails if: the drawing editor selector exactly matches "*.mmd"
   */
  it("DRW-B08: drawing_custom_editor_selector_is_distinct", async () => {
    const pkg = await readPkg();
    const editors = pkg.contributes?.customEditors ?? [];
    expect(editors.length).toBeGreaterThan(0);

    // The drawing editor targets .excalidraw files (paired with .mmd)
    // The diagram editor targets .mmd files.
    // They must NOT share the same selector.
    const diagramSelector = "*.mmd";
    for (const editor of editors) {
      const patterns = editor.selector ?? [];
      const hasMmdOnlySelector = patterns.some(
        (sel) => sel.filenamePattern === diagramSelector
      );
      expect(hasMmdOnlySelector).toBe(false);
    }
  });

  it("DRW-C07: manifest activates Drawing for compatibility focus command", async () => {
    const pkg = await readPkg();

    expect(pkg.activationEvents ?? []).toContain("onCommand:accordo_diagram_focusThread");
    expect((pkg.contributes?.commands ?? []).map((command) => command.command)).toContain(
      "accordo_diagram_focusThread",
    );
  });
});
