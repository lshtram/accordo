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
import { access, readFile, writeFile } from "node:fs/promises";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { createDrawingTools } from "./tools/drawing-tools.js";
import type { DrawingPanelLike, DrawingToolContext } from "./core/types.js";
import { DrawingEditorProvider } from "./host/drawing-editor-provider.js";
import { ensureDrawingPanel } from "./host/panel-registry.js";

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
  const publishDrawingState = (): void => publishPanelState(bridgeRef, panelsByPath);
  registerDrawingProvider(context, panelsByPath, publishDrawingState, output);
  registerOpenCommand(context);
  registerFocusThreadCommand(context);
  wireBridgeRegistration(context, output, drawingCtx, (bridge) => {
    bridgeRef = bridge;
    publishDrawingState();
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
    ensurePanelOpen: async (path: string) => {
      await vscode.commands.executeCommand("accordo-drawing.open", vscode.Uri.file(path));
    },
    hasVisiblePanelTab: (path: string) => {
      const expectedLabel = `Drawing • ${basename(path)}`;
      const groups = vscode.window.tabGroups?.all ?? [];
      return groups.some((group) =>
        group.tabs.some((tab) => tab.label === expectedLabel)
      );
    },
  };
}

function registerDrawingProvider(
  context: vscode.ExtensionContext,
  panelsByPath: Map<string, DrawingPanelLike>,
  publishDrawingState: () => void,
  output: vscode.OutputChannel,
): void {
  const provider = new DrawingEditorProvider(panelsByPath, publishDrawingState, output, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("accordo-drawing.drawingEditor", provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
}

function registerOpenCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("accordo-drawing.open", openDrawingDocument));
}

async function openDrawingDocument(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) return;
  const excalUri = await ensureExcalidrawSibling(target);
  await vscode.commands.executeCommand("vscode.openWith", excalUri, "accordo-drawing.drawingEditor");
}

async function ensureExcalidrawSibling(target: vscode.Uri): Promise<vscode.Uri> {
  if (!target.fsPath.endsWith(".mmd")) return target;
  const excalUri = vscode.Uri.file(target.fsPath.replace(/\.mmd$/i, ".excalidraw"));
  const exists = await access(excalUri.fsPath).then(() => true).catch(() => false);
  if (exists) return excalUri;
  const content = await readFile(target.fsPath, "utf8");
  await writeFile(excalUri.fsPath, JSON.stringify(createInitialExcalidrawPayload(target.fsPath, content), null, 2), "utf8");
  return excalUri;
}

function createInitialExcalidrawPayload(path: string, content: string): Record<string, unknown> {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://accordo.dev/drawing",
    elements: [],
    files: {},
    accordoSource: { kind: "mermaid", path, content },
  };
}

function registerFocusThreadCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("accordo_diagram_focusThread", focusDrawingThread));
}

async function focusDrawingThread(threadId: string, uri?: string): Promise<void> {
  if (typeof threadId !== "string" || threadId.length === 0) return;
  const panel = await ensureDrawingPanel(uri);
  if (!panel?.focusCommentThread) return;
  await panel.focusCommentThread(threadId);
}

function publishPanelState(bridgeRef: BridgeAPI | null, panelsByPath: Map<string, DrawingPanelLike>): void {
  if (!bridgeRef || typeof bridgeRef.publishState !== "function") return;
  const root = getWorkspaceRoot();
  const openPanels = [...panelsByPath.keys()]
    .filter((p) => p.endsWith(".mmd"))
    .map((abs) => (root && abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs));
  bridgeRef.publishState("accordo-drawing", {
    isOpen: openPanels.length > 0,
    openPanels,
  });
}

function wireBridgeRegistration(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  drawingCtx: DrawingToolContext,
  onReady: (bridge: BridgeAPI) => void,
): void {
  getBridgeApi()
    .then((bridge) => {
      if (!bridge) return;
      const tools = createDrawingTools(drawingCtx);
      context.subscriptions.push(bridge.registerTools("accordo.accordo-drawing", tools));
      onReady(bridge);
    })
    .catch(() => {
      output.appendLine("[drawing] Bridge unavailable; tools/state not registered");
    });
}

export const __testing = {
  createDrawingToolContext,
};

/**
 * Test seam for Phase B — exposes the DrawingEditorProvider class so tests
 * can instantiate the real custom-editor pipeline without going through
 * VS Code's extension activation.
 *
 * This is ONLY for test harness construction. No production logic lives here.
 *
 * Phase B: DrawingEditorProvider is constructed with the same dependencies
 * used in the real extension activation. Tests can then inject a mock
 * SurfaceCommentAdapter via the panelsByPath map or by subclassing.
 */
export const __testingSeams = {
  /**
   * Returns the DrawingEditorProvider class for test instantiation.
   * Tests can construct it directly with a mock SurfaceCommentAdapter.
   */
  getDrawingEditorProviderClass(): typeof DrawingEditorProvider {
    return DrawingEditorProvider;
  },
};
