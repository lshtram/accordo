/**
 * accordo-drawing extension entry point.
 *
 * Wires 5 accordo_drawing_* MCP tools into the Bridge registration system.
 * Falls back silently if accordo-bridge is not installed.
 *
 * Source: AGENTS.md §3 rule 3 (MCP tool naming convention)
 * Requirements: DRW-R17, DRW-R18, DRW-R19, DRW-R20, DRW-R21
 */

import * as vscode from "vscode";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { createDrawingTools } from "./tools/drawing-tools.js";
import type { DrawingPanelLike, DrawingToolContext } from "./core/types.js";

interface BridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

async function getBridgeApi(): Promise<BridgeAPI | undefined> {
  const ext = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge");
  if (!ext) return undefined;
  if (ext.isActive === false && typeof ext.activate === "function") {
    await ext.activate();
  }
  return ext.exports;
}

// Workspace root is the root folder open in VS Code.
// All drawing operations are scoped to this root.
function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return "";
  return folders[0].uri.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Accordo Drawing");
  context.subscriptions.push(output);

  const panelsByPath = new Map<string, DrawingPanelLike>();
  const drawingCtx = createDrawingToolContext(getWorkspaceRoot(), panelsByPath);
  (globalThis as { __accordoDrawingPanels?: Map<string, DrawingPanelLike> }).__accordoDrawingPanels = panelsByPath;

  let bridgeRef: BridgeAPI | null = null;
  const publishDrawingState = (): void => {
    if (!bridgeRef) return;
    const root = getWorkspaceRoot();
    const openPanels = [...panelsByPath.keys()]
      .filter((p) => p.endsWith(".mmd"))
      .map((abs) => (root && abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs));
    bridgeRef.publishState("accordo-drawing", {
      isOpen: openPanels.length > 0,
      openPanels,
    });
  };

  const provider = new DrawingEditorProvider(panelsByPath, publishDrawingState, output, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("accordo-drawing.drawingEditor", provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("accordo-drawing.open", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      let excalUri = target;
      if (target.fsPath.endsWith(".mmd")) {
        excalUri = vscode.Uri.file(target.fsPath.replace(/\.mmd$/i, ".excalidraw"));
        const exists = await access(excalUri.fsPath).then(() => true).catch(() => false);
        if (!exists) {
          const content = await readFile(target.fsPath, "utf8");
          await writeFile(excalUri.fsPath, JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "https://accordo.dev/drawing",
            elements: [],
            files: {},
            accordoSource: {
              kind: "mermaid",
              path: target.fsPath,
              content,
            },
          }, null, 2), "utf8");
        }
      }
      await vscode.commands.executeCommand("vscode.openWith", excalUri, "accordo-drawing.drawingEditor");
    }),
  );

  getBridgeApi().then((bridge) => {
    if (!bridge) return;
    bridgeRef = bridge;
    const tools = createDrawingTools(drawingCtx);
    context.subscriptions.push(bridge.registerTools("accordo.accordo-drawing", tools));
    publishDrawingState();
  }).catch(() => {
    // Bridge not available — extension remains silently inert
    output.appendLine("[drawing] Bridge unavailable; tools/state not registered");
  });
}

export function deactivate(): void {
  // subscriptions auto-disposed
}

function createDrawingToolContext(
  workspaceRoot: string,
  panelsByPath: Map<string, DrawingPanelLike>
): DrawingToolContext {
  return {
    workspaceRoot,
    getPanel: (path: string) => panelsByPath.get(path),
  };
}

class DrawingEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly panelsByPath: Map<string, DrawingPanelLike>,
    private readonly publishState: () => void,
    private readonly output: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri,
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const mmdPath = document.uri.fsPath.endsWith(".excalidraw")
      ? document.uri.fsPath.replace(/\.excalidraw$/i, ".mmd")
      : document.uri.fsPath;

    let exportSeq = 0;
    const pendingExports = new Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

    const panelLike: DrawingPanelLike = {
      mmdPath,
      requestExport: async (format) => {
        if (webviewPanel.webview === undefined) {
          throw new Error("webview not available");
        }
        const requestId = `exp-${Date.now()}-${++exportSeq}`;
        return await new Promise<Buffer>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingExports.delete(requestId);
            reject(new Error("export timed out"));
          }, 15000);
          pendingExports.set(requestId, { resolve, reject, timer });
          void webviewPanel.webview.postMessage({ type: "export:request", requestId, format });
        });
      },
    };

    this.panelsByPath.set(mmdPath, panelLike);
    this.panelsByPath.set(document.uri.fsPath, panelLike);
    this.publishState();

    webviewPanel.onDidDispose(() => {
      for (const { reject, timer } of pendingExports.values()) {
        clearTimeout(timer);
        reject(new Error("panel disposed"));
      }
      pendingExports.clear();
      this.panelsByPath.delete(mmdPath);
      this.panelsByPath.delete(document.uri.fsPath);
      this.publishState();
    });

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    webviewPanel.title = `Drawing • ${basename(mmdPath)}`;

    const sceneText = await readFile(document.uri.fsPath, "utf8").catch(() => document.getText());
    this.output.appendLine(`[drawing:webview] load ${document.uri.fsPath} bytes=${sceneText.length} parsedElements=${countSceneElements(sceneText)}`);
    webviewPanel.webview.html = renderDrawingHtml(sceneText, webviewPanel.webview, this.extensionUri);
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (isExportResultMessage(message)) {
        const pending = pendingExports.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingExports.delete(message.requestId);
        if (message.ok !== true || typeof message.dataBase64 !== "string") {
          pending.reject(new Error(typeof message.error === "string" ? message.error : "export failed"));
          return;
        }
        try {
          pending.resolve(Buffer.from(message.dataBase64, "base64"));
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : String(error);
          pending.reject(new Error(`invalid export payload: ${detail}`));
        }
        return;
      }
      if (isSceneErrorMessage(message)) {
        this.output.appendLine(`[drawing:webview] ${message.message}`);
        return;
      }
      if (isSceneReadyMessage(message)) {
        this.output.appendLine(`[drawing:webview] ready ${document.uri.fsPath} host=${message.hostElementCount ?? "?"} elements=${message.elementCount ?? "?"} accepted=${message.acceptedCount ?? "?"}`);
        return;
      }
      if (isUpdateElementsMessage(message)) {
        void applyWebviewMessage(document, message)
          .then(() => {
            this.output.appendLine(`[drawing:webview] saved update ${document.uri.fsPath} elements=${message.elements.length}`);
          })
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[drawing:webview] save failed ${document.uri.fsPath}: ${detail}`);
          });
      }
    });
  }
}

function isExportResultMessage(message: unknown): message is {
  type: "export:result";
  requestId: string;
  ok: boolean;
  dataBase64?: string;
  error?: string;
} {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "export:result"
    && typeof (message as { requestId?: unknown }).requestId === "string"
    && typeof (message as { ok?: unknown }).ok === "boolean";
}

function isSceneReadyMessage(message: unknown): message is { type: "scene:ready"; hostElementCount?: number; elementCount?: number; acceptedCount?: number } {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "scene:ready";
}

function isSceneErrorMessage(message: unknown): message is { type: "scene:error"; message: string } {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "scene:error"
    && typeof (message as { message?: unknown }).message === "string";
}

function countSceneElements(sceneText: string): number {
  try {
    const scene = JSON.parse(sceneText) as { elements?: unknown };
    return Array.isArray(scene.elements) ? scene.elements.length : 0;
  } catch {
    return 0;
  }
}

async function applyWebviewMessage(document: vscode.TextDocument, message: unknown): Promise<void> {
  if (!isUpdateElementsMessage(message)) return;
  let scene: Record<string, unknown>;
  try {
    scene = JSON.parse(document.getText()) as Record<string, unknown>;
  } catch {
    return;
  }
  scene.elements = message.elements;
  if (message.generated === true) {
    delete scene.accordoSource;
  }
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, fullRange, `${JSON.stringify(scene, null, 2)}\n`);
  await vscode.workspace.applyEdit(edit);
  await document.save();
}

function isUpdateElementsMessage(message: unknown): message is { type: "scene:update-elements"; elements: Array<Record<string, unknown>>; generated?: boolean } {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "scene:update-elements"
    && Array.isArray((message as { elements?: unknown }).elements);
}

function renderDrawingHtml(sceneText: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
  let scene: { elements?: Array<Record<string, unknown>> } = {};
  try {
    scene = JSON.parse(sceneText) as { elements?: Array<Record<string, unknown>> };
  } catch {
    scene = {};
  }

  const initialElementCount = Array.isArray(scene.elements) ? scene.elements.length : 0;
  const source = (scene as { accordoSource?: unknown }).accordoSource;
  const scenePayload = serializeScriptJson({ elements: Array.isArray(scene.elements) ? scene.elements : [], hostElementCount: initialElementCount, accordoSource: source });
  const nonce = randomBytes(16).toString("hex");
  const webviewRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const bundleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "drawing-webview.js").with({ query: `v=${nonce}` })).toString();
  const assetRoot = webview.asWebviewUri(webviewRoot).toString();
  const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "Virgil.woff2")).toString();

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src data: blob: ${webview.cspSource}; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <style>
      html, body { width: 100%; height: 100%; }
      body, #excalidraw-root { margin: 0; overflow: hidden; width: 100%; height: 100%; }
      #drawing-boot { position: fixed; right: 12px; bottom: 12px; max-width: 520px; padding: 8px 10px; border-radius: 4px; box-sizing: border-box; font: 12px var(--vscode-font-family, sans-serif); color: var(--vscode-editor-foreground); background: var(--vscode-editorWidget-background, rgba(0,0,0,0.08)); z-index: 9999; white-space: pre-wrap; pointer-events: none; }
      #drawing-boot.error { color: var(--vscode-errorForeground, #f48771); }
    </style>
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
      window.EXCALIDRAW_ASSET_PATH = "${assetRoot}/";
      window.__virgilFontUri = "${fontUri}";
      window.__accordoDrawingScene = JSON.parse(document.getElementById("drawing-scene").textContent);
    </script>
    <script nonce="${nonce}" src="${bundleUri}"></script>
  </body>
</html>`;
}

function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const __testing = {
  createDrawingToolContext,
};
