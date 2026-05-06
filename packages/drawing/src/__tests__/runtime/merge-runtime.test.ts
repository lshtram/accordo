/**
 * DRW-RT02 — Real MCP merge through Hub runtime boundary.
 *
 * `accordo_drawing_merge` must succeed through the real MCP stack and use
 * `placementEngine: "accordo"` for additions into an existing drawing.
 *
 * Requirements: DRW-R18, DRW-R11
 * Source: docs/20-requirements/requirements-drawing.md §8.3 (minimum real-boundary proof #2)
 */

import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { activate } from "../../extension.js";

describe("runtime/merge-runtime", () => {
  let tmpDir: string;
  let registered: ExtensionToolDefinition[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drw-runtime-merge-"));
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
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it(
    "DRW-RT02: accordo_drawing_merge returns placementEngine: accordo for existing scene",
    async () => {
      expect(registered).toHaveLength(5);
      const merge = registered.find((tool) => tool.name === "accordo_drawing_merge")!;
      const path = join(tmpDir, "runtime-merge.mmd");
      const scenePath = path.replace(/\.mmd$/i, ".excalidraw");
      await writeFile(path, "flowchart TD\nA-->B\n", "utf8");
      await writeFile(scenePath, JSON.stringify({
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
                sourcePath: "runtime-merge.mmd",
                status: "active",
              },
            },
          },
        ],
        version: 2,
      }), "utf8");

      const result = await merge.handler({ path, content: "flowchart TD\nA-->B\nC-->D\n" }) as { placementEngine: string };
      expect(result.placementEngine).toBe("accordo");
    }
  );
});
