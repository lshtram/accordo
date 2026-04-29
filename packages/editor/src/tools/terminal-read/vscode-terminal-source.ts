/**
 * vscode-terminal-source.ts — Priority S Phase C
 *
 * Production terminal output source using VS Code shell integration APIs.
 *
 * Uses `window.onDidStartTerminalShellExecution` + `window.onDidEndTerminalShellExecution`
 * to capture command output and stream it into the shared `terminalOutputBuffer`.
 *
 * For each tracked terminal with observe enabled:
 *   1. On `onDidStartTerminalShellExecution` for the terminal — record the execution
 *   2. Stream output via `execution.read()` (async iterable) → buffer.append
 *   3. On `onDidEndTerminalShellExecution` — flush any remaining output
 *
 * This source is shared (singleton) and installed once during extension activate.
 * Tracking is enabled per-terminal via `attachToTerminal` when observe is requested.
 */

import * as vscode from "vscode";
import { terminalOutputBuffer } from "./runtime-buffer.js";
import type { TerminalOutputSource } from "./contracts.js";
import { findTerminalId } from "../terminal/terminal-state.js";

/**
 * Per-terminal tracking state for active output capture.
 */
interface TerminalTrackingState {
  /** Set while an execution read stream is active */
  activeExecution: vscode.TerminalShellExecution | null;
  /** Abort controller for the current read stream */
  abortController: AbortController | null;
}

/**
 * Production implementation of TerminalOutputSource.
 *
 * Wires VS Code shell integration events to the shared `terminalOutputBuffer`.
 * Output capture is streaming and non-blocking — reads happen in the background
 * after each shell execution start, and the observe preview reads from the
 * buffer after the command dispatch.
 *
 * API limitations:
 * - Output capture requires shell integration to be available on the terminal.
 *   Without it, `shellIntegration` is undefined and no capture occurs.
 * - `execution.read()` is the only documented output stream API in VS Code 1.100+.
 *   There is no pre-execution output capture (output before command runs).
 */
export class VSCodeTerminalOutputSource implements TerminalOutputSource {
  /**
   * Map of terminalId → tracking state.
   * Only terminals with an active execution are tracked.
   */
  private tracking = new Map<string, TerminalTrackingState>();

  private activeExecutions = new Map<string, vscode.TerminalShellExecution>();
  private onEndHandlers = new Map<string, vscode.Disposable>();
  private startDisposable: vscode.Disposable | null = null;
  private commandLineCaptured = new WeakSet<vscode.TerminalShellExecution>();

  constructor() { /* listeners are attached lazily for testable runtime wiring */ }

  /**
   * Begin output tracking for a terminal.
   * Idempotent — safe to call multiple times for the same terminalId.
   */
  attachToTerminal(terminalId: string, terminal: vscode.Terminal): void {
    this.refreshStartListener();
    if (this.tracking.has(terminalId)) return; // already tracking
    this.tracking.set(terminalId, {
      activeExecution: null,
      abortController: null,
    });
  }

  private refreshStartListener(): void {
    this.startDisposable?.dispose();
    this.startDisposable = vscode.window.onDidStartTerminalShellExecution(
      (event) => this.onStartExecution(event),
    );
  }

  /**
   * Stop output tracking for a terminal and clean up any active streams.
   */
  stopTrackingTerminal(terminalId: string): void {
    const state = this.tracking.get(terminalId);
    if (!state) return;

    // Abort any active read stream
    if (state.abortController) {
      state.abortController.abort();
    }

    // Dispose the end listener for this terminal
    const endHandler = this.onEndHandlers.get(terminalId);
    if (endHandler) {
      endHandler.dispose();
      this.onEndHandlers.delete(terminalId);
    }

    this.activeExecutions.delete(terminalId);
    this.tracking.delete(terminalId);
  }

  /**
   * Called by the registered lifecycle handler when a terminal closes.
   * Ensures tracking state is fully cleaned up.
   */
  handleTerminalClose(terminalId: string): void {
    this.stopTrackingTerminal(terminalId);
  }

  private onStartExecution(event: vscode.TerminalShellExecutionStartEvent): void {
    const terminal = event.terminal;
    // Find the accordo terminalId for this vscode.Terminal
    const terminalId = findTerminalId(terminal);
    if (!terminalId || !this.tracking.has(terminalId)) return;

    this.activeExecutions.set(terminalId, event.execution);
    const commandLine = readCommandLine(event.execution);
    if (commandLine) {
      terminalOutputBuffer.append(terminalId, `${commandLine}\r\n`);
      this.commandLineCaptured.add(event.execution);
    }
    // Fire-and-forget: output streaming happens in the background
    // and appends directly to the shared buffer.
    void this.readExecutionOutput(terminalId, event.execution);

    // Register one-shot end listener for this execution
    const endHandler = vscode.window.onDidEndTerminalShellExecution((endEvent) => {
      if (endEvent.execution !== event.execution) return;
      this.onEndExecution(terminalId, event.execution);
      endHandler.dispose();
      this.onEndHandlers.delete(terminalId);
    });
    this.onEndHandlers.set(terminalId, endHandler);
  }

  private onEndExecution(
    terminalId: string,
    execution: vscode.TerminalShellExecution,
  ): void {
    if (!this.commandLineCaptured.has(execution)) {
      const commandLine = readCommandLine(execution);
      if (commandLine) {
        terminalOutputBuffer.append(terminalId, `${commandLine}\r\n`);
        this.commandLineCaptured.add(execution);
      }
    }
    this.activeExecutions.delete(terminalId);
  }

  private async readExecutionOutput(
    terminalId: string,
    execution: vscode.TerminalShellExecution,
  ): Promise<void> {
    const state = this.tracking.get(terminalId);
    if (!state) return;

    const abortController = new AbortController();
    state.abortController = abortController;

    try {
      // Stream output chunks from the execution into the buffer
      for await (const chunk of execution.read()) {
        if (abortController.signal.aborted) break;
        if (chunk) {
          terminalOutputBuffer.append(terminalId, chunk);
        }
      }
    } catch (err) {
      // EINVAL errors from closed streams are expected — ignore them
      if ((err as { code?: string }).code !== "EINVAL") {
        // Unexpected error — log but don't crash the extension
        console.error(`[VSCodeTerminalOutputSource] read error for ${terminalId}:`, err);
      }
    } finally {
      if (state.abortController === abortController) {
        state.abortController = null;
      }
    }
  }

  /**
   * Clean up all event listeners. Called from deactivate.
   */
  dispose(): void {
    this.startDisposable?.dispose();
    for (const handler of this.onEndHandlers.values()) {
      handler.dispose();
    }
    this.onEndHandlers.clear();
    this.activeExecutions.clear();
    this.tracking.clear();
  }
}

function readCommandLine(execution: vscode.TerminalShellExecution): string | undefined {
  const commandLine = (execution as unknown as { commandLine?: unknown }).commandLine;
  if (typeof commandLine === "string") return commandLine;
  if (!commandLine || typeof commandLine !== "object") return undefined;

  const value = (commandLine as { value?: unknown }).value;
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Singleton production source — installed once during activate.
 */
export const vscodeTerminalOutputSource = new VSCodeTerminalOutputSource();
