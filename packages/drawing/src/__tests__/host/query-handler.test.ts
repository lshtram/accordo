/**
 * DRW-I10, DRW-I11 — queryDrawing tool handler tests.
 *
 * DRW-I10: query_returns_counts_without_mutating
 * DRW-I11: query_reports_scene_invalid_when_parse_fails
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.3 (DRW-R19)
 * Requirements: DRW-R19, DRW-R22
 */

import { writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DrawingToolContext } from "../../../core/types.js";

let queryDrawing: (input: {
  path: string;
  includeOrphans?: boolean;
  includeElements?: boolean;
}, ctx: DrawingToolContext) => Promise<unknown>;
let createDrawing: (input: {
  path: string;
  content: string;
  force?: boolean;
  open?: boolean;
}, ctx: DrawingToolContext) => Promise<unknown>;

try {
  const m = await import("../../host/query-handler.js");
  queryDrawing = m.queryDrawing;
} catch {
  queryDrawing = async () => {
    throw new Error("not implemented");
  };
}

try {
  const m = await import("../../host/create-handler.js");
  createDrawing = m.createDrawing;
} catch {
  createDrawing = async () => {
    throw new Error("not implemented");
  };
}

let tmpDir: string;
let ctx: DrawingToolContext;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-query-"));
  ctx = { workspaceRoot: tmpDir, getPanel: () => undefined };
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

describe("host/query-handler", () => {
  /**
   * DRW-I10 — queryDrawing is non-mutating; calling twice returns identical counts.
   */
  it("DRW-I10: query_returns_counts_without_mutating", async () => {
    const mmdPath = join(tmpDir, "test.mmd");
    const excalidrawPath = join(tmpDir, "test.excalidraw");
    await writeFile(mmdPath, "flowchart TD\nA-->B\n", "utf8");
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

    const result1 = await queryDrawing(
      { path: mmdPath, includeOrphans: true },
      ctx
    ) as Record<string, unknown>;
    const result2 = await queryDrawing(
      { path: mmdPath, includeOrphans: true },
      ctx
    ) as Record<string, unknown>;

    expect(result1.counts).toEqual(result2.counts);
  });

  /**
   * DRW-I11 — Corrupting the .excalidraw file makes query return scene-invalid.
   */
  it("DRW-I11: query_reports_scene_invalid_when_parse_fails", async () => {
    const mmdPath = join(tmpDir, "test.mmd");
    const excalidrawPath = join(tmpDir, "test.excalidraw");
    await writeFile(mmdPath, "flowchart TD\nA-->B\n", "utf8");
    await writeFile(excalidrawPath, "not valid json at all {", "utf8");

    const result = await queryDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;

    expect(result.status).toBe("scene-invalid");
  });

  it("DRW-I12: query_reports_needs_merge_for_bootstrap_placeholder_scene", async () => {
    const mmdPath = join(tmpDir, "seeded.mmd");
    await createDrawing({ path: mmdPath, content: "flowchart TD\nA-->B\n" }, ctx);

    const result = await queryDrawing({ path: mmdPath }, ctx) as Record<string, unknown>;
    expect(result.status).toBe("needs-merge");
  });
});
