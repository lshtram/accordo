/**
 * accordo-marp — Presentation Provider
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

import * as vscode from "vscode";
import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { PresentationCommentsBridge } from "./presentation-comments-bridge.js";
import type { MarpRenderResult, PresentationRenderer } from "./types.js";
import { buildMarpWebviewHtml } from "./marp-webview-html.js";

export function buildWebviewHtml(
  renderResult: MarpRenderResult,
  nonce: string,
  cspSource: string,
  sdkJsUri?: string,
  sdkCssUri?: string,
): string {
  // Delegates to the dedicated HTML builder — no SDK URIs (comment SDK is
  // injected by the provider when commentsBridge is present).
  return buildMarpWebviewHtml({ renderResult, nonce, cspSource, sdkJsUri, sdkCssUri });
}

export class PresentationProvider {
  private panel: vscode.WebviewPanel | null = null;
  private deckUri: string | null = null;
  private currentSlide = 0;
  private revision = 0;
  private adapter: PresentationRuntimeAdapter | null = null;
  private renderer: PresentationRenderer | null = null;
  private commentsBridge: PresentationCommentsBridge | null = null;
  private slideSubscription: { dispose(): void } | null = null;
  private disposeCallbacks: Array<() => void> = [];
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private _pendingCapture: { resolve: (buf: Buffer) => void; reject: (err: Error) => void } | null = null;
  private extensionUri: vscode.Uri;

  // Constructor accepts context for API compatibility but does not retain it.
  // Renderer is injected via open() or setRenderer().
  // extensionUri is stored so SDK asset URIs can be computed post-panel-creation.
  constructor(_options: { context: vscode.ExtensionContext }) {
    this.extensionUri = _options.context.extensionUri;
  }

  async open(
    deckUri: string,
    adapter: PresentationRuntimeAdapter,
    renderer: PresentationRenderer,
    commentsBridge: PresentationCommentsBridge | null,
  ): Promise<void> {
    // Re-use existing panel for same URI (before closing anything)
    if (this.panel && this.deckUri === deckUri) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.close();

    this.deckUri = deckUri;
    this.adapter = adapter;
    this.renderer = renderer;
    this.commentsBridge = commentsBridge;

    let deckContent: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(deckUri));
      deckContent = Buffer.from(bytes).toString("utf8");
    } catch {
      throw new Error(`Could not open deck file: ${deckUri}`);
    }

    const renderResult = this.renderer.render(deckContent);

    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

    this.panel = vscode.window.createWebviewPanel(
      "accordo.marp.presentation",
      "Marp Presentation",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    const cspSource = this.panel.webview.cspSource;

    // Compute SDK asset URIs if comments bridge is present.
    // Must be done after panel creation so webview is available.
    let sdkJsUri: string | undefined;
    let sdkCssUri: string | undefined;
    if (this.commentsBridge) {
      sdkJsUri = this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "sdk.browser.js"))
        .toString();
      sdkCssUri = this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "sdk.css"))
        .toString();

      // Rebind the bridge sender to the real webview.postMessage.
      // This must happen after panel creation so we have a real sender.
      const realSender = this.commentsBridge.bindToSender({
        postMessage: (msg: unknown) => this.panel!.webview.postMessage(msg),
      });
      void realSender; // bindToSender returns the same bridge instance (for chaining)
    }

    this.panel.webview.html = buildWebviewHtml(renderResult, nonce, cspSource, sdkJsUri, sdkCssUri);

    // Single onDidReceiveMessage registration — consolidates:
    //  a) webview:ready → reload threads (commentsBridge restart/reload scenario)
    //  b) all other messages → handleWebviewMessage (slide changes, comments, capture)
    this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (this.commentsBridge && (msg as { type?: string }).type === "webview:ready") {
        this.commentsBridge.loadThreadsForUri(deckUri);
      }
      this.handleWebviewMessage(msg);
    });

    // Immediate load on open — needed for real integration (before webview:ready fires)
    // and for tests that don't fire webview:ready at all.
    if (this.commentsBridge) {
      this.commentsBridge.loadThreadsForUri(deckUri);
    }

    this.slideSubscription = adapter.onSlideChanged((index) => {
      this.currentSlide = index;
      this.panel?.webview.postMessage({ type: "slide-index", index });
    });

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(deckUri);
    this.fileWatcher.onDidChange(() => {
      void this.reloadDeck();
    });

    this.panel.onDidDispose(() => {
      this.close();
    });
  }

  private async reloadDeck(): Promise<void> {
    if (!this.deckUri || !this.panel || !this.renderer) return;
    // renderer is always set after open() completes, and close() does not clear it
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.deckUri));
      const result = this.renderer.render(Buffer.from(bytes).toString("utf8"));

      const clamped = Math.min(this.currentSlide, result.slideCount - 1);
      if (clamped !== this.currentSlide) this.currentSlide = clamped;

      this.revision++;
      this.panel.webview.postMessage({
        type: "marp:update",
        html: result.html,
        css: result.css,
        currentSlide: clamped,
        revision: this.revision,
      });
    } catch {
      // silent fail — don't crash the session
    }
  }

  private handleWebviewMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const msg = message as Record<string, unknown>;

    if (String(msg["type"]).startsWith("comment:")) {
      if (this.commentsBridge && typeof this.commentsBridge.handleWebviewMessage === "function") {
        this.commentsBridge.handleWebviewMessage(message, this.deckUri ?? "");
      }
      return;
    }

    if (msg["type"] === "presentation:capture-ready") {
      const pending = this._pendingCapture;
      this._pendingCapture = null;
      if (!pending) return;
      if (msg["error"] !== undefined || msg["data"] === null) {
        pending.reject(new Error(String(msg["error"] ?? "Capture failed")));
      } else {
        pending.resolve(Buffer.from(msg["data"] as string, "base64"));
      }
      return;
    }

    if (msg["type"] === "presentation:slideChanged") {
      if (!this.adapter) return;
      const index = msg["index"] as number;
      // Call handleWebviewSlideChanged — the single truthful typed path.
      // handleWebviewSlideChanged is declared on PresentationRuntimeAdapter and
      // implemented by MarpAdapter (delegates to handleViewSlideChanged internally).
      this.adapter.handleWebviewSlideChanged(index);
    }
  }

  getPanel(): vscode.WebviewPanel | null {
    return this.panel;
  }

  /**
   * Capture the currently visible slide as an SVG buffer.
   * Sends `host:request-capture` to the webview and resolves when the webview
   * replies with `presentation:capture-ready`.
   */
  requestCapture(): Promise<Buffer> {
    if (!this.panel) {
      return Promise.reject(new Error("No presentation panel is open"));
    }
    if (this._pendingCapture) {
      return Promise.reject(new Error("A capture is already in progress"));
    }
    return new Promise<Buffer>((resolve, reject) => {
      this._pendingCapture = { resolve, reject };
      this.panel!.webview.postMessage({ type: "host:request-capture" });
    });
  }

  getCurrentDeckUri(): string | null {
    return this.deckUri;
  }

  setCurrentSlide(index: number): void {
    this.currentSlide = index;
  }

  setRenderer(renderer: PresentationRenderer): void {
    this.renderer = renderer;
  }

  onDispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  close(): void {
    if (!this.panel && !this.deckUri) return;

    const panel = this.panel;
    // Clear state first to prevent re-entrancy via onDidDispose
    this.panel = null;
    this.deckUri = null;
    this.adapter = null;
    this.commentsBridge = null;
    this.slideSubscription?.dispose();
    this.slideSubscription = null;
    this.fileWatcher?.dispose();
    this.fileWatcher = null;
    this.currentSlide = 0;
    this.revision = 0;

    // Reject any pending capture
    const pendingCapture = this._pendingCapture;
    this._pendingCapture = null;
    if (pendingCapture) {
      pendingCapture.reject(new Error("Presentation panel closed"));
    }

    panel?.dispose();

    const callbacks = [...this.disposeCallbacks];
    this.disposeCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }

  dispose(): void {
    this.close();
  }
}
