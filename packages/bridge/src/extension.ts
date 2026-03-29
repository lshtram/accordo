/**
 * Accordo Bridge — VSCode Extension Entry Point (thin shell)
 *
 * Orchestrates activation by delegating to three focused modules:
 *   - extension-bootstrap.ts   — output channel, config, status bar setup
 *   - extension-service-factory.ts — service instantiation
 *   - extension-composition.ts — hub/ws event wiring, cleanup, status handler
 *
 * This file owns: BridgeAPI interface, activate(), deactivate(),
 * VS Code command registration, BridgeAPI object construction.
 *
 * Requirements: requirements-bridge.md §2, §3, §4
 */

import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { bootstrapExtension, buildStatusBarUpdater } from "./extension-bootstrap.js";
import {
  buildHubManagerEvents,
  buildShowStatusHandler,
  cleanupExtension,
} from "./extension-composition.js";
import type { ExtensionState } from "./extension-composition.js";
import { createServices } from "./extension-service-factory.js";
import { ExtensionRegistry } from "./extension-registry.js";
import type { ExtensionToolDefinition } from "./extension-registry.js";
import { StatePublisher } from "./state-publisher.js";
import type { IDEState } from "@accordo/bridge-types";

// ── Public API ───────────────────────────────────────────────────────────────

export type { ExtensionToolDefinition };

/**
 * The interface that consumer extensions (e.g. accordo-editor) receive
 * when they call `vscode.extensions.getExtension("accordo.accordo-bridge")
 *   .exports` — or via standard extension API acquisition.
 *
 * Source: requirements-bridge.md §3
 */
export interface BridgeAPI {
  /**
   * Register tools for extensionId.
   * Returns a vscode.Disposable — calling dispose() unregisters them.
   */
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): vscode.Disposable;

  /**
   * Push arbitrary modality state for extensionId.
   * Immediately sent to Hub as a stateUpdate patch.
   */
  publishState(
    extensionId: string,
    state: Record<string, unknown>,
  ): void;

  /** Return the current cached IDEState (local read — no network). */
  getState(): IDEState;

  /** True if Bridge has an active WS connection to Hub. */
  isConnected(): boolean;

  /** Fires with the new connection state whenever it changes. */
  onConnectionStatusChanged: vscode.Event<boolean>;

  /**
   * Invoke a registered tool directly, returning its result.
   * Used by accordo-browser to route Chrome relay events through unified tools.
   */
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
}

// ── Module-level state (created on activate, cleared on deactivate) ───────────

let _state: ExtensionState | null = null;
let _services: ReturnType<typeof createServices> | null = null;
let _connectionStatusEmitter: vscode.EventEmitter<boolean> | null = null;

