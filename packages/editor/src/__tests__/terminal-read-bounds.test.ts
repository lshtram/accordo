/**
 * terminal-read-bounds.test.ts — Priority S Phase B · §S-TR-03-01..04
 * accordo_terminal_read default limits and custom bounds
 *
 * Phase B RED tests for default limits (S-TR-03-01..02) and custom bounds
 * application (S-TR-03-03..04). All tests MUST fail at assertion level against
 * "not implemented" stubs.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-03-01..04 (default limits, custom bounds)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — used to build mock deps bag
 *   ✓ DEFAULT_TERMINAL_READ_MAX_LINES — imported from contracts
 *   ✓ DEFAULT_TERMINAL_READ_MAX_CHARS — imported from contracts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  terminalReadHandler,
  DEFAULT_TERMINAL_READ_MAX_LINES,
  DEFAULT_TERMINAL_READ_MAX_CHARS,
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
      text: "",
      cursor: "",
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

// ── Constants ─────────────────────────────────────────────────────────────────

// S-TR-03-01..02: defaults must match contracts (200/12000, NOT 500/20000)
// Hard caps are tested separately in S-TR-03-06..11
const DEFAULT_LINES = 200;
const DEFAULT_CHARS = 12000;

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-03-01..02: default limits
// Contract: when maxLines/maxChars are omitted, the handler applies defaults
//            before calling buffer.read.
//   - S-TR-03-01: maxLines defaults to 500
//   - S-TR-03-02: maxChars defaults to 20000
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-03-01..02: default limits applied to buffer.read", () => {
  it("S-TR-03-01: maxLines defaults to 200 when omitted — buffer.read called with correct default", async () => {
    // Arrange
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "output",
      cursor: "cursor",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act: no maxLines provided
    await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    // Assert: buffer.read was called with default maxLines of 200
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxLines: DEFAULT_LINES }),
    );
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxLines: DEFAULT_TERMINAL_READ_MAX_LINES }),
    );
  });

  it("S-TR-03-02: maxChars defaults to 12000 when omitted — buffer.read called with correct default", async () => {
    // Arrange
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "output",
      cursor: "cursor",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act: no maxChars provided
    await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    // Assert: buffer.read was called with default maxChars of 12000
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxChars: DEFAULT_CHARS }),
    );
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxChars: DEFAULT_TERMINAL_READ_MAX_CHARS }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-03-03..04: custom bounds
// Contract: when maxLines/maxChars are explicitly provided, they are passed
//            through to buffer.read (within hard-cap limits).
//   - S-TR-03-03: custom maxLines is passed to buffer.read
//   - S-TR-03-04: custom maxChars is passed to buffer.read
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-03-03..04: custom bounds passed to buffer.read", () => {
  it("S-TR-03-03: custom maxLines=100 is passed to buffer.read", async () => {
    // Arrange
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "output",
      cursor: "cursor",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act: custom maxLines of 100
    await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 100 });

    // Assert: buffer.read received the custom maxLines
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxLines: 100 }),
    );
  });

  it("S-TR-03-04: custom maxChars=5000 is passed to buffer.read", async () => {
    // Arrange
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "output",
      cursor: "cursor",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    // Act: custom maxChars of 5000
    await terminalReadHandler({ terminalId: "accordo-terminal-1", maxChars: 5000 });

    // Assert: buffer.read received the custom maxChars
    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxChars: 5000 }),
    );
  });
});
