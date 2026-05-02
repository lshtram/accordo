import { beforeEach, describe, expect, it, vi } from "vitest";

import { activate } from "../extension.js";
import {
  _resetTerminalMap,
  terminalListHandler,
  terminalOpenHandler,
} from "../tools/terminal.js";
import { createTerminalReadDeps, initTerminalReadGateway, terminalReadHandler } from "../tools/terminal-read/index.js";
import * as vscodeMock from "./mocks/vscode.js";

const { mockState } = vscodeMock;

function makeRestorableTerminal(name: string, snapshotText: string) {
  const terminal = {
    name,
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    __snapshotText: snapshotText,
  };
  terminal.show.mockImplementation(() => {
    mockState.activeTerminal = terminal as never;
  });
  return terminal;
}

function installTerminalCopyCommands(): void {
  mockState.registeredCommands.set("workbench.action.terminal.selectAll", () => undefined);
  mockState.registeredCommands.set("workbench.action.terminal.clearSelection", () => undefined);
  mockState.registeredCommands.set("workbench.action.terminal.focus", () => undefined);
  mockState.registeredCommands.set("workbench.action.terminal.copySelection", () => {
    const active = mockState.activeTerminal as (typeof mockState.activeTerminal & { __snapshotText?: string }) | null;
    mockState.clipboardText = active?.__snapshotText ?? "";
  });
}

function installBridge(): void {
  const bridge = {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    getState: vi.fn().mockReturnValue({
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
    }),
  };
  vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
}

