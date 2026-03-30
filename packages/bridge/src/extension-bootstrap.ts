/**
 * Extension Bootstrap — VSCode activation ceremony
 *
 * Extracts all VSCode-specific setup from extension.ts:
 * - Output channel creation
 * - MCP config path derivation
 * - Configuration reads
 * - Copilot virtualTools threshold enforcement (CFG-11)
 * - Status bar item creation and update logic
 * - syncMcpSettings() for user-level mcp.json
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  BOUNDARY: this is the ONLY file in the bridge package that         │
 * │  imports 'vscode' directly.  All other modules receive the VSCode   │
 * │  surface via the HostEnvironment interface (state-collector.ts)     │
 * │  injected at runtime from extension.ts.                             │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * This module is the ONLY new module that imports 'vscode' directly.
 * The factory and composition modules receive VSCode deps via injection.
 *
 * Requirements: requirements-bridge.md §2, §8.1, §9
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { HubManagerConfig } from "./hub-manager.js";
import { removeWorkspaceThreshold } from "./agent-config.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Abstraction over vscode.SecretStorage for testability.
 * Wraps Thenable returns into proper Promises.
 */
export interface SecretStorageAdapter {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Configuration values read from VSCode settings during bootstrap.
 * Pure data — no vscode dependency for consumers.
 */
export interface BridgeConfig {
  /** Hub HTTP port. Default: 3000 */
  readonly port: number;
  /** Whether to auto-start Hub if not running. Default: true */
  readonly autoStart: boolean;
  /** Path to Node.js executable for spawning Hub. Empty = process.execPath */
  readonly executablePath: string;
  /** Whether to register Hub as MCP server for Copilot */
  readonly wantCopilot: boolean;
  /** Whether to auto-generate opencode.json */
  readonly wantOpencode: boolean;
  /** Whether to auto-generate .claude/mcp.json */
  readonly wantClaude: boolean;
  /** Absolute path to the first workspace folder root, or empty string if none */
  readonly workspaceRoot: string;
}

/**
 * Update callback type for status bar refreshes.
 * Called whenever connection state or tool count changes.
 */
export type StatusBarUpdateFn = () => void;

/**
 * The result of bootstrapExtension — everything the factory and
 * composition modules need to proceed, without any vscode import.
 */
export interface BootstrapResult {
  /** Output channel for Hub logging (LCM-09) */
  readonly outputChannel: vscode.OutputChannel;
  /** Path to user-level mcp.json for Copilot MCP registration */
  readonly mcpConfigPath: string;
  /** Parsed configuration values from VSCode settings */
  readonly config: BridgeConfig;
  /** HubManagerConfig ready for HubManager construction */
  readonly hubManagerConfig: HubManagerConfig;
  /** SecretStorage adapter wrapping context.secrets */
  readonly secretStorage: SecretStorageAdapter;
  /** Connection status event emitter */
  readonly connectionStatusEmitter: vscode.EventEmitter<boolean>;
  /** Function to update the status bar item; captured in closure */
  readonly updateStatusBar: StatusBarUpdateFn;
  /**
   * Replace the status bar update logic after services are wired.
   * Called from extension.ts once the depsContainer is fully populated
   * so that updateStatusBar can compute dynamic text from wsClient state.
   */
  readonly setStatusBarUpdater: (fn: StatusBarUpdateFn) => void;
  /**
   * Direct reference to the status bar item — exposed so that the
   * dynamic updater registered via setStatusBarUpdater can set its text.
   */
  readonly statusBarItem: { text: string };
  /** Register a disposable for cleanup on deactivate */
  readonly pushDisposable: (d: vscode.Disposable) => void;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Perform the VSCode activation ceremony.
 *
 * Creates the output channel, reads configuration, enforces the Copilot
 * virtualTools threshold, creates the status bar item, and returns a
 * BootstrapResult that downstream modules consume without importing vscode.
 *
 * @param context  The VSCode ExtensionContext provided to activate()
 * @returns        BootstrapResult containing all setup artifacts
 */
export async function bootstrapExtension(
  context: vscode.ExtensionContext,
): Promise<BootstrapResult> {
  // Step 1: Create output channel
  const outputChannel = vscode.window.createOutputChannel("Accordo Hub");

  // Step 2: Derive mcpConfigPath (user-level .vscode/mcp.json)
  const mcpConfigPath = path.join(os.homedir(), ".vscode", "mcp.json");

  // Step 3: Read configuration
  const cfg = vscode.workspace.getConfiguration("accordo");
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : "";
  const config: BridgeConfig = {
    port: cfg.get<number>("hub.port") ?? 3000,
    autoStart: cfg.get<boolean>("hub.autoStart") ?? true,
    executablePath: cfg.get<string>("hub.executablePath") ?? "",
    wantCopilot: cfg.get<boolean>("agent.configureCopilot") ?? true,
    wantOpencode: cfg.get<boolean>("agent.configureOpencode") ?? true,
    wantClaude: cfg.get<boolean>("agent.configureClaude") ?? true,
    workspaceRoot,
  };

  // Step 4: Enforce Copilot virtualTools threshold (CFG-11) — remove stale workspace setting
  if (workspaceFolders && workspaceFolders.length > 0) {
    removeWorkspaceThreshold(workspaceFolders[0].uri.fsPath, outputChannel);
  }

  // Step 5: Build HubManagerConfig
  const hubEntryPoint = path.join(
    context.extensionUri.fsPath,
    "node_modules",
    "accordo-hub",
    "dist",
    "index.js",
  );
  const accordoDir = path.join(os.homedir(), ".accordo");
  const hubManagerConfig = {
    port: config.port,
    autoStart: config.autoStart,
    executablePath: config.executablePath,
    hubEntryPoint,
    portFilePath: path.join(accordoDir, "hub.port"),
    pidFilePath: path.join(accordoDir, "hub.pid"),
  };

  // Step 6: Create SecretStorageAdapter wrapping context.secrets
  const secretStorage: SecretStorageAdapter = {
    get: (key: string): Promise<string | undefined> => Promise.resolve(context.secrets.get(key)),
    store: (key: string, value: string): Promise<void> => Promise.resolve(context.secrets.store(key, value)),
    delete: (key: string): Promise<void> => Promise.resolve(context.secrets.delete(key)),
  };

  // Step 7: Create connectionStatusEmitter
  const connectionStatusEmitter = new vscode.EventEmitter<boolean>();

  // Step 8: Create status bar item and updateStatusBar closure
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();

  // Mutable delegate: allows extension.ts to inject real logic after services are wired
  let updateFn: StatusBarUpdateFn = (): void => {
    statusBarItem.text = "$(plug) Accordo";
  };
  const updateStatusBar: StatusBarUpdateFn = (): void => { updateFn(); };
  const setStatusBarUpdater = (fn: StatusBarUpdateFn): void => { updateFn = fn; };
  updateStatusBar();

  // Step 9: pushDisposable helper
  const pushDisposable = (d: vscode.Disposable): void => {
    context.subscriptions.push(d);
  };

  // Register disposables
  pushDisposable(connectionStatusEmitter);
  pushDisposable(statusBarItem);

  return {
    outputChannel,
    mcpConfigPath,
    config,
    hubManagerConfig,
    secretStorage,
    connectionStatusEmitter,
    updateStatusBar,
    setStatusBarUpdater,
    statusBarItem,
    pushDisposable,
  };
}

// ── MCP settings sync ────────────────────────────────────────────────────────

/**
 * Write or update the `accordo` server entry in the user-level mcp.json file.
 *
 * VS Code 1.99+ expects MCP server configuration in a dedicated mcp.json file
 * (not in settings.json — that now shows a deprecation warning).
 * The top-level format is { "servers": { ... } }.
 *
 * Skips the write if the existing entry already matches (token and URL
 * unchanged) — avoids resetting Copilot's consent checkbox.
 *
 * MCP-01, MCP-02, MCP-04
 *
 * @param outputChannel  Logger for diagnostic messages
 * @param mcpConfigPath  Absolute path to the user-level mcp.json file
 * @param port           Hub port number
 * @param token          Bearer token for Hub authentication
 */
export async function syncMcpSettings(
  outputChannel: { appendLine(v: string): void },
  mcpConfigPath: string,
  port: number,
  token: string,
): Promise<void> {
  // Read existing mcp.json (user-level)
  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(mcpConfigPath, "utf8");
  } catch {
    // file absent — will create it
  }

