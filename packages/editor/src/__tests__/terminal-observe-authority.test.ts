/**
 * terminal-observe-authority.test.ts — Priority S Phase B · §S-TR-11
 * accordo_terminal_run observe does not replace terminal_read authority
 *
 * Phase B runtime-proof tests for run→read continuity authority (S-TR-11).
 *
 * S-TR-11 contract: terminal_read remains the authoritative incremental surface.
 * terminal_run observe is purely additive preview — it does NOT replace or
 * supersede terminal_read for continuation.
 *
 * Runtime-proof strategy:
 *   Uses the REAL runtime buffer (terminalOutputBuffer.test_only_append) with
 *   actual emitted cursor format so that the encoder/decoder round-trip is
 *   exercised. If the observe cursor cannot be consumed by terminal_read
 *   (format mismatch, unwired pipeline), the continuation test fails.
 *
 *   S-TR-11-01: static registration — terminal_read has 'since' param (PASS-ELIGIBLE)
 *   S-TR-11-02: runtime continuation — observe cursor from terminal_run is used
 *               to continue reading through terminal_read with the real buffer.
 *               NOT pass-eligible — requires the full runtime pipeline.
 *
 * Exported API checklist:
 *   ✓ terminalReadTools[]   — S-TR-11-01 (terminal_read registration + schema)
 *   ✓ terminalRunHandler    — S-TR-11-02 (observe cursor used in terminal_read)
 *   ✓ terminalReadHandler   — S-TR-11-02 (continuation via real cursor path)
 *   ✓ terminalOutputBuffer  — real runtime buffer for cursor round-trip proof
 *   ✓ initTerminalRunGateway — wires real buffer into observe pipeline
 *   ✓ initTerminalReadGateway — wires real buffer into read pipeline
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { terminalReadTools } from "../tools/terminal-read/index.js";
import {
  terminalRunHandler,
  terminalMap,
  _resetTerminalMap,
} from "../tools/terminal.js";
import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  terminalReadHandler,
} from "../tools/terminal-read/index.js";
import { initTerminalRunGateway } from "../tools/terminal/terminal-run.js";
import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";

import * as vscodeMock from "./mocks/vscode.js";
const { window, mockState } = vscodeMock;

function makeMockTerminal(name = "Accordo") {
  return { name, show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-11: follow-up terminal_read remains authoritative
// Contract: terminal_run observe preview does not replace terminal_read as the
//           authoritative incremental surface. Both tools are registered and
//           terminal_read has the 'since' parameter for continuation.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-11: follow-up terminal_read remains authoritative", () => {
  it("S-TR-11-01: accordo_terminal_read is registered with 'since' param for incremental continuation", async () => {
    // PASS-ELIGIBLE-IN-B: static tool registration metadata is correct in Phase A stubs.
    // Verifies the tool definition exposes the 'since' parameter for incremental reads.
    expect(terminalReadTools).toHaveLength(1);
    expect(terminalReadTools[0].name).toBe("accordo_terminal_read");
    const readSchema = terminalReadTools[0].inputSchema;
    expect(readSchema.properties).toHaveProperty("since");
  });

  it("S-TR-11-02: terminal_read schema includes terminalId, since, maxLines, maxChars for full continuation", async () => {
    // Verifies the terminal_read schema contains all parameters needed for
    // authoritative incremental continuation after observe preview.
    const schema = terminalReadTools[0].inputSchema;
    expect(schema.properties).toHaveProperty("terminalId");
    expect(schema.properties).toHaveProperty("since");
    expect(schema.properties).toHaveProperty("maxLines");
    expect(schema.properties).toHaveProperty("maxChars");
    // All params are optional — caller can pick what it needs for continuation
    expect(schema.required).toEqual([]);
  });

  it("S-TR-11-RT-01: observe cursor from terminal_run continues through terminal_read (real runtime pipeline)", async () => {
    // S-TR-11 runtime-proof: uses real buffer + actual emitted cursor format.
    // If the observe pipeline is unwired or cursor format mismatched between
    // encoder (makeCursor) and decoder (cursorKey), the continuation fails.
    //
    // Arrange: tracked terminal + real buffer populated with two output batches
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Wire real deps into both run and read gateways
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    // Append first batch
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "batch one output\n");

    // Step 1: terminal_run with observe to capture cursor
    const runResult = await terminalRunHandler({
      command: "echo first",
      observeMaxLines: 50,
    });
    expect(runResult).toHaveProperty("observe");
    const observeCursor = (runResult as { observe: { cursor: string } }).observe.cursor;
    expect(observeCursor).toMatch(/^t-accordo-terminal-1:/);

    // Step 2: append second batch (new content after cursor was issued)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "batch two output\n");

    // Step 3: terminal_read using cursor from observe — must return only batch two
    const readResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: observeCursor,
    });

    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    // Cursor must skip "batch one output" — only "batch two output" returned
    expect(readText).not.toContain("batch one");
    expect(readText).toContain("batch two");
  });

  it("S-TR-11-RT-02: observe preview redacted via same pipeline as terminal_read (shared redaction)", async () => {
    // Prove observe preview uses the same redactor as terminal_read.
    // A secret in buffer must appear redacted in observe AND in follow-up read.
    const mock = makeMockTerminal();
    vi.mocked(window.createTerminal).mockReturnValueOnce(mock as never);
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);
    initTerminalRunGateway({
      read: (req) => realDeps.buffer.read(req),
      redact: (text) => realDeps.redactor.redact(text),
    });

    // Append content with a secret
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "password=SuperSecret123\npublic output\n");

    // Observe preview
    const runResult = await terminalRunHandler({
      command: "echo done",
      observeMaxLines: 50,
    });
    expect(runResult).toHaveProperty("observe");
    const observeText = (runResult as { observe: { text: string } }).observe.text;

    // Both observe and follow-up read must redact the same secret
    expect(observeText).not.toContain("SuperSecret123");
    expect(observeText).toContain("[SECRET]");

    // Follow-up read via cursor
    const observeCursor = (runResult as { observe: { cursor: string } }).observe.cursor;
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "more output\n");
    const readResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: observeCursor,
    });
    expect(readResult).not.toHaveProperty("error");
    const readText = (readResult as { text: string }).text;
    expect(readText).not.toContain("SuperSecret123");
  });
});