describe("terminal restore reconciliation after reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetTerminalMap();
    mockState.terminals = [];
    mockState.activeTerminal = null;
    mockState.registeredCommands.clear();
    mockState.clipboardText = "";
    installTerminalCopyCommands();
    installBridge();
  });

  it("rebinds two restored accordo terminals on activation and lists both stable IDs", async () => {
    const initialContext = new vscodeMock.ExtensionContext();
    const openedA = makeRestorableTerminal("Accordo Manual A", "A1\n");
    const openedB = makeRestorableTerminal("Accordo Manual B", "B1\n");

    vi.mocked(vscodeMock.window.createTerminal)
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedA as never);
        return openedA as never;
      })
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedB as never);
        return openedB as never;
      });

    await activate(initialContext as never);
    await terminalOpenHandler({ name: "Accordo Manual A" });
    await terminalOpenHandler({ name: "Accordo Manual B" });

    const restoredA = makeRestorableTerminal("Accordo Manual A", "A-restored\n");
    const restoredB = makeRestorableTerminal("Accordo Manual B", "B-restored\n");
    mockState.terminals = [restoredA as never, restoredB as never];
    mockState.activeTerminal = restoredB as never;
    _resetTerminalMap();

    const reloadContext = new vscodeMock.ExtensionContext({
      workspaceState: initialContext.workspaceState,
      globalState: initialContext.globalState,
    });
    await activate(reloadContext as never);

    const result = await terminalListHandler({});
    expect(result).toEqual({
      terminals: [
        { terminalId: "accordo-terminal-1", name: "Accordo Manual A", isActive: false },
        { terminalId: "accordo-terminal-2", name: "Accordo Manual B", isActive: true },
      ],
    });
  });

  it("allows terminal_read on both restored terminals after activation reconciliation", async () => {
    const initialContext = new vscodeMock.ExtensionContext();
    const openedA = makeRestorableTerminal("Accordo Manual A", "A1\n");
    const openedB = makeRestorableTerminal("Accordo Manual B", "B1\n");

    vi.mocked(vscodeMock.window.createTerminal)
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedA as never);
        return openedA as never;
      })
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedB as never);
        return openedB as never;
      });

    await activate(initialContext as never);
    await terminalOpenHandler({ name: "Accordo Manual A" });
    await terminalOpenHandler({ name: "Accordo Manual B" });

    const restoredA = makeRestorableTerminal("Accordo Manual A", "A-restored\nline-two\n");
    const restoredB = makeRestorableTerminal("Accordo Manual B", "B-restored\nline-two\n");
    mockState.terminals = [restoredA as never, restoredB as never];
    mockState.activeTerminal = restoredB as never;
    _resetTerminalMap();

    const reloadContext = new vscodeMock.ExtensionContext({
      workspaceState: initialContext.workspaceState,
      globalState: initialContext.globalState,
    });
    await activate(reloadContext as never);

    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const readA = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 50, maxChars: 4000 });
    const readB = await terminalReadHandler({ terminalId: "accordo-terminal-2", maxLines: 50, maxChars: 4000 });

    expect(readA).not.toHaveProperty("error");
    expect(readB).not.toHaveProperty("error");
    expect((readA as { text: string }).text).toContain("A-restored");
    expect((readB as { text: string }).text).toContain("B-restored");
  });

  it("keeps duplicate terminal names deterministic across reload and does not drop the second terminal", async () => {
    const initialContext = new vscodeMock.ExtensionContext();
    const openedA = makeRestorableTerminal("Accordo", "first\n");
    const openedB = makeRestorableTerminal("Accordo", "second\n");

    vi.mocked(vscodeMock.window.createTerminal)
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedA as never);
        return openedA as never;
      })
      .mockImplementationOnce(() => {
        mockState.terminals.push(openedB as never);
        return openedB as never;
      });

    await activate(initialContext as never);
    await terminalOpenHandler({ name: "Accordo" });
    await terminalOpenHandler({ name: "Accordo" });

    const restoredA = makeRestorableTerminal("Accordo", "restored-first\n");
    const restoredB = makeRestorableTerminal("Accordo", "restored-second\n");
    mockState.terminals = [restoredA as never, restoredB as never];
    mockState.activeTerminal = restoredA as never;
    _resetTerminalMap();

    const reloadContext = new vscodeMock.ExtensionContext({
      workspaceState: initialContext.workspaceState,
      globalState: initialContext.globalState,
    });
    await activate(reloadContext as never);

    const listed = await terminalListHandler({});
    expect(listed).toEqual({
      terminals: [
        { terminalId: "accordo-terminal-1", name: "Accordo", isActive: true },
        { terminalId: "accordo-terminal-2", name: "Accordo", isActive: false },
      ],
    });

    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);
    const read1 = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    const read2 = await terminalReadHandler({ terminalId: "accordo-terminal-2" });
    expect((read1 as { text: string }).text).toContain("restored-first");
    expect((read2 as { text: string }).text).toContain("restored-second");
  });

  it("waits for terminal identity persistence before terminal_open returns", async () => {
    const delayedState = new vscodeMock.MockMemento(25);
    const context = new vscodeMock.ExtensionContext({ workspaceState: delayedState, globalState: delayedState });
    const opened = makeRestorableTerminal("Persisted", "persisted\n");
    vi.mocked(vscodeMock.window.createTerminal).mockImplementationOnce(() => {
      mockState.terminals.push(opened as never);
      return opened as never;
    });

    await activate(context as never);
    const result = await terminalOpenHandler({ name: "Persisted" });

    expect(result).toMatchObject({ terminalId: "accordo-terminal-1" });
    expect(delayedState.get("accordo.terminals.restorable.v1", [])).toEqual([
      { terminalId: "accordo-terminal-1", name: "Persisted" },
    ]);
  });

  it("bootstraps legacy restored Accordo terminals with no persisted mapping so terminal_list works immediately", async () => {
    const restoredA = makeRestorableTerminal("Accordo Manual A", "legacy-a\n");
    const restoredB = makeRestorableTerminal("Accordo Manual B", "legacy-b\n");
    mockState.terminals = [restoredA as never, restoredB as never];
    mockState.activeTerminal = restoredB as never;

    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);

    const listed = await terminalListHandler({});
    expect(listed).toEqual({
      terminals: [
        { terminalId: "accordo-terminal-1", name: "Accordo Manual A", isActive: false },
        { terminalId: "accordo-terminal-2", name: "Accordo Manual B", isActive: true },
      ],
    });
  });

  it("bootstraps legacy restored Accordo terminals so explicit terminal_read works immediately", async () => {
    const restoredA = makeRestorableTerminal("Accordo Manual A", "legacy-a\nline\n");
    const restoredB = makeRestorableTerminal("Accordo Manual B", "legacy-b\nline\n");
    mockState.terminals = [restoredA as never, restoredB as never];
    mockState.activeTerminal = restoredB as never;

    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);

    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);
    const readA = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    const readB = await terminalReadHandler({ terminalId: "accordo-terminal-2" });

    expect((readA as { text: string }).text).toContain("legacy-a");
    expect((readB as { text: string }).text).toContain("legacy-b");
  });
});
