import * as vscode from "vscode";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import type { DrawingPanelLike } from "../core/types.js";
import { DrawingCommentsBridge } from "../comments/drawing-comments-bridge.js";
import { countSceneElements, renderDrawingHtml } from "./webview-html.js";

export class DrawingEditorProvider implements vscode.CustomTextEditorProvider {
  public static __testingAdapter: SurfaceCommentAdapter | null = null;

  public constructor(
    public readonly panelsByPath: Map<string, DrawingPanelLike>,
    private readonly publishState: () => void,
    private readonly output: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri,
  ) {
    (globalThis as { __accordoDrawingPanels?: Map<string, DrawingPanelLike> }).__accordoDrawingPanels = this.panelsByPath;
  }

  public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const mmdPath = toMmdPath(document.uri.fsPath);
    const bridge = await this.createCommentsBridge(webviewPanel, mmdPath);
    const pendingExports = new Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const panelLike = this.createPanelLike(mmdPath, webviewPanel, pendingExports, bridge);

    this.registerPanelEntries(document.uri.fsPath, mmdPath, panelLike);
    this.registerDisposeHandler(document.uri.fsPath, mmdPath, webviewPanel, pendingExports, bridge);
    await this.configureAndRenderWebview(document, mmdPath, webviewPanel);
    this.registerMessageHandler(document, webviewPanel, pendingExports, bridge);
  }

  private async createCommentsBridge(webviewPanel: vscode.WebviewPanel, mmdPath: string): Promise<DrawingCommentsBridge | null> {
    const adapter = await this.getSurfaceCommentAdapter();
    const bridge = adapter
      ? new DrawingCommentsBridge(adapter, { postMessage: (msg) => Promise.resolve(webviewPanel.webview.postMessage(msg)) }, `file://${mmdPath}`)
      : null;
    this.output.appendLine(`[drawing:comments] bridge ${bridge ? "enabled" : "disabled"} uri=file://${mmdPath}`);
    return bridge;
  }

  private createPanelLike(
    mmdPath: string,
    webviewPanel: vscode.WebviewPanel,
    pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
    bridge: DrawingCommentsBridge | null,
  ): DrawingPanelLike {
    let exportSeq = 0;
    return {
      mmdPath,
      requestExport: async (format) => this.requestPanelExport(webviewPanel, pendingExports, format, ++exportSeq),
      focusCommentThread: async (threadId: string) => {
        bridge?.focusThread(threadId);
      },
    };
  }

  private async requestPanelExport(
    webviewPanel: vscode.WebviewPanel,
    pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
    format: "png" | "svg",
    sequence: number,
  ): Promise<Buffer> {
    if (webviewPanel.webview === undefined) {
      throw new Error("webview not available");
    }
    const requestId = `exp-${Date.now()}-${sequence}`;
    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExports.delete(requestId);
        reject(new Error("export timed out"));
      }, 15000);
      pendingExports.set(requestId, { resolve, reject, timer });
      void webviewPanel.webview.postMessage({ type: "export:request", requestId, format });
    });
  }

  private registerPanelEntries(documentPath: string, mmdPath: string, panelLike: DrawingPanelLike): void {
    this.panelsByPath.set(mmdPath, panelLike);
    this.panelsByPath.set(documentPath, panelLike);
    this.publishState();
  }

  private registerDisposeHandler(
    documentPath: string,
    mmdPath: string,
    webviewPanel: vscode.WebviewPanel,
    pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
    bridge: DrawingCommentsBridge | null,
  ): void {
    webviewPanel.onDidDispose(() => {
      bridge?.dispose();
      rejectAllPendingExports(pendingExports, "panel disposed");
      this.panelsByPath.delete(mmdPath);
      this.panelsByPath.delete(documentPath);
      this.publishState();
    });
  }

  private async configureAndRenderWebview(
    document: vscode.TextDocument,
    mmdPath: string,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    webviewPanel.title = `Drawing • ${basename(mmdPath)}`;
    const sceneText = await readFile(document.uri.fsPath, "utf8").catch(() => document.getText());
    const mmdContent = await readFile(mmdPath, "utf8").catch(() => undefined);
    this.output.appendLine(`[drawing:webview] load ${document.uri.fsPath} bytes=${sceneText.length} parsedElements=${countSceneElements(sceneText)}`);
    webviewPanel.webview.html = renderDrawingHtml(sceneText, webviewPanel.webview, this.extensionUri, mmdContent, mmdPath);
  }

  private registerMessageHandler(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
    bridge: DrawingCommentsBridge | null,
  ): void {
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (this.handleBridgeMessage(message, bridge)) return;
      if (this.handleDebugMessage(message)) return;
      if (this.handleExportResult(message, pendingExports)) return;
      if (this.handleSceneMessages(message, document, bridge)) return;
    });
  }

  private handleBridgeMessage(message: unknown, bridge: DrawingCommentsBridge | null): boolean {
    if (!bridge || !isCommentMessage(message)) return false;
    this.output.appendLine(`[drawing:comments] webview -> host ${(message as { type?: string }).type ?? "unknown"}`);
    void bridge.handleWebviewMessage(message);
    return true;
  }

  private handleDebugMessage(message: unknown): boolean {
    if (!isDrawingDebugMessage(message)) return false;
    this.output.appendLine(`[drawing:comments] ${message.event} ${message.data ? JSON.stringify(message.data) : ""}`);
    return true;
  }

  private handleExportResult(
    message: unknown,
    pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
  ): boolean {
    if (!isExportResultMessage(message)) return false;
    const pending = pendingExports.get(message.requestId);
    if (!pending) return true;
    clearTimeout(pending.timer);
    pendingExports.delete(message.requestId);
    if (message.ok !== true || typeof message.dataBase64 !== "string") {
      pending.reject(new Error(typeof message.error === "string" ? message.error : "export failed"));
      return true;
    }
    try {
      pending.resolve(Buffer.from(message.dataBase64, "base64"));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      pending.reject(new Error(`invalid export payload: ${detail}`));
    }
    return true;
  }

  private handleSceneMessages(message: unknown, document: vscode.TextDocument, bridge: DrawingCommentsBridge | null): boolean {
    if (isSceneErrorMessage(message)) {
      this.output.appendLine(`[drawing:webview] ${message.message}`);
      return true;
    }
    if (isSceneReadyMessage(message)) {
      this.output.appendLine(`[drawing:webview] ready ${document.uri.fsPath} host=${message.hostElementCount ?? "?"} elements=${message.elementCount ?? "?"} accepted=${message.acceptedCount ?? "?"}`);
      this.output.appendLine("[drawing:comments] scene ready -> loadThreadsForUri");
      bridge?.loadThreadsForUri();
      return true;
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
      return true;
    }
    return false;
  }

  private async getSurfaceCommentAdapter(): Promise<SurfaceCommentAdapter | null> {
    const testAdapter = (DrawingEditorProvider as { __testingAdapter?: SurfaceCommentAdapter | null }).__testingAdapter;
    if (testAdapter) return testAdapter;
    try {
      const adapter = await vscode.commands.executeCommand<SurfaceCommentAdapter>(
        CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
      );
      return adapter ?? null;
    } catch (error: unknown) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      this.output.appendLine(`[drawing:comments] failed to acquire surface adapter via ${CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER}: ${detail}`);
      return null;
    }
  }
}

function toMmdPath(path: string): string {
  return path.endsWith(".excalidraw") ? path.replace(/\.excalidraw$/i, ".mmd") : path;
}

function rejectAllPendingExports(
  pendingExports: Map<string, { resolve: (buf: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>,
  reason: string,
): void {
  for (const { reject, timer } of pendingExports.values()) {
    clearTimeout(timer);
    reject(new Error(reason));
  }
  pendingExports.clear();
}

function isCommentMessage(message: unknown): boolean {
  return typeof message === "object"
    && message !== null
    && typeof (message as { type?: unknown }).type === "string"
    && String((message as { type?: unknown }).type).startsWith("comment:");
}

function isDrawingDebugMessage(message: unknown): message is { type: "drawing:debug"; event: string; data?: Record<string, unknown> } {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "drawing:debug"
    && typeof (message as { event?: unknown }).event === "string";
}

function isExportResultMessage(message: unknown): message is { type: "export:result"; requestId: string; ok: boolean; dataBase64?: string; error?: string } {
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

function isUpdateElementsMessage(message: unknown): message is { type: "scene:update-elements"; elements: Array<Record<string, unknown>>; generated?: boolean } {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "scene:update-elements"
    && Array.isArray((message as { elements?: unknown }).elements);
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
