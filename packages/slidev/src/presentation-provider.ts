/**
 * accordo-slidev — Presentation Provider
 *
 * Manages the VS Code WebviewPanel and Slidev child process for a single
 * presentation session. One session at a time (M44-EXT-07).
 *
 * Source: requirements-slidev.md §4 M44-PVD
 *
 * Requirements:
 *   M44-PVD-01  Opens deck in a VS Code WebviewPanel (not CustomTextEditorProvider)
 *   M44-PVD-02  Spawns Slidev dev server as child process (npx slidev <deck> --port <N> --remote false)
 *   M44-PVD-03  WebviewPanel HTML contains <iframe> pointing at Slidev server URL
 *   M44-PVD-04  Injects Comment SDK overlay alongside the iframe when comments enabled
 *   M44-PVD-05  dispose() kills Slidev process and resets session state
 *   M44-PVD-06  On dispose, state resets to { isOpen: false, deckUri: null, ... }
 *   M44-PVD-07  Supports reopen/focus of existing session for same deck URI (no restart)
 *   M44-PVD-08  Port selection: scans range 7788–7888 for first free port
 */

import * as vscode from "vscode";
import type {
  ProcessSpawner,
  ChildProcessHandle,
  PresentationSessionState,
} from "./types.js";
import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { PresentationCommentsBridge } from "./presentation-comments-bridge.js";

/** Default port scan range (M44-PVD-08). */
export const PORT_RANGE_START = 7788;
export const PORT_RANGE_END = 7888;

// ── Port utilities ────────────────────────────────────────────────────────────

/**
 * M44-PVD-08
 * Returns the first free TCP port in [start, end].
 * Throws if no port is available in the range.
 */
export async function findFreePort(start: number, end: number): Promise<number> {
  throw new Error("not implemented");
}

// ── PresentationProvider ──────────────────────────────────────────────────────

export interface PresentationProviderOptions {
  context: vscode.ExtensionContext;
  spawner: ProcessSpawner;
  portOverride?: number | null;
}

/**
 * M44-PVD — Manages the WebviewPanel and Slidev child process lifecycle.
 *
 * Only one session is active at a time. Call open() to start; dispose() to end.
 */
export class PresentationProvider {
  private panel: vscode.WebviewPanel | null = null;
  private process: ChildProcessHandle | null = null;
  private currentDeckUri: string | null = null;
  private currentPort: number | null = null;
  private onDisposeCallback: (() => void) | null = null;

  constructor(private readonly options: PresentationProviderOptions) {}

  /**
   * M44-PVD-01 / M44-PVD-02 / M44-PVD-03
   * Opens the deck in a new or existing WebviewPanel.
   * If the same deck is already open, reveals the existing panel (M44-PVD-07).
   * If a different deck is open, closes the current session first.
   *
   * @param deckUri         Absolute file-system path to the deck.
   * @param adapter         Runtime adapter (already validated).
   * @param commentsBridge  Optional comments bridge (null = disabled).
   */
  async open(
    deckUri: string,
    adapter: PresentationRuntimeAdapter,
    commentsBridge: PresentationCommentsBridge | null,
  ): Promise<void> {
    throw new Error("not implemented");
  }

  /**
   * M44-PVD-05 / M44-PVD-06
   * Kills the Slidev process and disposes the WebviewPanel.
   */
  close(): void {
    throw new Error("not implemented");
  }

  /** Returns the active WebviewPanel, or null if no session is open. */
  getPanel(): vscode.WebviewPanel | null {
    return this.panel;
  }

  /** Returns the URI of the currently open deck, or null. */
  getCurrentDeckUri(): string | null {
    return this.currentDeckUri;
  }

  /** Returns the port the Slidev server is running on, or null. */
  getCurrentPort(): number | null {
    return this.currentPort;
  }

  /**
   * Register a callback to be invoked when the session is disposed.
   * Used by PresentationStateContribution to reset state on close.
   */
  onDispose(callback: () => void): void {
    this.onDisposeCallback = callback;
  }

  /** Alias for close() — implements VS Code disposable pattern. */
  dispose(): void {
    this.close();
  }
}