  // Parse and check if it already matches (skip write to preserve Copilot consent)
  if (existingRaw !== undefined) {
    try {
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      const servers = (existing["servers"] ?? {}) as Record<string, unknown>;
      const accordo = servers["accordo"] as Record<string, unknown> | undefined;
      if (accordo !== undefined) {
        const url = accordo["url"] as string | undefined;
        const headers = (accordo["headers"] ?? {}) as Record<string, unknown>;
        const auth = headers["Authorization"] as string | undefined;
        const expectedUrl = `http://localhost:${port}/mcp`;
        const expectedAuth = `Bearer ${token}`;
        if (url === expectedUrl && auth === expectedAuth) {
          outputChannel.appendLine("[accordo-bridge] mcp.json is up to date — skipping write");
          return;
        }
      }
    } catch {
      // malformed JSON — fall through to overwrite
    }
  }

  // Build new content merging with existing servers
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const existingServers = (existing["servers"] ?? {}) as Record<string, unknown>;
  const newContent = {
    ...existing,
    servers: {
      ...existingServers,
      accordo: {
        type: "http",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };

  // Ensure directory exists
  const dir = path.dirname(mcpConfigPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mcpConfigPath, JSON.stringify(newContent, null, 2) + "\n", "utf8");
  outputChannel.appendLine(`[accordo-bridge] Updated ${mcpConfigPath} ✓`);
}

// ── Status bar updater factory ────────────────────────────────────────────────

/**
 * Minimal structural type for the services needed by the status bar updater.
 * Duck-typed so extension-bootstrap.ts avoids importing extension-service-factory.ts.
 */
export interface StatusBarServices {
  readonly registry: { getAllTools(): ReadonlyArray<{ name: string }> };
  readonly statePublisher: {
    getState(): Record<string, unknown> | null;
    emptyState?: () => Record<string, unknown>;
  };
}

/**
 * Build the updateStatusBar function that extension.ts injects via
 * bootstrap.setStatusBarUpdater().
 *
 * Extracted here so extension.ts stays thin. The returned function
 * uses the exact $(check)/$(warning)/$(error) logic from the original
 * extension.ts implementation.
 *
 * @param statusBarItem  The VS Code status bar item to update
 * @param getWsClient    Lazy getter for the current WsClient (null if not yet connected)
 * @param getServices    Lazy getter for the service instances (null until factory runs)
 */
export function buildStatusBarUpdater(
  statusBarItem: { text: string },
  getWsClient: () => { isConnected(): boolean; getState(): string } | null,
  getServices: () => StatusBarServices | null,
): StatusBarUpdateFn {
  return (): void => {
    const wsClient = getWsClient();
    const services = getServices();

    const connected = wsClient?.isConnected() ?? false;
    const wsState = wsClient?.getState() ?? "disconnected";
    const toolCount = services?.registry.getAllTools().length ?? 0;

    // Check voice modality health from published state
    const ideState = (services?.statePublisher.getState() ?? {}) as Record<string, unknown>;
    const voiceState = ideState["accordo-voice"] as Record<string, unknown> | undefined;
    const voiceToolsPresent = (services?.registry.getAllTools() ?? []).some(
      (t) => t.name.startsWith("accordo_voice_"),
    );
    const voiceDegraded =
      voiceToolsPresent &&
      voiceState !== undefined &&
      (voiceState["ttsAvailable"] === false || voiceState["sttAvailable"] === false);

    if (connected && toolCount > 0 && !voiceDegraded) {
      statusBarItem.text = "$(check) Accordo";
    } else if (wsState === "connecting" || wsState === "reconnecting") {
      statusBarItem.text = "$(warning) Accordo";
    } else if (connected && (toolCount === 0 || voiceDegraded)) {
      statusBarItem.text = "$(warning) Accordo";
    } else {
      statusBarItem.text = "$(error) Accordo";
    }
  };
}