// ── activate ─────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 * Returns the BridgeAPI object consumed by accordo-editor and other
 * modality extensions.
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<BridgeAPI> {
  // ── Step 1: Bootstrap ────────────────────────────────────────────────────
  const bootstrap = await bootstrapExtension(context);
  const { outputChannel, config, hubManagerConfig, secretStorage } = bootstrap;
  bootstrap.pushDisposable(outputChannel);

  // ── Step 2: Connection status emitter ────────────────────────────────────
  _connectionStatusEmitter = bootstrap.connectionStatusEmitter;
  const emitter = _connectionStatusEmitter;

  // ── Step 3: Shared mutable state ─────────────────────────────────────────
  _state = { wsClient: null, currentHubToken: "", currentHubPort: 0 };
  const state = _state;

  // ── Step 4: Full Hub config (add pid/port file paths) ─────────────────────
  const fullHubConfig = {
    ...hubManagerConfig,
    pidFilePath: path.join(os.homedir(), ".accordo", "hub.pid"),
    portFilePath: path.join(os.homedir(), ".accordo", "hub.port"),
  };

  // ── Step 5: Hub manager events ────────────────────────────────────────────
  // buildHubManagerEvents captures deps.services via lazy getter — _services
  // is null here and will be populated in Step 7 before any event fires.
  const compositionDeps = {
    bootstrap,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    get services() { return _services!; },
    state,
    showQuickPick: (
      items: Array<{ label: string }>,
      opts: { canPickMany: boolean; title: string },
    ) => Promise.resolve(vscode.window.showQuickPick(items, opts)),
  };
  const hubManagerEvents = buildHubManagerEvents(compositionDeps);

  // ── Step 6: Confirmation dialog ────────────────────────────────────────────
  const confirmationFn = async (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
    const detail = JSON.stringify(args, null, 2);
    const choice = await vscode.window.showWarningMessage(
      `Accordo: allow tool "${toolName}"?`,
      { modal: true, detail },
      "Allow",
    );
    return choice === "Allow";
  };

  // ── Step 7: Create services ────────────────────────────────────────────────
  _services = createServices({
    hubManagerConfig: fullHubConfig,
    hubManagerEvents,
    secretStorage,
    outputChannel,
    vscodeApi: vscode as unknown as Parameters<typeof createServices>[0]["vscodeApi"],
    confirmationFn,
  });
  const services = _services;

  // ── Step 8: Status bar updater ─────────────────────────────────────────────
  const updateStatusBar = buildStatusBarUpdater(
    bootstrap.statusBarItem,
    () => state.wsClient as { isConnected(): boolean; getState(): string } | null,
    () => _services as unknown as import("./extension-bootstrap.js").StatusBarServices | null,
  );
  bootstrap.setStatusBarUpdater(updateStatusBar);
  bootstrap.pushDisposable(emitter.event(() => { updateStatusBar(); }));

  // ── Step 9: Register VS Code commands ────────────────────────────────────
  bootstrap.pushDisposable(
    vscode.commands.registerCommand("accordo.hub.restart", () => {
      services.hubManager.restart().catch((err: Error) => {
        void vscode.window.showErrorMessage(`Accordo: restart failed — ${err.message}`);
      });
    }),
  );
  bootstrap.pushDisposable(
    vscode.commands.registerCommand("accordo.hub.showLog", () => { outputChannel.show(true); }),
  );
  bootstrap.pushDisposable(
    vscode.commands.registerCommand(
      "accordo.bridge.showStatus",
      buildShowStatusHandler(compositionDeps),
    ),
  );

  // ── Step 10: Activate Hub ─────────────────────────────────────────────────
  await services.hubManager.activate();
  updateStatusBar();

  // ── Step 11: Return BridgeAPI ─────────────────────────────────────────────
  return {
    registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable {
      const inner = services.registry.registerTools(extensionId, tools);
      updateStatusBar();
      const cmdDisposables = tools.map((tool) =>
        vscode.commands.registerCommand(
          tool.name,
          (args?: unknown) => tool.handler((args as Record<string, unknown>) ?? {}),
        ),
      );
      return {
        dispose() {
          inner.dispose();
          services.statePublisher.removeModalityState(extensionId);
          for (const d of cmdDisposables) d.dispose();
          updateStatusBar();
        },
      };
    },

    publishState(extensionId: string, stateData: Record<string, unknown>): void {
      services.statePublisher.publishState(extensionId, stateData);
      updateStatusBar();
    },

    getState(): IDEState {
      return services.statePublisher.getState() ?? StatePublisher.emptyState();
    },

    isConnected(): boolean {
      return state.wsClient?.isConnected() ?? false;
    },

    onConnectionStatusChanged: emitter.event,

    invokeTool(toolName: string, args: Record<string, unknown>, timeout = 30_000): Promise<unknown> {
      return services.router.invokeTool(toolName, args, timeout);
    },
  };
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension is deactivated.
 * LCM-11: Close WS but do NOT kill the Hub process.
 */
export async function deactivate(): Promise<void> {
  if (_state !== null && _services !== null) {
    await cleanupExtension(_state, _services);
  }
  // LCM-11: do NOT kill Hub — it serves CLI agents independently.
  await _services?.hubManager.deactivate();

  _services = null;
  _state = null;
  _connectionStatusEmitter?.dispose();
  _connectionStatusEmitter = null;
}
