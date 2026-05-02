import * as vscode from "vscode";
import type {
  TerminalReadRequest,
  TerminalReadSuccess,
  TerminalSnapshotSource,
} from "./contracts.js";
import {
  DEFAULT_TERMINAL_READ_MAX_CHARS,
  DEFAULT_TERMINAL_READ_MAX_LINES,
} from "./contracts.js";

type SnapshotMode = "full" | "delta";

interface CursorSnapshotEntry {
  readonly terminalId: string;
  readonly text: string;
}

export class VSCodeTerminalSnapshotSource implements TerminalSnapshotSource {
  private readonly cursorSnapshots = new Map<string, CursorSnapshotEntry>();
  private readonly terminalCursors = new Map<string, string[]>();
  private clipboardLock: Promise<void> = Promise.resolve();

  async read(
    request: TerminalReadRequest,
    terminal: vscode.Terminal,
    terminalId: string,
  ): Promise<TerminalReadSuccess> {
    const snapshotText = await this.withClipboardLock(() => captureTerminalText(terminal));
    const previousText = request.since
      ? this.resolvePreviousSnapshotText(request.since, terminalId)
      : undefined;

    if (!snapshotText && previousText === undefined) {
      return { terminalId, text: "", cursor: "", truncated: false };
    }

    const mode: SnapshotMode = previousText === undefined ? "full" : "delta";
    const rawText = mode === "full"
      ? snapshotText
      : this.computeDelta(snapshotText, previousText ?? "", terminalId);

    const bounded = boundSnapshotText(
      rawText,
      request.maxLines ?? DEFAULT_TERMINAL_READ_MAX_LINES,
      request.maxChars ?? DEFAULT_TERMINAL_READ_MAX_CHARS,
    );
    const cursor = makeSnapshotCursor(terminalId, snapshotText.length);
    this.rememberCursor(cursor, { terminalId, text: snapshotText });

    return {
      terminalId,
      text: bounded.text,
      cursor,
      truncated: bounded.truncated,
    };
  }

  async clearTerminal(terminalId: string): Promise<void> {
    const cursors = this.terminalCursors.get(terminalId) ?? [];
    for (const cursor of cursors) {
      this.cursorSnapshots.delete(cursor);
    }
    this.terminalCursors.delete(terminalId);
  }

  private async withClipboardLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.clipboardLock;
    let release!: () => void;
    this.clipboardLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private resolvePreviousSnapshotText(cursor: string, terminalId: string): string {
    const entry = this.cursorSnapshots.get(cursor);
    if (!entry || entry.terminalId !== terminalId) {
      throw new Error(`Cursor reset or invalid for terminal ${terminalId}`);
    }
    return entry.text;
  }

  private computeDelta(currentText: string, previousText: string, terminalId: string): string {
    if (currentText.startsWith(previousText)) {
      return currentText.slice(previousText.length);
    }
    throw new Error(`Cursor reset or invalid for terminal ${terminalId}`);
  }

  private rememberCursor(cursor: string, entry: CursorSnapshotEntry): void {
    this.cursorSnapshots.set(cursor, entry);
    const cursors = this.terminalCursors.get(entry.terminalId) ?? [];
    cursors.push(cursor);
    while (cursors.length > 8) {
      const stale = cursors.shift();
      if (stale) {
        this.cursorSnapshots.delete(stale);
      }
    }
    this.terminalCursors.set(entry.terminalId, cursors);
  }
}

function makeSnapshotCursor(terminalId: string, textLength: number): string {
  const raw = `${Date.now()}:${textLength}`;
  const encoded = Buffer.from(raw).toString("base64url");
  return `s-${terminalId}:${encoded}`;
}

export function isSnapshotCursor(cursor: string | undefined): boolean {
  return typeof cursor === "string" && /^s-accordo-terminal-\d+:/.test(cursor);
}

async function captureTerminalText(terminal: vscode.Terminal): Promise<string> {
  const originalClipboard = await vscode.env.clipboard.readText();
  terminal.show(false);
  await vscode.commands.executeCommand("workbench.action.terminal.focus");
  await delay(50);

  try {
    const copied = await copyTerminalSelectionWithRetry(originalClipboard);
    await vscode.commands.executeCommand("workbench.action.terminal.clearSelection");
    return copied;
  } finally {
    await vscode.env.clipboard.writeText(originalClipboard);
  }
}

async function copyTerminalSelectionWithRetry(previousText: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await vscode.commands.executeCommand("workbench.action.terminal.selectAll");
    await delay(30);
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    const copied = await waitForClipboardChange(previousText);
    if (copied || previousText !== copied) {
      return copied;
    }
    await delay(30);
  }
  return "";
}

async function waitForClipboardChange(previousText: string): Promise<string> {
  const deadline = Date.now() + 400;
  let current = await vscode.env.clipboard.readText();
  while (current === previousText && Date.now() < deadline) {
    await delay(10);
    current = await vscode.env.clipboard.readText();
  }
  return current;
}

function boundSnapshotText(text: string, maxLines: number, maxChars: number): { text: string; truncated: boolean } {
  const lines = splitTerminalLines(text);
  const clippedLines = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  let boundedText = clippedLines.join("\n");
  let truncated = clippedLines.length < lines.length;

  if (boundedText.length > maxChars) {
    boundedText = boundedText.slice(boundedText.length - maxChars);
    truncated = true;
  }

  return { text: boundedText, truncated };
}

function splitTerminalLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const vscodeTerminalSnapshotSource = new VSCodeTerminalSnapshotSource();
