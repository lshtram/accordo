/**
 * extension.test.ts — Part 2 of 4
 * Req: E2E-VCG-09 (tool-count composition) + M76-VCGM-01/02 (removal cycle)
 *
 * M76-VCGM removal:
 *   editorTools: was 11, now 6 (removed: split, reveal, save, saveAll, format)
 *   layoutTools (base): was 5, now 1 (removed: zen, fullscreen, join, even)
 *   layoutState added by factory (+1)
 *   bar tools: +? (see bar.ts)
 * New totals:
 *   editorTools: 6
 *   terminalTools: 5
 *   vscodeCommandTools: 2
 *   createLayoutTools: 1 (panelToggle) + bar + 1 (state) = 3
 *   allTools: 6 + 5 + 2 + 3 = 16
 */

import { describe, expect, it } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { editorTools } from "../tools/editor.js";
import { terminalTools } from "../tools/terminal.js";
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
      ...vscodeCommandTools,
      ...createLayoutTools(() => state),
    ];

    // M76-VCGM-01/02: editorTools=6 (was 11), layoutTools base=1 (was 5), state=1, bar=1
    // Total: 6 + 5 + 2 + 3 = 16
    expect(editorTools).toHaveLength(6);
    expect(terminalTools).toHaveLength(5);
    expect(vscodeCommandTools).toHaveLength(2);
    expect(createLayoutTools(() => state)).toHaveLength(3);
    expect(allTools).toHaveLength(16);
  });
});
