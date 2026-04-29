/**
 * terminal-read-precedence.test.ts — Priority S Phase B · §S-TR-06
 * accordo_terminal_read deterministic validation precedence
 *
 * Phase B RED tests for deterministic error precedence/messages.
 * All tests MUST fail at assertion level against "not implemented" stubs.
 *
 * Validation order (S-TR-06 contract):
 *   1. terminalId resolution (explicit → active → error)
 *   2. bounds validation (maxLines/maxChars checked before read)
 *   3. cursor/terminal compatibility (since cursor must belong to terminalId)
 *
 * S-TR-06-01: missing target terminal → "No active terminal" / "Terminal X not found"
 * S-TR-06-02: bad bounds → "Argument 'maxLines' must be an integer between 1 and 500"
 * S-TR-06-03: cursor mismatch → "Cursor does not belong to terminal X"
 * S-TR-06-04..06: precedence — when multiple errors apply, the highest-priority fires
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-06 (validation precedence)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — used to build mock deps bag
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
// S-TR-06: deterministic validation precedence
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-06: deterministic validation precedence", () => {
  // S-TR-06-01: missing/invalid target terminal
  it("S-TR-06-01: returns 'Terminal X not found' when terminalId is explicit but not tracked", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-99" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Terminal accordo-terminal-99 not found");
  });

  // S-TR-06-02: bounds validation
  it("S-TR-06-02: returns bounds error for invalid maxLines before attempting read", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 0 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxLines' must be an integer between 1 and 500");
  });

  it("S-TR-06-03: returns bounds error for invalid maxChars before attempting read", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxChars: -1 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxChars' must be an integer between 1 and 20000");
  });

  // S-TR-06-04: cursor mismatch — cursor from one terminal used with another
  it("S-TR-06-04: returns 'Cursor does not belong to terminal X' when cursor lineage is wrong", async () => {
    const t1 = makeMockTerminal("T1");
    const t2 = makeMockTerminal("T2");
    mockState.terminals = [t1, t2] as never;
    terminalMap.set("accordo-terminal-1", t1);
    terminalMap.set("accordo-terminal-2", t2);

    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    // t1-cursor was obtained from terminal-1, but we request terminal-2 with it
    const result = await terminalReadHandler({ terminalId: "accordo-terminal-2", since: "t1-cursor" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Cursor does not belong to terminal accordo-terminal-2");
  });

  // S-TR-06-05..06: precedence — when two errors could apply, the higher-priority fires
  it("S-TR-06-05: bounds error fires before terminal resolution when maxLines is invalid for a non-existent terminal", async () => {
    // Both maxLines=0 (invalid) AND terminalId=accordo-terminal-99 (not found) apply.
    // Bounds validation has higher precedence than terminal resolution.
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-99", maxLines: 0 });

    // Must fire bounds error (higher precedence) — NOT terminal-not-found error
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxLines' must be an integer between 1 and 500");
  });

  it("S-TR-06-06: when cursor is invalid for a non-existent terminal, terminal-not-found fires before cursor mismatch", async () => {
    // Both terminal-not-found AND cursor-mismatch apply.
    // Terminal resolution (step 1) fires before cursor validation (step 3).
    // So terminal-not-found fires first.
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-99", since: "some-cursor" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Terminal accordo-terminal-99 not found");
  });
});
