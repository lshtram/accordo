/**
 * terminal-read.test.ts — Priority S Phase B · §S-TR-01
 * accordo_terminal_read terminalId resolution
 *
 * Phase B RED tests for terminalId resolution: explicit terminalId is resolved
 * first, then active-terminal fallback, including active untracked terminal adoption.
 * All tests MUST fail at assertion level against "not implemented" stubs.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-01 (terminalId resolution)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — used to build mock deps bag
 *   ✓ terminalMap                — used to register terminal for handler
 *   ✓ _resetTerminalMap          — called in beforeEach
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  terminalReadHandler,
} from "../tools/terminal-read/index.js";

import type {
  TerminalReadSuccess,
  TerminalOutputBuffer,
  TerminalOutputRedactor,
  TerminalOutputSource,
} from "../tools/terminal-read/contracts.js";

import * as vscodeMock from "./mocks/vscode.js";
import { _resetTerminalMap, terminalMap } from "../tools/terminal.js";

const { mockState } = vscodeMock;

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeMockDeps(overrides?: {
  source?: Partial<TerminalOutputSource>;
  buffer?: Partial<TerminalOutputBuffer>;
  redactor?: Partial<TerminalOutputRedactor>;
}) {
  const source: TerminalOutputSource = {
    startTrackingTerminal: vi.fn().mockResolvedValue(undefined),
    stopTrackingTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides?.source,
  };
  const buffer: TerminalOutputBuffer = {
    read: vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "output",
      cursor: "cursor-1",
      truncated: false,
    } satisfies TerminalReadSuccess),
    clearTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides?.buffer,
  };
  const redactor: TerminalOutputRedactor = {
    redact: (text: string) => text,
    ...overrides?.redactor,
  };
  return { source, buffer, redactor };
}

// ── Shared mock terminal helper ───────────────────────────────────────────────

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
// S-TR-01: terminalId resolution order
// Contract: explicit terminalId → active terminal → create-on-run (terminal.run)
//           For terminal.read: explicit terminalId → active terminal (no create).
//           Error: "No active terminal" when neither explicit nor active exists.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-01: terminalId resolution", () => {
  it("S-TR-01-01: resolves explicit terminalId from terminalMap and calls buffer.read", async () => {
    // Arrange: register a tracked terminal in terminalMap
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "explicit output",
      cursor: "cursor-explicit",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act
    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    // Assert: buffer.read was called for the explicit terminalId
    expect(readSpy).toHaveBeenCalled();
    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.terminalId).toBe("accordo-terminal-1");
  });

  it("S-TR-01-02: falls back to active terminal when terminalId is omitted", async () => {
    // Arrange: active terminal is tracked in terminalMap
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    mockState.activeTerminal = mock as never;
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "active output",
      cursor: "cursor-active",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act: no terminalId provided — must use active terminal
    const result = await terminalReadHandler({});

    // Assert: buffer.read was called with active terminal
    expect(readSpy).toHaveBeenCalled();
    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.terminalId).toBe("accordo-terminal-1");
  });

  it("S-TR-01-03: adopts untracked active terminal when no terminalId provided and no tracked active exists", async () => {
    // Arrange: VS Code has an active terminal but it is NOT in terminalMap (untracked).
    //         The handler should adopt it for the read.
    const untracked = makeMockTerminal("External");
    mockState.terminals = [untracked as never];
    mockState.activeTerminal = untracked as never;
    // NOT added to terminalMap — simulates a terminal opened manually in VS Code

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "External",
      text: "untracked output",
      cursor: "cursor-untracked",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act
    const result = await terminalReadHandler({});

    // Assert: handler adopted the untracked active terminal and read from it
    expect(readSpy).toHaveBeenCalled();
    expect(result).not.toHaveProperty("error");
  });

  it("S-TR-01-04: returns error when terminalId is explicit but not found in terminalMap", async () => {
    // Arrange: no terminals registered
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    // Act
    const result = await terminalReadHandler({ terminalId: "accordo-terminal-99" });

    // Assert: explicit non-existent terminalId → explicit error
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Terminal accordo-terminal-99 not found");
  });

  it("S-TR-01-05: returns error when no terminalId provided and no active terminal exists", async () => {
    // Arrange: empty terminalMap, no active terminal
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    // Act
    const result = await terminalReadHandler({});

    // Assert: "No active terminal" error — neither explicit nor fallback available
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active terminal");
  });
});
