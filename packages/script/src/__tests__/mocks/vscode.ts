/**
 * VSCode mock for vitest unit tests in accordo-script.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Covers all APIs used by script components:
 *   StatusBarItem (subtitle bar), commands.executeCommand / registerCommand,
 *   extensions.getExtension (voice check), window.showTextDocument,
 *   workspace.openTextDocument, Range/Position (highlight decorations),
 *   window.createTextEditorDecorationType.
 */

import { vi } from "vitest";

// ── URI ──────────────────────────────────────────────────────────────────────

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;

  private constructor(scheme: string, path: string) {
    this.scheme = scheme;
    this.fsPath = path;
    this.path = path;
  }

  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static parse(value: string): Uri {
    if (value.startsWith("file://")) return new Uri("file", value.slice(7));
    return new Uri("file", value);
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
      this.end = new Position(
        endLine ?? startLineOrPos,
        endChar ?? (startCharOrEnd as number),
      );
    }
  }
}

// ── ThemeColor ────────────────────────────────────────────────────────────────

export class ThemeColor {
  constructor(readonly id: string) {}
}

// ── StatusBarAlignment ────────────────────────────────────────────────────────

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// ── StatusBarItem mock ────────────────────────────────────────────────────────

export function createStatusBarItemMock() {
  return {
    text: "",
    tooltip: "",
    color: undefined as ThemeColor | string | undefined,
    command: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

// ── TextDocument mock ─────────────────────────────────────────────────────────

export function createTextDocumentMock(fsPath = "/mock/file.ts") {
  return {
    uri: Uri.file(fsPath),
    fileName: fsPath,
    getText: vi.fn(() => ""),
    lineAt: vi.fn(() => ({ text: "" })),
  };
}

// ── TextEditor mock ───────────────────────────────────────────────────────────

export function createTextEditorMock(fsPath = "/mock/file.ts") {
  return {
    document: createTextDocumentMock(fsPath),
    selection: { isEmpty: true, active: new Position(0, 0) },
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
  };
}

// ── ExtensionContext / Memento ────────────────────────────────────────────────

export function createMementoMock() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue),
    update: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    keys: vi.fn(() => [...store.keys()]),
    _store: store,
  };
}

export function createExtensionContextMock() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: createMementoMock(),
    globalState: createMementoMock(),
    extensionPath: "/mock/extension",
    extensionUri: Uri.file("/mock/extension"),
    storagePath: "/mock/storage",
    globalStoragePath: "/mock/global-storage",
    logPath: "/mock/log",
  };
}

// ── workspace ─────────────────────────────────────────────────────────────────

let _lastMockDoc = createTextDocumentMock();

export const workspace = {
  openTextDocument: vi.fn(async (pathOrUri: string | Uri) => {
    const p =
      typeof pathOrUri === "string" ? pathOrUri : (pathOrUri as Uri).fsPath;
    _lastMockDoc = createTextDocumentMock(p);
    return _lastMockDoc;
  }),
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  _getLastMockDoc: () => _lastMockDoc,
};

// ── window ────────────────────────────────────────────────────────────────────

let _statusBarItem = createStatusBarItemMock();
let _lastMockEditor = createTextEditorMock();

export const window = {
  createStatusBarItem: vi.fn(
    (_alignment?: StatusBarAlignment, _priority?: number) => {
      _statusBarItem = createStatusBarItemMock();
      return _statusBarItem;
    },
  ),
  showTextDocument: vi.fn(async (doc: ReturnType<typeof createTextDocumentMock>) => {
    _lastMockEditor = createTextEditorMock(doc.uri.fsPath);
    return _lastMockEditor;
  }),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  activeTextEditor: null as null | ReturnType<typeof createTextEditorMock>,
  createTextEditorDecorationType: vi.fn(() => ({
    dispose: vi.fn(),
    key: "mock-decoration-type",
  })),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
  })),
  // Test helpers ─────────────────────────────────────────────────────────────
  _getLastStatusBarItem: () => _statusBarItem,
  _getLastMockEditor: () => _lastMockEditor,
};

// ── commands ──────────────────────────────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(async (_command: string, ..._args: unknown[]) => undefined),
};

// ── extensions ────────────────────────────────────────────────────────────────

export const extensions = {
  getExtension: vi.fn((_id: string) => undefined as unknown),
};

// ── EventEmitter ──────────────────────────────────────────────────────────────

export class EventEmitter<T> {
  private _handlers: Array<(e: T) => void> = [];

  event = (handler: (e: T) => void): { dispose: () => void } => {
    this._handlers.push(handler);
    return {
      dispose: () => {
        this._handlers = this._handlers.filter((h) => h !== handler);
      },
    };
  };

  fire(data: T): void {
    for (const h of this._handlers) h(data);
  }

  dispose(): void {
    this._handlers = [];
  }
}

// ── Disposable ────────────────────────────────────────────────────────────────

export class Disposable {
  constructor(private readonly _callOnDispose: () => void) {}
  dispose(): void {
    this._callOnDispose();
  }
  static from(...disposables: Array<{ dispose: () => void }>): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
}
