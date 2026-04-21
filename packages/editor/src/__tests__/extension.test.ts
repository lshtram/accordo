import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { activate } from "../extension.js";
import { editorTools } from "../tools/editor.js";
import { terminalTools } from "../tools/terminal.js";
import { createLayoutTools } from "../tools/layout.js";
import * as vscodeMock from "./mocks/vscode.js";

describe("extension activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.mockState.workspaceFolders = [];
    vscodeMock.mockState.terminals = [];
    vscodeMock.mockState.activeTerminal = null;
  });

  it("is inert when bridge extension is missing", async () => {
    const context = new vscodeMock.ExtensionContext();
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue(undefined);

    await activate(context as never);

    expect(vscodeMock.extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
    expect(vscodeMock.commands.registerCommand).not.toHaveBeenCalled();
    expect(context.subscriptions).toHaveLength(1); // terminal lifecycle listener
  });

  it("registers all tools and command shims when bridge is available", async () => {
    const context = new vscodeMock.ExtensionContext();
    const bridgeDisposable = { dispose: vi.fn() };
    const state: IDEState = {
      activeFile: null,
      activeFileLine: 1,
      activeFileColumn: 1,
      openEditors: [],
      openTabs: [],
      visibleEditors: [],
      workspaceFolders: [],
      activeTerminal: null,
      workspaceName: null,
      remoteAuthority: null,
      modalities: {},
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
    expect(registeredTools).toHaveLength(23);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledTimes(23);
    expect(context.subscriptions).toHaveLength(25);
  });

  it("keeps tool-count composition stable across editor + terminal + layout factories", () => {
    const state: IDEState = {
      activeFile: null,
      activeFileLine: 1,
      activeFileColumn: 1,
      openEditors: [],
      openTabs: [],
      visibleEditors: [],
      workspaceFolders: [],
      activeTerminal: null,
      workspaceName: null,
      remoteAuthority: null,
      modalities: {},
    };

    const allTools = [
      ...editorTools,
      ...terminalTools,
      ...createLayoutTools(() => state),
    ];

    expect(editorTools).toHaveLength(11);
    expect(terminalTools).toHaveLength(5);
    expect(createLayoutTools(() => state)).toHaveLength(7);
    expect(allTools).toHaveLength(23);
  });
});
