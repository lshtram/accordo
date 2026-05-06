/**
 * DRW-I04, DRW-I05, DRW-I06 — createDrawing tool handler tests.
 *
 * DRW-I04: create_handler_writes_both_files
 * DRW-I05: create_response_shape
 * DRW-I06: create_validates_flowchart_only
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.1 (DRW-R17)
 * Requirements: DRW-R17, DRW-R23
 */

import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DrawingToolContext } from "../../../core/types.js";

// Dynamic import of the handler — throws if not yet implemented
let createDrawing: (input: {
  path: string;
  content: string;
  force?: boolean;
  open?: boolean;
}, ctx: DrawingToolContext) => Promise<unknown>;

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
  tmpDir = mkdtempSync(join(tmpdir(), "drw-create-"));
  ctx = {
    workspaceRoot: tmpDir,
    getPanel: () => undefined,
  };
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

describe("host/create-handler", () => {
  /**
   * DRW-I04 — createDrawing writes both .mmd and creates sibling .excalidraw.
   */
  it("DRW-I04: create_handler_writes_both_files", async () => {
    const path = join(tmpDir, "new drawing.mmd");
    const content = "flowchart TD\nA-->B\n";

    const result = await createDrawing({ path, content }, ctx) as Record<string, unknown>;

    expect(result.created).toBe(true);

    // Both files must exist
    const mmdExists = await import("node:fs/promises").then(({ access }) =>
      access(path).then(() => true).catch(() => false)
    );
    const scenePath = result.scenePath as string;
    const sceneExists = await import("node:fs/promises").then(({ access }) =>
      access(scenePath).then(() => true).catch(() => false)
    );

    expect(mmdExists).toBe(true);
    expect(sceneExists).toBe(true);

    const sceneJson = JSON.parse(await readFile(scenePath, "utf8")) as {
      elements?: Array<unknown>;
      accordoSource?: { kind?: string; content?: string; sourcePath?: string };
    };
    expect(Array.isArray(sceneJson.elements)).toBe(true);
    expect(sceneJson.elements).toHaveLength(0);
    expect(sceneJson.accordoSource?.kind).toBe("mermaid");
    expect(sceneJson.accordoSource?.content).toBe(content);
    expect(sceneJson.accordoSource?.sourcePath).toBe("new drawing.mmd");
  });

  /**
   * DRW-I05 — createDrawing response shape includes all required fields.
   */
  it("DRW-I05: create_response_shape", async () => {
    const path = join(tmpDir, "test.mmd");
    const content = "flowchart TD\nA-->B\n";

    const result = await createDrawing({ path, content }, ctx) as Record<string, unknown>;

    expect(result.created).toBe(true);
    expect(typeof result.path).toBe("string");
    expect(typeof result.scenePath).toBe("string");
    expect(["mermaid-to-excalidraw", "empty"]).toContain(result.bootstrapEngine);
    expect(typeof result.opened).toBe("boolean");
  });

  /**
   * DRW-I06 — Non-flowchart Mermaid returns unsupported-diagram-type error.
   * DRW-R23: tool-specific preconditions; create validates supported type.
   */
  it("DRW-I06: create_validates_flowchart_only", async () => {
    const path = join(tmpDir, "test.mmd");
    const content = "stateDiagram-v2\n[*]-->State1\n";

    await expect(
      createDrawing({ path, content }, ctx)
    ).rejects.toThrow();
  });

  it("DRW-I12: create_force_false_throws_already_exists", async () => {
    const path = join(tmpDir, "existing.mmd");
    const content = "flowchart TD\nA-->B\n";
    await createDrawing({ path, content }, ctx);

    await expect(createDrawing({ path, content, force: false }, ctx)).rejects.toMatchObject({ code: "already-exists" });
  });

  it("DRW-I13: create_rejects_path_outside_workspace_after_normalization", async () => {
    const path = join(tmpDir, "..", "outside.mmd");
    await expect(createDrawing({ path, content: "flowchart TD\nA-->B\n" }, ctx)).rejects.toMatchObject({ code: "path-outside-workspace" });
  });

  it("DRW-I16: create_persists_workspace_relative_source_path", async () => {
    const path = join(tmpDir, "nested", "graph.mmd");
    const content = "flowchart TD\nA-->B\n";
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(tmpDir, "nested"), { recursive: true }));
    const result = await createDrawing({ path, content }, ctx) as Record<string, unknown>;
    const scene = JSON.parse(await readFile(String(result.scenePath), "utf8")) as {
      accordoSource?: { sourcePath?: string };
    };

    expect(scene.accordoSource?.sourcePath).toBe("nested/graph.mmd");
  });
});
