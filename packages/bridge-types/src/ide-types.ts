/**
 * IDE State types — snapshot of the current editor environment.
 *
 * Sources:
 *   - requirements-hub.md §3.3 (IDEState)
 */

// ─── IDE State ──────────────────────────────────────────────────────────────

/** Valid type discriminants for an OpenTab entry */
export const OPEN_TAB_TYPES = ["text", "webview", "other"] as const;

/** A single open tab entry derived from vscode.window.tabGroups.all */
export interface OpenTab {
  /** Display label shown in the VS Code tab bar */
  label: string;
  /** Tab category — text file, webview panel, or anything else */
  type: "text" | "webview" | "other";
  /** Normalized path to the file. Only present when type === "text" */
  path?: string;
  /** WebView viewType string. Only present when type === "webview" */
  viewType?: string;
  /** Whether this is the active (focused) tab. Uses tab.isActive ?? false */
  isActive: boolean;
  /** 0-based index of the tab group that contains this tab */
  groupIndex: number;
}

/**
 * Flat snapshot of the current IDE state.
 * Pushed from Bridge to Hub over WebSocket.
 *
 * Source: requirements-hub.md §3.3
 */
export interface IDEState {
  /** Absolute path of the active editor file, or null */
  activeFile: string | null;
  /** 1-based line number of the cursor in the active file */
  activeFileLine: number;
  /** 1-based column number of the cursor in the active file */
  activeFileColumn: number;
  /** Absolute paths of all open editor tabs (from tabGroups API) */
  openEditors: string[];
  /** All open tabs across all tab groups, in group order */
  openTabs: OpenTab[];
  /** Absolute paths of editors visible in split panes */
  visibleEditors: string[];
  /** Absolute paths of all workspace folder roots */
  workspaceFolders: string[];
  /** Display name of the active terminal, or null */
  activeTerminal: string | null;
  /**
   * Display name of the workspace or root folder.
   * From vscode.workspace.name. Null when no folder is open.
   */
  workspaceName: string | null;
  /**
   * Remote authority identifier — describes the execution environment.
   * From vscode.env.remoteName.
   * null = local, or one of "ssh-remote", "wsl", "dev-container",
   * "codespaces", "tunnel", etc.
   */
  remoteAuthority: string | null;
  /** Per-extension modality state. Key = extension ID (e.g. "accordo-editor") */
  modalities: Record<string, Record<string, unknown>>;
}
