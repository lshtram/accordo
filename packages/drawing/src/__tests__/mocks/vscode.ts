/**
 * VS Code mock for vitest unit tests in accordo-drawing.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Provides stubs for VS Code APIs called by accordo-drawing modules.
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

  static joinPath(base: Uri, ...parts: string[]): Uri {
    const joined = [base.fsPath, ...parts].join("/").replace(/\/+/g, "/");
    return new Uri(base.scheme, joined);
  }

  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }

  with(_change: { scheme?: string; path?: string }): Uri {
    return this;
  }
}

// ── ViewColumn ───────────────────────────────────────────────────────────────

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}

// ── Mock Webview ─────────────────────────────────────────────────────────────

export class MockWebview {
  html = "";
  options: Record<string, unknown> = {};
  cspSource = "https://localhost";

  postMessage = vi.fn().mockResolvedValue(true);
  onDidReceiveMessage = vi.fn().mockReturnValue({ dispose: vi.fn() });
  asWebviewUri = (uri: { fsPath: string }) => uri as never;
}

// ── Env ─────────────────────────────────────────────────────────────────────

export const env = {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  machineId: "test-machine",
  sessionId: "test-session",
  uiKind: 1,
};

// ── Workspace ────────────────────────────────────────────────────────────────

export const workspace = {
  workspaceFolders: [{ uri: Uri.file("/test"), name: "test", index: 0 }],
  getWorkspaceFolder: vi.fn(() => ({ uri: Uri.file("/test"), name: "test", index: 0 })),
  onDidChangeWorkspaceFolders: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

// ── Window ────────────────────────────────────────────────────────────────────

export const window = {
  activeTextEditor: undefined,
  activeTerminal: undefined,
  state: { activeColorTheme: 0 },
  onDidChangeActiveTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeWindowState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  showOpenDialog: vi.fn().mockResolvedValue([]),
  createWebviewPanel: vi.fn().mockReturnValue({
    webview: new MockWebview(),
    onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeViewState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  }),
};

// ── Commands ────────────────────────────────────────────────────────────────

export const commands = {
  executeCommand: vi.fn().mockResolvedValue(undefined),
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

// ── Disposable ─────────────────────────────────────────────────────────────

export class Disposable {
  #dispose = vi.fn();
  dispose() { return this.#dispose(); }
}

// ── Event ──────────────────────────────────────────────────────────────────

export class EventEmitter<T> {
  event = vi.fn(() => ({ dispose: vi.fn() }));
  fire(_data: T) {}
  dispose() {}
}

// ── Memento ────────────────────────────────────────────────────────────────

export class Memento {
  private store = new Map<string, unknown>();
  get(key: string) { return this.store.get(key); }
  update(key: string, value: unknown) { this.store.set(key, value); }
  keys() { return [...this.store.keys()]; }
}

// ── ExtensionContext ───────────────────────────────────────────────────────

export class ExtensionContext {
  subscriptions: Array<{ dispose: () => void }> = [];
  workspaceState = new Memento();
  globalState = new Memento();
  extensionPath = "/test";
  extensionUri = Uri.file("/test");
  environmentVariableCollection = { get: () => null, forEach: () => {}, replace: () => {}, delete: () => {}, clear: () => {}, size: 0 };
  secrets = { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve(), onDidChange: { event: () => ({ dispose: () => {} }) } };
  languageModelAccessInformation = { onDidChange: { event: () => ({ dispose: () => {} }) } };
}

// ── vscode module export ────────────────────────────────────────────────────

export type { ExtensionContext };
