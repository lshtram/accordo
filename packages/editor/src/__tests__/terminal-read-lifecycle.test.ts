/**
 * terminal-read-lifecycle.test.ts — Priority S Phase B · §S-TR-05
 * accordo_terminal_read lifecycle: close/reset clears output, stale cursors rejected
 *
 * Phase B runtime-proof tests for S-TR-05.
 * Uses the REAL runtime buffer (terminalOutputBuffer) so that if the close
 * lifecycle is unwired, the buffer remains populated and tests pass incorrectly.
 *
 * Runtime-proof strategy:
 *   S-TR-05-01: Prove buffer clears through the registered close lifecycle
 *               (onDidCloseTerminal → clearTerminal), not through a manual
 *               buffer.clearTerminal call. We call the production
 *               registerTerminalLifecycle(context) to install the real handler,
 *               then fire the close event through the VS Code event emitter so
 *               that onDidCloseTerminal → registered close handler → clearTerminal
 *               is exercised as it would be at runtime.
 *   S-TR-05-02: Prove stale cursor rejection through the real handler path with
 *               a real cursor obtained from a pre-close read. The lifecycle is
 *               fired (clearing the buffer), then the pre-close cursor is reused.
 *               The real handler must detect the cleared buffer + stale cursor
 *               and return an error — not replay stale data.
 *
 * Exported API checklist:
 *   ✓ terminalReadHandler        — S-TR-05 (close/reset clears output, stale cursor rejection)
 *   ✓ initTerminalReadGateway    — called to inject deps before each test
 *   ✓ createTerminalReadDeps     — used to build mock deps bag
 *   ✓ terminalOutputBuffer       — real runtime buffer for lifecycle proof
 *   ✓ TerminalOutputBuffer.test_only_append — used to populate buffer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  initTerminalReadGateway,
  createTerminalReadDeps,
  terminalReadHandler,
} from "../tools/terminal-read/index.js";

import { terminalOutputBuffer } from "../tools/terminal-read/runtime-buffer.js";

import type {
  TerminalReadSuccess,
  TerminalOutputBuffer as TOutputBuffer,
  TerminalOutputRedactor,
  TerminalOutputSource,
} from "../tools/terminal-read/contracts.js";

import * as vscodeMock from "./mocks/vscode.js";
import { _resetTerminalMap, terminalMap } from "../tools/terminal.js";
import { registerTerminalLifecycle } from "../tools/terminal/terminal-lifecycle.js";

const { mockState } = vscodeMock;

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeMockDeps(overrides?: {
  source?: Partial<TerminalOutputSource>;
  buffer?: Partial<TOutputBuffer>;
  redactor?: Partial<TerminalOutputRedactor>;
}) {
  const source: TerminalOutputSource = {
    startTrackingTerminal: vi.fn().mockResolvedValue(undefined),
    stopTrackingTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides?.source,
  };
  const buffer: TOutputBuffer = {
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

// ── Lifecycle emitter (EventEmitter-like for onDidCloseTerminal) ───────────────
// In tests we need the real registerTerminalLifecycle(context) to register
// a listener via vscode.window.onDidCloseTerminal, then fire that listener
// through the VS Code event emitter as VS Code would at runtime.
//
// VS Code's onDidCloseTerminal is an Event<Terminal> — it is callable
// (Event.subscribe) AND has an .event property (Event.event).
// We model this with a callable object that has .event() and .fire().
//
// The production registerTerminalLifecycle calls:
//   vscode.window.onDidCloseTerminal(callback)  ← callable path
// and registers the listener. fireCloseLifecycle fires via .fire() to
// exercise the registered path: onDidCloseTerminal → clearTerminal.

interface LifecycleEmitter {
  // Callable: vscode.window.onDidCloseTerminal(callback)
  (callback: (terminal: { name: string }) => void): { dispose(): void };
  // Event-style: vscode.window.onDidCloseTerminal.event(callback)
  event(callback: (terminal: { name: string }) => void): { dispose(): void };
  // Fire: triggers all registered listeners
  fire(terminal: { name: string }): void;
}

function makeLifecycleEmitter(): LifecycleEmitter {
  const listeners: Array<(terminal: { name: string }) => void> = [];

  const emitter = ((callback: (terminal: { name: string }) => void) => {
    listeners.push(callback);
    return { dispose: () => { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); } };
  }) as LifecycleEmitter;

  emitter.event = (callback) => {
    listeners.push(callback);
    return { dispose: () => { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); } };
  };

  emitter.fire = (terminal) => {
    listeners.forEach((l) => l(terminal));
  };

  return emitter;
}

let lifecycleEmitter: LifecycleEmitter;

/** Installs an EventEmitter-like onDidCloseTerminal on the vscode mock */
function installCapturingLifecycleEmitter() {
  lifecycleEmitter = makeLifecycleEmitter();

  // Replace window.onDidCloseTerminal with the EventEmitter-like object
  // so registerTerminalLifecycle registers its listener through the callable path
  (vscodeMock.window as unknown as { onDidCloseTerminal: LifecycleEmitter }).onDidCloseTerminal =
    lifecycleEmitter;
}

