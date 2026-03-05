/**
 * VS Code mock for vitest unit tests in accordo-slidev.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Provides stubs for VS Code APIs called by accordo-slidev modules.
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
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new Uri(value.startsWith("https") ? "https" : "http", value);
    }
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
  asWebviewUri(uri: Uri): Uri { return uri; }

  onDidReceiveMessage = vi.fn().mockReturnValue({ dispose: vi.fn() });
}

export class MockWebviewPanel {
  readonly webview = new MockWebview();
  readonly viewType: string;
  readonly title: string;
  visible = true;
  active = true;

  readonly onDidDispose = vi.fn().mockReturnValue({ dispose: vi.fn() });
  readonly onDidChangeViewState = vi.fn().mockReturnValue({ dispose: vi.fn() });
  readonly reveal = vi.fn();
  readonly dispose = vi.fn();

  constructor(viewType: string, title: string) {
    this.viewType = viewType;
    this.title = title;
  }
}

// ── window ────────────────────────────────────────────────────────────────────

export const mockPanel = new MockWebviewPanel("accordo.presentation", "Presentation");

export const window = {
  createWebviewPanel: vi.fn().mockReturnValue(mockPanel),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  activeTextEditor: null as null | { document: { uri: Uri; fsPath?: string } },
};

// ── workspace ─────────────────────────────────────────────────────────────────

export const workspace = {
  workspaceFolders: null as null | Array<{ uri: Uri; name: string }>,
  findFiles: vi.fn().mockResolvedValue([]),
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(null),
  }),
  fs: {
    readFile: vi.fn().mockResolvedValue(Buffer.from("")),
    stat: vi.fn().mockResolvedValue({}),
  },
};

// ── env ───────────────────────────────────────────────────────────────────────

export const env = {
  asExternalUri: vi.fn().mockImplementation((uri: Uri) => Promise.resolve(uri)),
};

// ── commands ──────────────────────────────────────────────────────────────────

export const commands = {
  executeCommand: vi.fn(),
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

// ── extensions ───────────────────────────────────────────────────────────────

export const extensions = {
  getExtension: vi.fn().mockReturnValue(null),
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
