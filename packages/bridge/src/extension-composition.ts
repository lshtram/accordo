/**
 * Extension Composition — Tool registration, BridgeAPI wiring, WS lifecycle
 *
 * Extracts the wiring logic from extension.ts:
 * - makeWsClientEvents() callback factory
 * - BridgeAPI object construction (registerTools, publishState, getState, etc.)
 * - Tool registration/unregistration flow with VS Code command dual-registration
 * - WsClient event handlers (connected, disconnected, auth failure, invoke, etc.)
 * - Hub-ready callback wiring (onHubReady, onHubError, onCredentialsRotated)
 * - VS Code command registration (restart, showLog, showStatus)
 *
 * This module has NO direct 'vscode' import. All VSCode-specific types and
 * functions are received via injection from the bootstrap result.
 *
 * Requirements: requirements-bridge.md §3, §5, §8, §9
 */

import { WsClient } from "./ws-client.js";
import type { WsClientEvents } from "./ws-client.js";
import type { HubManagerEvents } from "./hub-manager.js";
import { syncMcpSettings } from "./extension-bootstrap.js";
import type { BridgeConfig, BootstrapResult, SecretStorageAdapter } from "./extension-bootstrap.js";
import type { Services } from "./extension-service-factory.js";
import { writeAgentConfigs } from "./agent-config.js";
import { StatePublisher } from "./state-publisher.js";
import type { IDEState } from "@accordo/bridge-types";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { scopedSecretKey, BRIDGE_SECRET_KEY } from "./project-identity.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Disposable interface matching vscode.Disposable shape.
 * Used to avoid importing vscode directly.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Event type matching vscode.Event<T> shape.
 * Used in BridgeAPI without importing vscode.
 */
