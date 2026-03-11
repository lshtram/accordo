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
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HubManager } from "./hub-manager.js";
import type { HubManagerConfig } from "./hub-manager.js";
import { WsClient } from "./ws-client.js";
import type { WsClientEvents } from "./ws-client.js";
import { ExtensionRegistry } from "./extension-registry.js";
import type { ExtensionToolDefinition } from "./extension-registry.js";
import { CommandRouter } from "./command-router.js";
import { StatePublisher } from "./state-publisher.js";
import type { VscodeApi } from "./state-publisher.js";
import type { IDEState } from "@accordo/bridge-types";
import { writeAgentConfigs, removeWorkspaceThreshold } from "./agent-config.js";

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

  // Derive the user-level mcp.json path from the extension storage URI.
  // context.globalStorageUri.fsPath = .../Code/User/globalStorage/<ext-id>
  // Two dirname calls → .../Code/User → append mcp.json
  // VS Code 1.99+ expects MCP server config in the dedicated mcp.json file,
  // not in settings.json (which now shows a deprecation warning for mcp.*).
  const vscodeUserDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
  const mcpConfigPath = path.join(vscodeUserDir, "mcp.json");

  // Connection-status event emitter
  connectionStatusEmitter = new vscode.EventEmitter<boolean>();
  context.subscriptions.push(connectionStatusEmitter);

  // ── Config ────────────────────────────────────────────────────────────────

  const cfg = vscode.workspace.getConfiguration("accordo");
  const port = cfg.get<number>("hub.port", 3000);
  const autoStart = cfg.get<boolean>("hub.autoStart", true);
  const executablePath = cfg.get<string>("hub.executablePath", "");
  const wantCopilot = cfg.get<boolean>("agent.configureCopilot", true);
  const wantOpencode = cfg.get<boolean>("agent.configureOpencode", true);
  const wantClaude = cfg.get<boolean>("agent.configureClaude", true);

  // CFG-11: Raise virtualTools.threshold via the VS Code settings API so
  // the Copilot extension exposes all MCP tools directly instead of
  // collapsing them into activate_* virtual groups.
  //
  // IMPORTANT: Must use ConfigurationTarget.Global (user-level settings).
  // VS Code reads virtualTools.threshold during extension-host bootstrap,
  // before workspace settings are evaluated, so a .vscode/settings.json
  // entry has no effect on tool loading.
  //
  // We inspect the *global* value explicitly (not the merged effective value)
  // so a stale workspace-level entry from an earlier approach does not fool
  // us into skipping the global write.
  {
    const THRESHOLD_KEY = "github.copilot.chat";
    const THRESHOLD_SECTION = "virtualTools.threshold";
    const THRESHOLD_VALUE = 300;
    const copilotCfg = vscode.workspace.getConfiguration(THRESHOLD_KEY);
    // inspect() returns { globalValue, workspaceValue, defaultValue, ... }
    // Use globalValue, not get(), which merges workspace override.
    const inspected = copilotCfg.inspect<number>(THRESHOLD_SECTION);
    const globalValue = inspected?.globalValue ?? 0;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (globalValue < THRESHOLD_VALUE) {
      try {
        await copilotCfg.update(
          THRESHOLD_SECTION,
          THRESHOLD_VALUE,
          vscode.ConfigurationTarget.Global,
        );
        outputChannel.appendLine(
          `[accordo-bridge] Set ${THRESHOLD_KEY}.${THRESHOLD_SECTION}=${THRESHOLD_VALUE} (global) ✓`,
        );
        // Belt-and-suspenders: also remove the stale workspace-level flat key
        // from .vscode/settings.json that a previous approach wrote directly.
        // Do this via both VS Code API (for nested-key format) and direct file
        // edit (for flat-key format like "github.copilot.chat.virtualTools.threshold").
        try {
          await copilotCfg.update(THRESHOLD_SECTION, undefined, vscode.ConfigurationTarget.Workspace);
        } catch { /* workspace update may fail if no folder open */ }
        if (workspaceRoot) {
          removeWorkspaceThreshold(workspaceRoot, outputChannel);
        }
        void vscode.window.showInformationMessage(
          "Accordo raised the virtual-tools threshold so all MCP tools are visible. Reload the window to apply.",
          "Reload Window",
        ).then((choice) => {
          if (choice === "Reload Window") {
            void vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
      } catch (err) {
        outputChannel.appendLine(
          `[accordo-bridge] Failed to set ${THRESHOLD_KEY}.${THRESHOLD_SECTION}: ${String(err)}`,
        );
      }
    } else {
      // Global is already set adequately. Still clean up any stale workspace entry.
      if (workspaceRoot) {
        try {
          removeWorkspaceThreshold(workspaceRoot, outputChannel);
        } catch { /* best-effort */ }
      }
    }
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
    // M29: default PID file location mirrors what Hub writes at startup
    pidFilePath: path.join(os.homedir(), ".accordo", "hub.pid"),
    // Dynamic port: Hub writes the actual bound port here after startup
    portFilePath: path.join(os.homedir(), ".accordo", "hub.port"),
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

  /**
   * Build the WsClientEvents object. Extracted so both onHubReady (first
   * connection) and onCredentialsRotated (hub respawn when wsClient was
   * never created) can construct a WsClient with identical handlers.
   */
  const makeWsClientEvents = (): WsClientEvents => ({
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

  hubManager = new HubManager(
    secretStorage,
    outputChannel,
    config,
    {
      onHubReady: async (readyPort) => {
        const secret = hubManager?.getSecret() ?? "";
        currentHubPort = readyPort;
        currentHubToken = hubManager?.getToken() ?? "";

        // MCP-01 / MCP-02: Write Accordo to user-level mcp.json.
        if (wantCopilot) {
          await syncMcpSettings(outputChannel, mcpConfigPath, currentHubPort, currentHubToken);
        }

        // CFG-01 / CFG-02: Write agent config files (opencode.json, .claude/mcp.json)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot && (wantOpencode || wantClaude || wantCopilot)) {
          writeAgentConfigs({
            workspaceRoot,
            port: currentHubPort,
            token: currentHubToken,
            configureOpencode: wantOpencode,
            configureClaude: wantClaude,
            configureCopilot: wantCopilot,
            outputChannel,
          });
        } else if (!workspaceRoot) {
          outputChannel.appendLine(
            "[accordo-bridge] writeAgentConfigs skipped: no workspace folder open",
          );
        }

        // Disconnect any existing (stale) WsClient before creating a new one.
        if (wsClient) {
          const stale = wsClient;
          wsClient = null;
          await stale.disconnect();
        }

        wsClient = new WsClient(readyPort, secret, makeWsClientEvents(), () => registry?.getAllTools() ?? [], (msg) => outputChannel.appendLine(msg));

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
        // MCP-04: update settings so Copilot picks up the new token
        currentHubToken = newToken;
        if (wantCopilot) {
          await syncMcpSettings(outputChannel, mcpConfigPath, currentHubPort, newToken);
        }
        // CFG-07: rewrite agent config files with new token
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot && (wantOpencode || wantClaude || wantCopilot)) {
          writeAgentConfigs({
            workspaceRoot,
            port: currentHubPort,
            token: newToken,
            configureOpencode: wantOpencode,
            configureClaude: wantClaude,
            configureCopilot: wantCopilot,
            outputChannel,
          });
        } else if (!workspaceRoot) {
          outputChannel.appendLine(
            "[accordo-bridge] writeAgentConfigs skipped on rotation: no workspace folder open",
          );
        }
        if (wsClient) {
          wsClient.updateSecret(newSecret);
          await wsClient.disconnect();
          await wsClient.connect(
            statePublisher?.getState() ?? StatePublisher.emptyState(),
            registry?.getAllTools() ?? [],
          );
        } else {
          // wsClient was never created — the initial hub spawn crashed before
          // onHubReady fired, so restart() ran and produced new credentials.
          // Bootstrap the WsClient now so the bridge actually connects.
          outputChannel.appendLine(
            "[accordo-bridge] Creating WsClient after hub respawn (initial spawn had crashed)",
          );
          const port = hubManager?.getPort() ?? config.port;
          currentHubPort = port;
          wsClient = new WsClient(port, newSecret, makeWsClientEvents(), () => registry?.getAllTools() ?? [], (msg) => outputChannel.appendLine(msg));
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

      // Dual-register every MCP tool as a VS Code command so scripts can
      // invoke any tool via { "type": "command", "command": "<toolName>", "args": {...} }.
      // Uses the MCP tool name directly (e.g. "accordo_editor_open") as the
      // command ID — valid in VS Code despite the underscore convention.
      const cmdDisposables = tools.map((tool) =>
        vscode.commands.registerCommand(
          tool.name,
          (args?: unknown) => tool.handler((args as Record<string, unknown>) ?? {}),
        ),
      );

      return {
        dispose() {
          inner.dispose();
          statePublisher?.removeModalityState(extensionId);
          for (const d of cmdDisposables) d.dispose();
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
  // NOTE: do NOT remove mcp.servers.accordo — Hub stays running (LCM-11)
  // and the setting must remain so Copilot can reach it from any workspace.
  currentHubToken = "";
  currentHubPort = 0;

  statePublisher?.dispose();
  statePublisher = null;

  router?.cancelAll();
  router = null;

  registry?.dispose();
  registry = null;

  await wsClient?.disconnect();
  wsClient = null;

  // LCM-11: do NOT kill Hub — it serves CLI agents independently.
  // But do call deactivate() to arm the deactivated guard so the spawn
  // exit-handler and pollHealth timer chain don't fire into disposed resources.
  await hubManager?.deactivate();
  hubManager = null;

  connectionStatusEmitter?.dispose();
  connectionStatusEmitter = null;
}

// ── MCP settings sync ────────────────────────────────────────────────────────

/**
 * Write or update the `accordo` server entry in the user-level mcp.json file.
 *
 * VS Code 1.99+ expects MCP server configuration in a dedicated mcp.json file
 * (not in settings.json — that now shows a deprecation warning).
 * The top-level format is { "servers": { ... } }.
 *
 * MCP-01, MCP-02, MCP-04
 */
async function syncMcpSettings(
  outputChannel: { appendLine(v: string): void },
  mcpConfigPath: string,
  port: number,
  token: string,
): Promise<void> {
  try {
    const expectedUrl = `http://localhost:${port}/mcp`;
    const expectedAuth = `Bearer ${token}`;

    // Read existing mcp.json, defaulting to empty config if file missing.
    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(mcpConfigPath, "utf8");
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File may not exist yet — that's fine, we'll create it.
    }

    // mcp.json top-level format: { servers: { <name>: { type, url, headers } } }
    const servers = (config["servers"] ?? {}) as Record<string, unknown>;
    const existing = servers["accordo"] as Record<string, unknown> | undefined;

    // Skip the write if nothing changed — avoids VS Code treating the entry as
    // a new server and resetting the user's enabled/disabled consent checkbox.
    if (
      existing &&
      existing["type"] === "http" &&
      existing["url"] === expectedUrl &&
      (existing["headers"] as Record<string, string> | undefined)?.["Authorization"] === expectedAuth
    ) {
      outputChannel.appendLine(
        "[accordo-bridge] mcp.json accordo entry unchanged — skipping write",
      );
      return;
    }

    config["servers"] = {
      ...servers,
      accordo: {
        type: "http",
        url: expectedUrl,
        headers: { Authorization: expectedAuth },
      },
    };

    await fs.promises.writeFile(mcpConfigPath, JSON.stringify(config, null, 2), "utf8");
    outputChannel.appendLine(
      `[accordo-bridge] mcp.json accordo entry written to ${mcpConfigPath} (port=${port}) ✓`,
    );
  } catch (err: unknown) {
    outputChannel.appendLine(
      `[accordo-bridge] Failed to write mcp.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
