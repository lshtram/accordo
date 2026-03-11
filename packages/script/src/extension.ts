/**
 * extension.ts
 *
 * accordo-script VS Code extension entry point.
 * Wires together ScriptSubtitleBar, ScriptRunner, and the three MCP tools,
 * then registers them with the Bridge via BridgeAPI.
 *
 * M52-EXT — Extension Wiring
 */

import * as vscode from "vscode";
import { ScriptSubtitleBar } from "./subtitle-bar.js";
import { ScriptRunner, type ScriptRunnerDeps } from "./script-runner.js";
import { makeRunScriptTool } from "./tools/run-script.js";
import { makeStopScriptTool } from "./tools/stop-script.js";
import { makeScriptStatusTool } from "./tools/script-status.js";
import { makeScriptDiscoverTool } from "./tools/script-discover.js";

/** Exported by the Bridge extension as its public API surface. */
export interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: Array<{ name: string }>,
  ): vscode.Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
  isConnected(): boolean;
  onConnectionStatusChanged: vscode.Event<boolean>;
}

/**
 * Returned by activate() to allow tests to inspect and drive the runner.
 */
export interface ScriptExtensionApi {
  runner: ScriptRunner;
}

export function activate(context: vscode.ExtensionContext): ScriptExtensionApi {
  // ── Subtitle bar ─────────────────────────────────────────────────────────
  const subtitleBar = new ScriptSubtitleBar();
  context.subscriptions.push(subtitleBar);

  // ── Optional bridge ───────────────────────────────────────────────────────
  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;

  // ── Voice wiring ──────────────────────────────────────────────────────────
  const voiceInstalled = !!vscode.extensions.getExtension("accordo.accordo-voice");

  // ── Highlight decoration tracking ────────────────────────────────────────
  let currentDecoration: vscode.TextEditorDecorationType | undefined;

  // ── Deps ─────────────────────────────────────────────────────────────────
  const deps: ScriptRunnerDeps = {
    executeCommand: (command: string, args?: unknown): Promise<unknown> =>
      Promise.resolve(vscode.commands.executeCommand(command, args)),

    speakText: voiceInstalled
      ? (text, opts) =>
          vscode.commands.executeCommand("accordo.voice.speakText", {
            text,
            voice: opts.voice,
            speed: opts.speed,
            block: opts.block,
          }) as Promise<void>
      : undefined,

    showSubtitle: (text: string, durationMs: number) => {
      subtitleBar.show(text, durationMs);
    },

    openAndHighlight: async (file: string, startLine: number, endLine: number) => {
      const doc = await vscode.workspace.openTextDocument(file);
      const editor = await vscode.window.showTextDocument(doc);
      if (currentDecoration) {
        currentDecoration.dispose();
        currentDecoration = undefined;
      }
      currentDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      });
      const range = new vscode.Range(
        new vscode.Position(startLine - 1, 0),
        new vscode.Position(endLine - 1, Number.MAX_SAFE_INTEGER),
      );
      editor.setDecorations(currentDecoration, [range]);
      editor.revealRange(range);
    },

    clearHighlights: () => {
      if (currentDecoration) {
        currentDecoration.dispose();
        currentDecoration = undefined;
      }
    },

    wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  };

  // ── Runner ────────────────────────────────────────────────────────────────
  const runner = new ScriptRunner(deps, {
    onStepComplete: () => {
      bridge?.publishState("accordo.accordo-script", { ...runner.status });
    },
    onComplete: () => {
      bridge?.publishState("accordo.accordo-script", { ...runner.status });
    },
    onStop: () => {
      bridge?.publishState("accordo.accordo-script", { ...runner.status });
    },
  });

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.script.stop", () => {
      void runner.stop();
    }),
  );

  // ── MCP tool registration ─────────────────────────────────────────────────
  if (bridge) {
    const tools = [
      makeRunScriptTool(runner),
      makeStopScriptTool(runner),
      makeScriptStatusTool(runner),
      makeScriptDiscoverTool(),
    ];
    const toolsDisposable = bridge.registerTools("accordo.accordo-script", tools);
    context.subscriptions.push(toolsDisposable);
  }

  return { runner };
}

export function deactivate(): void {
  // intentionally empty — disposables are managed via context.subscriptions
}
