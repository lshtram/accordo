import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { EXCALIDRAW_FONTS, EXCALIDRAW_PACKAGE_VERSION } from "../core/excalidraw-fonts.js";

export function countSceneElements(sceneText: string): number {
  try {
    const scene = JSON.parse(sceneText) as { elements?: unknown };
    return Array.isArray(scene.elements) ? scene.elements.length : 0;
  } catch {
    return 0;
  }
}

export function renderDrawingHtml(
  sceneText: string,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mmdContent?: string,
  mmdPath?: string,
): string {
  const scene = parseScene(sceneText);
  const scenePayload = serializeScenePayload(scene, mmdContent, mmdPath);
  const nonce = randomBytes(16).toString("hex");
  const assets = buildWebviewAssets(webview, extensionUri, nonce);
  const fontFacesCss = buildFontFacesCss(assets.fontUris);
  const fontGlobalsScript = buildFontGlobalsScript(assets.fontUris);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src data: blob: ${webview.cspSource}; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <style>
${fontFacesCss}
      html, body { width: 100%; height: 100%; }
      body, #excalidraw-root { margin: 0; overflow: hidden; width: 100%; height: 100%; }
      #drawing-boot { position: fixed; right: 12px; bottom: 12px; max-width: 520px; padding: 8px 10px; border-radius: 4px; box-sizing: border-box; font: 12px var(--vscode-font-family, sans-serif); color: var(--vscode-editor-foreground); background: var(--vscode-editorWidget-background, rgba(0,0,0,0.08)); z-index: 9999; white-space: pre-wrap; pointer-events: none; }
      #drawing-boot.error { color: var(--vscode-errorForeground, #f48771); }
    </style>
    <link rel="stylesheet" href="${assets.commentSdkCssUri}" />
  </head>
  <body>
    <div id="excalidraw-root"></div>
    <div id="drawing-boot">Loading Accordo Drawing...</div>
    <script id="drawing-scene" type="application/json">${scenePayload}</script>
    <script nonce="${nonce}">
      window.__accordoDrawingErrors = [];
      window.__accordoDrawingBoot = document.getElementById("drawing-boot");
      window.onerror = function(message, source, line, column, error) {
        var text = String(message) + "\n" + String(source || "") + ":" + String(line || "") + ":" + String(column || "") + "\n" + String(error && error.stack || "");
        window.__accordoDrawingErrors.push(text);
        if (window.__accordoDrawingBoot) {
          window.__accordoDrawingBoot.className = "error";
          window.__accordoDrawingBoot.textContent = "Accordo Drawing failed to load:\n" + text;
        }
      };
      window.addEventListener("unhandledrejection", function(event) {
        var reason = event.reason;
        var text = String(reason && reason.stack || reason || "Unhandled rejection");
        window.__accordoDrawingErrors.push(text);
        if (window.__accordoDrawingBoot) {
          window.__accordoDrawingBoot.className = "error";
          window.__accordoDrawingBoot.textContent = "Accordo Drawing failed to load:\n" + text;
        }
      });
      window.EXCALIDRAW_ASSET_PATH = "${assets.assetRoot}/";
      window.EXCALIDRAW_PACKAGE_VERSION = "${EXCALIDRAW_PACKAGE_VERSION}";
      ${fontGlobalsScript}
      window.__accordoDrawingScene = JSON.parse(document.getElementById("drawing-scene").textContent);
    </script>
    <script nonce="${nonce}" src="${assets.bundleUri}"></script>
  </body>
</html>`;
}

function parseScene(sceneText: string): { elements?: Array<Record<string, unknown>>; accordoSource?: unknown } {
  try {
    return JSON.parse(sceneText) as { elements?: Array<Record<string, unknown>>; accordoSource?: unknown };
  } catch {
    return {};
  }
}

function serializeScenePayload(
  scene: { elements?: Array<Record<string, unknown>>; accordoSource?: unknown },
  mmdContent?: string,
  mmdPath?: string,
): string {
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  return serializeScriptJson({
    elements,
    hostElementCount: elements.length,
    accordoSource: scene.accordoSource,
    accordoSourceContent: mmdContent,
    sourcePath: mmdPath,
  });
}

function buildWebviewAssets(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string): {
  bundleUri: string;
  assetRoot: string;
  commentSdkCssUri: string;
  fontUris: Array<{ family: string; windowKey: string; uri: string }>;
} {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  return {
    bundleUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "drawing-webview.js").with({ query: `v=${nonce}` })).toString(),
    assetRoot: webview.asWebviewUri(webviewRoot).toString(),
    commentSdkCssUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "comment-sdk.css")).toString(),
    fontUris: EXCALIDRAW_FONTS.map((font) => ({
      family: font.family,
      windowKey: font.windowKey,
      uri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "excalidraw-assets", font.fileName)).toString(),
    })),
  };
}

function buildFontFacesCss(fontUris: Array<{ family: string; uri: string }>): string {
  return fontUris.map(({ family, uri }) => `
      @font-face {
        font-family: "${family}";
        src: url("${uri}") format("woff2");
        font-weight: 400;
        font-style: normal;
       font-display: block;
      }`).join("\n");
}

function buildFontGlobalsScript(fontUris: Array<{ windowKey: string; uri: string }>): string {
  return fontUris.map(({ windowKey, uri }) => `window.${windowKey} = "${uri}";`).join("\n      ");
}

function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
