/**
 * terminal-read-cursor-continuity.test.ts — Priority S Phase B · §S-TR-02, S-TR-11
 * Real runtime buffer cursor continuation using actual emitted cursor format
 *
 * Phase B tests proving the runtime buffer cursor encoder/decoder round-trip:
 *   - Cursor emitted as `t-{terminalId}:{base64url(timestamp:terminalId:lineIndex:charOffset)}`
 *   - Using returned cursor in next read excludes already-returned content
 *   - Cross-terminal cursor rejection uses real cursor parsing
 *
 * These tests use the REAL runtime buffer (terminalOutputBuffer.test_only_append)
 * so that any encoder/decoder format mismatch causes assertion failure.
 * This is the required runtime-proof surface for S-TR-02 and S-TR-11 per
 * docs/test-plan-terminal-readback.md §4.2.
 *
 * Independence: each test explicitly initializes the read gateway in its own
 * Arrange step. No test relies on state established by a prior test.
 *
 * Exported API checklist:
 *   ✓ terminalOutputBuffer      — real runtime buffer, test_only_append + read
 *   ✓ createTerminalReadDeps     — injects real buffer+redactor into handler
 *   ✓ initTerminalReadGateway    — wires deps into handler (called per-test)
 *   ✓ terminalReadHandler        — S-TR-02, S-TR-11 (cursor continuation via real pipeline)
 */

import { describe, it, expect, beforeEach } from "vitest";

import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";
import {
  createTerminalReadDeps,
  initTerminalReadGateway,
  terminalReadHandler,
} from "../tools/terminal-read/index.js";

import { _resetTerminalMap, terminalMap } from "../tools/terminal.js";

import * as vscodeMock from "./mocks/vscode.js";
const { mockState } = vscodeMock;

function makeMockTerminal(name = "Accordo") {
  return { name, show: () => {}, sendText: () => {}, dispose: () => {} };
}

// ── Shared terminal-map setup helper (used in each test's Arrange) ───────────

function trackTerminal(terminalId: string, name = "Accordo") {
  const mock = makeMockTerminal(name);
  mockState.terminals = [mock as never];
  terminalMap.set(terminalId, mock);
  return mock;
}

// ── beforeEach: clean slate for every test ───────────────────────────────────

beforeEach(() => {
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
  // Clear the real buffer between tests
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-2");
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-02 / S-TR-11 — runtime cursor format and continuation proof
//
// Cursor format: t-{terminalId}:{base64url(timestamp:terminalId:lineIndex:charOffset)}
//
// Tests use the real buffer so that:
//   - makeCursor (encoder) and cursorKey/cursor parsing (decoder) must match exactly
//   - If append path is unwired, buffer.read returns empty and test fails
//   - If cursor format changes without decoder update, second read returns duplicates
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-02 / S-TR-11: real buffer cursor continuation", () => {
  it("S-TR-02-CONT-01: first read returns non-empty cursor in runtime format", async () => {
    // Arrange: tracked terminal + real buffer + explicit gateway init (independence)
    trackTerminal("accordo-terminal-1");

    // Append real content to the runtime buffer (mimics terminal output events)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "line one\nline two\nline three");

    // Explicit gateway initialization (per-test independence contract)
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    // Act: first read — no cursor, should return all content
    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as { terminalId: string; text: string; cursor: string; truncated: boolean };
    expect(success.cursor).toBeTruthy();
    expect(success.cursor.length).toBeGreaterThan(0);

    // Cursor must be in the runtime format: t-accordo-terminal-1:{base64payload}
    expect(success.cursor).toMatch(/^t-accordo-terminal-1:/);
  });

  it("S-TR-02-CONT-02: second read with cursor returns ONLY subsequent content (no duplicates)", async () => {
    // Arrange: tracked terminal + real buffer + explicit gateway init (independence)
    trackTerminal("accordo-terminal-1");

    // Append first batch to the runtime buffer
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "first batch line\n");

    // Explicit gateway initialization for this test
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    // First read — captures cursor at end of first batch
    const firstResult = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    expect(firstResult).not.toHaveProperty("error");
    const cursorAfterFirst = (firstResult as { cursor: string }).cursor;

    // Append more content after the cursor was issued (simulates new command output)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "second batch line\n");

    // Act: second read with cursor from first — must return only "second batch"
    const secondResult = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: cursorAfterFirst,
    });

    expect(secondResult).not.toHaveProperty("error");
    const secondText = (secondResult as { text: string }).text;
    // Must not contain "first batch" — cursor skips already-returned content
    expect(secondText).not.toContain("first batch");
    expect(secondText).toContain("second batch");
  });

  it("S-TR-02-CONT-03: cursor format round-trip: encoder output is consumable by decoder", async () => {
    // Arrange: tracked terminal + real buffer + explicit gateway init (independence)
    trackTerminal("accordo-terminal-1");

    terminalOutputBuffer.test_only_append("accordo-terminal-1", "original output");

    // Explicit gateway initialization for this test
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    // Act: get cursor from first read
    const r1 = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    expect(r1).not.toHaveProperty("error");
    const cursor = (r1 as { cursor: string }).cursor;
    expect(cursor).toMatch(/^t-accordo-terminal-1:/);

    // Append new content
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "new output");

    // Use cursor — if decoder can't parse it, second read returns from start (includes original)
    const r2 = await terminalReadHandler({ terminalId: "accordo-terminal-1", since: cursor });
    expect(r2).not.toHaveProperty("error");
    const text2 = (r2 as { text: string }).text;

    // If cursor was properly parsed, "original output" is excluded
    expect(text2).not.toContain("original output");
    expect(text2).toContain("new output");
  });

  it("S-TR-02-CROSS-01: cursor from terminal-1 is rejected for terminal-2 using real buffer parsing", async () => {
    // Arrange: two tracked terminals + real buffer + explicit gateway init (independence)
    const t1 = makeMockTerminal("T1");
    const t2 = makeMockTerminal("T2");
    mockState.terminals = [t1, t2] as never;
    terminalMap.set("accordo-terminal-1", t1);
    terminalMap.set("accordo-terminal-2", t2);

    // Append to both terminals
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "t1 output");
    terminalOutputBuffer.test_only_append("accordo-terminal-2", "t2 output");

    // Explicit gateway initialization for this test (independence)
    const deps = createTerminalReadDeps();
    initTerminalReadGateway(deps);

    // Act: get cursor from terminal-1
    const r1 = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    expect(r1).not.toHaveProperty("error");
    const t1Cursor = (r1 as { cursor: string }).cursor;

    // Try to use t1's cursor with terminal-2 request
    const result = await terminalReadHandler({
      terminalId: "accordo-terminal-2",
      since: t1Cursor,
    });

    // Must be rejected — cursor belongs to terminal-1
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Cursor does not belong to terminal accordo-terminal-2");
  });
});
