/**
 * Contracts and constants for Priority S terminal readback.
 *
 * Public MCP surfaces: accordo_terminal_read + observed accordo_terminal_run
 * Requirements: requirements-editor.md §4.10, §4.30, §5.4
 */

import type * as vscode from "vscode";

export const DEFAULT_TERMINAL_READ_MAX_LINES = 200;
export const MAX_TERMINAL_READ_MAX_LINES = 500;
export const DEFAULT_TERMINAL_READ_MAX_CHARS = 12000;
export const MAX_TERMINAL_READ_MAX_CHARS = 20000;
export const DEFAULT_TERMINAL_OBSERVE_WAIT_MS = 250;
export const TERMINAL_OBSERVE_POLL_MS = 10;

export interface TerminalObserveRequest {
  readonly observeMaxLines?: number;
  readonly observeMaxChars?: number;
}

export interface TerminalObservedSlice extends Record<string, unknown> {
  readonly text: string;
  readonly cursor: string;
  readonly truncated: boolean;
}

export interface TerminalReadRequest {
  readonly terminalId?: string;
  readonly since?: string;
  readonly maxLines?: number;
  readonly maxChars?: number;
}

export interface TerminalReadSuccess extends TerminalObservedSlice {
  readonly terminalId: string;
}

export interface TerminalRunRequest extends TerminalObserveRequest {
  readonly command: string;
  readonly terminalId?: string;
}

export interface TerminalRunSuccess extends Record<string, unknown> {
  readonly sent: true;
  readonly terminalId: string;
  readonly observe?: TerminalObservedSlice;
}

export interface TerminalReadErrorResponse extends Record<string, unknown> {
  readonly error: string;
}

export type TerminalReadResult = TerminalReadSuccess | TerminalReadErrorResponse;
export type TerminalRunResult = TerminalRunSuccess | TerminalReadErrorResponse;

/**
 * External dependency boundary for terminal-output event capture.
 *
 * Production implementation wires VS Code shell integration events
 * (onDidStartTerminalShellExecution / onDidEndTerminalShellExecution)
 * to stream terminal output into the shared TerminalOutputBuffer.
 */
export interface TerminalOutputSource {
  /**
   * Attach to a tracked terminal and begin capturing output.
   * Idempotent — multiple calls with the same terminalId are safe.
   * @param terminalId Stable accordo terminal ID (from terminal-state)
   * @param terminal vscode.Terminal instance to attach to
   */
  attachToTerminal(terminalId: string, terminal: vscode.Terminal): void;

  /**
   * Stop capturing output for a terminal and clean up resources.
   * Called by the lifecycle handler when a terminal closes.
   * @param terminalId Stable accordo terminal ID
   */
  stopTrackingTerminal(terminalId: string): void;
}

/**
 * Local retention + cursor store for bounded terminal output readback.
 */
export interface TerminalOutputBuffer {
  read(request: TerminalReadRequest): Promise<TerminalReadSuccess>;
  clearTerminal(terminalId: string): Promise<void>;
}

/**
 * Local redaction seam for terminal output before it crosses MCP.
 */
export interface TerminalOutputRedactor {
  redact(text: string): string;
}

export interface TerminalSnapshotSource {
  read(
    request: TerminalReadRequest,
    terminal: vscode.Terminal,
    terminalId: string,
  ): Promise<TerminalReadSuccess>;
  clearTerminal(terminalId: string): Promise<void>;
}

export interface TerminalReadGatewayDeps {
  readonly source: TerminalOutputSource;
  readonly buffer: TerminalOutputBuffer;
  readonly redactor: TerminalOutputRedactor;
  readonly snapshot?: TerminalSnapshotSource;
}

export type TerminalReadHandler = (
  args: Record<string, unknown>,
) => Promise<TerminalReadResult>;

export type TerminalRunHandler = (
  args: Record<string, unknown>,
) => Promise<TerminalRunResult>;
