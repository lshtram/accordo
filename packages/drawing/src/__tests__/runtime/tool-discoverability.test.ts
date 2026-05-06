/**
 * DRW-RT04 — Real MCP tool discoverability.
 *
 * `tools/list` from a connected MCP client must include all five drawing tools
 * and NOT include any diagram tools from accordo-diagram.
 *
 * Requirements: DRW-R26
 * Source: docs/20-requirements/requirements-drawing.md §8.3
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { activate } from "../../extension.js";

describe("runtime/tool-discoverability", () => {
  let registered: ExtensionToolDefinition[] = [];

  beforeEach(() => {
    registered = [];
    (vscode.workspace.workspaceFolders as unknown as Array<{ uri: { fsPath: string } }>) = [{ uri: { fsPath: "/tmp/workspace" } }];
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

  it(
    "DRW-RT04: tools/list includes all 5 accordo_drawing_* tools",
    async () => {
      const names = registered.map((tool) => tool.name);
      expect(names).toEqual([
        "accordo_drawing_create",
        "accordo_drawing_merge",
        "accordo_drawing_query",
        "accordo_drawing_patch",
        "accordo_drawing_render",
      ]);
      expect(names.some((name) => name.startsWith("accordo_diagram_"))).toBe(false);
    }
  );
});
