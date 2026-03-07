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
 *   - Command: accordo_preview_open (opens current .md file in preview)
 *   - Command: accordo_preview_toggle (toggles current file between preview/text)
 *   - Command: accordo_preview_openSideBySide (opens preview beside text editor)
 *   - Setting: accordo_preview_defaultSurface — when "viewer", opens preview by default
 *
 * VS Code configuration contributions (package.json):
 *   accordo_preview_defaultSurface: "viewer" | "text"  (default: "viewer")
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
import type { CommentStoreLike, ResolverLike } from "./preview-bridge.js";
import { PreviewBridge } from "./preview-bridge.js";
import { MarkdownRenderer } from "./renderer.js";
import type { BlockIdResolver } from "./block-id-plugin.js";
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

  /**
   * Registry of live webview panels, keyed by document URI string.
   * Used by the accordo_preview_internal_focusThread command to send
   * comments:focus messages to the correct webview.
   */
  static readonly livePanels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: CommentStoreLike | null,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const docFsPath = document.uri.fsPath;
    const docUri = document.uri.toString();

    // M41b-CPE-08: restrict webview to extension + workspace + document-folder resource roots
    // Include the document's parent folder so previews work for files outside the workspace
    const docFolderUri = vscode.Uri.file(docFsPath.substring(0, docFsPath.lastIndexOf("/")));
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
        docFolderUri,
      ],
    };

    // Lazy-init renderer (shared across re-renders for the same panel)
    if (!this.renderer) {
      this.renderer = await MarkdownRenderer.create();
    }
    const renderer = this.renderer;

    // Block-id resolver — updated on every render so the bridge always
    // uses the latest blockId ↔ source-line mapping.
    let latestResolver: BlockIdResolver | null = null;

    // Render sequence counter — prevents stale async renders from
    // overwriting a newer result (M41b-CPE-06 race fix).
    let renderSeq = 0;

    // Helper: (re)render markdown → set webview.html
    const render = async (): Promise<void> => {
      const mySeq = ++renderSeq;
      const markdown = document.getText();
      const themeKind = mapThemeKind(vscode.window.activeColorTheme.kind);
      const nonce = generateNonce();
      const asUri = (rel: string) =>
        webviewPanel.webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", rel))
          .toString();

      const { html, resolver } = await renderer.render(markdown, {
        docFsPath,
        webview: webviewPanel.webview,
        uriFromFsPath: (p: string) => vscode.Uri.file(p),
      });

      // If a newer render started while we were async, discard this result
      if (mySeq !== renderSeq) return;

      latestResolver = resolver;

      webviewPanel.webview.html = buildWebviewHtml({
        nonce,
        body: html,
        themeKind,
        cspSource: webviewPanel.webview.cspSource,
        katexCssUri: asUri("katex.min.css"),
        mermaidJsUri: asUri("mermaid.min.js"),
        sdkJsUri: asUri("sdk.browser.js"),
        sdkCssUri: asUri("sdk.css"),
        markdownCssUri: asUri("markdown-body.css"),
      });
    };

    // M41b-CPE-05: initial render + optional comment bridge
    try {
      await render();
    } catch (err) {
      // Show a user-friendly error in the webview instead of crashing
      const errMsg = err instanceof Error ? err.message : String(err);
      webviewPanel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;font-family:sans-serif;color:#cc0000;"><h2>Accordo Preview Error</h2><pre>${errMsg}</pre></body></html>`;
      return;
    }

    // Resolver adapter that always delegates to the latest render result
    const resolverAdapter: ResolverLike = {
      blockIdToLine: (id) => latestResolver?.blockIdToLine(id) ?? null,
      lineToBlockId: (line) => latestResolver?.lineToBlockId(line) ?? null,
    };

    // Create bridge only when a real CommentStore is available (not inert)
    let bridge: PreviewBridge | undefined;
    if (this.store) {
      bridge = new PreviewBridge(this.store, webviewPanel.webview, docUri, resolverAdapter);
      bridge.loadThreadsForUri();
    }

    // M41b-CPE-06: re-render on text change for this document
    // The render() guard (renderSeq check) discards stale HTML, but we also
    // need to guard the post-render thread reload so an older render's .then()
    // doesn't push threads using a stale resolver.
    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === docUri) {
        const seqAtStart = renderSeq;
        void render().then(() => {
          // Only reload threads if this render was not superseded
          if (seqAtStart + 1 === renderSeq) bridge?.loadThreadsForUri();
        });
      }
    });

    // M41b-CPE-07: dispose all subscriptions when panel closes
    webviewPanel.onDidDispose(() => {
      CommentablePreview.livePanels.delete(docUri);
      docChangeSub.dispose();
      bridge?.dispose();
    });

    // Register this panel so focusThread can find it by URI
    CommentablePreview.livePanels.set(docUri, webviewPanel);
  }
}
