import * as vscode from "vscode";

/** Maintained across the extension host session. Never reset outside tests. */
export const terminalMap = new Map<string, vscode.Terminal>();

interface RestorableTerminalRecord {
  readonly terminalId: string;
  readonly name: string;
}

const RESTORABLE_TERMINALS_KEY = "accordo.terminals.restorable.v1";
const restorableTerminalNames = new Map<string, string>();

let terminalPersistence: vscode.Memento | null = null;
let persistenceWrite: Promise<void> = Promise.resolve();

let terminalCounter = 0;

export function initTerminalTrackingPersistence(store: vscode.Memento): void {
  terminalPersistence = store;
  restoreRestorableTerminalNames();
  reconcileTrackedTerminals();
}

export function flushTerminalTrackingPersistence(): Promise<void> {
  return persistenceWrite;
}

/** Generate the next stable accordo terminal ID. */
export function createTerminalId(): string {
  return `accordo-terminal-${++terminalCounter}`;
}

/** Reverse lookup: vscode.Terminal → accordo terminal ID. */
export function findTerminalId(
  terminal: vscode.Terminal,
): string | undefined {
  reconcileTrackedTerminals();
  for (const [id, trackedTerminal] of terminalMap) {
    if (trackedTerminal === terminal) {
      return id;
    }
  }
  return undefined;
}

/** Look up a live tracked terminal by stable ID. */
export function getTerminal(id: string): vscode.Terminal | undefined {
  reconcileTrackedTerminals();
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
  options: { restorable?: boolean } = {},
): void {
  terminalMap.set(terminalId, terminal);
  syncTerminalCounter(terminalId);
  if (options.restorable) {
    restorableTerminalNames.set(terminalId, terminal.name);
    persistRestorableTerminals();
  }
}

export function adoptTerminal(terminal: vscode.Terminal): string {
  reconcileTrackedTerminals();
  const existingId = findTerminalId(terminal);
  if (existingId) {
    return existingId;
  }
  const terminalId = createTerminalId();
  trackTerminal(terminalId, terminal);
  return terminalId;
}

export function untrackTerminal(terminalId: string): void {
  terminalMap.delete(terminalId);
  if (restorableTerminalNames.delete(terminalId)) {
    persistRestorableTerminals();
  }
}

export function reconcileTrackedTerminals(): void {
  let records = getRestorableTerminalRecords();
  if (records.length === 0) {
    records = bootstrapLegacyAccordoTerminals();
  }
  if (records.length === 0) return;

  const available = (vscode.window.terminals as vscode.Terminal[]).filter((terminal) => !terminalMapHasTerminal(terminal));

  for (const record of records) {
    const tracked = terminalMap.get(record.terminalId);
    if (tracked && (vscode.window.terminals as vscode.Terminal[]).includes(tracked)) {
      syncTerminalCounter(record.terminalId);
      continue;
    }

    const candidateIndex = available.findIndex((terminal) => terminal.name === record.name);
    if (candidateIndex === -1) continue;

    const [candidate] = available.splice(candidateIndex, 1);
    terminalMap.set(record.terminalId, candidate);
    syncTerminalCounter(record.terminalId);
  }
}

/** Test-only helper — resets the terminal map and counter. */
export function _resetTerminalMap(): void {
  terminalMap.clear();
  restorableTerminalNames.clear();
  terminalPersistence = null;
  persistenceWrite = Promise.resolve();
  terminalCounter = 0;
}

function terminalMapHasTerminal(terminal: vscode.Terminal): boolean {
  for (const trackedTerminal of terminalMap.values()) {
    if (trackedTerminal === terminal) {
      return true;
    }
  }
  return false;
}

function restoreRestorableTerminalNames(): void {
  restorableTerminalNames.clear();
  for (const record of getRestorableTerminalRecords()) {
    restorableTerminalNames.set(record.terminalId, record.name);
    syncTerminalCounter(record.terminalId);
  }
}

function getRestorableTerminalRecords(): RestorableTerminalRecord[] {
  const raw = terminalPersistence?.get(RESTORABLE_TERMINALS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const terminalId = typeof (entry as { terminalId?: unknown }).terminalId === "string"
      ? (entry as { terminalId: string }).terminalId
      : undefined;
    const name = typeof (entry as { name?: unknown }).name === "string"
      ? (entry as { name: string }).name
      : undefined;
    return terminalId && name ? [{ terminalId, name }] : [];
  });
}

function persistRestorableTerminals(): void {
  if (!terminalPersistence) return;
  const records = [...restorableTerminalNames.entries()]
    .sort(([leftId], [rightId]) => compareTerminalIds(leftId, rightId))
    .map(([terminalId, name]) => ({ terminalId, name }));
  persistenceWrite = persistenceWrite.then(() => terminalPersistence?.update(RESTORABLE_TERMINALS_KEY, records));
}

function syncTerminalCounter(terminalId: string): void {
  const match = /^accordo-terminal-(\d+)$/.exec(terminalId);
  if (!match) return;
  terminalCounter = Math.max(terminalCounter, Number.parseInt(match[1], 10));
}

function compareTerminalIds(left: string, right: string): number {
  return extractTerminalIndex(left) - extractTerminalIndex(right);
}

function extractTerminalIndex(terminalId: string): number {
  const match = /^accordo-terminal-(\d+)$/.exec(terminalId);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function bootstrapLegacyAccordoTerminals(): RestorableTerminalRecord[] {
  if (terminalMap.size > 0 || restorableTerminalNames.size > 0) {
    return [];
  }

  const candidates = (vscode.window.terminals as vscode.Terminal[])
    .filter((terminal) => /^Accordo(?:\b| )/.test(terminal.name));
  if (candidates.length === 0) {
    return [];
  }

  const records: RestorableTerminalRecord[] = [];
  for (const terminal of candidates) {
    const terminalId = createTerminalId();
    restorableTerminalNames.set(terminalId, terminal.name);
    terminalMap.set(terminalId, terminal);
    records.push({ terminalId, name: terminal.name });
  }
  persistRestorableTerminals();
  return records;
}
