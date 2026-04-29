/**
 * VSCode mock for vitest unit tests in accordo-editor.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Provides vi.fn() stubs for every VSCode API called by editor tool handlers.
 * Tests import this file indirectly (through the alias) — they can use
 * vi.mocked() or overwrite individual fns via jest-style vi.fn().mockReturnValue().
 *
 * Coverage: all APIs used by tools §4.1–§4.22 in requirements-editor.md.
 */

import { vi } from "vitest";

// ── URI ──────────────────────────────────────────────────────────────────────

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
  }

  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static parse(value: string): Uri {
    return new Uri("file", value);
  }

  with(_change: { scheme?: string; path?: string }): Uri {
    return this;
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

// ── Range / Position ─────────────────────────────────────────────────────────

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(
    startLineOrPos: number | Position,
    startCharOrEnd: number | Position,
    endLine?: number,
    endChar?: number,
  ) {
    if (startLineOrPos instanceof Position) {
      this.start = startLineOrPos;
      this.end = startCharOrEnd as Position;
    } else {
      this.start = new Position(startLineOrPos, startCharOrEnd as number);
      this.end = new Position(endLine ?? startLineOrPos, endChar ?? (startCharOrEnd as number));
    }
  }
}

// ── DiagnosticSeverity ───────────────────────────────────────────────────────

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

// ── Mock state (tests read/write these) ──────────────────────────────────────

/**
 * Mutable state that tests set before calling handlers.
 * Reset it in beforeEach to keep tests isolated.
 */
export const mockState = {
  activeTextEditor: null as null | {
    document: { uri: Uri; lineCount: number; isDirty: boolean };
    visibleRanges: Array<{ start: { line: number } }>;
    setDecorations: ReturnType<typeof vi.fn>;
  },
  visibleTextEditors: [] as Array<{
    document: { uri: Uri; lineCount: number; isDirty: boolean };
    visibleRanges: Array<{ start: { line: number } }>;
    setDecorations: ReturnType<typeof vi.fn>;
  }>,
  tabGroups: {
    all: [] as Array<{
      tabs: Array<{ input: { uri?: Uri } }>;
    }>,
    close: vi.fn().mockResolvedValue(true),
  },
  terminals: [] as Array<{
    name: string;
    dispose: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    sendText: ReturnType<typeof vi.fn>;
  }>,
  activeTerminal: null as null | { name: string },
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  textDocuments: [] as Array<{
    uri: Uri;
    isDirty: boolean;
    fileName: string;
    save: ReturnType<typeof vi.fn>;
    lineCount: number;
  }>,
  diagnostics: [] as Array<[Uri, Array<{
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
    code?: string | number;
  }>]>,
  /** Map of registered commands for executeCommand mock routing */
  registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
};

// ── window ───────────────────────────────────────────────────────────────────

export const window = {
  get activeTextEditor() {
    return mockState.activeTextEditor;
  },
  get visibleTextEditors() {
    return mockState.visibleTextEditors;
  },
  get terminals() {
    return mockState.terminals;
  },
  get activeTerminal() {
    return mockState.activeTerminal;
  },
  get tabGroups() {
    return mockState.tabGroups;
  },
  showTextDocument: vi.fn().mockResolvedValue(undefined),
  createTextEditorDecorationType: vi.fn().mockImplementation(() => ({
    key: `decoration-${Math.random().toString(36).slice(2)}`,
    dispose: vi.fn(),
  })),
  createTerminal: vi.fn(),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  onDidCloseTerminal: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
  // S-TR-04: mock shell integration events — uses shared listener storage
  // so tests can fire events via fireShellExecutionStart/End
  onDidStartTerminalShellExecution: ((listener: (event: MockTerminalShellExecutionStartEvent) => void) => {
    _shellStartListeners.push(listener);
    return { dispose: () => { const i = _shellStartListeners.indexOf(listener); if (i >= 0) _shellStartListeners.splice(i, 1); } };
  }) as unknown as typeof window.onDidStartTerminalShellExecution,
  onDidEndTerminalShellExecution: ((listener: (event: MockTerminalShellExecutionEndEvent) => void) => {
    _shellEndListeners.push(listener);
    return { dispose: () => { const i = _shellEndListeners.indexOf(listener); if (i >= 0) _shellEndListeners.splice(i, 1); } };
  }) as unknown as typeof window.onDidEndTerminalShellExecution,
};

// ── workspace ────────────────────────────────────────────────────────────────

export const workspace = {
  get workspaceFolders() {
    return mockState.workspaceFolders.length > 0
      ? mockState.workspaceFolders
      : undefined;
  },
  get textDocuments() {
    return mockState.textDocuments;
  },
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue({}),
  }),
  fs: {
    readDirectory: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  },
  findTextInFiles: vi.fn().mockResolvedValue({ resultCount: 0, limitHit: false }),
  openTextDocument: vi.fn(),
};

// ── commands ─────────────────────────────────────────────────────────────────

