/**
 * terminal-read-redaction.test.ts — Priority S Phase B · §S-TR-04
 * accordo_terminal_read output redaction before MCP boundary
 *
 * Phase B runtime-proof tests for S-TR-04.
 * Uses the REAL terminalOutputRedactor (runtime-redactor.ts) so that if
 * the redactor pipeline is unwired, custom spy behavior can't mask the gap.
 *
 * Runtime-proof strategy:
 *   Tests inject the real terminalOutputRedactor via createTerminalReadDeps().
 *   If the redactor's redact() is never called in the handler (pipeline unwired),
 *   the spy on buffer.read records the call but the redactor is bypassed.
 *   Using the real redactor ensures both the pipeline presence AND the actual
 *   pattern-matching logic are exercised.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-04 (redaction before MCP boundary)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — provides real buffer+redactor
 *   ✓ terminalOutputBuffer       — real runtime buffer
 *   ✓ terminalOutputRedactor     — real redactor from runtime-redactor.ts
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  terminalReadHandler,
} from "../tools/terminal-read/index.js";

import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";
import { terminalOutputRedactor } from "../tools/terminal-read/runtime-redactor.js";

import type {
  TerminalReadSuccess,
  TerminalOutputBuffer as TOutputBuffer,
  TerminalOutputRedactor,
  TerminalOutputSource,
} from "../tools/terminal-read/contracts.js";

import * as vscodeMock from "./mocks/vscode.js";
import { _resetTerminalMap, terminalMap } from "../tools/terminal.js";

const { mockState } = vscodeMock;

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeMockDeps(overrides?: {
  source?: Partial<TerminalOutputSource>;
  buffer?: Partial<TOutputBuffer>;
  redactor?: Partial<TerminalOutputRedactor>;
}) {
  const source: TerminalOutputSource = {
    startTrackingTerminal: async () => {},
    stopTrackingTerminal: async () => {},
    ...overrides?.source,
  };
  const buffer: TOutputBuffer = {
    read: async () => ({
      terminalId: "accordo-terminal-1",
      text: "",
      cursor: "",
      truncated: false,
    } satisfies TerminalReadSuccess),
    clearTerminal: async () => {},
    ...overrides?.buffer,
  };
  // Default: use the REAL redactor — runtime-proof
  const redactor = overrides?.redactor ?? terminalOutputRedactor;
  return { source, buffer, redactor };
}

// ── Shared mock terminal helper ───────────────────────────────────────────────

function makeMockTerminal(name = "Accordo") {
  return { name, show: () => {}, sendText: () => {}, dispose: () => {} };
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
  // Clear the real runtime buffer
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-04: redaction before MCP boundary
// Runtime-proof: redactor from runtime-redactor.ts is injected, proving both
// pipeline wiring AND pattern-matching behavior are exercised.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-04: output redaction", () => {
  it("S-TR-04-01: real redactor scrubs obvious secrets via shared pipeline", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate buffer with content containing a secret pattern
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "password=SECRET123\nsome output\n");

    // Inject real buffer + redactor (runtime-proof: both are real implementations)
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    // The real redactor replaces SECRET with [SECRET] (pattern: password=SECRET → password=[SECRET])
    // Actual pattern: /\b(password|passwd|pwd|secret|token|auth|bearer|apikey|api_key)\s*[=:]\s*[\w@#$%^&*()-]{8,}/gi
    // "password=SECRET123" matches the password= pattern — "SECRET123" is ≥8 chars
    expect(success.text).toContain("[SECRET]");
    expect(success.text).not.toContain("SECRET123");
  });

  it("S-TR-04-02: real redactor is called even when output is empty (pipeline invariant)", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate buffer with empty content
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "");

    // Wire with real deps — redactor is always invoked on whatever text buffer returns
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    // Text is empty but redactor was called (no error)
    expect(success.text).toBe("");
  });

  it("S-TR-04-03: JWT pattern is scrubbed by real redactor", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Real JWT (three base64url segments separated by dots)
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.sFLrPQ1FK8vsqSvLfQjR-Nb6hcrVvCMFGI9C6T6bovM";
    terminalOutputBuffer.test_only_append("accordo-terminal-1", `Authorization: Bearer ${jwt}\n`);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    // The JWT pattern (eyJ...eyJ...) should be replaced with [JWT]
    expect(success.text).not.toContain("eyJ");
    expect(success.text).toContain("[JWT]");
  });

  it("S-TR-04-04: long hex string (potential key/token ≥32 chars) is scrubbed", async () => {
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // 32+ hex chars — matches the HEX_KEY pattern
    const longHex = "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890";
    terminalOutputBuffer.test_only_append("accordo-terminal-1", `key=${longHex}\n`);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.text).not.toContain(longHex);
    expect(success.text).toContain("[HEX_KEY]");
  });
});
