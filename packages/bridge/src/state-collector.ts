/**
 * State Collector
 *
 * VSCode API type abstractions, path utilities, type guards, and the
 * collection/subscription logic that keeps local IDEState current.
 *
 * Consumed by StatePublisher (orchestrator) and exported for testing.
 *
 * Requirements: requirements-bridge.md §6 (§6.1–§6.2)
 */

import type { IDEState, OpenTab } from "@accordo/bridge-types";

// ── VSCode API Abstractions for testability ──────────────────────────────────
// (No direct 'vscode' import — injected at runtime from extension.ts)

/** Minimal TextDocument surface used by StatePublisher */
export interface TextDocument {
  uri: { fsPath: string };
}

/** Minimal TextEditor surface used by StatePublisher */
export interface TextEditor {
  document: TextDocument;
  /** Active cursor position (0-based internally, converted to 1-based for IDEState) */
  selection: { active: { line: number; character: number } };
}

/** Event argument for onDidChangeTextEditorSelection */
export interface TextEditorSelectionChangeEvent {
  textEditor: TextEditor;
}

/** Minimal Terminal surface */
export interface Terminal {
  name: string;
}

/** Minimal workspace folder surface */
export interface WorkspaceFolder {
  uri: { fsPath: string };
}

/** Event argument for onDidChangeWorkspaceFolders */
export interface WorkspaceFoldersChangeEvent {
  readonly added: readonly WorkspaceFolder[];
  readonly removed: readonly WorkspaceFolder[];
}

/**
 * A tab input that represents a document URI.
 * Matches vscode.TabInputText — only uri is used.
 */
export interface TabInputText {
  uri: { fsPath: string };
}

/**
 * A tab input that represents a WebView panel.
 * Matches vscode.TabInputWebviewView — only viewType is used.
 */
export interface TabInputWebview {
  viewType: string;
}

/** Minimal Tab surface: the input may be a text tab, webview, or something else */
export interface Tab {
  /** Display label shown in the VS Code tab bar */
  label: string;
  /** Whether this tab is the active (focused) tab in its group */
  isActive?: boolean;
  input?: TabInputText | TabInputWebview | unknown;
}

/** Minimal TabGroup surface */
export interface TabGroup {
  readonly tabs: readonly Tab[];
}

/** A VSCode Disposable-like */
export interface VsDisposable {
  dispose(): void;
}

/** A VSCode Event<T>: subscribe fn → disposable */
export type VsEvent<T> = (listener: (e: T) => void) => VsDisposable;

/**
 * Host environment surface required by StatePublisher.
 * Injected from the real `vscode` module in extension.ts.
 * Mocked in tests.
 *
 * Named `HostEnvironment` (not `VscodeApi`) to reflect that this interface
 * is editor-agnostic: the contract is defined here, the only place that
 * satisfies it with real VSCode objects is `extension-bootstrap.ts`.
 */
