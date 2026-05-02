import type {
  TerminalOutputBuffer,
  TerminalOutputRedactor,
  TerminalOutputSource,
  TerminalReadErrorResponse,
  TerminalReadGatewayDeps,
  TerminalReadHandler,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalReadSuccess,
} from "./contracts.js";
import { adoptTerminal, getTerminal } from "../terminal/terminal-state.js";
import {
  DEFAULT_TERMINAL_READ_MAX_CHARS,
  DEFAULT_TERMINAL_READ_MAX_LINES,
  MAX_TERMINAL_READ_MAX_CHARS,
  MAX_TERMINAL_READ_MAX_LINES,
} from "./contracts.js";
import * as vscode from "vscode";
import { terminalOutputBuffer } from "./runtime-buffer.js";
import { terminalOutputRedactor } from "./runtime-redactor.js";
import { vscodeTerminalOutputSource } from "./vscode-terminal-source.js";
import {
  isSnapshotCursor,
  vscodeTerminalSnapshotSource,
} from "./vscode-terminal-snapshot-source.js";

/**
 * Parse request args into a strongly-typed request.
 */
function parseReadArgs(args: Record<string, unknown>): {
  terminalId?: string;
  since?: string;
  maxLines?: number;
  maxChars?: number;
} {
  return {
    terminalId: typeof args["terminalId"] === "string" ? args["terminalId"] : undefined,
    since: typeof args["since"] === "string" ? args["since"] : undefined,
    maxLines: typeof args["maxLines"] === "number" ? args["maxLines"] : undefined,
    maxChars: typeof args["maxChars"] === "number" ? args["maxChars"] : undefined,
  };
}

/**
 * Validate maxLines argument; returns error string or undefined if valid.
 */
function validateMaxLines(raw: number | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_TERMINAL_READ_MAX_LINES) {
    return `Argument 'maxLines' must be an integer between 1 and ${MAX_TERMINAL_READ_MAX_LINES}`;
  }
  return undefined;
}

/**
 * Validate maxChars argument; returns error string or undefined if valid.
 */
function validateMaxChars(raw: number | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_TERMINAL_READ_MAX_CHARS) {
    return `Argument 'maxChars' must be an integer between 1 and ${MAX_TERMINAL_READ_MAX_CHARS}`;
  }
  return undefined;
}

/**
 * Apply defaults and validate bounds BEFORE any read.
 */
function validateAndApplyDefaults(
  parsed: { terminalId?: string; since?: string; maxLines?: number; maxChars?: number },
): { request: TerminalReadRequest; error?: undefined } | { request?: undefined; error: TerminalReadErrorResponse } {
  const maxLinesErr = validateMaxLines(parsed.maxLines);
  if (maxLinesErr) return { error: { error: maxLinesErr } };

  const maxCharsErr = validateMaxChars(parsed.maxChars);
  if (maxCharsErr) return { error: { error: maxCharsErr } };

  return { request: {
    terminalId: parsed.terminalId,
    since: parsed.since,
    maxLines: parsed.maxLines ?? MAX_TERMINAL_READ_MAX_LINES,
    maxChars: parsed.maxChars ?? MAX_TERMINAL_READ_MAX_CHARS,
  }};
}

/**
 * Resolve terminalId for read:
 *   1. explicit → lookup in terminalMap
 *   2. active terminal → adopt if untracked
 *   3. error: "No active terminal"
 */
function resolveTerminalIdForRead(
  explicitId: string | undefined,
): { terminalId: string; terminal: vscode.Terminal } | { error: TerminalReadErrorResponse } {
  if (explicitId) {
    const terminal = getTerminal(explicitId);
    if (!terminal) {
      return { error: { error: `Terminal ${explicitId} not found` } };
    }
    return { terminalId: explicitId, terminal };
  }

  const active = vscode.window.activeTerminal;
  if (!active) {
    return { error: { error: "No active terminal" } };
  }

  // Adopt active untracked terminal so returned terminalId is reusable
  const terminalId = adoptTerminal(active);
  return { terminalId, terminal: active };
}

/**
 * Extract the terminalId prefix from an opaque cursor.
 * Recognizes two cursor formats:
 *   1. Standard: "t-accordo-terminal-N:{unique}"  (canonical)
 *   2. Legacy/short: "t{N}{suffix}" or similar patterns (extract N as terminal number)
 * Returns undefined for unrecognized formats.
 */
function extractCursorTerminalId(cursor: string): string | undefined {
  // Standard format: t-accordo-terminal-1:...
  const standard = /^t-(accordo-terminal-\d+):/.exec(cursor);
  if (standard) return standard[1];
  const snapshot = /^s-(accordo-terminal-\d+):/.exec(cursor);
  if (snapshot) return snapshot[1];
  // Short format: t1-cursor, t2-output — extract the terminal number
  // This handles cases where the buffer uses a short-form cursor encoding.
  // We need to reject cross-terminal cursors in this format too.
  const shortForm = /^t(\d+)-/.exec(cursor);
  if (shortForm) {
    return `accordo-terminal-${shortForm[1]}`;
  }
  return undefined;
}

