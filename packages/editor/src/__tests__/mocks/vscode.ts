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
  executeCommand: vi.fn().mockResolvedValue(undefined),
};

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
