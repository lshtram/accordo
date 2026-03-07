/**
 * VSCode mock for vitest unit tests in accordo-comments.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Provides vi.fn() stubs for every VSCode API called by comments modules.
 *
 * Coverage: all APIs used by comments-architecture.md §2.1, §6, §9, §10.
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
    if (value.startsWith("file://")) {
      return new Uri("file", value.slice(7));
    }
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

// ── MarkdownString ────────────────────────────────────────────────────────────

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  constructor(value = "") {
    this.value = value;
  }
}

// ── ThemeIcon ─────────────────────────────────────────────────────────────────

export class ThemeIcon {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

// ── TreeItemCollapsibleState ──────────────────────────────────────────────────

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

// ── TreeItem ─────────────────────────────────────────────────────────────────

export class TreeItem {
  label: string | { label: string } | undefined;
  description?: string;
  tooltip?: string | MarkdownString;
  iconPath?: ThemeIcon;
  contextValue?: string;
  collapsibleState?: TreeItemCollapsibleState;
  command?: { command: string; title: string; arguments?: unknown[] };
  resourceUri?: Uri;

  constructor(label: string | { label: string }, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

// ── CommentMode ──────────────────────────────────────────────────────────────

export enum CommentMode {
  Editing = 0,
  Preview = 1,
}

// ── CommentThreadCollapsibleState ────────────────────────────────────────────

export enum CommentThreadCollapsibleState {
  Collapsed = 0,
  Expanded = 1,
}

// ── CommentThreadState ────────────────────────────────────────────────────────

export enum CommentThreadState {
  Unresolved = 0,
  Resolved = 1,
}

// ── Mock Comment Thread ──────────────────────────────────────────────────────

export class MockCommentThread {
  uri: Uri;
  range: Range | undefined;
  comments: MockComment[];
  collapsibleState: CommentThreadCollapsibleState;
  canReply: boolean | { name: string };
  contextValue: string;
  label: string;
  state?: number;

  constructor(
    uri: Uri,
    range: Range | undefined,
    comments: MockComment[],
  ) {
    this.uri = uri;
    this.range = range;
    this.comments = comments;
    this.collapsibleState = CommentThreadCollapsibleState.Collapsed;
    this.canReply = true;
    this.contextValue = "";
    this.label = "";
  }

  dispose = vi.fn();
}

// ── Mock Comment ─────────────────────────────────────────────────────────────

export class MockComment {
  body: string;
  mode: CommentMode;
  author: { name: string; iconPath?: Uri };

  constructor(body: string, mode: CommentMode, author: { name: string; iconPath?: Uri }) {
    this.body = body;
    this.mode = mode;
    this.author = author;
  }
}

// ── Mock CommentController ───────────────────────────────────────────────────

export class MockCommentController {
  readonly id: string;
  readonly label: string;
  options: { prompt?: string; placeHolder?: string } | undefined;
  commentingRangeProvider: {
    provideCommentingRanges: (document: unknown) => Range[];
  } | undefined;

  private threads: MockCommentThread[] = [];

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }

  createCommentThread(uri: Uri, range: Range | undefined, comments: MockComment[]): MockCommentThread {
    const thread = new MockCommentThread(uri, range, comments);
    this.threads.push(thread);
    return thread;
  }

  /** Test helper — get all created threads */
  getThreads(): MockCommentThread[] {
    return this.threads;
  }

  dispose = vi.fn();
}

// ── Mock state (tests read/write these) ──────────────────────────────────────

export const mockState = {
  activeTextEditor: null as null | {
    document: {
      uri: Uri;
      lineCount: number;
      isDirty: boolean;
      version: number;
      getText: ReturnType<typeof vi.fn>;
      languageId: string;
    };
    visibleRanges: Array<{ start: { line: number }; end: { line: number } }>;
    selection: { start: Position; end: Position; isEmpty: boolean };
  },
  visibleTextEditors: [] as Array<{
    document: { uri: Uri; lineCount: number; isDirty: boolean; version: number };
  }>,
  tabGroups: {
    all: [] as Array<{
      tabs: Array<{ input: { uri?: Uri } }>;
    }>,
    close: vi.fn().mockResolvedValue(true),
  },
  terminals: [] as Array<{ name: string }>,
  activeTerminal: null as null | { name: string },
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  textDocuments: [] as Array<{
    uri: Uri;
    isDirty: boolean;
    fileName: string;
    lineCount: number;
    version: number;
    getText: ReturnType<typeof vi.fn>;
    languageId: string;
  }>,
  diagnostics: [] as Array<[Uri, Array<{
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
  }>]>,
  commentControllers: [] as MockCommentController[],
  registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
};

// ── comments ─────────────────────────────────────────────────────────────────

export const comments = {
  createCommentController: vi.fn().mockImplementation((id: string, label: string): MockCommentController => {
    const ctrl = new MockCommentController(id, label);
    mockState.commentControllers.push(ctrl);
    return ctrl;
  }),
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
  showInputBox: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  createTreeView: vi.fn().mockImplementation((_viewId: string, _options: unknown) => {
    return {
      onDidChangeSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      reveal: vi.fn(),
      dispose: vi.fn(),
    };
  }),
};

// ── workspace ────────────────────────────────────────────────────────────────

/** Listeners registered via onDidChangeTextDocument */
const textDocChangeListeners: Array<(e: unknown) => void> = [];

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
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn(),
  },
  openTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn().mockImplementation((listener: (e: unknown) => void) => {
    textDocChangeListeners.push(listener);
    return { dispose: () => { const i = textDocChangeListeners.indexOf(listener); if (i >= 0) textDocChangeListeners.splice(i, 1); } };
  }),
  /** Test helper — fire a text document change event */
  _fireTextDocChange(event: unknown): void {
    textDocChangeListeners.forEach(l => l(event));
  },
};

// ── commands ─────────────────────────────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn().mockImplementation((id: string, handler: (...args: unknown[]) => unknown) => {
    mockState.registeredCommands.set(id, handler);
    return { dispose: () => { mockState.registeredCommands.delete(id); } };
  }),
  executeCommand: vi.fn().mockImplementation(async (id: string, ...args: unknown[]) => {
    const handler = mockState.registeredCommands.get(id);
    if (handler) return handler(...args);
    return undefined;
  }),
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

export function createMockExtensionContext(): {
  subscriptions: Array<{ dispose(): void }>;
  globalStorageUri: Uri;
  workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
} {
  return {
    subscriptions: [],
    globalStorageUri: Uri.file("/tmp/test-global-storage"),
    workspaceState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export const extensions = {
  getExtension: vi.fn(),
};

// ── Reset helper ─────────────────────────────────────────────────────────────

/**
 * Reset all mock state. Call in beforeEach().
 */
export function resetMockState(): void {
  mockState.activeTextEditor = null;
  mockState.visibleTextEditors = [];
  mockState.tabGroups.all = [];
  mockState.terminals = [];
  mockState.activeTerminal = null;
  mockState.workspaceFolders = [];
  mockState.textDocuments = [];
  mockState.diagnostics = [];
  mockState.commentControllers = [];
  mockState.registeredCommands.clear();
  textDocChangeListeners.length = 0;

  vi.clearAllMocks();
}
