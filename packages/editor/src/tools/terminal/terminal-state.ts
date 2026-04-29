import * as vscode from "vscode";

/** Maintained across the extension host session. Never reset outside tests. */
export const terminalMap = new Map<string, vscode.Terminal>();

let terminalCounter = 0;

/** Generate the next stable accordo terminal ID. */
export function createTerminalId(): string {
  return `accordo-terminal-${++terminalCounter}`;
}

/** Reverse lookup: vscode.Terminal → accordo terminal ID. */
export function findTerminalId(
  terminal: vscode.Terminal,
): string | undefined {
  for (const [id, trackedTerminal] of terminalMap) {
    if (trackedTerminal === terminal) {
      return id;
    }
  }
  return undefined;
}

/** Look up a live tracked terminal by stable ID. */
export function getTerminal(id: string): vscode.Terminal | undefined {
  const terminal = terminalMap.get(id);
  if (!terminal) {
    return undefined;
  }
  if ((vscode.window.terminals as vscode.Terminal[]).includes(terminal)) {
    return terminal;
  }
  terminalMap.delete(id);
  return undefined;
}

export function trackTerminal(
  terminalId: string,
  terminal: vscode.Terminal,
): void {
  terminalMap.set(terminalId, terminal);
}

export function adoptTerminal(terminal: vscode.Terminal): string {
  const existingId = findTerminalId(terminal);
  if (existingId) {
    return existingId;
  }
  const terminalId = createTerminalId();
  trackTerminal(terminalId, terminal);
  return terminalId;
}

/** Test-only helper — resets the terminal map and counter. */
export function _resetTerminalMap(): void {
  terminalMap.clear();
  terminalCounter = 0;
}
