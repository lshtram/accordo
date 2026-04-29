/**
 * terminal-read-truncated.test.ts — Priority S Phase B · §S-TR-03-05..11
 * accordo_terminal_read truncation signaling and bounds validation
 *
 * Phase B RED tests for truncation signaling (S-TR-03-05) and bounds
 * validation (S-TR-03-06..11). All tests MUST fail at assertion level.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-03-05..11 (truncated, bounds validation)
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
// S-TR-03-05: truncated signaling
// S-TR-03-06..11: bounds validation (maxLines, maxChars)
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-03-05: truncated signaling", () => {
  it("S-TR-03-05: returns truncated: true when buffer signals truncation", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const deps = makeMockDeps({
      buffer: {
        read: vi.fn().mockResolvedValue({
          terminalId: "accordo-terminal-1",
          text: "x".repeat(20000),
          cursor: "cursor-truncated",
          truncated: true,
        } satisfies TerminalReadSuccess),
      },
    });
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.truncated).toBe(true);
  });
});

describe("S-TR-03-06..11: bounds validation", () => {
  it("S-TR-03-06: rejects maxLines = 0 (must be positive integer)", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 0 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxLines' must be an integer between 1 and 500");
  });

  it("S-TR-03-07: rejects maxLines > 500 (hard cap)", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 501 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxLines' must be an integer between 1 and 500");
  });

  it("S-TR-03-08: rejects maxLines = non-integer", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxLines: 3.14 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxLines' must be an integer between 1 and 500");
  });

  it("S-TR-03-09: rejects maxChars > 20000 (hard cap)", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxChars: 20001 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxChars' must be an integer between 1 and 20000");
  });

  it("S-TR-03-10: rejects maxChars = 0 (must be positive integer)", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxChars: 0 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxChars' must be an integer between 1 and 20000");
  });

  it("S-TR-03-11: rejects maxChars = non-integer", async () => {
    const deps = makeMockDeps();
    initTerminalReadGateway(deps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1", maxChars: 99.9 });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Argument 'maxChars' must be an integer between 1 and 20000");
  });
});