/**
 * Tests for src/tools/terminal.ts — Module 18
 *
 * Phase B — all tests MUST fail RED against "not implemented" stubs.
 *
 * Requirement coverage:
 *   [x] §4.9  terminal.open   — creates terminal, assigns stable ID, respects name/cwd
 *   [x] §4.10 terminal.run    — sends text to terminal, creates new if needed
 *   [x] §4.11 terminal.focus  — executes terminal.focus command
 *   [x] §4.21 terminal.list   — lists all terminals with stable IDs + active flag
 *   [x] §4.22 terminal.close  — disposes by ID or by name (untracked-terminal support)
 *   [x] §5.3  Terminal ID Map — stable IDs persist across calls
 *   [x] Registration          — 5 tools, danger levels, schemas
 *
 * Exported API checklist (dev-process.md §5 Phase B Coverage Audit):
 *   ✓ terminalOpenHandler   — 8 tests (§4.9-OPEN-01..08)
 *   ✓ terminalRunHandler    — 6 tests (§4.10-RUN-01..06)
 *   ✓ terminalFocusHandler  — 2 tests (§4.11-FOCUS-01, R01)
 *   ✓ terminalListHandler   — 5 tests (§4.21-LIST-01..05)
 *   ✓ terminalCloseHandler  — 6 tests (§4.22-CLOSE-01..06)
 *   ✓ terminalMap           — used directly in map-mutation tests
 *   ✓ _resetTerminalMap     — called in beforeEach
 *   ✓ createTerminalId      — indirectly tested via open/run
 *   ✓ terminalTools[]       — 8 registration tests (M18-REG-01..08)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  terminalOpenHandler,
  terminalRunHandler,
  terminalFocusHandler,
  terminalListHandler,
  terminalCloseHandler,
  terminalMap,
  _resetTerminalMap,
  terminalTools,
} from "../tools/terminal.js";

import * as vscodeMock from "./mocks/vscode.js";
const { window, commands, mockState } = vscodeMock;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockTerminal(name = "Accordo") {
  return {
    name,
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  mockState.workspaceFolders = [];
  _resetTerminalMap();
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.9 accordo.terminal.open
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalOpenHandler — §4.9", () => {
  it("§4.9-OPEN-01: returns a stable terminalId and name", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    const result = await terminalOpenHandler({});
    expect(result).toMatchObject({ terminalId: expect.stringContaining("accordo-terminal-"), name: "Accordo" });
  });

  it("§4.9-OPEN-02: default name is 'Accordo'", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    const result = await terminalOpenHandler({});
    expect(result.name).toBe("Accordo");
  });

  it("§4.9-OPEN-03: uses provided name", async () => {
    const mock = makeMockTerminal("myTerminal");
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    const result = await terminalOpenHandler({ name: "myTerminal" });
    expect(result.name).toBe("myTerminal");
  });

  it("§4.9-OPEN-04: calls createTerminal with provided cwd", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    await terminalOpenHandler({ cwd: "/tmp" });
    expect(window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: expect.stringContaining("tmp") }),
    );
  });

  it("§4.9-OPEN-05: terminal.show() is called after creation", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    await terminalOpenHandler({});
    expect(mock.show).toHaveBeenCalled();
  });

  it("§4.9-OPEN-06: stores terminal in terminalMap", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    const { terminalId } = await terminalOpenHandler({});
    expect(terminalMap.get(terminalId)).toBe(mock);
  });

  it("§4.9-OPEN-07: each open call produces a unique terminalId", async () => {
    const m1 = makeMockTerminal();
    const m2 = makeMockTerminal("B");
    vi.mocked(window.createTerminal)
      .mockReturnValueOnce(m1 as never)
      .mockReturnValueOnce(m2 as never);
    const r1 = await terminalOpenHandler({});
    const r2 = await terminalOpenHandler({ name: "B" });
    expect(r1.terminalId).not.toBe(r2.terminalId);
  });

  it("§4.9-OPEN-08: uses workspace root cwd if no cwd provided", async () => {
    mockState.workspaceFolders = [
      { uri: vscodeMock.Uri.file("/ws"), name: "ws", index: 0 },
    ];
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    await terminalOpenHandler({});
    expect(window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/ws" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.10 accordo.terminal.run
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalRunHandler — §4.10", () => {
  it("§4.10-RUN-01: returns error when command argument is missing", async () => {
    const result = await terminalRunHandler({});
    expect(result).toHaveProperty("error");
  });

  it("§4.10-RUN-02: returns error when command is empty string", async () => {
    const result = await terminalRunHandler({ command: "" });
    expect(result).toHaveProperty("error");
  });

  it("§4.10-RUN-03: sends command to specified terminal and calls show()", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);
    const result = await terminalRunHandler({ command: "ls", terminalId: "accordo-terminal-1" });
    expect(mock.sendText).toHaveBeenCalledWith("ls", true);
    expect(mock.show).toHaveBeenCalled();
    expect(result).toEqual({ sent: true, terminalId: "accordo-terminal-1" });
  });

  it("§4.10-RUN-04: returns error when specified terminalId not found", async () => {
    const result = await terminalRunHandler({ command: "ls", terminalId: "accordo-terminal-99" });
    expect(result).toMatchObject({ error: "Terminal accordo-terminal-99 not found" });
  });

  it("§4.10-RUN-05: uses active terminal when no terminalId provided, calls show()", async () => {
    const mock = makeMockTerminal();
    mockState.activeTerminal = mock as never;
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);
    const result = await terminalRunHandler({ command: "echo hi" });
    expect(mock.sendText).toHaveBeenCalledWith("echo hi", true);
    expect(mock.show).toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });

  it("§4.10-RUN-06: creates new terminal when no active terminal exists, calls show()", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    const result = await terminalRunHandler({ command: "pwd" });
    expect(window.createTerminal).toHaveBeenCalled();
    expect(mock.sendText).toHaveBeenCalledWith("pwd", true);
    expect(mock.show).toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.11 accordo.terminal.focus
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalFocusHandler — §4.11", () => {
  it("§4.11-FOCUS-01: executes terminal.focus command and returns { focused: true }", async () => {
    await expect(terminalFocusHandler({})).resolves.toEqual({ focused: true });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.terminal.focus",
    );
  });

  it("§4.11-FOCUS-R01: wraps command rejection as { error: string }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("focus fail"));
    const result = await terminalFocusHandler({});
    expect(result).toMatchObject({ error: "focus fail" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.21 accordo.terminal.list
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalListHandler — §4.21", () => {
  it("§4.21-LIST-01: returns empty list when no terminals open", async () => {
    const result = await terminalListHandler({});
    expect(result).toEqual({ terminals: [] });
  });

  it("§4.21-LIST-02: returns terminal info for each open terminal", async () => {
    const mock = makeMockTerminal("MyTerm");
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);
    const result = await terminalListHandler({});
    expect(result.terminals).toHaveLength(1);
    expect(result.terminals[0]).toMatchObject({ name: "MyTerm", terminalId: "accordo-terminal-1" });
  });

  it("§4.21-LIST-03: marks active terminal with isActive: true", async () => {
    const mock = makeMockTerminal("Active");
    mockState.terminals = [mock as never];
    mockState.activeTerminal = mock as never;
    terminalMap.set("accordo-terminal-1", mock);
    const result = await terminalListHandler({});
    expect(result.terminals[0].isActive).toBe(true);
  });

  it("§4.21-LIST-04: non-active terminals have isActive: false", async () => {
    const m1 = makeMockTerminal("T1");
    const m2 = makeMockTerminal("T2");
    mockState.terminals = [m1, m2] as never;
    mockState.activeTerminal = m1 as never;
    terminalMap.set("accordo-terminal-1", m1);
    terminalMap.set("accordo-terminal-2", m2);
    const result = await terminalListHandler({});
    const t2 = result.terminals.find((t) => t.name === "T2")!;
    expect(t2.isActive).toBe(false);
  });

  it("§4.21-LIST-05: untracked terminals get terminalId '(untracked)'", async () => {
    const mock = makeMockTerminal("External");
    mockState.terminals = [mock as never];
    // NOT added to terminalMap
    const result = await terminalListHandler({});
    expect(result.terminals[0].terminalId).toBe("(untracked)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.22 accordo.terminal.close
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalCloseHandler — §4.22", () => {
  it("§4.22-CLOSE-01: returns error when neither terminalId nor name is provided", async () => {
    const result = await terminalCloseHandler({});
    expect(result).toHaveProperty("error");
  });

  it("§4.22-CLOSE-02: returns error with message when terminalId not found in map", async () => {
    const result = await terminalCloseHandler({ terminalId: "accordo-terminal-99" });
    expect(result).toMatchObject({ error: "Terminal accordo-terminal-99 not found" });
  });

  it("§4.22-CLOSE-03: disposes terminal and returns { closed: true, terminalId }", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);
    const result = await terminalCloseHandler({ terminalId: "accordo-terminal-1" });
    expect(mock.dispose).toHaveBeenCalled();
    expect(result).toEqual({ closed: true, terminalId: "accordo-terminal-1" });
  });

  it("§4.22-CLOSE-04: removes terminal from terminalMap after close", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);
    await terminalCloseHandler({ terminalId: "accordo-terminal-1" });
    expect(terminalMap.has("accordo-terminal-1")).toBe(false);
  });

  it("§4.22-CLOSE-05: closes untracked terminal by name", async () => {
    const mock = makeMockTerminal("my-unnamed");
    mockState.terminals = [mock as never];
    // NOT in terminalMap — simulates a terminal opened manually in VS Code
    const result = await terminalCloseHandler({ name: "my-unnamed" });
    expect(mock.dispose).toHaveBeenCalled();
    expect(result).toMatchObject({ closed: true });
  });

  it("§4.22-CLOSE-06: returns error when name not found in VS Code terminals", async () => {
    const result = await terminalCloseHandler({ name: "ghost-terminal" });
    expect(result).toMatchObject({ error: expect.stringContaining("ghost-terminal") });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.3 Terminal ID Map — sequential IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("Terminal ID Map — §5.3", () => {
  it("§5.3-MAP-01: assigns accordo-terminal-1 then accordo-terminal-2 on successive opens", async () => {
    const m1 = makeMockTerminal("A");
    const m2 = makeMockTerminal("B");
    vi.mocked(window.createTerminal)
      .mockReturnValueOnce(m1 as never)
      .mockReturnValueOnce(m2 as never);
    const r1 = await terminalOpenHandler({ name: "A" });
    const r2 = await terminalOpenHandler({ name: "B" });
    expect(r1.terminalId).toBe("accordo-terminal-1");
    expect(r2.terminalId).toBe("accordo-terminal-2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registration — Module 18
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalTools registration — Module 18", () => {
  const byName = (name: string) => terminalTools.find((t) => t.name === name)!;

  it("M18-REG-01: exports exactly 5 tool definitions", () => {
    expect(terminalTools).toHaveLength(5);
  });

  it("M18-REG-02: all tool names are present", () => {
    const names = terminalTools.map((t) => t.name);
    expect(names).toContain("accordo.terminal.open");
    expect(names).toContain("accordo.terminal.run");
    expect(names).toContain("accordo.terminal.focus");
    expect(names).toContain("accordo.terminal.list");
    expect(names).toContain("accordo.terminal.close");
  });

  it("M18-REG-03: terminal.run is destructive", () => {
    expect(byName("accordo.terminal.run").dangerLevel).toBe("destructive");
  });

  it("M18-REG-04: terminal.open is moderate", () => {
    expect(byName("accordo.terminal.open").dangerLevel).toBe("moderate");
  });

  it("M18-REG-05: terminal.focus and terminal.list are safe", () => {
    expect(byName("accordo.terminal.focus").dangerLevel).toBe("safe");
    expect(byName("accordo.terminal.list").dangerLevel).toBe("safe");
  });

  it("M18-REG-06: terminal.run requires [command]", () => {
    expect(byName("accordo.terminal.run").inputSchema.required).toContain("command");
  });

  it("M18-REG-07: terminal.close has terminalId and name as optional properties", () => {
    const schema = byName("accordo.terminal.close").inputSchema;
    expect(schema.properties).toHaveProperty("terminalId");
    expect(schema.properties).toHaveProperty("name");
    expect(schema.required).toEqual([]);
  });

  it("M18-REG-08: all handlers are functions", () => {
    for (const tool of terminalTools) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});


