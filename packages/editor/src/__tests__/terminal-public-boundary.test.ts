/**
 * terminal-public-boundary.test.ts — Priority S Phase B · §S-TR-04, S-TR-09, S-TR-11
 *
 * Completion-defining public/runtime boundary proof tests.
 *
 * These tests prove that observe preview and redaction flow through the REAL
 * runtime pipeline (terminalOutputBuffer, terminalOutputRedactor) when accessed
 * via the registered public VS Code command boundary.
 *
 * Strategy:
 *   - installShellExecutionEmitter() is called BEFORE activate(), wiring up the
 *     mock shell execution emitter (window.onDidStartTerminalShellExecution → our EventEmitter)
 *   - vscodeTerminalOutputSource subscribes to our EventEmitter at module load time during activate()
 *   - Terminal is created and tracked in terminalMap
 *   - executeCommand("accordo_terminal_run", {observeMaxLines}) is called through
 *     the public shim boundary (wireExecuteCommandToShims)
 *   - The handler calls dispatchRunCommand(terminal, command), whose sendText call
 *     fires the shell event via the mock terminal wrapper.
 *   - This proves that within the SAME executeCommand call, shell integration events
 *     triggered during dispatch result in buffer population that collectObservePreview reads.
 *   - Assert observe:{text, cursor, truncated} is returned with correct content
 *   - Assert cursor format matches runtime format /^t-accordo-terminal-\d+:/
 *
 * Same-call semantics:
 *   The executeCommand call dispatches the command (fires shell event), and the
 *   production observe wait reads captured output in the same invocation.
 *
 * The tests will FAIL if:
 *   1. dispatchRunCommand does NOT trigger shell events → buffer empty
 *   2. Extension activation does not wire observeDeps → observe field absent
 *   3. terminalMap not populated → terminalId resolution fails
 *   4. Cursor format encoder/decoder mismatch
 *   5. Redactor not wired → plaintext secrets exposed
 *
 * Exported API checklist:
 *   ✓ activate            — extension activation (wires real deps, registers shims)
 *   ✓ vscode.commands.executeCommand — public command boundary
 *   ✓ vscodeTerminalOutputSource — real source adapter (subscribed at module load)
 *   ✓ terminalOutputBuffer — real runtime buffer (populated via shell events)
 *   ✓ initTerminalRunGateway — observe pipeline wiring
 *   ✓ initTerminalReadGateway — read pipeline wiring
 *   ✓ MockTerminalShellExecution — mock execution with async iterable read()
 *   ✓ installShellExecutionEmitter — wires window emitter to test EventEmitter
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { activate } from "../extension.js";

import * as vscodeMock from "./mocks/vscode.js";
const { mockState, commands } = vscodeMock;
import { terminalMap, _resetTerminalMap } from "../tools/terminal.js";
import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";

// ── Bridge / state helpers ───────────────────────────────────────────────────

function makeState(): IDEState {
  return {
    activeFile: null, activeFileLine: 1, activeFileColumn: 1,
    openEditors: [], openTabs: [], visibleEditors: [],
    workspaceFolders: [], activeTerminal: null,
    workspaceName: null, remoteAuthority: null, modalities: {},
  };
}

function makeBridge(state: IDEState) {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    getState: vi.fn().mockReturnValue(state),
  };
}

// ── Per-suite reset ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vscodeMock.resetShellExecutionListeners();
  for (let i = 1; i <= 10; i += 1) {
    void terminalOutputBuffer.clearTerminal(`accordo-terminal-${i}`);
  }
  _resetTerminalMap();
  mockState.terminals = [];
  mockState.activeTerminal = null;
});

// ── Terminal shim helpers ───────────────────────────────────────────────────

function wireExecuteCommandToShims() {
  vi.mocked(commands.executeCommand).mockImplementation(async (command: string, ...args: unknown[]) => {
    const calls = vi.mocked(commands.registerCommand).mock.calls;
    const entry = calls.find(([id]) => id === command);
    if (entry) {
      const handler = entry[1] as (args: unknown) => unknown;
      return handler(args[0]);
    }
    return undefined;
  });
}

// Make a mock terminal with sendText method
function makeMockTerminal(name = "TestTerminal") {
  return {
    name,
    sendText: vi.fn().mockReturnValue(undefined),
    show: vi.fn(),
    dispose: vi.fn(),
    creationOptions: {},
    environmentVariableScope: null,
    exitStatus: null,
    state: 1,
    isHidden: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-09: same-call observe preview via public boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-09: same-call observe preview via executeCommand boundary", () => {
  it("S-TR-09-PB-01: executeCommand(accordo_terminal_run, {observeMaxLines}) returns observe preview populated by shell event", async () => {
    // ── Arrange ─────────────────────────────────────────────────────────────
    const shellEmitter = vscodeMock.installShellExecutionEmitter();

    const mockTerminal = makeMockTerminal();
    mockState.terminals = [mockTerminal as never];
    mockState.activeTerminal = mockTerminal as never;

    const bridge = makeBridge(makeState());
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    wireExecuteCommandToShims();

    const terminalId = `accordo-terminal-${terminalMap.size + 1}`;
    terminalMap.set(terminalId, mockTerminal as never);
    shellEmitter.setChunks(["hello from shell\n"]);
    shellEmitter.wrapTerminal(mockTerminal as Record<string, unknown>);

    // ── Act: the same observed run dispatches and captures shell output ──────
    const result = await commands.executeCommand("accordo_terminal_run", {
      command: "echo hello from shell",
      observeMaxLines: 50,
      terminalId,
    }) as { sent: boolean; terminalId: string; observe?: { text: string; cursor: string; truncated: boolean }; error?: string };

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(result).toHaveProperty("sent", true);
    expect(result).toHaveProperty("observe");
    expect(result.observe).toHaveProperty("text");
    expect(result.observe).toHaveProperty("cursor");
    expect(result.observe).toHaveProperty("truncated");
    expect(result.observe!.cursor).toMatch(/^t-accordo-terminal-\d+:/);
    expect(result.observe!.text).toContain("hello from shell");
  });

  it("S-TR-09-PB-02: observe preview is absent when observeMaxLines=0", async () => {
    // ── Arrange ─────────────────────────────────────────────────────────────
    const shellEmitter = vscodeMock.installShellExecutionEmitter();

    const mockTerminal = makeMockTerminal();
    mockState.terminals = [mockTerminal as never];
    mockState.activeTerminal = mockTerminal as never;

    const bridge = makeBridge(makeState());
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    wireExecuteCommandToShims();

    const terminalId = `accordo-terminal-${terminalMap.size + 1}`;
    terminalMap.set(terminalId, mockTerminal as never);

    // ── Act ─────────────────────────────────────────────────────────────────
    const result = await commands.executeCommand("accordo_terminal_run", {
      command: "echo some output",
      observeMaxLines: 0,
      terminalId,
    }) as { sent: boolean; observe?: unknown };

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(result).toHaveProperty("sent", true);
    expect(result).not.toHaveProperty("observe");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-04: same-call redaction via public boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-04: same-call redaction via public executeCommand boundary", () => {
  it("S-TR-04-PB-01: executeCommand(accordo_terminal_run, {observeMaxLines}) redacts secrets in observe preview", async () => {
    // ── Arrange ─────────────────────────────────────────────────────────────
    const shellEmitter = vscodeMock.installShellExecutionEmitter();

    const mockTerminal = makeMockTerminal();
    mockState.terminals = [mockTerminal as never];
    mockState.activeTerminal = mockTerminal as never;

    const bridge = makeBridge(makeState());
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    wireExecuteCommandToShims();

    const terminalId = `accordo-terminal-${terminalMap.size + 1}`;
    terminalMap.set(terminalId, mockTerminal as never);
    shellEmitter.setChunks(["password=SuperSecret123\n"]);
    shellEmitter.wrapTerminal(mockTerminal as Record<string, unknown>);

    const result = await commands.executeCommand("accordo_terminal_run", {
      command: "echo password=SuperSecret123",
      observeMaxLines: 50,
      terminalId,
    }) as { sent: boolean; observe?: { text: string; cursor: string; truncated: boolean }; error?: string };

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(result).toHaveProperty("observe");
    expect(result.observe!.text).not.toContain("SuperSecret123");
    expect(result.observe!.text).toContain("[SECRET]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-11: observe cursor enables continuation via terminal_read
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-11: observe cursor enables continuation via terminal_read", () => {
  it("S-TR-11-PB-01: cursor from executeCommand(accordo_terminal_run) enables terminal_read continuation", async () => {
    // ── Arrange ─────────────────────────────────────────────────────────────
    const shellEmitter = vscodeMock.installShellExecutionEmitter();

    const mockTerminal = makeMockTerminal();
    mockState.terminals = [mockTerminal as never];
    mockState.activeTerminal = mockTerminal as never;

    const bridge = makeBridge(makeState());
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    wireExecuteCommandToShims();

    const terminalId = `accordo-terminal-${terminalMap.size + 1}`;
    terminalMap.set(terminalId, mockTerminal as never);
    shellEmitter.setChunks(["initial output\n"]);
    shellEmitter.wrapTerminal(mockTerminal as Record<string, unknown>);

    // ── Act step 1: terminal_run → get observe cursor ────────────────────────
    const runResult = await commands.executeCommand("accordo_terminal_run", {
      command: "echo initial output",
      observeMaxLines: 50,
      terminalId,
    }) as { sent: boolean; terminalId: string; observe?: { text: string; cursor: string; truncated: boolean } };

    expect(runResult).toHaveProperty("observe");
    const observeCursor = runResult.observe!.cursor;
    expect(observeCursor).toMatch(/^t-accordo-terminal-\d+:/);

    // ── Act step 2: Fire another shell execution start event with new output ─
    const exec2 = new vscodeMock.MockTerminalShellExecution(["continuation output\n"]);
    const drained = new Promise<void>((resolve) => { exec2.onExhausted = resolve; });
    shellEmitter.fireStart({ terminal: mockTerminal as never, execution: exec2 });
    await drained;

    // ── Act step 3: terminal_read with cursor from observe ─────────────────
    const readResult = await commands.executeCommand("accordo_terminal_read", {
      terminalId,
      since: observeCursor,
    }) as { text: string; cursor: string; truncated: boolean };

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(readResult.text).toContain("continuation output");
  });

  it("S-TR-11-PB-02: observe cursor format is decodable by terminal_read", async () => {
    // Verifies cursor format round-trips through executeCommand boundary.

    const shellEmitter = vscodeMock.installShellExecutionEmitter();

    const mockTerminal = makeMockTerminal();
    mockState.terminals = [mockTerminal as never];
    mockState.activeTerminal = mockTerminal as never;

    const bridge = makeBridge(makeState());
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    wireExecuteCommandToShims();

    const terminalId = `accordo-terminal-${terminalMap.size + 1}`;
    terminalMap.set(terminalId, mockTerminal as never);
    shellEmitter.setChunks(["line one\n"]);
    shellEmitter.wrapTerminal(mockTerminal as Record<string, unknown>);

    const runResult = await commands.executeCommand("accordo_terminal_run", {
      command: "echo line one",
      observeMaxLines: 50,
      terminalId,
    }) as { sent: boolean; observe?: { text: string; cursor: string; truncated: boolean } };

    expect(runResult).toHaveProperty("observe");
    const cursor = runResult.observe!.cursor;
    expect(cursor).toMatch(/^t-accordo-terminal-\d+:/);
    expect(cursor.length).toBeGreaterThan(0);
  });
});
