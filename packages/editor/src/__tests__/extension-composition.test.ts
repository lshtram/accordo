/**
 * extension.test.ts — Part 2 of 4
 * Req: E2E-VCG-09 (tool-count composition) + M76-VCGM-01/02 (removal cycle)
 *
 * M76-VCGM removal:
 *   editorTools: 6
 *   layoutTools (base): was 5, now 0 (retired; panelToggle, zen, fullscreen, join, even removed)
 *   bar tools: +1 (layout_panel — replaces panelToggle)
 *   layoutState added by factory (+1)
 * New totals:
 *   editorTools: 6
 *   terminalTools: 5
 *   terminalReadTools: 1
 *   vscodeCommandTools: 2
 *   createLayoutTools: 0 (layoutTools base) + 1 (bar) + 1 (state) = 2
 *   allTools: 6 + 5 + 1 + 2 + 2 = 16
 */

import { describe, expect, it } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { editorTools } from "../tools/editor.js";
import { terminalTools } from "../tools/terminal.js";
import { terminalReadTools } from "../tools/terminal-read/index.js";
import { createLayoutTools } from "../tools/layout.js";
import { vscodeCommandTools } from "../tools/vscode-command-tools.js";

describe("extension activate — tool composition", () => {
  // ── Test 3 ───────────────────────────────────────────────────────────────────

  it("keeps tool-count composition stable across editor + terminal + layout factories", () => {
    const state: IDEState = {
      activeFile: null, activeFileLine: 1, activeFileColumn: 1,
      openEditors: [], openTabs: [], visibleEditors: [],
      workspaceFolders: [], activeTerminal: null,
      workspaceName: null, remoteAuthority: null, modalities: {},
    };

    const allTools = [
      ...editorTools,
      ...terminalTools,
      ...terminalReadTools,
      ...vscodeCommandTools,
      ...createLayoutTools(() => state),
    ];

    // M76-VCGM-01/02 + Priority U: layoutTools base=0, state=1, bar=1
    // Total: 6 + 5 + 1 + 2 + 2 = 16
    expect(editorTools).toHaveLength(6);
    expect(terminalTools).toHaveLength(5);
    expect(terminalReadTools).toHaveLength(1);
    expect(vscodeCommandTools).toHaveLength(2);
    expect(createLayoutTools(() => state)).toHaveLength(2);
    expect(allTools).toHaveLength(16);
  });
});
