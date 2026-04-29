/**
 * terminal-observe-legacy.test.ts — Priority S Phase B · §S-TR-07..08
 * accordo_terminal_run dispatch-only (legacy) behavior and backward-compat
 *
 * Phase B RED tests for dispatch-only path (no observe preview).
 * S-TR-07: omit observeMaxLines OR set to 0 → same dispatch-only shape.
 * S-TR-08: observeMaxLines=0 is semantically identical to omit; observeMaxChars ignored.
 *
 * All tests MUST fail at assertion level against "not implemented" stubs.
 * Tests set up valid tracked terminal so terminal resolution works.
 *
 * Exported API checklist:
 *   ✓ terminalRunHandler        — S-TR-07..08 (dispatch-only, backward compat)
 *   ✓ terminalMap               — used to register terminal for handler
 *   ✓ _resetTerminalMap         — called in beforeEach
 *   ✓ createTerminal            — vi.mocked in each test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  terminalRunHandler,
  terminalMap,
  _resetTerminalMap,
} from "../tools/terminal.js";

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
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-07: dispatch-only (legacy) — observe is purely additive
// Contract: omit observeMaxLines OR set to 0 → same dispatch-only response shape
//           { sent: true, terminalId } with NO observe field
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalRunHandler — S-TR-07: dispatch-only (legacy) behavior", () => {
  it("S-TR-07-01: returns { sent: true, terminalId } without observe field when observeMaxLines is omitted", async () => {
    // Setup: valid tracked terminal — createTerminal + mockState.terminals
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({ command: "ls" });

    expect(result).toHaveProperty("sent", true);
    expect(result).toHaveProperty("terminalId");
    expect((result as { observe?: unknown }).observe).toBeUndefined();
  });

  it("S-TR-07-02: returns { sent: true, terminalId } without observe field when observeMaxLines is 0", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const result = await terminalRunHandler({ command: "echo hi", observeMaxLines: 0 });

    expect(result).toHaveProperty("sent", true);
    expect(result).toHaveProperty("terminalId");
    expect((result as { observe?: unknown }).observe).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-08: backward-compatible dispatch-only response
// Contract: observeMaxLines=0 is semantically identical to omitting it entirely.
//           No preview is attempted, and observeMaxChars is IGNORED when observe=0.
// ─────────────────────────────────────────────────────────────────────────────

describe("terminalRunHandler — S-TR-08: backward-compatible dispatch-only response", () => {
  it("S-TR-08-01: observeMaxLines=0 produces identical shape to omitting observeMaxLines", async () => {
    const mock = makeMockTerminal();
    // mockReturnValue (persistent) ensures createTerminal() always returns the same terminal
    vi.mocked(window.createTerminal).mockReturnValue(mock as never);
    mockState.terminals = [mock as never];
    mockState.activeTerminal = mock as never;
    terminalMap.set("accordo-terminal-1", mock);

    const r1 = await terminalRunHandler({ command: "ls" });
    const r2 = await terminalRunHandler({ command: "ls", observeMaxLines: 0 });

    // Both calls share the same active terminal, so terminalId is identical.
    // Exact equality — both must be { sent: true, terminalId: "accordo-terminal-1" }
    expect(r1).toEqual(r2);
  });

  it("S-TR-08-02: observeMaxChars is ignored when observeMaxLines is 0 (no preview attempted)", async () => {
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // observeMaxLines=0 + observeMaxChars=50000 (exceeds cap) must succeed.
    // If observeMaxChars were validated, it would reject before the dispatch path.
    const result = await terminalRunHandler({
      command: "pwd",
      observeMaxLines: 0,
      observeMaxChars: 50000, // would be invalid if validated
    });

    expect(result).toHaveProperty("sent", true);
    expect((result as { observe?: unknown }).observe).toBeUndefined();
  });
});