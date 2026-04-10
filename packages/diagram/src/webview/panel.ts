/**
 * A15 — DiagramPanel: VSCode webview panel manager.
 * Creates and manages a VSCode webview showing an Excalidraw canvas for a `.mmd` diagram.
 * Source: diag_workplan.md §4.15
 */

import { basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import { getWebviewHtml } from "./html.js";
import type {
  HostToastMessage,
  HostRequestExportMessage,
  WebviewToHostMessage,
} from "./protocol.js";
import { DiagramCommentsBridge } from "../comments/diagram-comments-bridge.js";
import {
  createPanelState,
  assertNotDisposed,
  cleanupOnDispose,
  resolveWorkspaceRoot,
} from "./panel-state.js";
import type { PanelState } from "./panel-state.js";
import { loadAndPost, handleWebviewMessage } from "./panel-core.js";
import { setupWebview } from "./panel-commands.js";

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
  private readonly _state: PanelState;

  private _log: (msg: string) => void = () => {};
  private _createTime = 0;

  private constructor(mmdPath: string, panel: vscode.WebviewPanel, state: PanelState) {
    this.mmdPath = mmdPath;
    this._panel = panel;
    this._state = state;
  }

  // ── Factory ─────────────────────────────────────────────────────────────────

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
        retainContextWhenHidden: true,
      },
    );

    const state = createPanelState("", panel, context);

    // Register message listener BEFORE setting html so no canvas:ready is missed.
    state._disposables.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        handleWebviewMessage(
          Object.assign(state, { _panel: panel, _log: log, _createTime: 0 }),
          msg as WebviewToHostMessage,
        );
      }),
    );

    state._disposables.push(
      panel.onDidDispose(() => { cleanupOnDispose(state); }),
    );

    const nonce = randomBytes(16).toString("hex");
    const bundleUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.bundle.js"))
      .toString();
    const virgilFontUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "Virgil.woff2"))
      .toString();
    const excalidrawAssetsUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview"))
      .toString();
    const mermaidLibraryUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "webview",
          "excalidraw",
          "accordo-mermaid-shapes.excalidrawlib",
        ),
      )
      .toString();
    panel.webview.html = getWebviewHtml({
      nonce,
      cspSource: panel.webview.cspSource,
      bundleUri,
      virgilFontUri,
      excalidrawAssetsUri,
      mermaidLibraryUri,
    });

    const instance = new DiagramPanel("", panel, state);
    instance._log = log;
    context.subscriptions.push(instance);
    return instance;
  }

  static async create(
    context: vscode.ExtensionContext,
    mmdPath: string,
    log: (msg: string) => void = () => {},
  ): Promise<DiagramPanel> {
    const createStart = Date.now();
    log("DiagramPanel.create() — path: " + mmdPath);
    const title = basename(mmdPath, extname(mmdPath));
    const panel = vscode.window.createWebviewPanel(
      "accordo.diagram",
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
        retainContextWhenHidden: true,
      },
    );

    const state = createPanelState(mmdPath, panel, context);
    state._workspaceRoot = resolveWorkspaceRoot(mmdPath);
    log(`[TIMING] create: _initCommentsBridge starting (${Date.now() - createStart}ms since create start)`);
    const mmdUri = vscode.Uri.file(mmdPath).toString();
    try {
      const adapter = await vscode.commands.executeCommand<SurfaceCommentAdapter | undefined>(
        CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
        mmdUri,
      );
      state._commentsBridge = new DiagramCommentsBridge(adapter ?? null, panel.webview, mmdUri);
    } catch {
      state._commentsBridge = new DiagramCommentsBridge(null, panel.webview, mmdUri);
    }
    log(`[TIMING] create: _initCommentsBridge done (${Date.now() - createStart}ms since create start)`);

    setupWebview(panel, context, mmdPath, state);

    const instance = new DiagramPanel(mmdPath, panel, state);
    instance._log = log;
    instance._createTime = createStart;
    context.subscriptions.push(instance);
    return instance;
  }

  static async createFromExistingPanel(
    context: vscode.ExtensionContext,
    mmdPath: string,
    existingPanel: vscode.WebviewPanel,
    log: (msg: string) => void = () => {},
  ): Promise<DiagramPanel> {
    log("DiagramPanel.createFromExistingPanel() — path: " + mmdPath);

    existingPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    };

    const state = createPanelState(mmdPath, existingPanel, context);
    state._workspaceRoot = resolveWorkspaceRoot(mmdPath);
    const mmdUri = vscode.Uri.file(mmdPath).toString();
    try {
      const adapter = await vscode.commands.executeCommand<SurfaceCommentAdapter | undefined>(
        CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
        mmdUri,
      );
      state._commentsBridge = new DiagramCommentsBridge(adapter ?? null, existingPanel.webview, mmdUri);
    } catch {
      state._commentsBridge = new DiagramCommentsBridge(null, existingPanel.webview, mmdUri);
    }

    setupWebview(existingPanel, context, mmdPath, state);

    const instance = new DiagramPanel(mmdPath, existingPanel, state);
    instance._log = log;
    context.subscriptions.push(instance);
    return instance;
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  async refresh(): Promise<void> {
    assertNotDisposed(this._state);
    await loadAndPost(Object.assign(this._state, { _panel: this._panel, _log: this._log }));
  }

  notify(message: string): void {
    assertNotDisposed(this._state);
    const msg: HostToastMessage = { type: "host:toast", message };
    this._panel.webview.postMessage(msg);
  }

  async requestExport(format: "svg" | "png"): Promise<Buffer> {
    assertNotDisposed(this._state);
    if (this._state._pendingExport !== null) {
      throw new ExportBusyError();
    }

    return new Promise<Buffer>((resolve, reject) => {
      this._state._pendingExport = { resolve, reject, format };
      const msg: HostRequestExportMessage = { type: "host:request-export", format };
      this._panel.webview.postMessage(msg);
    });
  }

  onDisposed(cb: () => void): void {
    this._state._onDisposedCallbacks.push(cb);
  }

  reveal(column?: vscode.ViewColumn): void {
    this._panel.reveal(column);
  }

  focusThread(threadId: string): void {
    this.reveal();
    this._panel.webview.postMessage({ type: "host:focus-thread", threadId });
  }

  dispose(): void {
    if (this._state._disposed) return;
    this._panel.dispose();
    cleanupOnDispose(this._state);
  }
}
