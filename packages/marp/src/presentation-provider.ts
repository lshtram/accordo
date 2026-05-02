/**
 * accordo-marp — Presentation Provider
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

import * as vscode from "vscode";
import { dirname, resolve } from "node:path";
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
  mermaidJsUri?: string,
): string {
  // Delegates to the dedicated HTML builder — no SDK URIs (comment SDK is
  // injected by the provider when commentsBridge is present).
  return buildMarpWebviewHtml({ renderResult, nonce, cspSource, mermaidJsUri, sdkJsUri, sdkCssUri });
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
  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private extensionUri: vscode.Uri;

  // Constructor accepts context for API compatibility but does not retain it.
  // Renderer is injected via open() or setRenderer().
  // extensionUri is stored so SDK asset URIs can be computed post-panel-creation.
  constructor(_options: { context: vscode.ExtensionContext }) {
    this.extensionUri = _options.context.extensionUri;
  }

  private async readDeckContent(deckUri: string): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(deckUri));
      return Buffer.from(bytes).toString("utf8");
    } catch {
      throw new Error(`Could not open deck file: ${deckUri}`);
    }
  }

  private rewriteDeckAssetUris(
    html: string,
    deckUri: string,
    webview: vscode.Webview,
  ): string {
    const deckDir = dirname(deckUri);

    const toWebviewAssetUri = (rawSrc: string): string => {
      if (
        rawSrc.startsWith("http://") ||
        rawSrc.startsWith("https://") ||
        rawSrc.startsWith("data:") ||
        rawSrc.startsWith("blob:") ||
        rawSrc.startsWith("vscode-webview:")
      ) {
        return rawSrc;
      }

      const [pathPart, suffix = ""] = String(rawSrc).split(/([?#].*)/, 2);
      const absolutePath = pathPart.startsWith("/")
        ? pathPart
        : resolve(deckDir, pathPart);
      const rewritten = webview
        .asWebviewUri(vscode.Uri.file(absolutePath))
        .toString();
      return `${rewritten}${suffix}`;
    };

    return html.replace(/(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi, (_m, prefix, quote, src) => {
      return `${prefix}${quote}${toWebviewAssetUri(src)}${quote}`;
    }).replace(
      /(background-image\s*:\s*url\((?:&quot;|"|'))([^"')]+)((?:&quot;|"|')\))/gi,
      (_m, prefix, src, suffix) => `${prefix}${toWebviewAssetUri(src)}${suffix}`,
    );
  }

  private toWebviewRenderResult(
    renderResult: MarpRenderResult,
    deckUri: string,
    webview: vscode.Webview,
  ): MarpRenderResult {
    return {
      ...renderResult,
      html: this.rewriteDeckAssetUris(renderResult.html, deckUri, webview),
    };
  }

  private createPanel(deckUri: string): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(
      "accordo.marp.presentation",
      "Marp Presentation",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(dirname(deckUri)), this.extensionUri],
      },
    );
  }

  private getWebviewAssetUris(panel: vscode.WebviewPanel): {
    mermaidJsUri: string;
    sdkJsUri?: string;
    sdkCssUri?: string;
  } {
    const asWebviewUri = typeof panel.webview.asWebviewUri === "function"
      ? (uri: vscode.Uri) => panel.webview.asWebviewUri(uri).toString()
      : (uri: vscode.Uri) => uri.toString();

    return {
      mermaidJsUri: asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "mermaid.min.js")),
      sdkJsUri: this.commentsBridge
        ? asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "sdk.browser.js"))
        : undefined,
      sdkCssUri: this.commentsBridge
        ? asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "sdk.css"))
        : undefined,
    };
  }

  private bindCommentsSender(panel: vscode.WebviewPanel): void {
    if (!this.commentsBridge) {
      return;
    }

    this.commentsBridge.bindToSender({
      postMessage: (msg: unknown) => panel.webview.postMessage(msg),
    });
  }

  private wirePanelMessageHandling(panel: vscode.WebviewPanel, deckUri: string): void {
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (this.commentsBridge && (msg as { type?: string }).type === "webview:ready") {
        // Load threads only after the webview signals it is ready (JS initialized).
        // Sending comments:load before webview:ready means the message is dropped
        // because the webview's window.addEventListener('message', ...) handler
        // has not yet been registered. The webview:ready signal is the correct
        // and only reliable trigger for the initial thread push.
        this.commentsBridge.loadThreadsForUri(deckUri);
      }
      this.handleWebviewMessage(msg);
    });
  }

  private setupAdapterSubscription(panel: vscode.WebviewPanel, adapter: PresentationRuntimeAdapter): void {
    this.slideSubscription = adapter.onSlideChanged((index) => {
      this.currentSlide = index;
      panel.webview.postMessage({ type: "slide-index", index });
    });
  }

  private setupDeckWatcher(deckUri: string): void {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(deckUri);
    this.fileWatcher.onDidChange(() => {
      if (this.reloadDebounceTimer !== null) {
        clearTimeout(this.reloadDebounceTimer);
      }
      this.reloadDebounceTimer = setTimeout(() => {
        this.reloadDebounceTimer = null;
        void this.reloadDeck();
      }, 300);
    });
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

    const deckContent = await this.readDeckContent(deckUri);

    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

    const panel = this.createPanel(deckUri);
    this.panel = panel;

    const renderResult = this.toWebviewRenderResult(
      this.renderer.render(deckContent),
      deckUri,
      panel.webview,
    );

    this.bindCommentsSender(panel);
    const cspSource = panel.webview.cspSource;
    const { mermaidJsUri, sdkJsUri, sdkCssUri } = this.getWebviewAssetUris(panel);
    panel.webview.html = buildWebviewHtml(renderResult, nonce, cspSource, sdkJsUri, sdkCssUri, mermaidJsUri);

    this.wirePanelMessageHandling(panel, deckUri);
    this.setupAdapterSubscription(panel, adapter);
    this.setupDeckWatcher(deckUri);

    panel.onDidDispose(() => {
      this.close();
    });
  }

  private async reloadDeck(): Promise<void> {
    if (!this.deckUri || !this.panel || !this.renderer) return;
    // renderer is always set after open() completes, and close() does not clear it
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.deckUri));
      const result = this.toWebviewRenderResult(
        this.renderer.render(Buffer.from(bytes).toString("utf8")),
        this.deckUri,
        this.panel.webview,
      );

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
    const bridge = this.commentsBridge;
    this.commentsBridge = null;
    bridge?.dispose();
    this.slideSubscription?.dispose();
    this.slideSubscription = null;
    this.fileWatcher?.dispose();
    this.fileWatcher = null;
    if (this.reloadDebounceTimer !== null) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
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
