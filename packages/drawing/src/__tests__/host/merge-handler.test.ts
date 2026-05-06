/**
 * DRW-I07, DRW-I08, DRW-I09 — mergeDrawing tool handler tests.
 *
 * DRW-I07: merge_reads_both_files_and_reports_counts
 * DRW-I08: merge_with_content_replaces_mmd_first
 * DRW-I09: merge_uses_accordo_placement_engine_for_existing_scene
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.2 (DRW-R18)
 * Requirements: DRW-R18, DRW-R11, DRW-R23
 */

import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DrawingToolContext } from "../../../core/types.js";

let mergeDrawing: (input: {
  path: string;
  content?: string;
  open?: boolean;
}, ctx: DrawingToolContext) => Promise<unknown>;

try {
  const m = await import("../../host/merge-handler.js");
  mergeDrawing = m.mergeDrawing;
} catch {
  mergeDrawing = async () => {
    throw new Error("not implemented");
  };
}

let tmpDir: string;
let ctx: DrawingToolContext;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-merge-"));
  ctx = { workspaceRoot: tmpDir, getPanel: () => undefined };
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

/** Seed a valid drawing pair on disk. */
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
  return { mmdPath, excalidrawPath };
}

describe("host/merge-handler", () => {
  /**
   * DRW-I07 — mergeDrawing reads both files and returns counts for each category.
   */
  it("DRW-I07: merge_reads_both_files_and_reports_counts", async () => {
    const { mmdPath } = await seedDrawing();

    const result = await mergeDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;

    expect(result.merged).toBe(true);
    expect(result.counts).toBeDefined();
    const counts = result.counts as Record<string, number>;
    expect(typeof counts.preserved).toBe("number");
    expect(typeof counts.added).toBe("number");
    expect(typeof counts.updated).toBe("number");
    expect(typeof counts.removed).toBe("number");
    expect(typeof counts.orphaned).toBe("number");
  });

  /**
   * DRW-I08 — Passing content replaces .mmd before merge.
   */
  it("DRW-I08: merge_with_content_replaces_mmd_first", async () => {
    const { mmdPath } = await seedDrawing();
    const newContent = "flowchart TD\nA-->B\nC-->D\n";

    const result = await mergeDrawing(
      { path: mmdPath, content: newContent },
      ctx
    ) as Record<string, unknown>;

    const savedContent = await readFile(mmdPath, "utf8");
    expect(savedContent).toBe(newContent);
    expect(result.merged).toBe(true);
  });

  /**
   * DRW-I09 — Merge into an existing scene uses placementEngine: "accordo".
   * DRW-R11: additions into existing drawings use Accordo placement.
   */
  it("DRW-I09: merge_uses_accordo_placement_engine_for_existing_scene", async () => {
    const { mmdPath } = await seedDrawing();
    // Add a new node C to trigger incremental addition
    await writeFile(mmdPath, "flowchart TD\nA-->B\nC-->D\n", "utf8");

    const result = await mergeDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;

    expect(result.placementEngine).toBe("accordo");
  });

  it("DRW-I14: merge_uses_bootstrap_when_sibling_scene_missing", async () => {
    const mmdPath = join(tmpDir, "missing-scene.mmd");
    await writeFile(mmdPath, "flowchart TD\nA-->B\n", "utf8");

    const result = await mergeDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;
    expect(result.placementEngine).toBe("bootstrap");
  });

  it("DRW-I15: merge_uses_bootstrap_when_no_active_managed", async () => {
    const mmdPath = join(tmpDir, "zero-active.mmd");
    const excalidrawPath = join(tmpDir, "zero-active.excalidraw");
    await writeFile(mmdPath, "flowchart TD\nA-->B\n", "utf8");
    await writeFile(excalidrawPath, JSON.stringify({ elements: [], version: 2 }), "utf8");

    const result = await mergeDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;
    expect(result.placementEngine).toBe("bootstrap");
  });
});
