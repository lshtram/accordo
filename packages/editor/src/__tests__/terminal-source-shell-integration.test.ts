/**
 * terminal-source-shell-integration.test.ts — Priority S Phase B · §S-TR-04, S-TR-09, S-TR-11
 *
 * Integration tests exercising the REAL shell-execution capture path:
 *   onDidStartTerminalShellExecution → execution.read() → terminalOutputBuffer.append()
 *
 * These tests are completion-defining for the boundary-proof requirement:
 *   - S-TR-04: proves redaction via real shell-execution pipeline
 *   - S-TR-09: proves observe preview via real shell-execution event (not test_only_append)
 *   - S-TR-11: proves run→read continuation via real shell-execution cursor
 *
 * Strategy: Since vscodeTerminalOutputSource is a module-level singleton that registers
 * its onDidStartTerminalShellExecution listener at construction time (before tests run),
 * we directly invoke the private onStartExecution handler via the public event surface.
 * This tests the real capture path without needing to replace already-registered listeners.
 *
 * CRITICAL: These tests will FAIL if:
 *   1. The ESM require() bug exists in vscode-terminal-source.ts (findTerminalId unavailable)
 *   2. The shell execution event path is unwired from the buffer append path
 *   3. The observe gateway is not wired to the real buffer/redactor
 *
 * Proof surface: package integration using the real vscodeTerminalOutputSource adapter
 * with a mock TerminalShellExecutionStartEvent — the production runtime boundary.
 *
 * Exported API checklist:
 *   ✓ vscodeTerminalOutputSource — real source adapter (used via createTerminalReadDeps)
 *   ✓ terminalOutputBuffer       — real runtime buffer (verified via read after shell events)
 *   ✓ initTerminalRunGateway    — wires observe pipeline
 *   ✓ initTerminalReadGateway   — wires read pipeline
 *   ✓ createTerminalReadDeps     — creates real deps bag with vscodeTerminalOutputSource
 *   ✓ terminalRunHandler         — S-TR-09 (observe via real shell execution)
 *   ✓ terminalReadHandler       — S-TR-11 (continuation via real cursor)
 *   ✓ MockTerminalShellExecution — mock execution with async iterable read()
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";
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

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeMockTerminal(name = "Accordo") {
  return {
    name,
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
  };
}

/**
 * Mock TerminalShellExecutionStartEvent for directly invoking the source handler.
 * This simulates what VS Code's onDidStartTerminalShellExecution would fire.
 */
function makeMockStartEvent(
  terminal: { name: string },
  execution: MockTerminalShellExecution,
) {
  return {
    terminal,
    execution: execution as unknown as import("vscode").TerminalShellExecution,
  };
}

// ── beforeEach / afterEach ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();

  // Clear the real runtime buffer between tests
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-2");
});

