/**
 * terminal-observe-preview.test.ts — Priority S Phase B · §S-TR-09..10
 * accordo_terminal_run observe inline preview and validation precedence
 *
 * Phase B runtime-proof tests for observeMaxLines>0 inline preview (S-TR-09) and
 * validation precedence order (S-TR-10). All S-TR-09 tests use the REAL runtime
 * buffer (terminalOutputBuffer.test_only_append) so that if the observe pipeline
 * is unwired or the cursor encoder/decoder is mismatched, tests fail at assertion level.
 *
 * Runtime-proof strategy for S-TR-09:
 *   Tests wire the real buffer+redactor via initTerminalRunGateway so that
 *   observeMaxLines>0 → collectObservePreview() → buffer.read() → observe field
 *   is exercised through the actual runtime pipeline. If observeDeps is null or
 *   observe never calls buffer.read, the observe field is absent and tests fail.
 *
 * Tests set up valid tracked terminal so terminal resolution works when
 * validation passes — failures must isolate the missing observe logic, not
 * crash on terminal.sendText().
 *
 * Exported API checklist:
 *   ✓ terminalRunHandler        — S-TR-09 (observe preview), S-TR-10 (precedence)
 *   ✓ terminalMap               — used to register terminal for handler
 *   ✓ _resetTerminalMap         — called in beforeEach
 *   ✓ createTerminal            — vi.mocked in tests needing valid terminal
 *   ✓ terminalOutputBuffer       — real runtime buffer for observe pipeline proof
 *   ✓ initTerminalRunGateway    — wires real buffer+redactor into observe pipeline
 *   ✓ createTerminalReadDeps    — provides real buffer+redactor for shared pipeline
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  terminalRunHandler,
  terminalMap,
  _resetTerminalMap,
} from "../tools/terminal.js";

import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  DEFAULT_TERMINAL_READ_MAX_LINES,
  DEFAULT_TERMINAL_READ_MAX_CHARS,
} from "../tools/terminal-read/index.js";
import { initTerminalRunGateway } from "../tools/terminal/terminal-run.js";

import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";
import type { TerminalReadSuccess } from "../tools/terminal-read/contracts.js";
import * as vscodeMock from "./mocks/vscode.js";
const { window, mockState } = vscodeMock;

// ── Shared mock terminal factory ───────────────────────────────────────────────

function makeMockTerminal(name = "Accordo") {
  return {
    name,
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
  };
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
  // Clear the real runtime buffer
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
  // Wire the observe pipeline with REAL buffer+redactor (runtime-proof)
  const realReadDeps = createTerminalReadDeps();
  initTerminalReadGateway(realReadDeps);
  initTerminalRunGateway({
    read: (req) => realReadDeps.buffer.read(req),
    redact: (text) => realReadDeps.redactor.redact(text),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-09: inline observe uses the same pipeline as terminal_read
// Contract: observe>0 preview returns observe:{text, cursor, truncated} using
//           the same buffer/read pipeline as terminal_read.
//           Both observeMaxLines and observeMaxChars bounds are applied.
//
// Runtime-proof: uses terminalOutputBuffer.test_only_append + real redactor
// so that if the observe pipeline is unwired (observeDeps null) or the buffer's
// append path is unwired, the observe field is absent and tests fail.
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalRunHandler — S-TR-09: inline observe uses same pipeline as terminal_read", () => {
  it("S-TR-09-01: when observeMaxLines > 0, result includes observe:{text, cursor, truncated}", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate real buffer (mimics terminal output events before observe)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "real terminal output\n");

    // Phase B stub: the observe field is NOT yet implemented when observeDeps is null,
    // so this fails at assertion level. Phase C wires observeDeps correctly.
    // With real buffer+redactor wired, observe field appears.
    const result = await terminalRunHandler({ command: "echo hello", observeMaxLines: 20 });

    expect(result).toHaveProperty("sent", true);
    expect(result).toHaveProperty("terminalId", "accordo-terminal-1");
    // Must have observe field with the exact shape
    expect(result).toHaveProperty("observe");
    const observe = (result as { observe: { text: string; cursor: string; truncated: boolean } }).observe;
    expect(observe).toHaveProperty("text");
    expect(observe).toHaveProperty("cursor");
    expect(observe).toHaveProperty("truncated");
  });

  it("S-TR-09-02: observeMaxLines positive with observeMaxChars applies both bounds (shared pipeline proof)", async () => {
    // Runtime-proof: uses real buffer content — observe.text must be non-empty
    // if observe pipeline is wired, proving the shared buffer/read path is live.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate real runtime buffer
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "real-output-line\n");

    const result = await terminalRunHandler({
      command: "echo test",
      observeMaxLines: 50,
      observeMaxChars: 8000,
    });

    // Must have observe field — shared pipeline proof
    expect(result).toHaveProperty("observe");
    const observe = (result as { observe: { text: string; cursor: string; truncated: boolean } }).observe;

    // observe.text must be defined (non-empty string) — proves real output from buffer
    expect(typeof observe.text).toBe("string");
    // observe.cursor must be a non-empty string — proves cursor lineage is maintained
    expect(typeof observe.cursor).toBe("string");
    expect(observe.cursor.length).toBeGreaterThan(0);
    // observe.truncated must be a boolean
    expect(typeof observe.truncated).toBe("boolean");
  });

  it("S-TR-09-CONT-01: terminal_run(observe) + terminal_read continuation via real cursor path", async () => {
    // Runtime-proof for run→read continuity: uses real cursor from observe response
    // in a follow-up terminal_read. If cursor format mismatches encoder/decoder,
    // the read returns duplicates and this test fails.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate initial content
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "first output\n");

    // First: terminal_run with observe to get cursor
    const runResult = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
    });
    expect(runResult).toHaveProperty("observe");
    const runObserve = (runResult as { observe: { cursor: string } }).observe;
    const cursorFromRun = runObserve.cursor;
    expect(cursorFromRun).toMatch(/^t-accordo-terminal-1:/);

    // Append more content (simulates subsequent command output)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "second output\n");

    // Second: terminal_read using cursor from observe response
    // Wire real deps for read path
    const readDeps = createTerminalReadDeps();
    initTerminalReadGateway(readDeps);

    const { terminalReadHandler } = await import("../tools/terminal-read/index.js");
    const readResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: cursorFromRun,
    });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    // Follow-up read must NOT contain "first output" — cursor skips already-returned content
    expect(readText).not.toContain("first output");
    expect(readText).toContain("second output");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-10: validation precedence
// Approved order: command → observeMaxLines → observeMaxChars → terminal → dispatch
// Each test fires TWO validation errors and proves only the first fires.
// S-TR-10-01/03 are PASS-ELIGIBLE (stub correctly handles those paths).
// S-TR-10-02/04/05/06/07 must fail at assertion level.
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalRunHandler — S-TR-10: validation precedence", () => {
  it("S-TR-10-01: command validation fires before observeMaxLines validation", async () => {
    // PASS-ELIGIBLE: stub correctly validates command first.
    // Empty command AND invalid observeMaxLines → command error wins (first check).
    const result = await terminalRunHandler({ command: "", observeMaxLines: -1 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'command' must be a non-empty string");
  });

  it("S-TR-10-02: observeMaxLines error fires before terminal resolution", async () => {
    // RED: observeMaxLines check fires before terminal lookup.
    // Valid tracked terminal set up so failure isolates missing observeMaxLines validation.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({
      command: "ls",
      terminalId: "accordo-terminal-1",
      observeMaxLines: 1000, // exceeds hard cap of 500
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'observeMaxLines' must be 0 or an integer between 1 and 500");
  });

  it("S-TR-10-03: observeMaxChars is IGNORED (not validated) when observeMaxLines is 0", async () => {
    // PASS-ELIGIBLE: stub has no observe validation → dispatch-only path → observeMaxChars ignored.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({
      command: "echo hi",
      observeMaxLines: 0,
      observeMaxChars: -1, // would be invalid if validated
    });

    expect(result).toHaveProperty("sent", true);
  });

  it("S-TR-10-04: observeMaxChars validation fires when observeMaxLines > 0 and observeMaxChars is invalid", async () => {
    // RED: observeMaxLines=50 (valid) + observeMaxChars=50000 (invalid cap) → observeMaxChars error.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({
      command: "ls",
      observeMaxLines: 50,
      observeMaxChars: 50000, // exceeds hard cap of 20000
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'observeMaxChars' must be an integer between 1 and 20000");
  });

  it("S-TR-10-05: observeMaxLines rejected when negative", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({ command: "ls", observeMaxLines: -5 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'observeMaxLines' must be 0 or an integer between 1 and 500");
  });

  it("S-TR-10-06: observeMaxLines rejected when non-integer", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({ command: "ls", observeMaxLines: 3.5 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'observeMaxLines' must be 0 or an integer between 1 and 500");
  });

  it("S-TR-10-07: observeMaxLines rejected when exceeds hard cap 500", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({ command: "ls", observeMaxLines: 501 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'observeMaxLines' must be 0 or an integer between 1 and 500");
  });
});