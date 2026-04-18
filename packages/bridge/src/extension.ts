/**
 * Accordo Bridge — VSCode Extension Entry Point
 *
 * Thin bootstrap shell that delegates to focused modules:
 *   1. extension-bootstrap.ts  — VSCode activation ceremony
 *   2. extension-service-factory.ts — Service instantiation
 *   3. extension-composition.ts — BridgeAPI wiring, WsClient lifecycle
 *
 * This file owns:
 *   - The public BridgeAPI interface definition
 *   - ExtensionToolDefinition re-export
 *   - activate() → bootstrap → factory → compose → return BridgeAPI
 *   - deactivate() → cleanup
 *
 * Activation order:
 *   1. bootstrap — output channel, config, status bar, copilot threshold
 *   2. factory — create registry, router, state-publisher, hub-manager
 *   3. compose — wire BridgeAPI, register commands, start hub lifecycle
 *
 * Requirements: requirements-bridge.md §2, §3, §4
 */

import * as vscode from "vscode";
import type { IDEState } from "@accordo/bridge-types";
import type { ExtensionToolDefinition } from "./extension-registry.js";
import { bootstrapExtension } from "./extension-bootstrap.js";
import type { BootstrapResult } from "./extension-bootstrap.js";
import { createServices } from "./extension-service-factory.js";
import type { Services } from "./extension-service-factory.js";
import type { WsClient } from "./ws-client.js";
import {
  composeExtension,
  buildHubManagerEvents,
  cleanupExtension,
} from "./extension-composition.js";
import type { ExtensionState, ComposedBridgeAPI, CompositionDeps } from "./extension-composition.js";
import { createVsCodeApi, createConfirmationFn } from "./extension-vscode-adapter.js";

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
   *
   * @param toolName - Fully qualified tool name, e.g. "accordo_comment_create"
   * @param args - Tool arguments
   * @param timeout - Timeout in ms (default: 30_000)
   */
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
}

// ── Module state (centralized, cleaned up on deactivate) ─────────────────────

let extensionState: ExtensionState | null = null;
let services: Services | null = null;
let bootstrap: BootstrapResult | null = null;

// ── activate ─────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 * Returns the BridgeAPI object consumed by accordo-editor and other
 * modality extensions.
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<BridgeAPI> {
  // 1. Bootstrap — VSCode ceremony, status bar, config
  bootstrap = await bootstrapExtension(context);

  // 2. Create module state
  extensionState = {
    wsClient: null,
    currentHubToken: "",
    currentHubPort: 0,
  };

  // 3. Build composition deps (needed before factory so hubManagerEvents can
  //    reference state/services via closure)
  // We need a forward reference: state is ready but services aren't yet.
  // We create a temporary CompositionDeps-like shell with a placeholder for services,
  // then build the real deps once services are created.

  // Build a mutable deps container so the events closures always see the live services
  const depsContainer: {
    bootstrap: BootstrapResult;
    services: ReturnType<typeof createServices> | null;
    state: ExtensionState;
  } = {
    bootstrap,
    services: null,
    state: extensionState,
  };

  // Build hubManagerEvents using a lazy deps proxy
  const lazyDeps: CompositionDeps = {
    get bootstrap() { return depsContainer.bootstrap; },
    get services() {
      if (depsContainer.services === null) throw new Error("services not yet created");
      return depsContainer.services;
    },
    get state() { return depsContainer.state; },
    showQuickPick: (items, options) =>
      vscode.window.showQuickPick(
        items as vscode.QuickPickItem[],
        options,
      ) as Promise<unknown>,
  };

  const hubManagerEvents = buildHubManagerEvents(lazyDeps);

  // 4. Build HostEnvironment for StatePublisher
  const vscodeApi = createVsCodeApi();

  // 5. Build confirmation dialog
  const confirmationFn = createConfirmationFn();

  // 6. Create services
  services = createServices({
    hubManagerConfig: bootstrap.hubManagerConfig,
    hubManagerEvents,
    secretStorage: bootstrap.secretStorage,
    outputChannel: bootstrap.outputChannel,
    vscodeApi,
    confirmationFn,
  });
  depsContainer.services = services;

  // 6b. Wire a dynamic status bar updater now that services are available.
  //     The fn is called from inside the bootstrap closure which owns
  //     statusBarItem; we receive a setText callback to update the text.
  bootstrap.setStatusBarUpdater((): void => {
    const wsClient = extensionState?.wsClient ?? null;
    const isConnected = wsClient?.isConnected() ?? false;
    const tools = depsContainer.services?.registry.getAllTools() ?? [];
    const wsAny = wsClient as (WsClient & { getState?: () => string }) | null;
    const connState = wsAny?.getState?.() ?? (isConnected ? "connected" : "disconnected");

    let text: string;
    if (isConnected && tools.length > 0) {
      text = "$(check) Accordo";
    } else if (
      connState === "connecting" ||
      connState === "reconnecting" ||
      (isConnected && tools.length === 0)
    ) {
      text = "$(warning) Accordo";
    } else {
      text = "$(error) Accordo";
    }
    if (bootstrap) {
      bootstrap.statusBarItem.text = text;
    }
  });

  // 7. Compose and return BridgeAPI
  const api = composeExtension(
    lazyDeps,
    (command, callback) => vscode.commands.registerCommand(command, callback),
  );

  return api as BridgeAPI;
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension is deactivated.
 * LCM-11: Close WS but do NOT kill the Hub process.
 */
export async function deactivate(): Promise<void> {
  if (extensionState !== null && services !== null) {
    await cleanupExtension(extensionState, services);
  }
  extensionState = null;
  services = null;
  bootstrap = null;
}
