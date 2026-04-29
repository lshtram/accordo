/**
 * runtime-buffer.ts — Priority S Phase C
 * In-memory terminal output buffer with per-terminal cursor lineage.
 *
 * Shared pipeline used by:
 *   - terminal_run observe (via initTerminalRunGateway read fn)
 *   - terminal_read handler (via createTerminalReadHandler deps)
 *
 * Responsibilities:
 *   - append lines from VS Code terminal output events (wired via vscode-terminal-source)
 *   - read bounded by maxLines/maxChars with cursor-based incremental reads
 *   - clearTerminal on close/reset lifecycle
 *   - cursor lineage per terminal (cursor encodes terminalId and position)
 */

import type { TerminalReadRequest, TerminalReadSuccess } from "./contracts.js";
import {
  DEFAULT_TERMINAL_READ_MAX_LINES,
  DEFAULT_TERMINAL_READ_MAX_CHARS,
  MAX_TERMINAL_READ_MAX_LINES,
  MAX_TERMINAL_READ_MAX_CHARS,
} from "./contracts.js";

// ── Internal buffer state per terminal ────────────────────────────────────────

interface TerminalBufferEntry {
  readonly timestamp: number;
  readonly text: string; // one logical "line" — may contain embedded newlines
}

interface TerminalBufferState {
  lines: TerminalBufferEntry[];
  /** Cumulative character count for all lines */
  totalChars: number;
  /** Cursor = base64(timestamp:lineIndex:charOffset) for incremental reads */
  cursor: string;
}

// ── Cursor encoding ──────────────────────────────────────────────────────────

function makeCursor(terminalId: string, lineIndex: number, charOffset: number): string {
  const raw = `${Date.now()}:${terminalId}:${lineIndex}:${charOffset}`;
  // Use base64url encoding for compactness; cursor is opaque so no crypto needed
  const encoded = Buffer.from(raw).toString("base64url");
  return `t-${terminalId}:${encoded}`;
}

function cursorKey(cursor: string): string {
  // Extract terminalId prefix and position data from opaque cursor
  // Format: t-{terminalId}:{base64payload}
  const parts = cursor.split(":");
  if (parts.length < 3) return "";
  const terminalId = parts[1];
  return `${terminalId}:${cursor}`;
}

// ── Singleton buffer store ────────────────────────────────────────────────────

class TerminalOutputBufferImpl {
  private buffers = new Map<string, TerminalBufferState>();

  /**
   * Append text to the terminal's buffer.
   * Called by vscode-terminal-source when shell execution output is captured.
   */
  append(terminalId: string, text: string): void {
    if (!text) return;
    let state = this.buffers.get(terminalId);
    if (!state) {
      state = { lines: [], totalChars: 0, cursor: "" };
      this.buffers.set(terminalId, state);
    }
    const entry: TerminalBufferEntry = { timestamp: Date.now(), text };
    state.lines.push(entry);
    state.totalChars += text.length;
    state.cursor = makeCursor(terminalId, state.lines.length - 1, state.totalChars);
  }

  async read(request: TerminalReadRequest): Promise<TerminalReadSuccess> {
    const terminalId = request.terminalId ?? "";
    const state = this.buffers.get(terminalId);

    // Cursor-based incremental read: find starting line index
    // (must be computed before the early-return guards below)
    let startIndex = 0;
    if (request.since) {
      // Cursor format: t-{terminalId}:{base64payload}
      // The base64payload may itself contain colons, so we must split only
      // on the FIRST colon to extract the encoded segment.
      const firstColon = request.since.indexOf(":");
      if (firstColon !== -1) {
        const encoded = request.since.substring(firstColon + 1);
        try {
          const decoded = Buffer.from(encoded, "base64url").toString("ascii");
          const segments = decoded.split(":");
          // segments[0]=timestamp, segments[1]=terminalId, segments[2]=lineIndex, segments[3]=charOffset
          startIndex = parseInt(segments[2] ?? "0", 10) + 1;
        } catch {
          startIndex = 0;
        }
      }
    }

    // S-TR-05-02: if caller passed a cursor but no buffer state exists,
    // the terminal was closed/reset since the cursor was issued.
    // Throw so the handler can return a stale-cursor error.
    if (!state || state.lines.length === 0) {
      if (request.since) {
        throw new Error(`Cursor reset or invalid for terminal ${terminalId}`);
      }
      return { terminalId, text: "", cursor: "", truncated: false };
    }

    const maxLines = request.maxLines ?? DEFAULT_TERMINAL_READ_MAX_LINES;
    const maxChars = request.maxChars ?? DEFAULT_TERMINAL_READ_MAX_CHARS;

    // Apply hard caps
    const capLines = Math.min(maxLines, MAX_TERMINAL_READ_MAX_LINES);
    const capChars = Math.min(maxChars, MAX_TERMINAL_READ_MAX_CHARS);

    const availableLines = state.lines.slice(startIndex);
    const selectedLines = availableLines.slice(0, capLines);

    // Build text with line boundaries preserved
    let text = selectedLines.map((e) => e.text).join("\n");
    const untruncated = text.length <= capChars;

    if (text.length > capChars) {
      text = text.slice(0, capChars);
    }

    // Cursor for next read: encode current end position
    const endLineIndex = startIndex + selectedLines.length - 1;
    const cursor = selectedLines.length > 0
      ? makeCursor(terminalId, endLineIndex, state.totalChars)
      : state.cursor;

    return {
      terminalId,
      text,
      cursor,
      truncated: !untruncated || selectedLines.length < availableLines.length,
    };
  }

  async clearTerminal(terminalId: string): Promise<void> {
    this.buffers.delete(terminalId);
  }

  /**
   * Expose buffer for testing — allows test to append and verify read behavior.
   */
  test_only_append(terminalId: string, text: string): void {
    this.append(terminalId, text);
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const terminalOutputBuffer = new TerminalOutputBufferImpl();