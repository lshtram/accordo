/**
 * marp-webview-html.ts — Marp Webview HTML Builder
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

import type { MarpRenderResult } from "./types.js";
import {
  buildSdkHeadAssets,
  buildSdkInitScript,
  buildSdkMessageHandlers,
  buildAltClickHandler,
  buildRuntimeScript,
} from "./marp-webview-script-segments.js";

export interface MarpWebviewHtmlOptions {
  renderResult: MarpRenderResult;
  nonce: string;
  cspSource: string;
  mermaidJsUri?: string;
  /** When provided, Comment SDK is initialized in the webview */
  sdkJsUri?: string;
  /** When provided, Comment SDK CSS is loaded in the webview */
  sdkCssUri?: string;
}

export interface StandaloneMarpHtmlOptions {
  renderResult: MarpRenderResult;
  title?: string;
  mermaidJsUri?: string;
}

function buildSharedPresentationStyles(marpCss: string): string {
  return `<style id="marp-core-css">${marpCss}</style>
  <style>
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
  </style>`;
}

function addNonceToStyleTags(html: string, nonce: string): string {
  return html.replace(/<style/g, `<style nonce="${nonce}"`);
}

/**
 * Builds the Marp webview HTML document.
 */
export function buildMarpWebviewHtml(opts: MarpWebviewHtmlOptions): string {
  const { renderResult, nonce, cspSource, mermaidJsUri, sdkJsUri, sdkCssUri } = opts;
  const { html: marpHtml, css: marpCss, slideCount } = renderResult;
  const hasSdk = Boolean(sdkJsUri || sdkCssUri);

  const sdkHeadAssets = buildSdkHeadAssets(hasSdk, sdkJsUri, sdkCssUri, nonce);
  const sdkInitScript = buildSdkInitScript(hasSdk);
  const sdkMessageHandlers = buildSdkMessageHandlers(hasSdk);
  const altClickHandler = buildAltClickHandler(hasSdk);

  // ── Full HTML document ───────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: https: blob:; font-src ${cspSource} data:; connect-src ${cspSource};">${sdkHeadAssets}
  ${addNonceToStyleTags(buildSharedPresentationStyles(marpCss), nonce)}
</head>
<body>
  <div id="slide-container">${marpHtml}</div>
  <div id="nav">
    <button id="btn-prev">&#9664; Prev</button>
    <span id="slide-counter">1 / ${slideCount}</span>
    <button id="btn-next">Next &#9654;</button>
  </div>
  ${mermaidJsUri ? `<script nonce="${nonce}" src="${mermaidJsUri}"></script>` : ""}
  <script nonce="${nonce}">
    ${buildRuntimeScript(altClickHandler, sdkInitScript, sdkMessageHandlers)}
  </script>
</body>
</html>`;
}

export function buildStandaloneMarpHtml(opts: StandaloneMarpHtmlOptions): string {
  const { renderResult, title = "Marp Browser Debug", mermaidJsUri } = opts;
  const { html: marpHtml, css: marpCss, slideCount } = renderResult;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${buildSharedPresentationStyles(marpCss)}
</head>
<body>
  <div id="slide-container">${marpHtml}</div>
  <div id="nav">
    <button id="btn-prev">&#9664; Prev</button>
    <span id="slide-counter">1 / ${slideCount}</span>
    <button id="btn-next">Next &#9654;</button>
  </div>
  ${mermaidJsUri ? `<script src="${mermaidJsUri}"></script>` : ""}
  <script>
    ${buildRuntimeScript("", "", "")}
  </script>
</body>
</html>`;
}
