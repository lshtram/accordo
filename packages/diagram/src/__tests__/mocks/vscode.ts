/**
 * VS Code mock for vitest unit tests in accordo-diagram.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Provides stubs for VS Code APIs called by accordo-diagram modules.
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

  readonly postMessage = vi.fn().mockResolvedValue(true);

  asWebviewUri(uri: Uri): Uri {
    return uri;
  }

  private _messageHandler: ((msg: unknown) => void) | null = null;

  onDidReceiveMessage = vi.fn().mockImplementation((handler: (msg: unknown) => void) => {
    this._messageHandler = handler;
    return { dispose: vi.fn() };
  });

  /** Test helper: simulate a message arriving from the webview. */
  simulateMessage(msg: unknown): void {
    this._messageHandler?.(msg);
  }
}

// ── Mock WebviewPanel ────────────────────────────────────────────────────────

export class MockWebviewPanel {
  readonly webview = new MockWebview();
  readonly viewType: string;
  readonly title: string;
  visible = true;
  active = true;

  private _disposeHandler: (() => void) | null = null;

  readonly onDidDispose = vi.fn().mockImplementation((handler: () => void) => {
    this._disposeHandler = handler;
    return { dispose: vi.fn() };
  });
  readonly onDidChangeViewState = vi.fn().mockReturnValue({ dispose: vi.fn() });
  readonly reveal = vi.fn();
  readonly dispose = vi.fn();

  /** Test helper: simulate the panel being closed by the user. */
  simulateDispose(): void {
    this._disposeHandler?.();
  }

  constructor(viewType: string, title: string) {
    this.viewType = viewType;
    this.title = title;
  }
}

// ── Mock FileSystemWatcher ────────────────────────────────────────────────────

export class MockFileSystemWatcher {
  private _changeHandler: ((uri: Uri) => void) | null = null;

  readonly onDidChange = vi.fn().mockImplementation((handler: (uri: Uri) => void) => {
    this._changeHandler = handler;
    return { dispose: vi.fn() };
  });
  readonly onDidCreate = vi.fn().mockReturnValue({ dispose: vi.fn() });
  readonly onDidDelete = vi.fn().mockReturnValue({ dispose: vi.fn() });
  readonly dispose = vi.fn();

  /** Test helper: simulate a file change event. */
  simulateChange(uri: Uri): void {
    this._changeHandler?.(uri);
  }
}

// ── window ────────────────────────────────────────────────────────────────────

export const mockPanel = new MockWebviewPanel("accordo.diagram", "Diagram");

export const window = {
  createWebviewPanel: vi.fn().mockReturnValue(mockPanel),
  registerCustomEditorProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
};

// ── workspace ─────────────────────────────────────────────────────────────────

export const mockWatcher = new MockFileSystemWatcher();

export const workspace = {
  createFileSystemWatcher: vi.fn().mockReturnValue(mockWatcher),
  workspaceFolders: null as null | Array<{ uri: Uri; name: string }>,
  getWorkspaceFolder: vi.fn().mockImplementation((uri: Uri) => {
    const folders = workspace.workspaceFolders;
    if (!folders) return undefined;
    return folders.find(f => uri.fsPath.startsWith(f.uri.fsPath));
  }),
};

// ── ExtensionContext ──────────────────────────────────────────────────────────

export function makeExtensionContext(
  extensionPath = "/fake/ext",
): MockExtensionContext {
  return new MockExtensionContext(extensionPath);
}

export class MockExtensionContext {
  readonly subscriptions: { dispose(): void }[] = [];
  readonly extensionUri: Uri;
  readonly extensionPath: string;
  readonly globalState = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockReturnValue([]),
  };
  readonly workspaceState = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockReturnValue([]),
  };

  constructor(path: string) {
    this.extensionPath = path;
    this.extensionUri = Uri.file(path);
  }
}
