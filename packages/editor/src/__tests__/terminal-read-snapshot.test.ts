import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTerminalReadDeps,
  initTerminalReadGateway,
  terminalReadHandler,
  vscodeTerminalOutputSource,
} from "../tools/terminal-read/index.js";
import { terminalRunHandler } from "../tools/terminal.js";
import { initTerminalRunGateway } from "../tools/terminal/terminal-run.js";
import { _resetTerminalMap, terminalMap } from "../tools/terminal.js";

import { MockTerminalShellExecution } from "./mocks/vscode.js";
import * as vscodeMock from "./mocks/vscode.js";

const { mockState } = vscodeMock;

function makeSnapshotTerminal(name: string, snapshotText: string) {
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
  mockState.registeredCommands.set("workbench.action.terminal.copySelection", () => {
    const active = mockState.activeTerminal as (typeof mockState.activeTerminal & { __snapshotText?: string }) | null;
    mockState.clipboardText = active?.__snapshotText ?? "";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetTerminalMap();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  mockState.registeredCommands.clear();
  mockState.clipboardText = "";
  installTerminalCopyCommands();
});

afterEach(() => {
  vscodeTerminalOutputSource.dispose();
});

describe("terminal_read snapshot fallback", () => {
  it("adopts an existing terminal after reload and reads full restored scrollback without a new command", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const terminal = makeSnapshotTerminal("Restored", "pwd\n/home/liorshtram/projects/accordo\n");
    mockState.terminals = [terminal as never];
    mockState.activeTerminal = terminal as never;

    const result = await terminalReadHandler({ maxLines: 50, maxChars: 4000 });

    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({ terminalId: "accordo-terminal-1", truncated: false });
    expect((result as { text: string }).text).toContain("/home/liorshtram/projects/accordo");
    expect((result as { cursor: string }).cursor).toMatch(/^s-accordo-terminal-1:/);
  });

  it("returns only newly typed manual output when the caller reuses a snapshot cursor", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const terminal = makeSnapshotTerminal("Manual", "echo one\none\n");
    mockState.terminals = [terminal as never];
    mockState.activeTerminal = terminal as never;

    const first = await terminalReadHandler({ maxLines: 50, maxChars: 4000 });
    expect(first).not.toHaveProperty("error");

    terminal.__snapshotText = "echo one\none\necho two\ntwo\n";
    const second = await terminalReadHandler({
      terminalId: (first as { terminalId: string }).terminalId,
      since: (first as { cursor: string }).cursor,
      maxLines: 50,
      maxChars: 4000,
    });

    expect(second).not.toHaveProperty("error");
    expect((second as { text: string }).text).toBe("echo two\ntwo\n");
    expect((second as { cursor: string }).cursor).toMatch(/^s-accordo-terminal-1:/);
  });

  it("allows immediate follow-up reads with the same snapshot cursor when no new output was appended", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const terminal = makeSnapshotTerminal("Stable", "echo stable\nstable\n");
    mockState.terminals = [terminal as never];
    mockState.activeTerminal = terminal as never;

    const first = await terminalReadHandler({ maxLines: 50, maxChars: 4000 });
    expect(first).not.toHaveProperty("error");

    const second = await terminalReadHandler({
      since: (first as { cursor: string }).cursor,
      maxLines: 50,
      maxChars: 4000,
    });

    expect(second).not.toHaveProperty("error");
    expect((second as { text: string }).text).toBe("");
    expect((second as { cursor: string }).cursor).toMatch(/^s-accordo-terminal-1:/);
  });

  it("re-adopts the same active restored terminal and accepts the prior snapshot cursor when terminalId is omitted", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const terminal = makeSnapshotTerminal("Reloaded", "before\n");
    mockState.terminals = [terminal as never];
    mockState.activeTerminal = terminal as never;

    const first = await terminalReadHandler({ maxLines: 50, maxChars: 4000 });
    expect(first).not.toHaveProperty("error");
    expect((first as { terminalId: string }).terminalId).toBe("accordo-terminal-1");

    _resetTerminalMap();
    mockState.activeTerminal = terminal as never;
    terminal.__snapshotText = "before\nafter\n";

    const second = await terminalReadHandler({
      since: (first as { cursor: string }).cursor,
      maxLines: 50,
      maxChars: 4000,
    });

    expect(second).not.toHaveProperty("error");
    expect((second as { terminalId: string }).terminalId).toBe("accordo-terminal-1");
    expect((second as { text: string }).text).toBe("after\n");
  });

  it("keeps snapshot cursors isolated per terminal", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    const terminalA = makeSnapshotTerminal("A", "alpha\n");
    const terminalB = makeSnapshotTerminal("B", "beta\n");
    mockState.terminals = [terminalA as never, terminalB as never];
    terminalMap.set("accordo-terminal-1", terminalA as never);
    terminalMap.set("accordo-terminal-2", terminalB as never);

    const a = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    const b = await terminalReadHandler({ terminalId: "accordo-terminal-2" });

    expect((a as { text: string }).text).toBe("alpha\n");
    expect((b as { text: string }).text).toBe("beta\n");

    const cross = await terminalReadHandler({
      terminalId: "accordo-terminal-2",
      since: (a as { cursor: string }).cursor,
    });
    expect(cross).toEqual({ error: "Cursor does not belong to terminal accordo-terminal-2" });
  });

  it("preserves terminal_run observe continuity for buffer cursors", async () => {
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);
    initTerminalRunGateway({
      read: (req) => deps.buffer.read(req),
      redact: (text) => deps.redactor.redact(text),
    });

    const terminal = makeSnapshotTerminal("Observed", "first\nsecond\n");
    mockState.terminals = [terminal as never];
    terminalMap.set("accordo-terminal-1", terminal as never);
    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", terminal as never);

    const firstExec = new MockTerminalShellExecution(["first\n"], "echo first");
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (event: unknown) => void }).onStartExecution({
      terminal,
      execution: firstExec,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const observed = await terminalRunHandler({
      command: "echo first",
      terminalId: "accordo-terminal-1",
      observeMaxLines: 20,
      observeMaxChars: 2000,
    });
    const observeCursor = (observed as { observe: { cursor: string } }).observe.cursor;
    expect(observeCursor).toMatch(/^t-accordo-terminal-1:/);

    const secondExec = new MockTerminalShellExecution(["second\n"], "echo second");
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (event: unknown) => void }).onStartExecution({
      terminal,
      execution: secondExec,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const continuation = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: observeCursor,
      maxLines: 20,
      maxChars: 2000,
    });

    expect(continuation).not.toHaveProperty("error");
    expect((continuation as { text: string }).text).toContain("second");
    expect((continuation as { text: string }).text).not.toContain("first\nfirst");
  });
});
