/**
 * A17 — Extension entry point: activate / deactivate.
 *
 * Acquires accordo-bridge BridgeAPI, builds a DiagramToolContext backed by
 * a path-keyed panel registry, and registers all six diagram tools.
 * Also registers the `accordo-diagram.open` VS Code command so the user can
 * open any `.mmd` file in the Excalidraw canvas.
 *
 * Panel registry design (supports multiple simultaneous panels):
 *   - Keyed by absolute mmdPath.
 *   - Written on DiagramPanel.create(); cleared on panel.onDidDispose.
 *   - DiagramToolContext.getPanel(path) returns the panel for that path, or
 *     undefined if none is open.
 *
 * If accordo-bridge is absent, activation logs one warning to the output
 * channel and returns — the extension is inert but does not crash.
 *
 * Source: diag_workplan.md §4.17, diag_arch_v4.2.md §14
 *
 * Requirements:
 *   EX-01  activate() registers all 6 diagram tools with BridgeAPI
 *   EX-02  activate() registers the accordo-diagram.open command
 *   EX-03  activate() is a no-op (+ output channel warning) when Bridge is absent
 *   EX-04  accordo-diagram.open with a .mmd path opens a DiagramPanel and registers it
 *   EX-05  accordo-diagram.open from an active .mmd text editor uses that file's path
 *   EX-06  accordo-diagram.open with no .mmd context shows a file-picker
 *   EX-07  getPanel(path) returns the registered panel for that path
 *   EX-08  getPanel(path) returns undefined when no panel is open for that path
 *   EX-09  disposing a panel removes it from the registry (getPanel returns undefined)
 *   EX-10  deactivate() is a no-op (subscriptions auto-disposed by VS Code)
 *   EX-11  activate() calls publishState with empty openPanels on startup
 *   EX-12  publishState is called with the open panel path when a panel is opened
 *   EX-13  publishState is called with empty openPanels when the last panel is closed
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import { DiagramPanel } from "./webview/panel.js";
import { createDiagramTools } from "./tools/diagram-tools.js";
import { parseMermaid } from "./parser/adapter.js";
import type { DiagramPanelLike } from "./tools/diagram-tools.js";

interface BridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── Panel registry ─────────────────────────────────────────────────────────────
// Keyed by absolute mmdPath; supports multiple simultaneous panels.
const _registry = new Map<string, DiagramPanel>();
let _bridge: BridgeAPI | null = null;
let _workspaceRoot = "";

export function getPanel(mmdPath: string): DiagramPanelLike | undefined {
  return _registry.get(mmdPath);
}

/** Push current open-panel list to the hub via bridge.publishState. */
function publishDiagramState(): void {
  if (!_bridge) return;
  const openPanels = [..._registry.keys()].map((abs) => {
    if (_workspaceRoot && abs.startsWith(_workspaceRoot + "/")) {
      return abs.slice(_workspaceRoot.length + 1);
    }
    return abs;
  });
  _bridge.publishState("accordo-diagram", {
    isOpen: openPanels.length > 0,
    openPanels,
  });
}

