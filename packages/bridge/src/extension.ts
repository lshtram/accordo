/**
 * Accordo Bridge — VSCode Extension Entry Point
 *
 * Wires all five Bridge modules together, exposes BridgeAPI to
 * consumer extensions, and registers VS Code commands.
 *
 * Activation order:
 *   1. Create registry, router, state-publisher (send fns are late-bound)
 *   2. Create hub-manager and call activate() → fires onHubReady when ready
 *   3. onHubReady creates and connects WsClient with real secret
 *
 * Requirements: requirements-bridge.md §2, §3, §4
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { HubManager } from "./hub-manager.js";
import type { HubManagerConfig } from "./hub-manager.js";
import { WsClient } from "./ws-client.js";
import { ExtensionRegistry } from "./extension-registry.js";
import type { ExtensionToolDefinition } from "./extension-registry.js";
import { CommandRouter } from "./command-router.js";
import { StatePublisher } from "./state-publisher.js";
import type { VscodeApi } from "./state-publisher.js";
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
}

// ── Module globals (created on activate, cleared on deactivate) ──────────────

let wsClient: WsClient | null = null;
let statePublisher: StatePublisher | null = null;
let registry: ExtensionRegistry | null = null;
let router: CommandRouter | null = null;
let hubManager: HubManager | null = null;
let connectionStatusEmitter: vscode.EventEmitter<boolean> | null = null;
let mcpChangeEmitter: vscode.EventEmitter<void> | null = null;
let mcpProviderRegistered = false;
let currentHubToken = "";
let currentHubPort = 0;

// ── activate ─────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 * Returns the BridgeAPI object consumed by accordo-editor and other
 * modality extensions.
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<BridgeAPI> {
  // Output channel — LCM-09
  const outputChannel = vscode.window.createOutputChannel("Accordo Hub");
  context.subscriptions.push(outputChannel);

  // Connection-status event emitter
  connectionStatusEmitter = new vscode.EventEmitter<boolean>();
  context.subscriptions.push(connectionStatusEmitter);

  // MCP change emitter — fires when Hub port/token become available or rotate
  // MCP-04: Re-register (update definition) when Hub restarts and token rotates
  mcpChangeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(mcpChangeEmitter);

  // ── Config ────────────────────────────────────────────────────────────────

  const cfg = vscode.workspace.getConfiguration("accordo");
  const port = cfg.get<number>("hub.port", 3000);
  const autoStart = cfg.get<boolean>("hub.autoStart", true);
  const executablePath = cfg.get<string>("hub.executablePath", "");

  // MCP-01, MCP-02, MCP-03: Native Copilot MCP server definition provider.
  // Registration is deferred to onHubReady so the token is guaranteed set
  // on the very first provideMcpServerDefinitions query (no empty-list race).
  const wantCopilot = cfg.get<boolean>("agent.configureCopilot", true);
  const hasLmApi = typeof vscode.lm?.registerMcpServerDefinitionProvider === "function";
  outputChannel.appendLine(
    `[accordo-bridge] MCP api check: configureCopilot=${wantCopilot}, vscode.lm=${!!vscode.lm}, registerMcpServerDefinitionProvider=${hasLmApi}`,
  );
  if (!wantCopilot || !hasLmApi) {
    outputChannel.appendLine(
      "[accordo-bridge] MCP provider WILL NOT be registered — check VS Code version and accordo.agent.configureCopilot setting",
    );
  }

  // Hub entry point: sibling package in the monorepo during development.
  // When packaged as a vsix the hub dist should be bundled alongside.
  const hubEntryPoint = path.join(
    context.extensionPath,
    "..",
    "hub",
    "dist",
    "index.js",
  );

  const config: HubManagerConfig = {
    port,
    autoStart,
    executablePath,
    hubEntryPoint,
  };

  // ── Registry (tool registrations from consumer extensions) ───────────────

  registry = new ExtensionRegistry();
  // Send fn is initially a no-op until WsClient is alive; the closure picks
  // up wsClient by reference so once it is created, sends work automatically.
  registry.setSendFunction((tools) => wsClient?.sendToolRegistry(tools));

  // ── Command Router (invoke / cancel from Hub) ─────────────────────────────

  router = new CommandRouter(registry);
  router.setSendResultFn((result) => wsClient?.sendResult(result));
  router.setSendCancelledFn((id, late) => wsClient?.sendCancelled(id, late));
  router.setConfirmationFn(async (toolName, args) => {
    const detail = JSON.stringify(args, null, 2);
    const choice = await vscode.window.showWarningMessage(
      `Accordo: allow tool "${toolName}"?`,
      { modal: true, detail },
      "Allow",
    );
    return choice === "Allow";
  });

  // ── State Publisher ───────────────────────────────────────────────────────

  // Send callbacks use late-bound wsClient via closure — safe because
  // StatePublisher only calls them after WsClient exists (start() is called
  // before WS connects but sends are gated on actual connection).
  statePublisher = new StatePublisher(
    vscode as unknown as VscodeApi,
    {
      sendSnapshot: (msg) => {
        wsClient?.sendStateSnapshot(msg.state);
      },
      sendUpdate: (msg) => {
        wsClient?.sendStateUpdate(msg.patch);
      },
    },
  );
  statePublisher.start();

  // ── Hub Manager ───────────────────────────────────────────────────────────

  // vscode.SecretStorage returns Thenable<T>; our SecretStorage interface
  // expects Promise<T>. Wrap with Promise.resolve() to bridge the gap.
  const secretStorage = {
    get: (key: string) => Promise.resolve(context.secrets.get(key)),
    store: (key: string, value: string) =>
      Promise.resolve(context.secrets.store(key, value)),
    delete: (key: string) => Promise.resolve(context.secrets.delete(key)),
  };

  const emitter = connectionStatusEmitter; // captured for callback closures

  hubManager = new HubManager(
    secretStorage,
    outputChannel,
    config,
    {
      onHubReady: async (readyPort) => {
        const secret = hubManager?.getSecret() ?? "";
        // Update current credentials for the MCP provider (MCP-02, MCP-04)
        currentHubPort = readyPort;
        currentHubToken = hubManager?.getToken() ?? "";

        // MCP-01: Register provider on first ready — token is already set so
        // provideMcpServerDefinitions never returns [] on the initial query.
        if (wantCopilot && hasLmApi) {
          if (!mcpProviderRegistered) {
            mcpProviderRegistered = true;
            const mcp = mcpChangeEmitter;
            const disposable = vscode.lm.registerMcpServerDefinitionProvider!("accordo", {
              onDidChangeMcpServerDefinitions: mcp!.event,
              provideMcpServerDefinitions: (_ct) => {
                outputChannel.appendLine(
                  `[accordo-bridge] provideMcpServerDefinitions called — token=${currentHubToken ? "present" : "missing"}, port=${currentHubPort}`,
                );
                if (!currentHubToken) return [];
                return [
                  new vscode.McpHttpServerDefinition(
                    "Accordo",
                    vscode.Uri.parse(`http://localhost:${currentHubPort}/mcp`),
                    { Authorization: `Bearer ${currentHubToken}` },
                  ),
                ];
              },
            });
            context.subscriptions.push(disposable);
            outputChannel.appendLine("[accordo-bridge] MCP provider registered ✓");
          } else {
            // MCP-04: Hub restarted / token rotated — signal Copilot to re-fetch
            mcpChangeEmitter?.fire();
          }
        }

        wsClient = new WsClient(readyPort, secret, {
          onConnected: () => {
            emitter.fire(true);
            outputChannel.appendLine("[accordo-bridge] Connected to Hub ✓");
          },
          onDisconnected: (code, reason) => {
            emitter.fire(false);
            outputChannel.appendLine(
              `[accordo-bridge] Disconnected (${code}${reason ? ": " + reason : ""})`,
            );
          },
          onAuthFailure: () => {
            outputChannel.appendLine(
              "[accordo-bridge] Auth failure — rotating credentials and respawning Hub",
            );
            hubManager?.restart().catch((err: Error) => {
              outputChannel.appendLine(
                `[accordo-bridge] Restart after auth failure failed: ${err.message}`,
              );
            });
          },
          onProtocolMismatch: (msg) => {
            void vscode.window.showErrorMessage(
              `Accordo Bridge and Hub versions are incompatible. Update both packages. ${msg}`,
            );
          },
          onInvoke: (message) => {
            router?.handleInvoke(message).catch((err: Error) => {
              outputChannel.appendLine(
                `[accordo-bridge] Invoke handler error: ${err.message}`,
              );
            });
          },
          onCancel: (message) => {
            router?.handleCancel(message);
          },
          onGetState: (_message) => {
            statePublisher?.sendSnapshot();
          },
        });

        await wsClient.connect(
          statePublisher?.getState() ?? StatePublisher.emptyState(),
          registry?.getAllTools() ?? [],
        );
      },

      onHubError: (err) => {
        outputChannel.appendLine(`[accordo-bridge] Hub error: ${err.message}`);
        void vscode.window
          .showErrorMessage(
            `Accordo Hub failed to start: ${err.message}`,
            "Retry",
            "Show Log",
          )
          .then((action) => {
            if (action === "Retry") {
              hubManager?.activate().catch((e: Error) => {
                outputChannel.appendLine(
                  `[accordo-bridge] Retry failed: ${e.message}`,
                );
              });
            } else if (action === "Show Log") {
              outputChannel.show(true);
            }
          });
      },

      onCredentialsRotated: async (newToken, newSecret) => {
        outputChannel.appendLine("[accordo-bridge] Credentials rotated — reconnecting");
        // MCP-04: update provider token so Copilot gets fresh credentials
        currentHubToken = newToken;
        mcpChangeEmitter?.fire();
        if (wsClient) {
          wsClient.updateSecret(newSecret);
          await wsClient.disconnect();
          await wsClient.connect(
            statePublisher?.getState() ?? StatePublisher.emptyState(),
            registry?.getAllTools() ?? [],
          );
        }
      },
    },
  );

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.hub.restart", () => {
      hubManager?.restart().catch((err: Error) => {
        void vscode.window.showErrorMessage(
          `Accordo: restart failed — ${err.message}`,
        );
      });
    }),

    vscode.commands.registerCommand("accordo.hub.showLog", () => {
      outputChannel.show(true);
    }),

    vscode.commands.registerCommand("accordo.bridge.showStatus", () => {
      const connected = wsClient?.isConnected() ?? false;
      const state = wsClient?.getState() ?? "disconnected";
      void vscode.window.showInformationMessage(
        `Accordo Bridge: ${connected ? "Connected ✓" : `Disconnected (${state})`}`,
      );
    }),
  );

  // ── Start Hub lifecycle ───────────────────────────────────────────────────

  await hubManager.activate();

  // ── Return BridgeAPI ──────────────────────────────────────────────────────

  return {
    registerTools(
      extensionId: string,
      tools: ExtensionToolDefinition[],
    ): vscode.Disposable {
      const inner = registry!.registerTools(extensionId, tools);
      return {
        dispose() {
          inner.dispose();
          statePublisher?.removeModalityState(extensionId);
        },
      };
    },

    publishState(
      extensionId: string,
      state: Record<string, unknown>,
    ): void {
      statePublisher?.publishState(extensionId, state);
    },

    getState(): IDEState {
      return statePublisher?.getState() ?? StatePublisher.emptyState();
    },

    isConnected(): boolean {
      return wsClient?.isConnected() ?? false;
    },

    onConnectionStatusChanged: emitter.event,
  };
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension is deactivated.
 * LCM-11: Close WS but do NOT kill the Hub process.
 */
export async function deactivate(): Promise<void> {
  currentHubToken = "";
  currentHubPort = 0;
  mcpProviderRegistered = false;
  mcpChangeEmitter = null; // already disposed via context.subscriptions

  statePublisher?.dispose();
  statePublisher = null;

  router?.cancelAll();
  router = null;

  registry?.dispose();
  registry = null;

  await wsClient?.disconnect();
  wsClient = null;

  // hubManager: do NOT kill Hub (LCM-11 — Hub serves CLI agents independently)
  hubManager = null;

  connectionStatusEmitter?.dispose();
  connectionStatusEmitter = null;
}