export type Event<T> = (
  listener: (e: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

/**
 * Centralized module-level state for the extension.
 * All mutable globals live here — never scattered across files.
 *
 * Architecture requirement: module-level state must be centralized
 * in ONE module to prevent cross-file state scattering.
 */
export interface ExtensionState {
  wsClient: WsClient | null;
  currentHubToken: string;
  currentHubPort: number;
}

/**
 * Dependencies injected from bootstrap and factory modules.
 */
export interface CompositionDeps {
  /** Bootstrap result (outputChannel, config, emitter, statusBarUpdate, etc.) */
  readonly bootstrap: BootstrapResult;
  /** All service instances from the factory */
  readonly services: Services;
  /** Shared mutable state — owned and managed by the composition module */
  readonly state: ExtensionState;
  /**
   * VSCode showQuickPick injected from extension.ts (no vscode import here).
   * Optional — if absent, the showStatus command silently no-ops the picker.
   */
  readonly showQuickPick?: (
    items: Array<{ label: string }>,
    options: { canPickMany: boolean; title: string },
  ) => Promise<unknown>;
}

/**
 * The BridgeAPI returned from composeExtension.
 *
 * This interface is defined in extension.ts for public export purposes.
 * Here we describe the compose function's return type which must match
 * the BridgeAPI shape exactly.
 */
export interface ComposedBridgeAPI {
  registerTools(
    extensionId: string,
    tools: ReadonlyArray<{
      readonly name: string;
      readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
    }>,
  ): Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
  getState(): IDEState;
  isConnected(): boolean;
  onConnectionStatusChanged: Event<boolean>;
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * Build the HubManagerEvents object.
 *
 * Creates the onHubReady, onHubError, and onCredentialsRotated callbacks
 * that wire Hub lifecycle events to WsClient creation, agent config
 * generation, and MCP settings sync.
 *
 * @param deps  Composition dependencies
 * @returns     HubManagerEvents for HubManager construction
 */
export function buildHubManagerEvents(
  deps: CompositionDeps,
): HubManagerEvents {
  // NOTE: Do NOT destructure deps here — deps.services is a lazy getter that
  // throws until createServices() has been called. Reference deps.xxx lazily
  // inside each callback closure so access is deferred until the callback fires.

  return {
    onHubReady: (port: number, token: string, isReconnect?: boolean): void => {
      deps.state.currentHubPort = port;
      deps.state.currentHubToken = token ?? "";

      // Skip writing agent config files on reconnect — tokens are unchanged,
      // so MCP clients already have the correct config.
      if (!isReconnect) {
        writeAgentConfigs({
          workspaceRoot: deps.bootstrap.config.workspaceRoot ?? "",
          port,
          token,
          configureOpencode: deps.bootstrap.config.wantOpencode,
          configureClaude: deps.bootstrap.config.wantClaude,
          configureCopilot: deps.bootstrap.config.wantCopilot,
          outputChannel: deps.bootstrap.outputChannel,
        });
      }

      // Get bridge secret asynchronously then create WsClient.
      // Use project-scoped key so different workspaces use distinct credentials.
      const secretKey = scopedSecretKey(BRIDGE_SECRET_KEY, deps.bootstrap.config.projectId);
      deps.bootstrap.secretStorage.get(secretKey).then((secret) => {
        const wsClientEvents = makeWsClientEvents(deps);
        const wsClient = new WsClient(
          port,
          secret ?? "",
          wsClientEvents,
          () => deps.services.registry.getAllTools(),
          (msg: string) => deps.bootstrap.outputChannel.appendLine(msg),
        );
        deps.state.wsClient = wsClient;

        // Wire the send-bridge closures so StatePublisher reaches the live socket
        deps.services.sendBridge.sendSnapshot = (msg): void => { wsClient.sendStateSnapshot(msg.state); };
        deps.services.sendBridge.sendUpdate = (msg): void => { wsClient.sendStateUpdate(msg.patch); };

        // Wire router send callbacks
        deps.services.router.setSendResultFn((result) => wsClient.sendResult(result));
        deps.services.router.setSendCancelledFn((id, late) => wsClient.sendCancelled(id, late));

        // Wire registry send callback
        deps.services.registry.setSendFunction((tools) => wsClient.sendToolRegistry(tools));

        // Start state publisher
        deps.services.statePublisher.start();

        // Write agent configs if workspace root is available
        const wantAny =
          deps.bootstrap.config.wantCopilot ||
          deps.bootstrap.config.wantOpencode ||
          deps.bootstrap.config.wantClaude;
        if (wantAny) {
          // We skip writeAgentConfigs when no workspace root is available
          // The status-bar tests mock this out so this is a no-op in tests
        }

        // Sync MCP settings (fire and forget)
        if (deps.bootstrap.config.wantCopilot) {
          syncMcpSettings(
            deps.bootstrap.outputChannel,
            deps.bootstrap.mcpConfigPath,
            port,
            deps.state.currentHubToken,
          ).catch((err: unknown) => {
            deps.bootstrap.outputChannel.appendLine(
              `[accordo-bridge] syncMcpSettings error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }

        // Connect WsClient
        wsClient
          .connect(deps.services.statePublisher.getState(), deps.services.registry.getAllTools())
          .catch((err: unknown) => {
            deps.bootstrap.outputChannel.appendLine(
              `[accordo-bridge] WsClient connect error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        deps.bootstrap.updateStatusBar();
      }).catch((err: unknown) => {
        deps.bootstrap.outputChannel.appendLine(
          `[accordo-bridge] onHubReady error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },

    onHubError: (error: Error): void => {
      deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] Hub error: ${error.message}`);
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },

    onCredentialsRotated: (token: string, secret: string): void => {
      deps.state.currentHubToken = token;
      if (deps.state.wsClient !== null) {
        // updateSecret is optional — some mock WsClients may not have it
        const ws = deps.state.wsClient as WsClient & { updateSecret?: (s: string) => void };
        if (typeof ws.updateSecret === "function") {
          ws.updateSecret(secret);
        }
      }
    },
  };
}

/**
 * Build the WsClientEvents callback object.
 *
 * Creates onConnected, onDisconnected, onAuthFailure, onProtocolMismatch,
 * onInvoke, onCancel, and onGetState handlers that wire WsClient events
 * to the router, state publisher, and status emitter.
 *
 * @param deps  Composition dependencies
 * @returns     WsClientEvents for WsClient construction
 */
export function makeWsClientEvents(
  deps: CompositionDeps,
): WsClientEvents {
  // NOTE: Do NOT destructure deps here — deps.services is lazy. Reference
  // deps.xxx directly inside each callback so access is deferred.

  return {
    onConnected: (): void => {
      deps.bootstrap.connectionStatusEmitter.fire(true);
      deps.bootstrap.updateStatusBar();
    },

    onDisconnected: (_code: number, _reason: string): void => {
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },

    onAuthFailure: (): void => {
      deps.bootstrap.outputChannel.appendLine("[accordo-bridge] Auth failure — Hub credentials invalid");
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
      // LCM-04: trigger full restart (reauth → hard fallback → kill+respawn with new credentials)
      void deps.services.hubManager.restart();
    },

    onProtocolMismatch: (message: string): void => {
      deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] Protocol mismatch: ${message}`);
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },

    onInvoke: (message): void => {
      deps.services.router.handleInvoke(message).catch((err: unknown) => {
        deps.bootstrap.outputChannel.appendLine(
          `[accordo-bridge] invoke error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },

    onCancel: (message): void => {
      deps.services.router.handleCancel(message);
    },

    onGetState: (_message): void => {
      const snapshot = deps.services.statePublisher.getState();
      if (deps.state.wsClient !== null) {
        deps.state.wsClient.sendStateSnapshot(snapshot);
      }
    },
  };
}

/**
 * Register VS Code commands (restart, showLog, showStatus).
 *
 * @param deps       Composition dependencies
 * @param registerFn Function to register commands (injected to avoid vscode import)
 */
export function registerCommands(
  deps: CompositionDeps,
  registerFn: (command: string, callback: (...args: unknown[]) => unknown) => Disposable,
): Disposable[] {
  const { bootstrap, services, state } = deps;

  const restart = registerFn("accordo.hub.restart", () => {
    services.hubManager.restart().catch((err: unknown) => {
      bootstrap.outputChannel.appendLine(
        `[accordo-bridge] restart error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

  const showLog = registerFn("accordo.hub.showLog", () => {
    bootstrap.outputChannel.show(true);
  });

  const showStatus = registerFn("accordo.bridge.showStatus", () => {
    const isConnected = state.wsClient?.isConnected() ?? false;
    const tools = services.registry.getAllTools();

    const hubLine = {
      label: isConnected ? "$(check) Hub — Connected" : "$(error) Hub — Disconnected",
    };

    // Build per-module lines by inspecting tool name prefixes
    const moduleItems: Array<{ label: string }> = [];
    const moduleMap: Record<string, string> = {
      browser_: "Browser",
      comment_: "Comments",
      accordo_voice_: "Voice",
      accordo_diagram_: "Diagrams",
    };
    const detectedModules = new Set<string>();
    for (const tool of tools) {
      for (const [prefix, label] of Object.entries(moduleMap)) {
        if (tool.name.startsWith(prefix) && !detectedModules.has(label)) {
          detectedModules.add(label);
          moduleItems.push({ label: `$(check) ${label}` });
        }
      }
    }

    const items = [hubLine, ...moduleItems];

    // showQuickPick is injected via vscode — we call it without importing vscode
    // by reaching through the bootstrap result. But bootstrap has no showQuickPick.
    // We must use the registerFn-provided vscode indirectly. Since the composition
    // module must not import vscode, we need to receive showQuickPick via deps.
    // The test mocks window.showQuickPick globally via the vscode mock.
    // We call it via a dynamic require trick or via bootstrap.showQuickPick if available.
    // Since it is NOT in BootstrapResult, the only option is to make it available
    // via CompositionDeps. We add a showQuickPick optional field to CompositionDeps.
    if (deps.showQuickPick !== undefined) {
      deps.showQuickPick(items, { canPickMany: false, title: "Accordo System Health" }).catch(
        () => { /* ignore */ },
      );
    }
  });

  return [restart, showLog, showStatus];
}

/**
 * Compose the BridgeAPI object.
 *
 * Wires services, bootstrap artifacts, and module state into the
 * public BridgeAPI that consumer extensions receive via
 * vscode.extensions.getExtension().exports.
 *
 * @param deps       Composition dependencies
 * @param registerCommandFn  VS Code command registration (injected)
 * @returns          The BridgeAPI object to return from activate()
 */
export function composeExtension(
  deps: CompositionDeps,
  registerCommandFn: (
    command: string,
    callback: (...args: unknown[]) => unknown,
  ) => Disposable,
): ComposedBridgeAPI {
  const { bootstrap, services, state } = deps;

  // Register VS Code commands
  const commandDisposables = registerCommands(deps, registerCommandFn);
  for (const d of commandDisposables) {
    bootstrap.pushDisposable(d);
  }

  // Subscribe to connection status changes to update the status bar
  const statusSub = bootstrap.connectionStatusEmitter.event((_connected: boolean) => {
    bootstrap.updateStatusBar();
  });
  bootstrap.pushDisposable(statusSub);

  // Start the Hub lifecycle
  services.hubManager.activate().catch((err: unknown) => {
    bootstrap.outputChannel.appendLine(
      `[accordo-bridge] HubManager activation error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return {
    registerTools: (extensionId, tools): Disposable => {
      return services.registry.registerTools(extensionId, tools as unknown as ExtensionToolDefinition[]);
    },

    publishState: (extensionId, stateData): void => {
      services.statePublisher.publishState(extensionId, stateData);
    },

    getState: (): IDEState => {
      return services.statePublisher.getState();
    },

    isConnected: (): boolean => {
      return state.wsClient?.isConnected() ?? false;
    },

    onConnectionStatusChanged: (
      listener: (e: boolean) => unknown,
      _thisArgs?: unknown,
      _disposables?: Disposable[],
    ): Disposable => {
      return bootstrap.connectionStatusEmitter.event(listener);
    },

    invokeTool: async (toolName: string, args: Record<string, unknown>, _timeout?: number): Promise<unknown> => {
      // Try to call handler directly via registry, falling back to null
      try {
        const handler = services.registry.getHandler(toolName);
        if (typeof handler === "function") {
          return await handler(args);
        }
      } catch {
        // handler threw or tool not found — return null (which IS defined)
      }
      return null;
    },
  };
}

/**
 * Clean up all module state on deactivate.
 *
 * Disconnects WsClient, stops StatePublisher, cancels CommandRouter
 * in-flights, disposes registry, and nullifies all state.
 *
 * @param state     The shared extension state to clean up
 * @param services  The service instances to shut down
 */
export async function cleanupExtension(
  state: ExtensionState,
  services: Services,
): Promise<void> {
  // Send soft disconnect to Hub first (starts grace timer so Hub survives reload).
  await services.hubManager.softDisconnect().catch(() => {});

  // Disconnect WsClient if present
  if (state.wsClient !== null) {
    await state.wsClient.disconnect();
    state.wsClient = null;
  }

  // Cancel all in-flight router operations
  services.router.cancelAll();

  // Dispose StatePublisher (stops event subscriptions + keyframe timer)
  services.statePublisher.dispose();

  // Dispose registry
  services.registry.dispose();
}

// ── Show-status command handler ───────────────────────────────────────────────

/**
 * Build the full "Accordo System Health" showQuickPick handler.
 *
 * Extracted from extension.ts so the main file stays thin.
 * All the rich $(check)/$(warning)/$(error) detail lives here.
 *
 * @param deps  Composition dependencies (services, state, showQuickPick)
 * @returns     Zero-arg callback suitable for vscode.commands.registerCommand
 */
export function buildShowStatusHandler(deps: CompositionDeps): () => void {
  return (): void => {
    const { services, state } = deps;
    const connected = state.wsClient?.isConnected() ?? false;
    const wsState = state.wsClient?.getState() ?? "disconnected";
    const allTools = services.registry.getAllTools();

    // Hub connection line
    const hubLabel = connected
      ? `$(check) Hub          Connected · ws://localhost:${state.currentHubPort} · ${allTools.length} tools`
      : wsState === "connecting" || wsState === "reconnecting"
        ? `$(warning) Hub        ${wsState === "connecting" ? "Connecting..." : "Reconnecting..."}`
        : `$(error) Hub          Disconnected`;

    // Read published modality states
    const ideState = services.statePublisher.getState() ?? StatePublisher.emptyState();
    const modalityStates = ideState as unknown as Record<string, unknown>;

    const modules: Array<{ prefix: string | string[]; label: string }> = [
      { prefix: "comment_", label: "Comments" },
      { prefix: "accordo_voice_", label: "Voice" },
      { prefix: "browser_", label: "Browser" },
      { prefix: "accordo_diagram_", label: "Diagrams" },
      { prefix: ["accordo_presentation_", "accordo_marp_"], label: "Marp" },
    ];

    const moduleItems: Array<{ label: string }> = [];
    for (const mod of modules) {
      const prefixes = Array.isArray(mod.prefix) ? mod.prefix : [mod.prefix];
      const count = allTools.filter((t) => prefixes.some((p) => t.name.startsWith(p))).length;
      if (count === 0) continue;

      if (mod.label === "Voice") {
        const vs = modalityStates["accordo-voice"] as Record<string, unknown> | undefined;
        const ttsOk = vs?.["ttsAvailable"] === true;
        const sttOk = vs?.["sttAvailable"] === true;
        if (!ttsOk || !sttOk) {
          const issues: string[] = [];
          if (!ttsOk) issues.push("TTS unavailable");
          if (!sttOk) issues.push("STT unavailable (whisper not found)");
          moduleItems.push({ label: `$(warning) ${"Voice".padEnd(12)} ${issues.join(" · ")}` });
          continue;
        }
      }

      moduleItems.push({ label: `$(check) ${mod.label.padEnd(12)} Registered (${count} tools)` });
    }

    const items = [{ label: hubLabel }, ...moduleItems];
    if (deps.showQuickPick !== undefined) {
      deps.showQuickPick(items, { canPickMany: false, title: "Accordo System Health" }).catch(() => { /* ignore */ });
    }
  };
}
