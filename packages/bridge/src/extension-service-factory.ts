/**
 * Extension Service Factory — Service instantiation
 *
 * Creates and wires all Bridge service instances:
 * - HubManager (process lifecycle)
 * - ExtensionRegistry (tool registration from consumer extensions)
 * - CommandRouter (Hub → Bridge invocation routing)
 * - StatePublisher (VSCode events → Hub state patches)
 * - SecretStorage adapter (vscode.SecretStorage wrapper)
 *
 * This module has NO direct 'vscode' import. All VSCode dependencies
 * are received via injection through the BootstrapResult and typed
 * interfaces from the individual service modules.
 *
 * Requirements: requirements-bridge.md §4, §5, §6, §7
 */

import { HubManager } from "./hub-manager.js";
import type { HubManagerConfig, HubManagerEvents } from "./hub-manager.js";
import type { SecretStorageAdapter } from "./extension-bootstrap.js";
import { ExtensionRegistry } from "./extension-registry.js";
import { CommandRouter } from "./command-router.js";
import { StatePublisher } from "./state-publisher.js";
import type { HostEnvironment, StatePublisherSend } from "./state-publisher.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Output channel abstraction — matches the essential subset of
 * vscode.OutputChannel that services need for logging.
 * Reuses the shape from hub-manager.ts for consistency.
 */
export interface OutputChannel {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

/**
 * Confirmation dialog function type for command router.
 * Shows a user confirmation dialog and returns true if confirmed.
 */
export type ConfirmationDialogFn = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

/**
 * All Bridge services created by the factory.
 * These are the live instances, not types.
 */
export interface Services {
  /** Hub process lifecycle manager */
  readonly hubManager: HubManager;
  /** Tool registration store for consumer extensions */
  readonly registry: ExtensionRegistry;
  /** Routes invoke/cancel from Hub to registered handlers */
  readonly router: CommandRouter;
  /** Watches VSCode events and pushes state patches to Hub */
  readonly statePublisher: StatePublisher;
  /**
   * Mutable send-functions object passed to StatePublisher.
   * The composition module mutates this object at runtime so that
   * the StatePublisher's outbound callbacks always delegate to the
   * currently-live WsClient instance.
   */
  readonly sendBridge: StatePublisherSend;
}

/**
 * Dependencies injected into the factory.
 * The bootstrap module provides these — no vscode import needed here.
 */
export interface ServiceFactoryDeps {
  /** Hub process configuration */
  readonly hubManagerConfig: HubManagerConfig;
  /** HubManager event callbacks (onHubReady, onHubError, onCredentialsRotated) */
  readonly hubManagerEvents: HubManagerEvents;
  /** Secret storage adapter wrapping vscode.SecretStorage */
  readonly secretStorage: SecretStorageAdapter;
  /** Output channel for Hub logging */
  readonly outputChannel: OutputChannel;
  /** VSCode API surface needed by StatePublisher (injected, not imported) */
  readonly vscodeApi: HostEnvironment;
  /** Confirmation dialog function for destructive tool invocations */
  readonly confirmationFn: ConfirmationDialogFn;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create all Bridge service instances.
 *
 * Instantiates HubManager, ExtensionRegistry, CommandRouter, and
 * StatePublisher. Wires late-bound send functions so WsClient (created
 * later by the composition module) can be injected at runtime.
 *
 * @param deps  All dependencies — provided by bootstrap + composition
 * @returns     Services record with all live instances
 */
export function createServices(deps: ServiceFactoryDeps): Services {
  // Create the mutable send-bridge object first. The composition module
  // will overwrite its properties after a WsClient is created so that
  // outbound messages always reach the live socket.
  const sendBridge: StatePublisherSend = {
    sendSnapshot: (_msg) => { /* wired by composition module after WsClient is ready */ },
    sendUpdate: (_msg) => { /* wired by composition module after WsClient is ready */ },
  };

  const registry = new ExtensionRegistry();
  const router = new CommandRouter(registry);
  router.setConfirmationFn(deps.confirmationFn);

  const statePublisher = new StatePublisher(deps.vscodeApi, sendBridge);

  const hubManager = new HubManager(
    deps.secretStorage,
    deps.outputChannel,
    deps.hubManagerConfig,
    deps.hubManagerEvents,
  );

  return { hubManager, registry, router, statePublisher, sendBridge };
}
