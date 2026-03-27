/**
 * VSCode mock for vitest unit tests in accordo-bridge.
 *
 * Mapped to 'vscode' via vitest.config.ts resolve.alias.
 * Covers all APIs used by extension.ts:
 *   window.createStatusBarItem, window.showQuickPick, window.showInformationMessage,
 *   window.showWarningMessage, window.showErrorMessage, window.createOutputChannel,
 *   commands.registerCommand, workspace.getConfiguration,
 *   EventEmitter, StatusBarAlignment, ConfigurationTarget.
 */

import { vi } from "vitest";

// ── Uri ───────────────────────────────────────────────────────────────────────

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;

  private constructor(scheme: string, p: string) {
    this.scheme = scheme;
    this.fsPath = p;
    this.path = p;
  }

  static file(p: string): Uri {
    return new Uri("file", p);
  }

  static parse(value: string): Uri {
    if (value.startsWith("file://")) return new Uri("file", value.slice(7));
    return new Uri("file", value);
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

// ── StatusBarAlignment ────────────────────────────────────────────────────────

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// ── ConfigurationTarget ───────────────────────────────────────────────────────

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

// ── StatusBarItem mock ────────────────────────────────────────────────────────

export interface MockStatusBarItem {
  text: string;
  tooltip: string;
  command: string | undefined;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

export function createStatusBarItemMock(): MockStatusBarItem {
  return {
    text: "",
    tooltip: "",
    command: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

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

// ── window ────────────────────────────────────────────────────────────────────

// Mutable so tests can inspect the last created item
let _statusBarItem = createStatusBarItemMock();

export const window = {
  createStatusBarItem: vi.fn(
    (_alignment?: StatusBarAlignment, _priority?: number): MockStatusBarItem => {
      _statusBarItem = createStatusBarItemMock();
      return _statusBarItem;
    },
  ),
  showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showQuickPick: vi.fn(async (_items: unknown, _options?: unknown) => undefined),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
  })),
  // Test helper
  _getLastStatusBarItem: () => _statusBarItem,
  _resetStatusBarItem: () => { _statusBarItem = createStatusBarItemMock(); },
};

// ── commands ──────────────────────────────────────────────────────────────────

// Registry of mock command handlers so tests can invoke them
const _commandRegistry = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
    _commandRegistry.set(id, handler);
    return { dispose: vi.fn(() => { _commandRegistry.delete(id); }) };
  }),
  executeCommand: vi.fn(async (id: string, ...args: unknown[]) => {
    const handler = _commandRegistry.get(id);
    return handler?.(...args);
  }),
  _getRegistry: () => _commandRegistry,
  _clearRegistry: () => { _commandRegistry.clear(); },
};

// ── workspace ─────────────────────────────────────────────────────────────────

function makeCfg(overrides: Record<string, unknown> = {}): ReturnType<typeof makeConfigurationMock> {
  return makeConfigurationMock(overrides);
}

function makeConfigurationMock(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T => {
      if (key in overrides) return overrides[key] as T;
      return defaultValue as T;
    }),
    inspect: vi.fn((_key: string) => ({ globalValue: undefined as unknown, workspaceValue: undefined as unknown })),
    update: vi.fn(async () => undefined),
    has: vi.fn((_key: string) => false),
  };
}

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => makeCfg()),
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
};

// ── extensions ────────────────────────────────────────────────────────────────

export const extensions = {
  getExtension: vi.fn((_id: string) => undefined as unknown),
};

// ── secrets (for ExtensionContext) ────────────────────────────────────────────

export function createSecretsMock() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    _store: store,
  };
}

// ── ExtensionContext mock ──────────────────────────────────────────────────────

export function createExtensionContextMock() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    secrets: createSecretsMock(),
    extensionPath: "/mock/extension",
    extensionUri: Uri.file("/mock/extension"),
    globalStorageUri: Uri.file("/mock/extension/global-storage/accordo.accordo-bridge"),
    storagePath: "/mock/storage",
    globalStoragePath: "/mock/global-storage",
    logPath: "/mock/log",
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => [] as string[]),
    },
    globalState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => [] as string[]),
      setKeysForSync: vi.fn(),
    },
  };
}