/**
 * Validate cursor belongs to the request terminalId.
 * S-TR-02/S-TR-06: reject cross-terminal cursor usage.
 *
 * Logic:
 *   - cursor is undefined/empty → allow (incremental read from beginning)
 *   - cursor has valid terminal-ID extraction → reject if belongs to a different terminal
 *   - cursor has unknown/non-matching format → allow through (cannot confirm lineage)
 */
function validateCursorBelongsToTerminal(
  cursor: string | undefined,
  terminalId: string,
): string | undefined {
  if (!cursor) return undefined;
  const cursorTerminalId = extractCursorTerminalId(cursor);
  // Reject only if cursor has a terminal-ID marker AND it belongs to a different terminal
  if (cursorTerminalId && cursorTerminalId !== terminalId) {
    return `Cursor does not belong to terminal ${terminalId}`;
  }
  return undefined;
}

/**
 * Phase C implementation — wires deps into real handler logic.
 */
export function createTerminalReadHandler(
  deps: TerminalReadGatewayDeps,
): TerminalReadHandler {
  const snapshotSource = deps.snapshot ?? vscodeTerminalSnapshotSource;
  const supportsSnapshotFallback = snapshotSource === vscodeTerminalSnapshotSource
    && deps.buffer === terminalOutputBuffer;

  return async (args: Record<string, unknown>): Promise<TerminalReadResult> => {
    const parsed = parseReadArgs(args);

    // Step 1: bounds validation
    const maxLinesErr = validateMaxLines(parsed.maxLines);
    if (maxLinesErr) return { error: maxLinesErr };

    const maxCharsErr = validateMaxChars(parsed.maxChars);
    if (maxCharsErr) return { error: maxCharsErr };

    // Step 2: terminal resolution
    const terminalResolution = resolveTerminalIdForRead(parsed.terminalId);
    if ("error" in terminalResolution) return terminalResolution.error;
    const { terminalId, terminal } = terminalResolution;

    // Build request with correct defaults (S-TR-03: 200/12000, not 500/20000)
    const request: TerminalReadRequest = {
      terminalId,
      since: parsed.since,
      maxLines: parsed.maxLines ?? DEFAULT_TERMINAL_READ_MAX_LINES,
      maxChars: parsed.maxChars ?? DEFAULT_TERMINAL_READ_MAX_CHARS,
    };

    // Step 3: cursor/terminal compatibility check BEFORE buffer read (S-TR-02/S-TR-06)
    // This validates the request-side cursor lineage before any I/O.
    // Extract cursor terminalId from parsed.since first, then validate.
    if (parsed.since) {
      const cursorTerminalId = extractCursorTerminalId(parsed.since);
      if (cursorTerminalId && cursorTerminalId !== terminalId) {
        return { error: `Cursor does not belong to terminal ${terminalId}` };
      }
    }

    // Step 4: bounded read
    try {
      const raw = isSnapshotCursor(parsed.since)
        ? await snapshotSource.read(request, terminal, terminalId)
        : await deps.buffer.read(request);

      const terminalRead = shouldUseSnapshotFallback(parsed.since, raw, supportsSnapshotFallback)
        ? await snapshotSource.read(request, terminal, terminalId)
        : raw;

      // Step 5: response-side cursor re-validation (belt-and-suspenders)
      if (terminalRead.cursor) {
        const responseCursorErr = validateCursorBelongsToTerminal(terminalRead.cursor, terminalId);
        if (responseCursorErr) return { error: responseCursorErr };
      }

      const redacted = deps.redactor.redact(terminalRead.text);
      return { terminalId, text: redacted, cursor: terminalRead.cursor, truncated: terminalRead.truncated };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  };
}

// ── Runtime dependency factories (Phase C — real implementations) ───────────

/**
 * Phase C runtime dependency bag — real implementations.
 *
 * Source: VS Code shell integration capture (onDidStartTerminalShellExecution,
 *   execution.read()) streams output into the shared buffer.
 * Buffer: in-memory per-terminal line store with cursor-based incremental reads.
 * Redactor: pattern-based secret redaction (tokens, passwords, long hex strings).
 *
 * Both terminal_run observe and terminal_read share the same buffer/redactor
 * pipeline so cursor continuity is preserved across the two operations.
 */
export function createTerminalReadDeps(): TerminalReadGatewayDeps {
  return {
    source: vscodeTerminalOutputSource,
    buffer: terminalOutputBuffer,
    redactor: terminalOutputRedactor,
    snapshot: vscodeTerminalSnapshotSource,
  };
}

// ── Runtime handler (set by initTerminalReadGateway) ────────────────────────

let runtimeTerminalReadHandler: TerminalReadHandler = async () => ({
  error: "not implemented",
});

export function initTerminalReadGateway(deps: TerminalReadGatewayDeps): void {
  runtimeTerminalReadHandler = createTerminalReadHandler(deps);
}

export async function terminalReadHandler(
  args: Record<string, unknown>,
): Promise<TerminalReadResult> {
  return runtimeTerminalReadHandler(args);
}

export { vscodeTerminalOutputSource } from "./vscode-terminal-source.js";

function shouldUseSnapshotFallback(
  since: string | undefined,
  raw: TerminalReadSuccess,
  supportsSnapshotFallback: boolean,
): boolean {
  return !since && supportsSnapshotFallback && !raw.text && !raw.cursor;
}
