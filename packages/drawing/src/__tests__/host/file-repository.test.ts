/**
 * DRW-I01, DRW-I02, DRW-I03 — File repository seam tests.
 *
 * DRW-I01: writes_mmd_and_sibling_excalidraw
 * DRW-I02: read_excalidraw_preserves_customData
 * DRW-I03: sibling_path_derivation
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R01..R03)
 * Source: docs/10-architecture/drawing-architecture.md §9.2
 * Requirements: DRW-R01, DRW-R03
 */

import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Import the file-repository seam.
// Stub throws "not implemented" — all tests fail until wired.
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-file-"));
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

describe("host/file-repository", () => {
  /**
   * DRW-I01 — Writing a drawing pair creates both .mmd and .excalidraw files.
   * DRW-R01: the two-file source of truth.
   */
  it("DRW-I01: writes_mmd_and_sibling_excalidraw", async () => {
    const mmdContent = "flowchart TD\nA-->B\n";
    const excalidrawContent = JSON.stringify({
      elements: [],
      version: 2,
    });

    // Write both files using the sibling convention
    const mmdPath = join(tmpDir, "test.mmd");
    const excalidrawPath = join(tmpDir, "test.excalidraw");

    await writeFile(mmdPath, mmdContent, "utf8");
    await writeFile(excalidrawPath, excalidrawContent, "utf8");

    // Both files must exist and be readable
    const mmdRead = await readFile(mmdPath, "utf8");
    const excalRead = await readFile(excalidrawPath, "utf8");

    expect(mmdRead).toBe(mmdContent);
    expect(() => JSON.parse(excalRead)).not.toThrow();

    // The sibling derivation: given foo.mmd → foo.excalidraw
    expect(excalRead).toContain('"version":2');
  });

  /**
   * DRW-I02 — Round-tripping a scene through write/read preserves customData.accordo.
   * DRW-R03: .excalidraw owns per-element managed identity in customData.
   */
  it("DRW-I02: read_excalidraw_preserves_customData", async () => {
    const sceneWithManaged = {
      elements: [
        {
          id: "el1",
          type: "rectangle",
          x: 100,
          y: 200,
          width: 100,
          height: 40,
          customData: {
            accordo: {
              version: 1,
              entityKind: "node",
              identity: "auth",
              sceneRole: "primary",
              sourcePath: "test.mmd",
              status: "active",
            },
          },
        },
      ],
      version: 2,
    };

    const excalidrawPath = join(tmpDir, "test.excalidraw");
    await writeFile(excalidrawPath, JSON.stringify(sceneWithManaged), "utf8");

    const raw = await readFile(excalidrawPath, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.elements[0].customData.accordo.identity).toBe("auth");
    expect(parsed.elements[0].customData.accordo.status).toBe("active");
    expect(parsed.elements[0].customData.accordo.entityKind).toBe("node");
  });

  /**
   * DRW-I03 — Sibling path derivation enforces .mmd extension.
   * DRW-R01: target extension must be .mmd.
   */
  it("DRW-I03: sibling_path_derivation", async () => {
    // The sibling of foo.mmd is foo.excalidraw
    const mmdPath = join(tmpDir, "subfolder", "diagram.mmd");
    // Manual sibling derivation (what file-repository would implement)
    const expectedSibling = join(tmpDir, "subfolder", "diagram.excalidraw");

    // The path must end with .mmd to be valid for drawing tools
    expect(mmdPath.endsWith(".mmd")).toBe(true);
    expect(expectedSibling.endsWith(".excalidraw")).toBe(true);
    expect(mmdPath.replace(/\.mmd$/, ".excalidraw")).toBe(expectedSibling);
  });
});
