/**
 * VSCode mock for vitest unit tests in accordo-voice.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Covers all APIs used by voice components: StatusBarItem, WebviewViewProvider,
 * workspace.getConfiguration, Memento, commands, window, etc.
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
      this.end = new Position(endLine ?? startLineOrPos, endChar ?? (startCharOrEnd as number));
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

// ── ExtensionContext / Memento ────────────────────────────────────────────────

export function createMementoMock() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue),
    update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
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

const mockConfig = new Map<string, unknown>([
  ["accordo.voice.whisperPath", "whisper"],
  ["accordo.voice.whisperModelFolder", "/usr/local/share/whisper"],
  ["accordo.voice.whisperModel", "ggml-base.en.bin"],
  ["accordo.voice.voice", "af_sarah"],
  ["accordo.voice.speed", 1.0],
  ["accordo.voice.language", "en-US"],
  ["accordo.voice.narrationMode", "narrate-off"],
  ["accordo.voice.llmEndpoint", ""],
  ["accordo.voice.llmModel", ""],
]);

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn((key: string, defaultValue?: unknown) => {
      const full = _section ? `${_section}.${key}` : key;
      return mockConfig.get(full) ?? defaultValue;
    }),
    update: vi.fn(),
    has: vi.fn(() => true),
    inspect: vi.fn(),
  })),
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  _mockConfig: mockConfig,
};

// ── window ────────────────────────────────────────────────────────────────────

let _statusBarItem = createStatusBarItemMock();

export const window = {
  createStatusBarItem: vi.fn((_alignment?: StatusBarAlignment, _priority?: number) => {
    _statusBarItem = createStatusBarItemMock();
    return _statusBarItem;
  }),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  activeTextEditor: null as null | {
    document: { uri: Uri; getText: () => string };
    selection: { isEmpty: boolean; active: Position };
    setDecorations: ReturnType<typeof vi.fn>;
  },
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createTextEditorDecorationType: vi.fn(() => ({
    dispose: vi.fn(),
    key: "mock-decoration",
  })),
  _getLastStatusBarItem: () => _statusBarItem,
};

// ── commands ──────────────────────────────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
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

// ── CancellationTokenSource ───────────────────────────────────────────────────

export class CancellationTokenSource {
  private _cancelled = false;
  private _handlers: Array<() => void> = [];

  token = {
    get isCancellationRequested() {
      return this._cancelled;
    },
    onCancellationRequested: (h: () => void) => {
      this._handlers.push(h);
      return { dispose: () => {} };
    },
  };

  cancel(): void {
    this._cancelled = true;
    this._handlers.forEach((h) => h());
  }

  dispose(): void {}
}