/** Fires the close lifecycle through the VS Code event emitter (as VS Code would) */
function fireCloseLifecycle(mockTerminal: { name: string }) {
  lifecycleEmitter.fire(mockTerminal);
}

// Mock ExtensionContext for registerTerminalLifecycle(context)
const mockContext = new vscodeMock.ExtensionContext();

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.terminals = [];
  mockState.activeTerminal = null;
  _resetTerminalMap();
  installCapturingLifecycleEmitter();
  // Register the production lifecycle handler (the real onDidCloseTerminal wiring)
  registerTerminalLifecycle(mockContext);
  // Clear the real runtime buffer between tests
  terminalOutputBuffer.test_only_append("accordo-terminal-1", "");
  (terminalOutputBuffer as unknown as { buffers: Map<string, unknown> }).buffers.delete("accordo-terminal-1");
});

// ─────────────────────────────────────────────────────────────────────────────
// S-TR-05: buffer reset on terminal close; stale cursors do not survive
//
// Runtime-proof strategy:
//   The registered close lifecycle (onDidCloseTerminal → clearTerminal) must
//   be exercised. If only manual buffer.clearTerminal is called without the
//   registered lifecycle, output still accumulates via the append path and
//   subsequent reads succeed with stale data.
//
//   S-TR-05-01: register the production lifecycle, populate real buffer, fire the
//   close event (VS Code lifecycle path), then read. If the registered lifecycle
//   is unwired, the buffer is NOT cleared, read returns stale content, and test fails.
//
//   S-TR-05-02: obtain a real cursor from a pre-close read, fire the lifecycle
//   (clearing the buffer), then issue a read with that pre-close cursor. Must
//   get a reset/invalid error — not stale data — proving lifecycle invalidation.
// ─────────────────────────────────────────────────────────────────────────────

describe("S-TR-05: buffer reset on terminal close", () => {
  it("S-TR-05-01: registered close lifecycle clears real buffer output — read returns empty not stale data", async () => {
    // Arrange: real tracked terminal + real buffer populated with content
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Populate real runtime buffer (simulates terminal output events)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "pre-close output\nmore content\n");

    // Wire handler with real deps (buffer + redactor from runtime)
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    // Act: fire the registered close lifecycle as VS Code would.
    // The production handler (registered via registerTerminalLifecycle in beforeEach)
    // is invoked via the VS Code event emitter: onDidCloseTerminal → clearTerminal
    fireCloseLifecycle(mock);

    // Assert: read must return empty text — not "pre-close output"
    // If the registered lifecycle is unwired (no onDidCloseTerminal wiring),
    // buffer is NOT cleared, read returns stale content, and test fails.
    const result = await terminalReadHandler({ terminalId: "accordo-terminal-1" });

    expect(result).not.toHaveProperty("error");
    const success = result as TerminalReadSuccess;
    expect(success.text).toBe("");
    // Cursor must also be absent/empty when buffer is cleared
    expect(success.cursor).toBe("");
  });

  it("S-TR-05-02: stale cursor for a closed/reset terminal is rejected as error through real handler", async () => {
    // Arrange: tracked terminal, buffer populated, then cleared via lifecycle
    const mock = makeMockTerminal();
    mockState.terminals = [mock as never];
    terminalMap.set("accordo-terminal-1", mock);

    // Wire real buffer+redactor into handler first (before any reads)
    const realDeps = createTerminalReadDeps();
    initTerminalReadGateway(realDeps);

    // Populate buffer then read to get a REAL cursor (from the runtime buffer)
    terminalOutputBuffer.test_only_append("accordo-terminal-1", "output before close");
    const preCloseResult = await terminalReadHandler({ terminalId: "accordo-terminal-1" });
    expect(preCloseResult).not.toHaveProperty("error");
    const preCloseCursor = (preCloseResult as { cursor: string }).cursor;

    // The cursor must be a real runtime cursor (t-accordo-terminal-1:...)
    expect(preCloseCursor).toMatch(/^t-accordo-terminal-1:/);

    // Act: fire the registered close lifecycle (clears the buffer)
    // The production handler was registered via registerTerminalLifecycle in beforeEach
    fireCloseLifecycle(mock);

    // Assert: reuse of the pre-close cursor must be rejected with a reset/invalid error
    // "reset" or "invalid" accepted (buffer cleared). "not found" rejected
    // because it would indicate terminal-resolution failure (lower precedence
    // than stale-cursor rejection — lifecycle path is: found → cleared → error).
    const result = await terminalReadHandler({
      terminalId: "accordo-terminal-1",
      since: preCloseCursor,
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/reset|invalid/i);
  });
});