// ── activate ───────────────────────────────────────────────────────────────────
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Accordo Diagram");
  context.subscriptions.push(outputChannel);
  const log = (msg: string) => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);

  log("activate() called — extensionUri: " + context.extensionUri.fsPath);

  // Register the open command unconditionally — opening a panel does not
  // require the bridge. Tool registration (below) does.
  log("Registering accordo-diagram.open command");
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo-diagram.open", async (mmdPath?: vscode.Uri | string) => {
      log("accordo-diagram.open invoked, arg: " + String(mmdPath ?? "(none)"));
      const resolvedPath = await resolveMmdPath(mmdPath);
      if (!resolvedPath) {
        log("accordo-diagram.open: no path resolved, aborting");
        return;
      }
      log("accordo-diagram.open: resolved path = " + resolvedPath);

      // Reuse existing panel if already open — just bring it into focus.
      const existing = _registry.get(resolvedPath);
      if (existing) {
        log("accordo-diagram.open: panel already open, revealing");
        existing.reveal();
        return;
      }

      log("accordo-diagram.open: creating new DiagramPanel");
      try {
        const panel = await DiagramPanel.create(context, resolvedPath, log);
        _registry.set(resolvedPath, panel);
        publishDiagramState();
        panel.onDisposed(() => {
          log("panel disposed, removing from registry: " + resolvedPath);
          _registry.delete(resolvedPath);
          publishDiagramState();
        });
        log("accordo-diagram.open: panel created successfully");
      } catch (err) {
        log("accordo-diagram.open: ERROR creating panel: " + String(err));
        void vscode.window.showErrorMessage("Accordo Diagram: " + String(err));
      }
    }),
  );

  // Open a blank Excalidraw canvas — no .mmd file required.
  log("Registering accordo-diagram.newCanvas command");
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo-diagram.newCanvas", async () => {
      log("accordo-diagram.newCanvas invoked");
      try {
        await DiagramPanel.createEmpty(context, log);
        log("accordo-diagram.newCanvas: panel created successfully");
      } catch (err) {
        log("accordo-diagram.newCanvas: ERROR: " + String(err));
        void vscode.window.showErrorMessage("Accordo Diagram: " + String(err));
      }
    }),
  );

  // Called by the Comments panel when the user clicks a diagram thread.
  // Reveals the panel and asks the webview to open the SDK popover.
  log("Registering accordo_diagram_focusThread command");
  context.subscriptions.push(
    vscode.commands.registerCommand(CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD, async (threadId: unknown, mmdUri: unknown) => {
      const tid = String(threadId ?? "");
      const uriStr = String(mmdUri ?? "");
      log(`accordo_diagram_focusThread: threadId=${tid}, mmdUri=${uriStr}, open panels=${_registry.size}`);

      // Fast path: at least one panel is already open — broadcast immediately.
      if (_registry.size > 0) {
        for (const panel of _registry.values()) {
          panel.focusThread(tid);
        }
        return;
      }

      // Slow path: no panel open — open the diagram first, then focus.
      if (!uriStr) {
        throw new Error("No diagram panel is open and no URI was provided");
      }
      let mmdPath: string;
      try {
        mmdPath = vscode.Uri.parse(uriStr).fsPath;
      } catch {
        throw new Error(`Cannot parse diagram URI: ${uriStr}`);
      }
      log(`accordo_diagram_focusThread: opening panel for ${mmdPath}`);
      await vscode.commands.executeCommand("accordo-diagram.open", mmdPath);
      // Wait for canvas:ready → _loadAndPost → loadThreadsForUri → comments:load
      // to complete before asking the webview to open the popover.
      await new Promise<void>(resolve => setTimeout(resolve, 2000));
      for (const panel of _registry.values()) {
        panel.focusThread(tid);
      }
    }),
  );

  // Register a CustomEditorProvider so .mmd files open as diagrams by default.
  // VS Code will show "Open with..." in the context menu to allow text editing.
  log("Registering accordo-diagram.diagramEditor custom editor provider");
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "accordo-diagram.diagramEditor",
      {
        async resolveCustomTextEditor(
          document: vscode.TextDocument,
          webviewPanel: vscode.WebviewPanel,
        ): Promise<void> {
          const mmdPath = document.uri.fsPath;
          log("Custom editor opened for: " + mmdPath);

          const existing = _registry.get(mmdPath);
          if (existing) {
            // Already open — the custom editor framework provided a fresh panel;
            // we can't reuse the old one, so dispose it and open a fresh instance.
            existing.dispose();
            _registry.delete(mmdPath);
          }

          try {
            const panel = await DiagramPanel.createFromExistingPanel(context, mmdPath, webviewPanel, log);
            _registry.set(mmdPath, panel);
            publishDiagramState();
            panel.onDisposed(() => {
              _registry.delete(mmdPath);
              publishDiagramState();
            });
          } catch (err) {
            log("Custom editor ERROR: " + String(err));
            void vscode.window.showErrorMessage("Accordo Diagram: " + String(err));
          }
        },
      },
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;
  if (!bridge) {
    log("accordo-bridge not found — diagram MCP tools will NOT be registered");
    outputChannel.appendLine(
      "accordo-bridge not installed or not active — accordo-diagram tools will not be registered.",
    );
    return;
  }
  log("accordo-bridge found, registering diagram tools");

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const ctx = {
    workspaceRoot,
    // Return the most recently opened panel (last in insertion order)
    getPanel: (): DiagramPanelLike | undefined => {
      const vals = [..._registry.values()];
      return vals[vals.length - 1];
    },
  };

  _bridge = bridge;
  _workspaceRoot = workspaceRoot;

  const tools = createDiagramTools(ctx);
  context.subscriptions.push(bridge.registerTools("accordo.accordo-diagram", tools));
  log("diagram tools registered with accordo-bridge");

  // Publish initial state (no panels open yet on activation)
  publishDiagramState();

  // Warm up mermaid.js in the background so the first diagram open doesn't pay
  // the cold-import cost (~2-3s). The dynamic import inside parseMermaid() is
  // cached after this call, making subsequent real parses nearly instantaneous.
  void parseMermaid("flowchart TD\nA-->B").catch(() => { /* warmup — ignore errors */ });
  log("mermaid warm-up dispatched");
}

// ── deactivate ─────────────────────────────────────────────────────────────────
export function deactivate(): void {
  _bridge = null;
  _workspaceRoot = "";
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function resolveMmdPath(arg?: vscode.Uri | string): Promise<string | undefined> {
  // 1. Explicit path argument — Uri-like object when invoked from the Explorer
  //    context menu, string when called from a script or another extension command.
  //    Use duck-typing (check for .fsPath) rather than instanceof so the function
  //    works correctly in test environments where vscode.Uri is a plain mock object.
  if (arg !== null && typeof arg === "object" && "fsPath" in arg) {
    const p = (arg as vscode.Uri).fsPath;
    if (typeof p === "string" && p.endsWith(".mmd")) return p;
  }
  if (typeof arg === "string" && arg.endsWith(".mmd")) {
    return arg;
  }

  // 2. Active text editor is a .mmd file
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.fsPath.endsWith(".mmd")) {
    return active.document.uri.fsPath;
  }

  // 3. No context — show a file picker
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Mermaid: ["mmd"] },
    openLabel: "Open Diagram",
  });
  return picks?.[0]?.fsPath;
}
