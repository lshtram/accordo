/**
 * CommentablePreviewEditor — VS Code CustomTextEditorProvider for *.md files.
 *
 * Registered in extension.ts as:
 *   vscode.window.registerCustomEditorProvider(
 *     'accordo.markdownPreview',
 *     new CommentablePreviewEditor(context, store),
 *     { webviewOptions: { retainContextWhenHidden: true } }
 *   )
 *
 * User triggers via:
 *   - Right-click .md file → "Open With" → "Accordo Preview"
 *   - Command: accordo.preview.open (opens current .md file in preview)
 *   - Command: accordo.preview.toggle (toggles current file between preview/text)
 *   - Command: accordo.preview.openSideBySide (opens preview beside text editor)
 *   - Setting: accordo.preview.defaultSurface — when "viewer", opens preview by default
 *
 * VS Code configuration contributions (package.json):
 *   accordo.preview.defaultSurface: "viewer" | "text"  (default: "viewer")
 *
 * Source: M41b — CommentablePreviewEditor
 *
 * Requirements:
 *   M41b-CPE-01  PREVIEW_VIEW_TYPE = "accordo.markdownPreview"
 *   M41b-CPE-02  generateNonce() returns a random 32-char alphanumeric string
 *   M41b-CPE-03  mapThemeKind() maps vscode.ColorThemeKind to 1|2|3|4
 *   M41b-CPE-04  CommentablePreview class implements vscode.CustomTextEditorProvider
 *   M41b-CPE-05  resolveCustomTextEditor() creates WebviewPanel, renders HTML, creates PreviewBridge
 *   M41b-CPE-06  Webview HTML rebuilt on onDidChangeTextDocument for the current file
 *   M41b-CPE-07  Webview disposed when panel closed; all subscriptions cleaned up
 *   M41b-CPE-08  Webview options: enableScripts: true, localResourceRoots restricted
 */

import * as vscode from "vscode";
import type { CommentStoreLike } from "./preview-bridge.js";
import { PreviewBridge } from "./preview-bridge.js";
import { MarkdownRenderer } from "./renderer.js";
import { buildWebviewHtml } from "./webview-template.js";

// ── CommentablePreviewEditor ──────────────────────────────────────────────────

/** The VS Code viewType identifier registered for the custom editor. */
export const PREVIEW_VIEW_TYPE = "accordo.markdownPreview";

/** Default surface setting values */
export type DefaultSurface = "viewer" | "text";

// ── Pure helpers (exported for unit testing without VSCode) ───────────────────

/**
 * M41b-CPE-02
 * Generate a cryptographically random nonce for CSP.
 * Returns a 32-character alphanumeric string.
 */
export function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(32);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

/**
 * M41b-CPE-03
 * Map a VS Code ColorThemeKind numeric value to the themeKind used by the template.
 *   1 = ColorThemeKind.Light       → 1
 *   2 = ColorThemeKind.Dark        → 2
 *   3 = ColorThemeKind.HighContrast → 3
 *   4 = ColorThemeKind.HighContrastLight → 4
 *   unknown → 2 (dark as fallback)
 */
export function mapThemeKind(kind: number): 1 | 2 | 3 | 4 {
  if (kind === 1 || kind === 2 || kind === 3 || kind === 4) return kind;
  return 2;
}

// ── CommentablePreview ────────────────────────────────────────────────────────

/**
 * M41b-CPE-04 / 05 / 06 / 07 / 08
 * CustomTextEditorProvider that VS Code calls when a .md file is opened with
 * the "Accordo Markdown Preview" editor. Wires all sub-modules together.
 */
export class CommentablePreview implements vscode.CustomTextEditorProvider {
  private renderer: MarkdownRenderer | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: CommentStoreLike,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const docFsPath = document.uri.fsPath;
    const docUri = document.uri.toString();

    // M41b-CPE-08: restrict webview to extension + workspace resource roots
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
      ],
    };

    // Lazy-init renderer (shared across re-renders for the same panel)
    if (!this.renderer) {
      this.renderer = await MarkdownRenderer.create();
    }
    const renderer = this.renderer;

    // Helper: (re)render markdown → set webview.html
    const render = async (): Promise<void> => {
      const markdown = document.getText();
      const themeKind = mapThemeKind(vscode.window.activeColorTheme.kind);
      const nonce = generateNonce();
      const asUri = (rel: string) =>
        webviewPanel.webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", rel))
          .toString();

      const { html } = await renderer.render(markdown, {
        docFsPath,
        webview: webviewPanel.webview,
      });

      webviewPanel.webview.html = buildWebviewHtml({
        nonce,
        body: html,
        themeKind,
        cspSource: webviewPanel.webview.cspSource,
        katexCssUri: asUri("katex.min.css"),
        mermaidJsUri: asUri("mermaid.min.js"),
        sdkJsUri: asUri("sdk.browser.js"),
        sdkCssUri: asUri("sdk.css"),
      });
    };

    // M41b-CPE-05: initial render + bridge
    await render();
    const bridge = new PreviewBridge(this.store, webviewPanel.webview, docUri);
    bridge.loadThreadsForUri();

    // M41b-CPE-06: re-render on text change for this document
    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === docUri) {
        void render().then(() => bridge.loadThreadsForUri());
      }
    });

    // M41b-CPE-07: dispose all subscriptions when panel closes
    webviewPanel.onDidDispose(() => {
      docChangeSub.dispose();
      bridge.dispose();
    });
  }
}