export const commands = {
  executeCommand: vi.fn().mockImplementation(async (id: string, ...args: unknown[]) => {
    const handler = mockState.registeredCommands.get(id);
    if (handler) return handler(...args);
    return undefined;
  }),
  registerCommand: vi.fn().mockImplementation((id: string, handler: (...args: unknown[]) => unknown) => {
    mockState.registeredCommands.set(id, handler);
    return { dispose: () => { mockState.registeredCommands.delete(id); } };
  }),
};

// ── Shell Execution Event Firing (S-TR-04, S-TR-09, S-TR-11) ─────────────────

// Shared listener storage for onDidStartTerminalShellExecution
const _shellStartListeners: Array<(event: MockTerminalShellExecutionStartEvent) => void> = [];

// Shared listener storage for onDidEndTerminalShellExecution
const _shellEndListeners: Array<(event: MockTerminalShellExecutionEndEvent) => void> = [];

/**
 * Fire a shell execution start event to all registered listeners.
 *
 * Uses process.nextTick so the event fires BEFORE the Node.js event loop's
 * microtask checkpoint — BEFORE any Promise.then() continuations (including
 * async function await continuations) are processed.
 *
 * This mirrors VS Code's real behavior where onDidStartTerminalShellExecution
 * fires synchronously with sendText() in the extension host, so the output
 * source is subscribed before any async continuation in the handler.
 *
 * Usage:
 *   terminal.sendText("echo hello");
 *   fireShellExecutionStart({ terminal, execution: mockExec });
 *   // The event fires via nextTick, BEFORE collectObservePreview() resumes
 *   // from its await — so the buffer is populated before the read attempt.
 */
export function fireShellExecutionStart(event: MockTerminalShellExecutionStartEvent, useNextTick = true): void {
  const fire = () => {
    _shellStartListeners.forEach((l) => l(event));
  };
  if (useNextTick) {
    process.nextTick(fire);
  } else {
    _shellStartListeners.forEach((l) => l(event));
  }
}

/**
 * Fire a shell execution end event to all registered listeners.
 */
export function fireShellExecutionEnd(event: MockTerminalShellExecutionEndEvent): void {
  _shellEndListeners.forEach((l) => l(event));
}

/**
 * Reset shell execution listeners (call in beforeEach).
 */
export function resetShellExecutionListeners(): void {
  _shellStartListeners.length = 0;
  _shellEndListeners.length = 0;
}

// ── languages ────────────────────────────────────────────────────────────────

export const languages = {
  getDiagnostics: vi.fn().mockImplementation((uri?: Uri) => {
    if (uri) {
      const entry = mockState.diagnostics.find(([u]) => u.fsPath === uri.fsPath);
      return entry ? entry[1] : [];
    }
    return mockState.diagnostics;
  }),
};

// ── FileType ─────────────────────────────────────────────────────────────────

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

// ── TextSearchQuery ──────────────────────────────────────────────────────────

export class TextSearchQuery {
  constructor(
    readonly pattern: string,
    readonly isRegex?: boolean,
    readonly isCaseSensitive?: boolean,
    readonly isWordMatch?: boolean,
  ) {}
}

