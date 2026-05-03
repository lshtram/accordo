/**
 * WebviewPanelHtmlRenderer — renders the initial HTML for the Comments Panel webview.
 *
 * Composes HTML fragments from comments-webview-html-fragments.ts.
 * Each public method stays under ~50 lines of actual logic.
 */

import type * as vscode from "vscode";
import {
  buildCsp,
  SHELL_CSS,
  buildFilterBarHtml,
  buildEmptyPanelHtml,
  buildPanelScript,
} from "./comments-webview-html-fragments.js";

export class WebviewPanelHtmlRenderer {
  renderInitialHtml(webview: vscode.Webview): string {
    const nonce = this._generateNonce();
    const csp = buildCsp(nonce);
    const css = SHELL_CSS;
    const filterBar = buildFilterBarHtml();
    const emptyPanel = buildEmptyPanelHtml();
    const script = buildPanelScript();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comments</title>
  <style>${css}</style>
</head>
<body>
  ${filterBar}
  ${emptyPanel}
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
  }

  private _generateNonce(): string {
    return Array.from({ length: 16 }, () =>
      Math.random().toString(36).at(-1) ?? "",
    ).join("");
  }
}