afterEach(() => {
  // Stop all terminal tracking and clean up
  vscodeTerminalOutputSource.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-04: redaction via real shell-execution pipeline
//
// Runtime-proof: output chunks from execution.read() flow through the real
// terminalOutputBuffer.append() path, then through the real redactor in
// terminal_run observe and terminal_read. If the redactor is unwired or
// the append path is broken, observe text still contains secrets and tests fail.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-04: redaction via real shell-execution pipeline", () => {
  it("S-TR-04-RT-01: secret output from execution.read() is redacted in observe preview", async () => {
    // Arrange: tracked terminal + real buffer wired to observe pipeline
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Wire real deps into observe pipeline
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    // Attach the real source adapter to the terminal
    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    // Create mock execution with secret-containing output
    const mockExec = new MockTerminalShellExecution();
    mockExec.setChunks(["echo password=SuperSecret123\n"]);

    // Act: directly invoke the source handler as onDidStartTerminalShellExecution would
    // This tests the real capture path: execution.read() → buffer.append()
    const event = makeMockStartEvent(mock, mockExec);
    // Access the private handler via any-cast (testing internal wiring)
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event) => void }).onStartExecution(event);

    // Wait for the async read to complete (background streaming)
    await new Promise((r) => setTimeout(r, 50));

    // Assert: observe preview must redact the secret
    const result = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
      terminalId: "accordo-terminal-1",
    });

    expect(result).toHaveProperty("observe");
    const observeText = (result as { observe: { text: string } }).observe.text;
    // Secret must be redacted
    expect(observeText).not.toContain("SuperSecret123");
    expect(observeText).toContain("[SECRET]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-09: observe preview via real shell-execution event
//
// Runtime-proof: observe preview reads from terminalOutputBuffer which was
// populated by the shell-execution → execution.read() → buffer.append path.
// If the capture path is unwired, observe.text is empty and tests fail.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-09: observe preview via real shell-execution event", () => {
  it("S-TR-09-RT-03: shell execution command line is captured before output", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    const mockExec = new MockTerminalShellExecution(["/tmp\n"], "pwd");
    const event = makeMockStartEvent(mock, mockExec);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event) => void }).onStartExecution(event);
    await new Promise((r) => setTimeout(r, 50));

    const readResult = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    expect(readText).toContain("pwd");
    expect(readText.indexOf("pwd")).toBeLessThan(readText.indexOf("/tmp"));
  });

  it("S-TR-09-RT-04: command line is captured at execution end if unavailable at start", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    const mockExec = new MockTerminalShellExecution(["answer\n"]);
    const event = makeMockStartEvent(mock, mockExec);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event) => void }).onStartExecution(event);
    await new Promise((r) => setTimeout(r, 50));

    mockExec.commandLine = { value: "echo answer" };
    (vscodeTerminalOutputSource as unknown as { onEndExecution: (terminalId: string, execution: typeof mockExec) => void })
      .onEndExecution("accordo-terminal-1", mockExec);

    const readResult = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    expect(readText).toContain("answer");
    expect(readText).toContain("echo answer");
  });

  it("S-TR-09-RT-01: shell execution output reaches the buffer and appears in observe preview", async () => {
    // Arrange: tracked terminal + real buffer wired to observe pipeline
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Wire real deps
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    // Attach source adapter
    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    // Create mock execution with multi-chunk output
    const mockExec = new MockTerminalShellExecution();
    mockExec.setChunks(["first chunk\n", "second chunk\n", "third chunk\n"]);

    // Act: fire the shell execution through the source handler
    const event = makeMockStartEvent(mock, mockExec);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event) => void }).onStartExecution(event);

    // Wait for async streaming to complete
    await new Promise((r) => setTimeout(r, 50));

    // Assert: observe preview returns the captured output
    const result = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
      terminalId: "accordo-terminal-1",
    });

    expect(result).toHaveProperty("observe");
    const observe = result as { observe: { text: string; cursor: string; truncated: boolean } };
    expect(observe.observe).toHaveProperty("text");
    expect(observe.observe).toHaveProperty("cursor");
    expect(observe.observe).toHaveProperty("truncated");
    // The observed text must contain the streamed chunks
    expect(observe.observe.text).toContain("first chunk");
    expect(observe.observe.text).toContain("second chunk");
    expect(observe.observe.text).toContain("third chunk");
  });

  it("S-TR-09-RT-02: observe preview continues through terminal_read via real cursor from shell event", async () => {
    // Arrange: tracked terminal + real buffer + real observe pipeline
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    // Act: fire first shell execution event
    const mockExec = new MockTerminalShellExecution();
    mockExec.setChunks(["batch one output\n"]);
    const event1 = makeMockStartEvent(mock, mockExec);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event1) => void }).onStartExecution(event1);
    await new Promise((r) => setTimeout(r, 50));

    // Get observe cursor from terminal_run
    const runResult = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
      terminalId: "accordo-terminal-1",
    });
    expect(runResult).toHaveProperty("observe");
    const cursorFromObserve = (runResult as { observe: { cursor: string } }).observe.cursor;
    expect(cursorFromObserve).toMatch(/^t-accordo-terminal-1:/);

    // Fire second shell execution with new content
    const mockExec2 = new MockTerminalShellExecution();
    mockExec2.setChunks(["batch two output\n"]);
    const event2 = makeMockStartEvent(mock, mockExec2);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event2) => void }).onStartExecution(event2);
    await new Promise((r) => setTimeout(r, 50));

    // Assert: terminal_read using cursor from observe returns only batch two
    const readResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: cursorFromObserve,
    });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    // Must NOT contain "batch one" — cursor skips already-returned content
    expect(readText).not.toContain("batch one");
    expect(readText).toContain("batch two");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-11: observe cursor from terminal_run continues through terminal_read
//           via the real shell-execution pipeline
//
// This is the key continuation test that the Phase B reviewer flagged as
// missing the real runtime path. It fires a real shell execution event,
// captures output, emits observe cursor, then continues through terminal_read.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-11: run→read authority via real shell-execution pipeline", () => {
  it("S-TR-11-RT-01: observe cursor from shell-execution event continues through terminal_read", async () => {
    // Arrange: tracked terminal + real deps wired
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    vscodeTerminalOutputSource.attachToTerminal("accordo-terminal-1", mock as never);

    // Act: fire shell execution event with output
    const mockExec = new MockTerminalShellExecution();
    mockExec.setChunks(["initial output\n"]);
    const event = makeMockStartEvent(mock, mockExec);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event) => void }).onStartExecution(event);
    await new Promise((r) => setTimeout(r, 50));

    // terminal_run with observe → get cursor
    const runResult = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
      terminalId: "accordo-terminal-1",
    });
    expect(runResult).toHaveProperty("observe");
    const observeCursor = (runResult as { observe: { cursor: string } }).observe.cursor;
    expect(observeCursor).toMatch(/^t-accordo-terminal-1:/);

    // Fire second execution with new content
    const mockExec2 = new MockTerminalShellExecution();
    mockExec2.setChunks(["continuation output\n"]);
    const event2 = makeMockStartEvent(mock, mockExec2);
    (vscodeTerminalOutputSource as unknown as { onStartExecution: (e: typeof event2) => void }).onStartExecution(event2);
    await new Promise((r) => setTimeout(r, 50));

    // Assert: terminal_read with observe cursor returns only continuation output
    const readResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: observeCursor,
    });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    // Must not contain "initial output" (already returned via observe)
    expect(readText).not.toContain("initial output");
    expect(readText).toContain("continuation output");
  });
});