// ── EventEmitter ─────────────────────────────────────────────────────────────

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };

  fire(data: T): void {
    this.listeners.forEach(l => l(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ── Shell Execution (S-TR-04, S-TR-09, S-TR-11) ────────────────────────────────

/**
 * Mock TerminalShellExecution with async iterable read().
 * Used by tests that exercise the real shell-execution → buffer capture path.
 *
 * Key behavior: when read() is consumed by for-await-of, each .next() resolves
 * SYNCHRONOUSLY with the chunk via Promise.resolve(). The for-await-of loop
 * awaits each result in sequence, but since next() resolves immediately, all
 * chunks are processed in rapid succession within the same microtask checkpoint.
 * This ensures the buffer is fully populated before collectObservePreview reads.
 *
 * Test-only hook (onExhausted): called when the last chunk has been consumed
 * by for-await-of. This allows tests to know when readExecutionOutput has
 * finished populating the buffer.
 */
export class MockTerminalShellExecution {
  private chunks: string[];
  public onExhausted: (() => void) | null = null;
  public commandLine: { value: string } | undefined;

  constructor(chunks: string[] = [], commandLine?: string) {
    this.chunks = chunks;
    this.commandLine = commandLine ? { value: commandLine } : undefined;
  }

  /** Set the chunks to be yielded by read() */
  setChunks(chunks: string[]): void {
    this.chunks = chunks;
  }

  /**
   * Async iterable read() — mimics VS Code TerminalShellExecution.read().
   * Each .next() resolves SYNCHRONOUSLY via Promise.resolve(), enabling
   * all chunks to be consumed in one microtask checkpoint.
   *
   * When the last chunk is consumed and the iterator signals {done: true},
   * onExhausted is called synchronously within the await chain.
   */
  read(): AsyncIterableIterator<string> {
    const chunks = this.chunks;
    let i = 0;
    const self = this;
    return {
      next(): Promise<IteratorResult<string>> {
        if (i < chunks.length) {
          const value = chunks[i++];
          return Promise.resolve({ value, done: false });
        }
        // All chunks consumed — fire the exhausted hook synchronously
        // within the Promise resolution chain.
        if (self.onExhausted) {
          self.onExhausted();
        }
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<string> {
        return this;
      },
    };
  }
}

/**
 * Mock TerminalShellExecutionStartEvent.
 * Used to fire onDidStartTerminalShellExecution listeners.
 */
export interface MockTerminalShellExecutionStartEvent {
  readonly terminal: { name: string };
  readonly execution: MockTerminalShellExecution;
}

/**
 * Mock TerminalShellExecutionEndEvent.
 * Used to fire onDidEndTerminalShellExecution listeners.
 */
export interface MockTerminalShellExecutionEndEvent {
  readonly execution: MockTerminalShellExecution;
}

/**
 * Shell execution event emitter — test helper.
 * Installs an EventEmitter-based onDidStartTerminalShellExecution on the window mock
 * so tests can fire shell execution events.
 *
 * Tests can wrap terminal.sendText() to fire a shell execution start event
 * during command dispatch. Production observed runs then wait for the source
 * adapter to stream the mock execution output into the buffer.
 *
 * Usage:
 *   const shellEmitter = installShellExecutionEmitter();
 *   const mockExec = new MockTerminalShellExecution(['output chunk\n']);
 *   shellEmitter.fireStart({ terminal: mockTerminal, execution: mockExec });
 */
export function installShellExecutionEmitter(chunks: string[] = []): {
  fireStart(event: MockTerminalShellExecutionStartEvent): void;
  fireEnd(event: MockTerminalShellExecutionEndEvent): void;
  setChunks(chunks: string[]): void;
  wrapTerminal(terminal: Record<string, unknown>): void;
} {
  const startEmitter = new EventEmitter<MockTerminalShellExecutionStartEvent>();
  const endEmitter = new EventEmitter<MockTerminalShellExecutionEndEvent>();

  // Create callable that registers with the emitter and also has an .event property
  function startHandler(listener: (e: MockTerminalShellExecutionStartEvent) => void) {
    const disp = startEmitter.event(listener);
    return { dispose: disp.dispose };
  }
  (startHandler as unknown as { event: typeof startHandler }).event = startHandler;

  function endHandler(listener: (e: MockTerminalShellExecutionEndEvent) => void) {
    const disp = endEmitter.event(listener);
    return { dispose: disp.dispose };
  }
  (endHandler as unknown as { event: typeof endHandler }).event = endHandler;

  // Replace the window mock's shell execution functions
  // The original values were vi.fn() mocks — we replace them with our emitter-backed functions
  (window as unknown as Record<string, unknown>).onDidStartTerminalShellExecution = startHandler;
  (window as unknown as Record<string, unknown>).onDidEndTerminalShellExecution = endHandler;

  // Store for test-time chunk updates
  let currentChunks = chunks;

  // Wrap createTerminal to install the same sendText shell-event hook on
  // terminals created through the mock VS Code API.
  const origCreateTerminal = window.createTerminal as (...args: unknown[]) => unknown;
  (window as unknown as Record<string, unknown>).createTerminal = vi.fn().mockImplementation((...args: unknown[]) => {
    const terminal = origCreateTerminal(...args) as Record<string, unknown>;
    if (!terminal) return undefined;
    wrapTerminalSendText(terminal, startEmitter, () => currentChunks);
    return terminal;
  }) as typeof window.createTerminal;

  return {
    fireStart: (event) => startEmitter.fire(event),
    fireEnd: (event) => endEmitter.fire(event),
    setChunks(chunks: string[]) { currentChunks = chunks; },
    /**
     * Manually wrap a terminal's sendText to fire shell events.
     * Use this for tests that create terminals manually (not via window.createTerminal).
     */
    wrapTerminal: (terminal: Record<string, unknown>) => {
      wrapTerminalSendText(terminal, startEmitter, () => currentChunks);
    },
  };
}

/**
 * Wrap terminal.sendText to fire shell execution events.
 * This is called by installShellExecutionEmitter for terminals created via window.createTerminal
 * and can also be called directly by tests for manually-created terminals.
 */
function wrapTerminalSendText(
  terminal: Record<string, unknown>,
  startEmitter: EventEmitter<MockTerminalShellExecutionStartEvent>,
  getChunks: () => readonly string[],
): void {
  const origSendText = terminal.sendText as (...args: unknown[]) => unknown;
  terminal.sendText = ((text: unknown, ...rest: unknown[]) => {
    const exec = new MockTerminalShellExecution([...getChunks()]);
    startEmitter.fire({ terminal, execution: exec } as MockTerminalShellExecutionStartEvent);
    return origSendText(text, ...rest);
  }) as typeof terminal.sendText;
}

// ── env ──────────────────────────────────────────────────────────────────────

export const env = {
  remoteName: null as string | null,
};

// ── ExtensionContext ─────────────────────────────────────────────────────────

export class ExtensionContext {
  subscriptions: Array<{ dispose(): void }> = [];
}

export const extensions = {
  getExtension: vi.fn(),
};
