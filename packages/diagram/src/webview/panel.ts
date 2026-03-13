/**
 * A15 — DiagramPanel: VSCode webview panel manager.
 *
 * Creates and manages a VSCode webview showing an Excalidraw canvas for a
 * `.mmd` diagram. The panel is canvas-only — no in-panel text editor.
 * Human text edits happen via the normal VS Code text editor; the panel's
 * file watcher triggers automatic canvas refresh on save.
 *
 * Public API
 * ──────────
 *   DiagramPanel.create(context, mmdPath) → DiagramPanel
 *   panel.mmdPath                          → string (absolute)
 *   panel.refresh()                        → Promise<void>
 *   panel.notify(message)                  → void
 *   panel.requestExport(format)            → Promise<Buffer>
 *   panel.dispose()                        → void
 *
 * Source: diag_workplan.md §4.15
 */

import { readFile } from "node:fs/promises";
import { writeFileSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import * as vscode from "vscode";

import { parseMermaid } from "../parser/adapter.js";
import { readLayout, writeLayout, layoutPathFor, createEmptyLayout, patchNode } from "../layout/layout-store.js";
import { reconcile } from "../reconciler/reconciler.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import type { LayoutStore, SpatialDiagramType } from "../types.js";
import type {
  HostLoadSceneMessage,
  HostToastMessage,
  HostRequestExportMessage,
  HostErrorOverlayMessage,
  WebviewToHostMessage,
} from "./protocol.js";

// ── Error types ───────────────────────────────────────────────────────────────

export class PanelDisposedError extends Error {
  constructor() {
    super("DiagramPanel has been disposed");
    this.name = "PanelDisposedError";
  }
}

export class ExportBusyError extends Error {
  constructor() {
    super("An export is already in progress");
    this.name = "ExportBusyError";
  }
}

export class PanelFileNotFoundError extends Error {
  constructor(path: string) {
    super(`Diagram file not found: ${path}`);
    this.name = "PanelFileNotFoundError";
  }
}

// ── DiagramPanel ──────────────────────────────────────────────────────────────

export class DiagramPanel {
  readonly mmdPath: string;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  private _disposed = false;
  private _lastSource = "";
  // In-memory layout cache — kept up-to-date by _loadAndPost and canvas message handlers
  private _currentLayout: LayoutStore | null = null;

  // Pending export: resolve/reject callbacks + format
  private _pendingExport: {
    resolve: (buf: Buffer) => void;
    reject: (err: unknown) => void;
    format: "svg" | "png";
  } | null = null;

  private constructor(mmdPath: string, panel: vscode.WebviewPanel) {
    this.mmdPath = mmdPath;
    this._panel = panel;
  }

  // ── Factory ─────────────────────────────────────────────────────────────────

  /**
   * Create and open a DiagramPanel for the given `.mmd` file.
   * Reads the file and layout, generates the initial canvas scene, and posts
   * it to the webview. Sets up a file watcher for auto-refresh on save.
   */
  static async create(
    context: vscode.ExtensionContext,
    mmdPath: string,
  ): Promise<DiagramPanel> {
    const title = basename(mmdPath, extname(mmdPath));
    const panel = vscode.window.createWebviewPanel(
      "accordo.diagram",
      title,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    const instance = new DiagramPanel(mmdPath, panel);

    // Wire up incoming webview messages
    instance._disposables.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        // Boundary: messages arrive as `unknown` from VS Code's postMessage API.
      instance._handleWebviewMessage(msg as WebviewToHostMessage);
      }),
    );

    // Dispose DiagramPanel when the VS Code panel is closed
    instance._disposables.push(
      panel.onDidDispose(() => {
        instance._cleanupOnDispose();
      }),
    );

    // File watcher: auto-refresh when the .mmd file is saved
    const watcher = vscode.workspace.createFileSystemWatcher(mmdPath);
    instance._disposables.push(
      watcher.onDidChange(() => {
        instance.refresh().catch(() => {
          // Errors shown via host:error-overlay inside refresh()
        });
      }),
    );
    instance._disposables.push(watcher);

    context.subscriptions.push(instance);

    // Initial load
    await instance._loadAndPost();

    return instance;
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  /**
   * Re-read the `.mmd` file and layout, reconcile, generate a new canvas
   * scene, and post `host:load-scene` to the webview.
   * Rejects with `PanelFileNotFoundError` if the file is missing.
   * Rejects with `PanelDisposedError` if the panel has been disposed.
   */
  async refresh(): Promise<void> {
    this._assertNotDisposed();
    await this._loadAndPost();
  }

  /**
   * Post a `host:toast` message to the webview for transient notifications.
   * Throws `PanelDisposedError` if the panel has been disposed.
   */
  notify(message: string): void {
    this._assertNotDisposed();
    const msg: HostToastMessage = { type: "host:toast", message };
    this._panel.webview.postMessage(msg);
  }

  /**
   * Ask the webview to export the current canvas.
   * Returns a Buffer of the exported file contents.
   * Rejects with `ExportBusyError` if an export is already in flight.
   * Rejects with `PanelDisposedError` if the panel is disposed while waiting.
   */
  async requestExport(format: "svg" | "png"): Promise<Buffer> {
    this._assertNotDisposed();
    if (this._pendingExport !== null) {
      throw new ExportBusyError();
    }

    return new Promise<Buffer>((resolve, reject) => {
      this._pendingExport = { resolve, reject, format };
      const msg: HostRequestExportMessage = { type: "host:request-export", format };
      this._panel.webview.postMessage(msg);
    });
  }

  /**
   * Dispose the underlying VS Code webview panel and clean up all resources.
   */
  dispose(): void {
    if (this._disposed) return;
    this._panel.dispose();
    this._cleanupOnDispose();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _assertNotDisposed(): void {
    if (this._disposed) throw new PanelDisposedError();
  }

  private _cleanupOnDispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Reject any pending export
    if (this._pendingExport) {
      this._pendingExport.reject(new PanelDisposedError());
      this._pendingExport = null;
    }

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  /**
   * Core load routine: read .mmd + layout → reconcile → generate → post host:load-scene.
   * On parse failure posts host:error-overlay instead.
   */
  private async _loadAndPost(): Promise<void> {
    // Read source
    let source: string;
    try {
      source = await readFile(this.mmdPath, "utf8");
    } catch {
      throw new PanelFileNotFoundError(this.mmdPath);
    }

    // Parse
    const parseResult = await parseMermaid(source);
    if (!parseResult.valid) {
      const errMsg: HostErrorOverlayMessage = {
        type: "host:error-overlay",
        message: parseResult.error.message,
      };
      this._panel.webview.postMessage(errMsg);
      return;
    }

    const layoutPath = layoutPathFor(this.mmdPath);

    // Load or compute layout
    let layout = await readLayout(layoutPath);
    if (layout === null) {
      // No layout file: compute a full initial layout with node positions
      try {
        layout = computeInitialLayout(parseResult.diagram);
      } catch {
        // computeInitialLayout throws UnsupportedDiagramTypeError for non-dagre
        // types; fall back to an empty flowchart layout so the panel can still
        // show an error-overlay on the next postMessage cycle.
        layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
      }
    }

    // Reconcile when source has changed since last load
    if (this._lastSource !== "" && this._lastSource !== source) {
      try {
        const result = await reconcile(this._lastSource, source, layout);
        layout = result.layout;
        await writeLayout(layoutPath, layout);
      } catch {
        // Reconcile errors are non-fatal; proceed with existing layout
      }
    }

    this._lastSource = source;

    // Generate canvas (resolves any unplaced[] nodes)
    const scene = generateCanvas(parseResult.diagram, layout);

    // Persist layout with resolved positions (unplaced[] cleared)
    await writeLayout(layoutPath, scene.layout);
    this._currentLayout = scene.layout;

    const msg: HostLoadSceneMessage = {
      type: "host:load-scene",
      elements: scene.elements,
      appState: {},
    };
    this._panel.webview.postMessage(msg);
  }

  /**
   * Handle incoming messages from the webview.
   */
  private _handleWebviewMessage(msg: WebviewToHostMessage): void {
    switch (msg.type) {
      case "canvas:node-moved":
        this._handleNodeMoved(msg.nodeId, msg.x, msg.y);
        break;
      case "canvas:node-resized":
        this._handleNodeResized(msg.nodeId, msg.w, msg.h);
        break;
      case "canvas:export-ready":
        this._handleExportReady(msg.format, msg.data);
        break;
      default:
        // Other canvas messages (node-added, edge-added, etc.) are diag.2
        break;
    }
  }

  private _handleNodeMoved(nodeId: string, x: number, y: number): void {
    this._patchLayoutSync((layout) => patchNode(layout, nodeId, { x, y }));
  }

  private _handleNodeResized(nodeId: string, w: number, h: number): void {
    this._patchLayoutSync((layout) => patchNode(layout, nodeId, { w, h }));
  }

  /**
   * Synchronously patch the in-memory layout cache and write to disk.
   * Canvas interactions (drag, resize) must be low-latency and deterministic.
   */
  private _patchLayoutSync(apply: (layout: LayoutStore) => LayoutStore): void {
    const layoutPath = layoutPathFor(this.mmdPath);

    // Use in-memory cache if available, otherwise read from disk synchronously
    let layout = this._currentLayout;
    if (layout === null) {
      try {
        const raw = readFileSync(layoutPath, "utf-8");
        // Boundary: reading from disk; the file was written by this panel so
        // the structure is trusted. Full validation happens in readLayout() on
        // the async path.
        layout = JSON.parse(raw) as LayoutStore;
      } catch {
        layout = createEmptyLayout("flowchart");
      }
    }

    const updated = apply(layout);
    this._currentLayout = updated;
    writeFileSync(layoutPath, JSON.stringify(updated, null, 2), "utf-8");
  }

  private _handleExportReady(format: string, data: string): void {
    if (!this._pendingExport) return;
    const { resolve, format: expectedFormat } = this._pendingExport;
    this._pendingExport = null;
    if (format !== expectedFormat) return;
    resolve(Buffer.from(data, "base64"));
  }
}
