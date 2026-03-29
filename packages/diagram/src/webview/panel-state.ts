/**
 * A15 — panel-state: state management for DiagramPanel.
 *
 * Contains the PanelState data type, factory function, state accessors,
 * cleanup logic, and workspace-root resolution.
 *
 * Source: diag_workplan.md §4.15
 */

import { dirname } from "node:path";
import * as vscode from "vscode";
import type { DiagramCommentsBridge } from "../comments/diagram-comments-bridge.js";
import type { LayoutStore } from "../types.js";
import { PanelDisposedError } from "./panel.js";

export { PanelDisposedError };

// ── PanelState type ───────────────────────────────────────────────────────────

export interface PanelState {
  mmdPath: string;
  _disposed: boolean;
  _pendingExport: {
    resolve: (buf: Buffer) => void;
    reject: (err: unknown) => void;
    format: "svg" | "png";
  } | null;
  _refreshTimer: ReturnType<typeof setTimeout> | null;
  _layoutWriteTimer: ReturnType<typeof setTimeout> | null;
  _disposables: vscode.Disposable[];
  _commentsBridge: DiagramCommentsBridge | null;
  _onDisposedCallbacks: Array<() => void>;
  _workspaceRoot: string;
  _lastSource: string;
  _currentLayout: LayoutStore | null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a fresh PanelState bag for a file-backed or empty panel.
 * The panel and context arguments are accepted for signature compatibility
 * with the factory helpers; the state itself does not hold a panel reference.
 */
export function createPanelState(
  mmdPath: string,
  _panel: vscode.WebviewPanel,
  _context: vscode.ExtensionContext,
): PanelState {
  return {
    mmdPath,
    _disposed: false,
    _pendingExport: null,
    _refreshTimer: null,
    _layoutWriteTimer: null,
    _disposables: [],
    _commentsBridge: null,
    _onDisposedCallbacks: [],
    _workspaceRoot: resolveWorkspaceRoot(mmdPath),
    _lastSource: "",
    _currentLayout: null,
  };
}

// ── Accessors / guards ────────────────────────────────────────────────────────

/**
 * Throws PanelDisposedError when the state has been disposed.
 */
export function assertNotDisposed(state: PanelState): void {
  if (state._disposed) throw new PanelDisposedError();
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Cleans up all timers, disposables, pending exports, and fires onDisposed
 * callbacks. Idempotent — safe to call multiple times.
 */
export function cleanupOnDispose(state: PanelState): void {
  if (state._disposed) return;
  state._disposed = true;

  if (state._refreshTimer !== null) {
    clearTimeout(state._refreshTimer);
    state._refreshTimer = null;
  }

  if (state._layoutWriteTimer !== null) {
    clearTimeout(state._layoutWriteTimer);
    state._layoutWriteTimer = null;
  }

  if (state._pendingExport !== null) {
    state._pendingExport.reject(new PanelDisposedError());
    state._pendingExport = null;
  }

  state._commentsBridge?.dispose();
  state._commentsBridge = null;

  for (const d of state._disposables) {
    d.dispose();
  }
  state._disposables.length = 0;

  for (const cb of state._onDisposedCallbacks) cb();
  state._onDisposedCallbacks.length = 0;
}

// ── Workspace root resolution ─────────────────────────────────────────────────

/**
 * Resolves the workspace root for a given .mmd file path.
 * Uses getWorkspaceFolder() to handle multi-root workspaces correctly.
 * Falls back to dirname(mmdPath) when the file is not inside any open folder.
 */
export function resolveWorkspaceRoot(mmdPath: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mmdPath));
  if (folder) return folder.uri.fsPath;
  return dirname(mmdPath);
}