export interface HostEnvironment {
  window: {
    activeTextEditor: TextEditor | undefined;
    visibleTextEditors: readonly TextEditor[];
    activeTerminal: Terminal | undefined;
    onDidChangeActiveTextEditor: VsEvent<TextEditor | undefined>;
    onDidChangeVisibleTextEditors: VsEvent<readonly TextEditor[]>;
    onDidChangeTextEditorSelection: VsEvent<TextEditorSelectionChangeEvent>;
    onDidChangeActiveTerminal: VsEvent<Terminal | undefined>;
    tabGroups: {
      all: readonly TabGroup[];
      onDidChangeTabGroups: VsEvent<unknown>;
      onDidChangeTabs: VsEvent<unknown>;
    };
  };
  workspace: {
    workspaceFolders: readonly WorkspaceFolder[] | undefined;
    /** Display name of workspace or root folder, or undefined */
    name: string | undefined;
    onDidChangeWorkspaceFolders: VsEvent<WorkspaceFoldersChangeEvent>;
  };
  env: {
    /**
     * Name of the remote. undefined when running locally.
     * e.g. "ssh-remote", "wsl", "dev-container", "codespaces", "tunnel".
     */
    remoteName: string | undefined;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Debounce for editor / selection / terminal events (ms) */
export const EDITOR_DEBOUNCE_MS = 50;

/** Debounce for tab group / open editors events (ms) */
export const TAB_DEBOUNCE_MS = 100;

/**
 * Keyframe interval in milliseconds.
 * A full snapshot is pushed to Hub on this schedule to guard against drift.
 * Default: 600 000 ms (10 minutes).
 */
export const KEYFRAME_INTERVAL_MS = 600_000;

// ── Path utilities ────────────────────────────────────────────────────────────

/**
 * Normalize an absolute filesystem path to forward-slash separators.
 * §6.2: All paths in IDEState use forward slashes.
 *
 * @param fsPath  Absolute path as returned by vscode Uri.fsPath
 * @returns       Same path with backslashes replaced by forward slashes
 */
export function normalizePath(fsPath: string): string {
  return fsPath.replace(/\\/g, "/");
}

// ── Type guards ───────────────────────────────────────────────────────────────

/**
 * Narrows an unknown tab.input value to TabInputText.
 * Only text tabs (with a document URI) satisfy this guard; webviews, terminals,
 * notebooks, etc. do not.
 */
export function isTabInputText(v: unknown): v is TabInputText {
  return (
    v !== null &&
    typeof v === "object" &&
    "uri" in v &&
    typeof (v as Record<string, unknown>)["uri"] === "object" &&
    (v as Record<string, unknown>)["uri"] !== null &&
    "fsPath" in ((v as Record<string, unknown>)["uri"] as Record<string, unknown>)
  );
}

/**
 * Narrows an unknown tab.input value to TabInputWebview.
 * WebView panels have a viewType string directly on the input object.
 */
export function isTabInputWebview(v: unknown): v is TabInputWebview {
  return (
    v !== null &&
    typeof v === "object" &&
    "viewType" in v &&
    typeof (v as Record<string, unknown>)["viewType"] === "string"
  );
}

// ── State collection helpers ──────────────────────────────────────────────────

/**
 * Derive openEditors list from vscode.window.tabGroups.all.
 * Only includes tabs with a TextDocument input (has .uri.fsPath).
 * Normalizes paths.
 *
 * §6.1: openEditors derived from tabGroups API, NOT workspace.onDidOpenTextDocument.
 */
export function deriveOpenEditors(tabGroups: readonly TabGroup[]): string[] {
  const seen = new Set<string>();
  for (const group of tabGroups) {
    for (const tab of group.tabs) {
      if (isTabInputText(tab.input)) {
        seen.add(normalizePath(tab.input.uri.fsPath));
      }
    }
  }
  return Array.from(seen);
}

/**
 * Derive openTabs list from vscode.window.tabGroups.all.
 * Captures all tabs (text, webview, other) in group order.
 * Groups are 0-indexed; isActive comes from tab.isActive ?? false.
 *
 * §6.5: M74-OT openTabs capture.
 */
export function deriveOpenTabs(tabGroups: readonly TabGroup[]): OpenTab[] {
  const result: OpenTab[] = [];
  const groups = tabGroups;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    for (const tab of group.tabs) {
      const label = tab.label;
      const isActive = tab.isActive ?? false;
      if (isTabInputText(tab.input)) {
        result.push({
          label,
          type: "text",
          path: normalizePath(tab.input.uri.fsPath),
          isActive,
          groupIndex: gi,
        });
      } else if (isTabInputWebview(tab.input)) {
        result.push({
          label,
          type: "webview",
          viewType: tab.input.viewType,
          isActive,
          groupIndex: gi,
        });
      } else {
        result.push({ label, type: "other", isActive, groupIndex: gi });
      }
    }
  }
  return result;
}

/**
 * Collect the current IDE state directly from the VSCode API.
 * Used by StatePublisher.start() for initial snapshot and by event handlers
 * to keep currentState fresh.
 *
 * @param vscode      Injected VSCode API
 * @param modalities  Existing modality state to preserve
 */
export function collectCurrentState(
  vscode: HostEnvironment,
  modalities: Record<string, Record<string, unknown>>,
): IDEState {
  const active = vscode.window.activeTextEditor;
  return {
    activeFile: active ? normalizePath(active.document.uri.fsPath) : null,
    activeFileLine: active ? active.selection.active.line + 1 : 1,
    activeFileColumn: active ? active.selection.active.character + 1 : 1,
    openEditors: deriveOpenEditors(vscode.window.tabGroups.all),
    openTabs: deriveOpenTabs(vscode.window.tabGroups.all),
    visibleEditors: Array.from(vscode.window.visibleTextEditors).map(
      (e) => normalizePath(e.document.uri.fsPath),
    ),
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(
      (f) => normalizePath(f.uri.fsPath),
    ),
    activeTerminal: vscode.window.activeTerminal?.name ?? null,
    workspaceName: vscode.workspace.name ?? null,
    remoteAuthority: vscode.env.remoteName ?? null,
    modalities: { ...modalities },
  };
}
