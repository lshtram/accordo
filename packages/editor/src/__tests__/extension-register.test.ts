/**
 * extension.test.ts — Part 1 of 4
 * Req: E2E-VCG-09 (registration contract)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { activate } from "../extension.js";
import { editorTools } from "../tools/editor.js";
import { terminalTools } from "../tools/terminal.js";
import { createLayoutTools } from "../tools/layout.js";
import { vscodeCommandTools } from "../tools/vscode-command-tools.js";
import * as vscodeMock from "./mocks/vscode.js";

describe("extension activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.mockState.workspaceFolders = [];
    vscodeMock.mockState.terminals = [];
    vscodeMock.mockState.activeTerminal = null;
  });

  // ── Test 1 ───────────────────────────────────────────────────────────────────

  it("is inert when bridge extension is missing", async () => {
    const context = new vscodeMock.ExtensionContext();
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue(undefined);

    await activate(context as never);

    expect(vscodeMock.extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
    expect(vscodeMock.commands.registerCommand).not.toHaveBeenCalled();
    expect(context.subscriptions).toHaveLength(1);
  });

  // ── Test 2 ───────────────────────────────────────────────────────────────────

  it("registers all tools and command shims when bridge is available", async () => {
    const context = new vscodeMock.ExtensionContext();
    const bridgeDisposable = { dispose: vi.fn() };
    const state: IDEState = {
      activeFile: null, activeFileLine: 1, activeFileColumn: 1,
      openEditors: [], openTabs: [], visibleEditors: [],
      workspaceFolders: [], activeTerminal: null,
      workspaceName: null, remoteAuthority: null, modalities: {},
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue(bridgeDisposable),
      getState: vi.fn().mockReturnValue(state),
    };
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);

    await activate(context as never);

    expect(bridge.registerTools).toHaveBeenCalledTimes(1);
    const [extensionId, registeredTools] = bridge.registerTools.mock.calls[0] as [string, unknown[]];
    expect(extensionId).toBe("accordo.accordo-editor");
    // M76-VCGM-01/02: editorTools (6) + terminalTools (5) + vscodeCommandTools (2) + layout (3) = 16
    expect(registeredTools).toHaveLength(16);
    // M76-VCGM-01/02: 16 tools → 16 command shims registered
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledTimes(16);
    // subscriptions: 1 (output channel) + 1 (terminal lifecycle) + 16 (tool shims) = 18
    expect(context.subscriptions).toHaveLength(18);
  });
});
