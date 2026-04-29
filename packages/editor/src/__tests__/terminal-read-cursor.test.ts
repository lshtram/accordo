/**
 * terminal-read-cursor.test.ts — Priority S Phase B · §S-TR-02
 * accordo_terminal_read incremental cursor semantics
 *
 * Phase B RED tests for opaque cursor handling and cross-terminal rejection.
 * All tests MUST fail at assertion level against "not implemented" stubs.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-02 (cursor passing, cross-terminal rejection)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — used to build mock deps bag
 *   ✓ TerminalOutputBuffer.read  — mocked in deps bag
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

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-02: incremental reads via opaque cursor
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-02: incremental reads via cursor", () => {
  it("S-TR-02-01: passes the 'since' cursor to the buffer", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "new output only",
      cursor: "cursor-new",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    await terminalReadHandler({ terminalId: "accordo-terminal-1", since: "cursor-old-123" });

    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ since: "cursor-old-123" }),
    );
  });

  it("S-TR-02-02: returns the cursor from the buffer in the response", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const deps = makeMockDeps({
      buffer: {
        read: vi.fn().mockResolvedValue({
          terminalId: "accordo-terminal-1",
          text: "output",
          cursor: "opaque-cursor-value-456",
          truncated: false,
        } satisfies TerminalReadSuccess),
      },
    });
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.cursor).toBe("opaque-cursor-value-456");
  });

  it("S-TR-02-03: rejects 'since' cursor from a different terminal with explicit error", async () => {
    const t1 = makeMockTerminal("T1");
    const t2 = makeMockTerminal("T2");
    mockState.terminals = [t1, t2] as never;
    terminalMap.set("accordo-terminal-1", t1);
    terminalMap.set("accordo-terminal-2", t2);

    const readSpy = vi.fn().mockResolvedValue({
      terminalId: "accordo-terminal-1",
      text: "t1 output",
      cursor: "t1-cursor",
      truncated: false,
    } satisfies TerminalReadSuccess);

    const deps = makeMockDeps({ buffer: { read: readSpy } });
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-2", since: "t1-cursor" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Cursor does not belong to terminal accordo-terminal-2");
  });
});