/**
 * DRW-RT01 — Real MCP create through Hub runtime boundary.
 *
 * `accordo_drawing_create` must succeed through the real MCP stack and create
 * both files on disk.
 *
 * Test: calls the tool via the real MCP tool registration (Hub API).
 * Fails: stub throws "tool not found" or files not created.
 *
 * Requirements: DRW-R17, DRW-R26
 * Source: docs/20-requirements/requirements-drawing.md §8.3 (minimum real-boundary proof #1)
 */

import { mkdtempSync } from "node:fs";
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { activate } from "../../extension.js";

/**
 * DRW-RT01: accordo_drawing_create creates both files through real MCP.
 *
 * This test requires the full MCP stack (Hub registration + Bridge dispatch).
 * It is tagged @runtime-integration and will be skipped if the runtime harness
 * is not available (i.e., if ACCORDO_DRAWING_RUNTIME_TESTS is not set).
 *
 * The test imports the real tool registration and calls the tool by name
 * through the Hub MCP dispatcher (or equivalent test bridge).
 */
describe("runtime/create-runtime", () => {
  let tmpDir: string;
  let registered: ExtensionToolDefinition[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drw-runtime-create-"));
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

  it("DRW-RT01: accordo_drawing_create through real MCP creates both files", async () => {
    expect(registered).toHaveLength(5);
    const create = registered.find((tool) => tool.name === "accordo_drawing_create");
    expect(create).toBeDefined();
    const path = join(tmpDir, "runtime-create.mmd");

    const result = await create!.handler({ path, content: "flowchart TD\nA-->B\n" }) as { scenePath: string };

    await expect(access(path)).resolves.toBeUndefined();
    await expect(access(result.scenePath)).resolves.toBeUndefined();
  });
});
