/**
 * A17 — Tests for extension.ts: activate / deactivate / panel registry.
 *
 * All VS Code APIs and DiagramPanel are mocked — these tests run in Node.js
 * via vitest with no VS Code extension host.
 *
 * Requirements tested:
 *   EX-01  activate() registers all 6 diagram tools with BridgeAPI
 *   EX-02  activate() registers the accordo-diagram.open command
 *   EX-03  activate() is a no-op (+ output channel warning) when Bridge is absent
 *   EX-04  accordo-diagram.open with a .mmd path opens DiagramPanel and registers it
 *   EX-05  accordo-diagram.open from active .mmd editor uses that file's path
 *   EX-06  accordo-diagram.open with no .mmd context shows a file-picker
 *   EX-07  getPanel(path) returns the registered panel for that path
 *   EX-08  getPanel(path) returns undefined when no panel is open for that path
 *   EX-09  disposing a panel removes it from the registry
 *   EX-10  deactivate() is a no-op
 *   EX-11  activate() calls publishState with empty openPanels on startup
 *   EX-12  publishState is called with the open panel path when a panel is opened
 *   EX-13  publishState is called with empty openPanels when the last panel is closed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────────

const mockRegisterCommand = vi.fn();
const mockOutputChannel = {
  appendLine: vi.fn(),
  dispose: vi.fn(),
};
const mockCreateOutputChannel = vi.fn(() => mockOutputChannel);
const mockShowOpenDialog = vi.fn();

let _activeTextEditorUri: string | undefined;
let _bridgeExports: unknown = undefined;

const mockExtensions = {
  getExtension: vi.fn((id: string) => {
    if (id === "accordo.accordo-bridge") {
      return _bridgeExports !== undefined
        ? { exports: _bridgeExports, isActive: true }
        : undefined;
    }
    return undefined;
  }),
};

const mockWorkspace = {
  workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
};

const mockWindow = {
  registerTreeDataProvider: vi.fn(),
  registerCustomEditorProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  createOutputChannel: mockCreateOutputChannel,
  showOpenDialog: mockShowOpenDialog,
  activeTextEditor: undefined as { document: { uri: { fsPath: string }; languageId: string } } | undefined,
};

vi.mock("vscode", () => ({
  commands: { registerCommand: mockRegisterCommand },
  window: mockWindow,
  workspace: mockWorkspace,
  extensions: mockExtensions,
  Uri: {
    file: (p: string) => ({ fsPath: p }),
  },
}));

// ── DiagramPanel mock ─────────────────────────────────────────────────────────

type PanelDisposedCallback = () => void;

function makePanel(mmdPath: string) {
  let onDisposedCb: PanelDisposedCallback | undefined;
  const panel = {
    mmdPath,
    dispose: vi.fn(),
    reveal: vi.fn(),
    onDisposed: (cb: PanelDisposedCallback) => {
      onDisposedCb = cb;
    },
    _triggerDispose: () => onDisposedCb?.(),
  };
  return panel;
}

const mockPanelCreate = vi.fn();

vi.mock("../webview/panel.js", () => ({
  DiagramPanel: {
    create: mockPanelCreate,
  },
}));

// ── createDiagramTools mock ───────────────────────────────────────────────────

const mockTools = [
  { name: "accordo_diagram_list" },
  { name: "accordo_diagram_get" },
  { name: "accordo_diagram_create" },
  { name: "accordo_diagram_patch" },
  { name: "accordo_diagram_render" },
  { name: "accordo_diagram_style_guide" },
];

vi.mock("../tools/diagram-tools.js", () => ({
  createDiagramTools: vi.fn(() => mockTools),
}));

// ── BridgeAPI mock ────────────────────────────────────────────────────────────

function makeBridge() {
  const disposable = { dispose: vi.fn() };
  const bridge = {
    registerTools: vi.fn(() => disposable),    publishState: vi.fn(),    _disposable: disposable,
  };
  return bridge;
}

// ── ExtensionContext mock ─────────────────────────────────────────────────────

function makeContext() {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extensionUri: { fsPath: "/ext" },
  };
}

// ── Import SUT ────────────────────────────────────────────────────────────────

// Dynamic import so mocks are in place before the module loads
async function loadSut() {
  const mod = await import("../extension.js");
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("activate / deactivate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    _activeTextEditorUri = undefined;
    _bridgeExports = undefined;
    mockWindow.activeTextEditor = undefined;
  });

  it("EX-01: activate() registers all 6 diagram tools with BridgeAPI", async () => {
    const bridge = makeBridge();
    _bridgeExports = bridge;
    const ctx = makeContext();
    const { activate } = await loadSut();

    await activate(ctx as never);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [extensionId, tools] = bridge.registerTools.mock.calls[0] as unknown as [string, typeof mockTools];
    expect(extensionId).toBe("accordo.accordo-diagram");
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual(mockTools.map((t) => t.name));
  });

  it("EX-02: activate() registers the accordo-diagram.open command", async () => {
    const bridge = makeBridge();
    _bridgeExports = bridge;
    const ctx = makeContext();
    const { activate } = await loadSut();

    await activate(ctx as never);

    const commandNames = (mockRegisterCommand.mock.calls as Array<[string, unknown]>).map(([name]) => name);
    expect(commandNames).toContain("accordo-diagram.open");
  });

  it("EX-03: activate() is a no-op (+ warning) when Bridge is absent", async () => {
    _bridgeExports = undefined;
    const ctx = makeContext();
    const { activate } = await loadSut();

    await activate(ctx as never);

    // createDiagramTools is only called when bridge is present — verify it was skipped
    const { createDiagramTools } = await import("../tools/diagram-tools.js");
    expect(createDiagramTools).not.toHaveBeenCalled();
    // Warning logged to output channel
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("accordo-bridge"),
    );
  });

  it("EX-10: deactivate() is a no-op", async () => {
    const { deactivate } = await loadSut();
    expect(() => deactivate()).not.toThrow();
  });
});

describe("accordo-diagram.open command", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    _bridgeExports = makeBridge();
    mockWindow.activeTextEditor = undefined;
  });

  it("EX-04: open with explicit .mmd path creates panel and registers it", async () => {
    const path = "/workspace/arch.mmd";
    const panel = makePanel(path);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const ctx = makeContext();
    const { activate, getPanel } = await loadSut();
    await activate(ctx as never);

    // Invoke the registered command handler with path arg
    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(path);

    expect(mockPanelCreate).toHaveBeenCalledWith(expect.anything(), path, expect.any(Function));
    expect(getPanel(path)).toBe(panel);
  });

  it("EX-05: open with active .mmd editor uses that editor's path", async () => {
    const path = "/workspace/flow.mmd";
    mockWindow.activeTextEditor = {
      document: { uri: { fsPath: path }, languageId: "mermaid" },
    };
    const panel = makePanel(path);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const ctx = makeContext();
    const { activate } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    // No explicit path arg — should fall back to active editor
    await commandHandler?.(undefined);

    expect(mockPanelCreate).toHaveBeenCalledWith(expect.anything(), path, expect.any(Function));
  });

  it("EX-06: open with no .mmd context shows a file-picker", async () => {
    mockWindow.activeTextEditor = undefined;
    mockShowOpenDialog.mockResolvedValueOnce(undefined); // user cancels
    const ctx = makeContext();
    const { activate } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(undefined);

    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ Mermaid: ["mmd"] }) }),
    );
    // Panel not created (user cancelled)
    expect(mockPanelCreate).not.toHaveBeenCalled();
  });
});

describe("panel registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    _bridgeExports = makeBridge();
  });

  it("EX-07: getPanel(path) returns the registered panel for that path", async () => {
    const path = "/workspace/arch.mmd";
    const panel = makePanel(path);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const ctx = makeContext();
    const { activate, getPanel } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(path);

    expect(getPanel(path)).toBe(panel);
  });

  it("EX-08: getPanel(path) returns undefined when no panel is open for that path", async () => {
    const ctx = makeContext();
    const { activate, getPanel } = await loadSut();
    await activate(ctx as never);

    expect(getPanel("/workspace/missing.mmd")).toBeUndefined();
  });

  it("EX-09: disposing a panel removes it from the registry", async () => {
    const path = "/workspace/arch.mmd";
    const panel = makePanel(path);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const ctx = makeContext();
    const { activate, getPanel } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(path);
    expect(getPanel(path)).toBe(panel);

    // Simulate VS Code disposing the panel (user closes the tab)
    panel._triggerDispose();

    expect(getPanel(path)).toBeUndefined();
  });

  it("EX-11: activate() calls publishState with empty openPanels on startup", async () => {
    const bridge = makeBridge();
    _bridgeExports = bridge;
    const ctx = makeContext();
    const { activate } = await loadSut();
    await activate(ctx as never);

    expect(bridge.publishState).toHaveBeenCalledWith("accordo-diagram", {
      isOpen: false,
      openPanels: [],
    });
  });

  it("EX-12: publishState reflects open panel path when a panel is opened", async () => {
    const mmdPath = "/workspace/arch.mmd";
    const panel = makePanel(mmdPath);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const bridge = makeBridge();
    _bridgeExports = bridge;
    const ctx = makeContext();
    const { activate } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(mmdPath);

    const calls = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1] as [string, Record<string, unknown>];
    expect(lastCall[0]).toBe("accordo-diagram");
    expect(lastCall[1]).toMatchObject({ isOpen: true, openPanels: ["arch.mmd"] });
  });

  it("EX-13: publishState reflects empty openPanels when the last panel is disposed", async () => {
    const mmdPath = "/workspace/arch.mmd";
    const panel = makePanel(mmdPath);
    mockPanelCreate.mockResolvedValueOnce(panel);
    const bridge = makeBridge();
    _bridgeExports = bridge;
    const ctx = makeContext();
    const { activate } = await loadSut();
    await activate(ctx as never);

    const commandHandler = (mockRegisterCommand.mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
      .find(([name]) => name === "accordo-diagram.open")?.[1];
    await commandHandler?.(mmdPath);
    panel._triggerDispose();

    const calls = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1] as [string, Record<string, unknown>];
    expect(lastCall[1]).toMatchObject({ isOpen: false, openPanels: [] });
  });
});
