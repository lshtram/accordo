/**
 * accordo-marp — Presentation Provider
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

import * as vscode from "vscode";
import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { PresentationCommentsBridge } from "./presentation-comments-bridge.js";
import type { MarpRenderResult } from "./types.js";
import { MarpRenderer } from "./marp-renderer.js";

export function buildWebviewHtml(
  renderResult: MarpRenderResult,
  nonce: string,
  cspSource: string,
): string {
  const total = renderResult.slideCount;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data: https: blob:;">
  <style nonce="${nonce}">${renderResult.css}</style>
  <style nonce="${nonce}">
    html, body { margin: 0; padding: 0; background: #1e1e1e; overflow-x: hidden; }
    div.marpit { width: 100%; }
    svg[data-marpit-svg] { display: none; width: 100%; height: auto; }
    svg[data-marpit-svg].active { display: block; }
    #slide-container { padding: 20px 20px 80px; }
    #nav {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px;
      background: rgba(0,0,0,0.75); color: #fff;
      padding: 8px 18px; border-radius: 24px; z-index: 9999;
      font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
      user-select: none;
    }
    #nav button {
      background: transparent; border: 1px solid rgba(255,255,255,0.4);
      color: #fff; padding: 3px 14px; border-radius: 12px;
      cursor: pointer; font-size: 13px;
    }
    #nav button:disabled { opacity: 0.3; cursor: default; }
    #nav button:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  </style>
</head>
<body>
  <div id="slide-container">${renderResult.html}</div>
  <div id="nav">
    <button id="btn-prev">&#9664; Prev</button>
    <span id="slide-counter">1 / ${total}</span>
    <button id="btn-next">Next &#9654;</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
    let current = 0;

    // Show only the first slide via CSS class
    slides.forEach((s, i) => { if (i === 0) s.classList.add('active'); });
    document.getElementById('btn-prev').disabled = true;
    document.getElementById('btn-next').disabled = slides.length <= 1;

    function goTo(index) {
      if (index < 0 || index >= slides.length) return;
      slides[current].classList.remove('active');
      current = index;
      slides[current].classList.add('active');
      document.getElementById('slide-counter').textContent = (current + 1) + ' / ' + slides.length;
      document.getElementById('btn-prev').disabled = current === 0;
      document.getElementById('btn-next').disabled = current === slides.length - 1;
      window.scrollTo(0, 0);
      vscode.postMessage({ type: 'presentation:slideChanged', index: current });
    }

    document.getElementById('btn-prev').addEventListener('click', () => goTo(current - 1));
    document.getElementById('btn-next').addEventListener('click', () => goTo(current + 1));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'slide-index') goTo(msg.index);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') goTo(current + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goTo(current - 1);
    });
  </script>
</body>
</html>`;
}

export class PresentationProvider {
  private panel: vscode.WebviewPanel | null = null;
  private deckUri: string | null = null;
  private currentSlide = 0;
  private revision = 0;
  private adapter: PresentationRuntimeAdapter | null = null;
  private renderer: MarpRenderer;
  private commentsBridge: PresentationCommentsBridge | null = null;
  private slideSubscription: { dispose(): void } | null = null;
  private disposeCallbacks: Array<() => void> = [];
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor(options: { context: vscode.ExtensionContext }) {
    this.renderer = new MarpRenderer();
  }

  async open(
    deckUri: string,
    adapter: PresentationRuntimeAdapter,
    renderer: MarpRenderer,
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
    const cspSource = this.panel?.webview.cspSource ?? "https://localhost";

    this.panel = vscode.window.createWebviewPanel(
      "accordo.marp.presentation",
      "Marp Presentation",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = buildWebviewHtml(renderResult, nonce, cspSource);

    this.panel.webview.onDidReceiveMessage((message) => {
      this.handleWebviewMessage(message);
    });

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
    if (!this.deckUri || !this.panel) return;
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
      this.commentsBridge?.handleWebviewMessage(message, this.deckUri ?? "");
      return;
    }

    if (msg["type"] === "presentation:slideChanged") {
      const index = msg["index"] as number;
      // MarpAdapter exposes handleWebviewSlideChanged — not in shared interface
      (this.adapter as unknown as { handleWebviewSlideChanged(index: number): void })
        ?.handleWebviewSlideChanged(index);
    }
  }

  getPanel(): vscode.WebviewPanel | null {
    return this.panel;
  }

  getCurrentDeckUri(): string | null {
    return this.deckUri;
  }

  setCurrentSlide(index: number): void {
    this.currentSlide = index;
  }

  setRenderer(renderer: MarpRenderer): void {
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

    panel?.dispose();

    const callbacks = [...this.disposeCallbacks];
    this.disposeCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }

  dispose(): void {
    this.close();
  }
}
