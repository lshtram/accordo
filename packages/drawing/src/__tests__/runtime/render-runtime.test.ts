/**
 * DRW-RT03 — Real MCP render precondition through Hub runtime boundary.
 *
 * `accordo_drawing_render` must:
 *   - Fail with code "panel-not-open" when the drawing panel is closed
 *   - Succeed after opening the real panel
 *
 * Requirements: DRW-R21, DRW-R23
 * Source: docs/20-requirements/requirements-drawing.md §8.3 (minimum real-boundary proof #3)
 */

import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { DrawingPanelLike } from "../../core/types.js";
import { activate } from "../../extension.js";

describe("runtime/render-runtime", () => {
  let tmpDir: string;
  let panelRegistry: Map<string, DrawingPanelLike>;
  let registered: ExtensionToolDefinition[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drw-runtime-render-"));
    panelRegistry = new Map<string, DrawingPanelLike>();
    registered = [];
    (vscode.workspace.workspaceFolders as unknown as Array<{ uri: { fsPath: string } }>) = [{ uri: { fsPath: tmpDir } }];
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue({
      exports: {
        registerTools: (_id: string, tools: ExtensionToolDefinition[]) => {
          registered = tools;
          return { dispose() {} };
        },
      },
    });
    activate({ subscriptions: [] } as never);
    const registry = (globalThis as { __accordoDrawingPanels?: Map<string, DrawingPanelLike> }).__accordoDrawingPanels;
    expect(registry).toBeDefined();
    panelRegistry = registry!;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it(
    "DRW-RT03: accordo_drawing_render fails panel-not-open when panel is closed",
    async () => {
      const mmdPath = join(tmpDir, "runtime-render.mmd");
      await writeFile(mmdPath, "flowchart TD\nA-->B\n", "utf8");
      await writeFile(join(tmpDir, "runtime-render.excalidraw"), JSON.stringify({ elements: [], version: 2 }), "utf8");

      expect(registered).toHaveLength(5);
      const render = registered.find((tool) => tool.name === "accordo_drawing_render")!;

      await expect(render.handler({ path: mmdPath, format: "png" })).rejects.toMatchObject({ code: "panel-not-open" });

      panelRegistry.set(mmdPath, {
        mmdPath,
        requestExport: async () => Buffer.from("ok"),
      });
      const result = await render.handler({ path: mmdPath, format: "png" }) as { rendered: boolean };
      expect(result.rendered).toBe(true);
    }
  );
});
