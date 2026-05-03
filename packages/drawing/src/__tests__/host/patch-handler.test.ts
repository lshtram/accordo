/**
 * DRW-I12, DRW-I13 — patchDrawing tool handler tests.
 *
 * DRW-I12: patch_replaces_source_then_merges
 * DRW-I13: patch_response_includes_patched_true
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.4 (DRW-R20)
 * Requirements: DRW-R20
 */

import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DrawingToolContext } from "../../../core/types.js";

let patchDrawing: (input: {
  path: string;
  content: string;
}, ctx: DrawingToolContext) => Promise<unknown>;

try {
  const m = await import("../../host/patch-handler.js");
  patchDrawing = m.patchDrawing;
} catch {
  patchDrawing = async () => {
    throw new Error("not implemented");
  };
}

let tmpDir: string;
let ctx: DrawingToolContext;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-patch-"));
  ctx = { workspaceRoot: tmpDir, getPanel: () => undefined };
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

async function seedDrawing(mmdContent = "flowchart TD\nA-->B\n") {
  const mmdPath = join(tmpDir, "test.mmd");
  const excalidrawPath = join(tmpDir, "test.excalidraw");
  await writeFile(mmdPath, mmdContent, "utf8");
  await writeFile(
    excalidrawPath,
    JSON.stringify({
      elements: [
        {
          id: "el-A",
          type: "rectangle",
          x: 100,
          y: 100,
          width: 100,
          height: 40,
          customData: {
            accordo: {
              version: 1,
              entityKind: "node",
              identity: "A",
              sceneRole: "primary",
              sourcePath: "test.mmd",
              status: "active",
            },
          },
        },
      ],
      version: 2,
    }),
    "utf8"
  );
  return mmdPath;
}

describe("host/patch-handler", () => {
  /**
   * DRW-I12 — patchDrawing persists new .mmd content then returns merge report.
   */
  it("DRW-I12: patch_replaces_source_then_merges", async () => {
    const mmdPath = await seedDrawing();
    const newContent = "flowchart TD\nA-->B\nC-->D\n";

    const result = await patchDrawing({ path: mmdPath, content: newContent }, ctx) as Record<string, unknown>;

    const savedContent = await readFile(mmdPath, "utf8");
    expect(savedContent).toBe(newContent);
    expect(result.merged).toBe(true);
    expect(result.counts).toBeDefined();
  });

  /**
   * DRW-I13 — patchDrawing response includes patched: true.
   */
  it("DRW-I13: patch_response_includes_patched_true", async () => {
    const mmdPath = await seedDrawing();

    const result = await patchDrawing(
      { path: mmdPath, content: "flowchart TD\nA-->B\nC\n" },
      ctx
    ) as Record<string, unknown>;

    expect(result.patched).toBe(true);
    expect(result.placementEngine).toBeDefined();
  });
});
