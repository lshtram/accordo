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
import { appendFileSync } from "node:fs";
import { basename, extname, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { parseMermaid } from "../parser/adapter.js";
import { readLayout, writeLayout, layoutPathFor, createEmptyLayout, patchNode } from "../layout/layout-store.js";
import { reconcile } from "../reconciler/reconciler.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import { getWebviewHtml } from "./html.js";
import { toExcalidrawPayload } from "./scene-adapter.js";
import type { LayoutStore, SpatialDiagramType } from "../types.js";
import type {
  HostLoadSceneMessage,
  HostToastMessage,
  HostRequestExportMessage,
  HostErrorOverlayMessage,
  WebviewToHostMessage,
} from "./protocol.js";

// ── Debug flag ────────────────────────────────────────────────────────────────
// Set to true to write verbose canvas message logs to /tmp/accordo-diagram.log
// and snapshot Excalidraw scenes to .accordo/diagrams/. Off by default.
const PANEL_FILE_DEBUG = false;

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
  // Debounce timer for file-watcher triggered refresh (500 ms)
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Debounce timer for async layout write coalescing (100 ms)
  private _layoutWriteTimer: ReturnType<typeof setTimeout> | null = null;
  // Callbacks fired when the panel is disposed (used by extension.ts registry)
  private _onDisposedCallbacks: Array<() => void> = [];

  // Pending export: resolve/reject callbacks + format
  private _pendingExport: {
    resolve: (buf: Buffer) => void;
    reject: (err: unknown) => void;
    format: "svg" | "png";
  } | null = null;

  // Optional logger — writes to the Accordo Diagram output channel
  private _log: (msg: string) => void = () => {};
  // Absolute path to the workspace root (used to derive the .accordo/diagrams path)
  private _workspaceRoot = "";
  /** Log to output channel AND append a timestamped line to /tmp/accordo-diagram.log.
   * No-op when PANEL_FILE_DEBUG is false. */
  private _debugLog(msg: string): void {
    if (!PANEL_FILE_DEBUG) return;
    this._log(msg);
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { appendFileSync("/tmp/accordo-diagram.log", line, "utf-8"); } catch { /* ignore */ }
  }

  private constructor(mmdPath: string, panel: vscode.WebviewPanel) {
    this.mmdPath = mmdPath;
    this._panel = panel;
    // Workspace root is set by the factory after construction.
  }

  // ── Factory ─────────────────────────────────────────────────────────────────

  /**
   * Open an empty Excalidraw canvas not tied to any .mmd file.
   * The canvas starts blank — the user can draw freely.
   * No file watcher is set up. No layout is persisted.
   */
  static async createEmpty(
    context: vscode.ExtensionContext,
    log: (msg: string) => void = () => {},
  ): Promise<DiagramPanel> {
    log("DiagramPanel.createEmpty() — creating webview panel");
    const panel = vscode.window.createWebviewPanel(
      "accordo.diagram",
      "New Canvas",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );

    const instance = new DiagramPanel("", panel);
    instance._log = log;

    // Register message listener BEFORE setting webview.html so no canvas:ready
    // message can be missed in the window between HTML assignment and subscription.
    instance._disposables.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        instance._handleWebviewMessage(msg as WebviewToHostMessage);
      }),
    );

    instance._disposables.push(
      panel.onDidDispose(() => {
        instance._cleanupOnDispose();
      }),
    );

    const nonce = randomBytes(16).toString("hex");
    const bundleUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.bundle.js"),
      )
      .toString();
    log("DiagramPanel.createEmpty() — bundle URI: " + bundleUri);
    const virgilFontUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "Virgil.woff2"))
      .toString();
    panel.webview.html = getWebviewHtml({
      nonce,
      cspSource: panel.webview.cspSource,
      bundleUri,
      virgilFontUri,
    });
    log("DiagramPanel.createEmpty() — HTML set, waiting for canvas:ready");

    context.subscriptions.push(instance);
    return instance;
  }

  /**
   * Create and open a DiagramPanel for the given `.mmd` file.
   * Reads the file and layout, generates the initial canvas scene, and posts
   * it to the webview. Sets up a file watcher for auto-refresh on save.
   */
  static async create(
    context: vscode.ExtensionContext,
    mmdPath: string,
    log: (msg: string) => void = () => {},
  ): Promise<DiagramPanel> {
    log("DiagramPanel.create() — path: " + mmdPath);
    const title = basename(mmdPath, extname(mmdPath));
    const panel = vscode.window.createWebviewPanel(
      "accordo.diagram",
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        // Restrict local resource loading to the extension's dist/ folder only.
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );

    const instance = new DiagramPanel(mmdPath, panel);
    instance._log = log;
    instance._workspaceRoot = DiagramPanel._resolveWorkspaceRoot(mmdPath);

    // Register message listener BEFORE setting webview.html so no canvas:ready
    // message can be missed in the window between HTML assignment and subscription.
    instance._disposables.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        instance._handleWebviewMessage(msg as WebviewToHostMessage);
      }),
    );

    instance._disposables.push(
      panel.onDidDispose(() => {
        instance._cleanupOnDispose();
      }),
    );

    // File watcher: auto-refresh when the .mmd file is saved (500 ms debounce).
    // The debounce coalesces rapid saves (e.g. auto-save in VS Code) into a
    // single refresh cycle, avoiding flicker on large diagrams.
    const watcher = vscode.workspace.createFileSystemWatcher(mmdPath);
    instance._disposables.push(
      watcher.onDidChange(() => {
        if (instance._refreshTimer !== null) clearTimeout(instance._refreshTimer);
        instance._refreshTimer = setTimeout(() => {
          instance._refreshTimer = null;
          instance.refresh().catch(() => {
            // Errors shown via host:error-overlay inside refresh()
          });
        }, 500);
      }),
    );
    instance._disposables.push(watcher);

    // Set the webview HTML — message listener is already registered above.
    const nonce = randomBytes(16).toString("hex");
    const bundleUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.bundle.js"),
      )
      .toString();
    log("DiagramPanel.create() — bundle URI: " + bundleUri);
    const virgilFontUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "Virgil.woff2"))
      .toString();
    panel.webview.html = getWebviewHtml({
      nonce,
      cspSource: panel.webview.cspSource,
      bundleUri,
      virgilFontUri,
    });
    log("DiagramPanel.create() — HTML set, waiting for canvas:ready");

    context.subscriptions.push(instance);

    // The authoritative load is triggered by canvas:ready from the webview.
    log("DiagramPanel.create() — setup complete, waiting for canvas:ready from webview");

    return instance;
  }

  /**
   * Wire up an existing VS Code WebviewPanel (e.g. provided by a CustomEditorProvider)
   * to serve as a DiagramPanel for the given `.mmd` file.
   * Shares the same setup as `create()` but skips `createWebviewPanel`.
   */
  static async createFromExistingPanel(
    context: vscode.ExtensionContext,
    mmdPath: string,
    existingPanel: vscode.WebviewPanel,
    log: (msg: string) => void = () => {},
  ): Promise<DiagramPanel> {
    log("DiagramPanel.createFromExistingPanel() — path: " + mmdPath);

    // Configure the webview options that the custom editor provider didn't set.
    existingPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    };

    const instance = new DiagramPanel(mmdPath, existingPanel);
    instance._log = log;
    instance._workspaceRoot = DiagramPanel._resolveWorkspaceRoot(mmdPath);

    instance._disposables.push(
      existingPanel.webview.onDidReceiveMessage((msg: unknown) => {
        instance._handleWebviewMessage(msg as WebviewToHostMessage);
      }),
    );

    instance._disposables.push(
      existingPanel.onDidDispose(() => {
        instance._cleanupOnDispose();
      }),
    );

    const watcher = vscode.workspace.createFileSystemWatcher(mmdPath);
    instance._disposables.push(
      watcher.onDidChange(() => {
        if (instance._refreshTimer !== null) clearTimeout(instance._refreshTimer);
        instance._refreshTimer = setTimeout(() => {
          instance._refreshTimer = null;
          instance.refresh().catch(() => {});
        }, 500);
      }),
    );
    instance._disposables.push(watcher);

    const nonce = randomBytes(16).toString("hex");
    const bundleUri = existingPanel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.bundle.js"),
      )
      .toString();
    const virgilFontUri = existingPanel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "Virgil.woff2"))
      .toString();
    existingPanel.webview.html = getWebviewHtml({
      nonce,
      cspSource: existingPanel.webview.cspSource,
      bundleUri,
      virgilFontUri,
    });
    log("DiagramPanel.createFromExistingPanel() — setup complete");

    context.subscriptions.push(instance);
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
   * Register a callback to be called when this panel is disposed.
   * Used by extension.ts to remove the panel from the path-keyed registry.
   */
  onDisposed(cb: () => void): void {
    this._onDisposedCallbacks.push(cb);
  }

  /**
   * Reveal (focus) this panel in the editor. Useful when the command is
   * invoked for a diagram that already has a panel open.
   */
  reveal(column?: vscode.ViewColumn): void {
    this._panel.reveal(column);
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

  /**
   * Resolve the workspace root for a given .mmd file path.
   * Uses getWorkspaceFolder() to handle multi-root workspaces correctly.
   * Falls back to dirname(mmdPath) if the file is not in any open workspace
   * folder (e.g. opened directly from Finder / outside an open workspace).
   */
  private static _resolveWorkspaceRoot(mmdPath: string): string {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mmdPath));
    if (folder) return folder.uri.fsPath;
    return dirname(mmdPath);
  }

  private _assertNotDisposed(): void {
    if (this._disposed) throw new PanelDisposedError();
  }

  private _cleanupOnDispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Cancel any pending debounced refresh
    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    // Cancel any pending debounced layout write
    if (this._layoutWriteTimer !== null) {
      clearTimeout(this._layoutWriteTimer);
      this._layoutWriteTimer = null;
    }

    // Reject any pending export
    if (this._pendingExport) {
      this._pendingExport.reject(new PanelDisposedError());
      this._pendingExport = null;
    }

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;

    // Fire any registered onDisposed callbacks (e.g. extension.ts registry cleanup)
    for (const cb of this._onDisposedCallbacks) cb();
    this._onDisposedCallbacks.length = 0;
  }

  /**
   * Core load routine: read .mmd + layout → reconcile → generate → post host:load-scene.
   * On parse failure posts host:error-overlay instead.
   */
  private async _loadAndPost(): Promise<void> {
    this._log("_loadAndPost() start — reading: " + this.mmdPath);
    // Read source
    let source: string;
    try {
      source = await readFile(this.mmdPath, "utf8");
      this._log("_loadAndPost() — file read OK, " + source.length + " chars");
    } catch (err) {
      this._log("_loadAndPost() — file read FAILED: " + String(err));
      throw new PanelFileNotFoundError(this.mmdPath);
    }

    // Parse
    this._log("_loadAndPost() — parsing mermaid source");
    const parseResult = await parseMermaid(source);
    if (!parseResult.valid) {
      this._log("_loadAndPost() — parse FAILED: " + parseResult.error.message);
      const errMsg: HostErrorOverlayMessage = {
        type: "host:error-overlay",
        message: parseResult.error.message,
      };
      this._panel.webview.postMessage(errMsg);
      return;
    }
    this._log("_loadAndPost() — parse OK, type=" + parseResult.diagram.type);

    const layoutPath = layoutPathFor(this.mmdPath, this._workspaceRoot);

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

    // Convert internal ExcalidrawElement[] → Excalidraw API payload once here.
    // The webview receives already-resolved elements and calls api.updateScene() directly.
    const apiElements = toExcalidrawPayload(scene.elements);

    const msg: HostLoadSceneMessage = {
      type: "host:load-scene",
      elements: apiElements,
      appState: {},
    };
    this._panel.webview.postMessage(msg);
    this._log("_loadAndPost() — host:load-scene posted with " + apiElements.length + " elements");

    // TODO(diag.2): Export to .excalidraw format — write the rendered scene as a
    // standard Excalidraw file so the user can open it in excalidraw.com or the
    // Excalidraw VS Code extension without having Accordo installed.
    // Trigger: VS Code setting `accordo.diagram.writeExcalidrawSnapshot` (default off).
    // Use `await writeFile(excalidrawPath, excalidrawJson, "utf-8")` (async — not sync).
    // Make excalidrawPath derivation a shared helper alongside layoutPathFor().
    // See diag_workplan.md TD-DIAG-2 for full context.
    //
    // const excalidrawPath = layoutPath.replace(/\.layout\.json$/, ".excalidraw");
    // const excalidrawJson = JSON.stringify({
    //   type: "excalidraw",
    //   version: 2,
    //   source: "accordo-diagram",
    //   elements: apiElements,
    //   appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    //   files: {},
    // }, null, 2);
    // try {
    //   mkdirSync(dirname(excalidrawPath), { recursive: true });
    //   writeFileSync(excalidrawPath, excalidrawJson, "utf-8");
    // } catch {
    //   // non-fatal
    // }
  }

  /**
   * Handle incoming messages from the webview.
   */
  private _handleWebviewMessage(msg: WebviewToHostMessage): void {
    this._log("webview → host message: type=" + msg.type);
    switch (msg.type) {
      case "canvas:ready":
        // Webview has finished mounting — send the latest scene.
        // This is the authoritative trigger for the initial load and for
        // reloads after VS Code restores a backgrounded webview tab.
        if (this.mmdPath === "") {
          this._log("canvas:ready received (empty mode) — posting empty host:load-scene");
          // Empty canvas mode: send an empty scene so Excalidraw renders its
          // blank canvas. No file to read or layout to restore.
          const emptyMsg: HostLoadSceneMessage = {
            type: "host:load-scene",
            elements: [],
            appState: {},
          };
          this._panel.webview.postMessage(emptyMsg);
          this._log("host:load-scene (empty) posted");
        } else {
          this._log("canvas:ready received — calling _loadAndPost for: " + this.mmdPath);
          void this._loadAndPost();
        }
        break;
      case "canvas:node-moved":
        this._handleNodeMoved(msg.nodeId, msg.x, msg.y);
        break;
      case "canvas:node-resized":
        this._handleNodeResized(msg.nodeId, msg.w, msg.h);
        break;
      case "canvas:node-styled":
        this._handleNodeStyled(msg.nodeId, msg.style as Record<string, unknown>);
        break;
      case "canvas:export-ready":
        this._handleExportReady(msg.format, msg.data);
        break;
      case "canvas:js-error":
        this._log("webview JS error: " + msg.message);
        break;
      default:
        this._log("webview → host: unhandled message type: " + (msg as { type: string }).type);
        break;
    }
  }

  private _handleNodeMoved(nodeId: string, x: number, y: number): void {
    this._debugLog(`canvas:node-moved nodeId=${nodeId} x=${x} y=${y}`);
    this._patchLayout((layout) => patchNode(layout, nodeId, { x, y }));
  }

  private _handleNodeResized(nodeId: string, w: number, h: number): void {
    this._debugLog(`canvas:node-resized nodeId=${nodeId} w=${w} h=${h}`);
    this._patchLayout((layout) => patchNode(layout, nodeId, { w, h }));
  }

  private _handleNodeStyled(nodeId: string, stylePatch: Record<string, unknown>): void {
    this._debugLog(`canvas:node-styled nodeId=${nodeId} style=${JSON.stringify(stylePatch)}`);
    this._patchLayout((layout) => {
      const existing = layout.nodes[nodeId]?.style ?? {};
      return patchNode(layout, nodeId, { style: { ...existing, ...stylePatch } as import("../types.js").NodeStyle });
    });
  }

  /**
   * Apply an in-memory layout patch and schedule an async debounced disk write.
   * Canvas interactions (drag, resize) use this to stay low-latency: the in-memory
   * layout is updated synchronously, while disk I/O is coalesced into a single
   * write 100 ms after the last interaction in a burst.
   */
  private _patchLayout(apply: (layout: LayoutStore) => LayoutStore): void {
    const layoutPath = layoutPathFor(this.mmdPath, this._workspaceRoot);

    // _currentLayout is maintained by _loadAndPost for every canvas:ready cycle.
    // The null fallback handles the rare race where the user interacts before
    // the first load completes.
    const base = this._currentLayout ?? createEmptyLayout("flowchart");
    this._currentLayout = apply(base);

    // Debounce disk write: coalesce rapid drag events into a single async write.
    if (this._layoutWriteTimer !== null) clearTimeout(this._layoutWriteTimer);
    this._layoutWriteTimer = setTimeout(() => {
      this._layoutWriteTimer = null;
      const snapshot = this._currentLayout;
      if (snapshot === null) return;
      writeLayout(layoutPath, snapshot).catch(() => {
        // Non-fatal: the next _loadAndPost or interaction will write again.
      });
    }, 100);
  }

  private _handleExportReady(format: string, data: string): void {
    if (!this._pendingExport) return;
    const { resolve, format: expectedFormat } = this._pendingExport;
    // Check format BEFORE clearing — a mismatched reply must not orphan the promise.
    if (format !== expectedFormat) return;
    this._pendingExport = null;
    resolve(Buffer.from(data, "base64"));
  }
}
