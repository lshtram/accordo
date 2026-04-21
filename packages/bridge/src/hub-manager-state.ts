/**
 * HubManager shared types and state interfaces.
 *
 * All types that are shared between HubManager and its sub-modules live here
 * to avoid circular imports (coding-guidelines.md §3.1).
 *
 * Re-exports from hub-process.ts and hub-health.ts for backwards compatibility.
 */

import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health.js";

// Re-export from upstream modules
export type { HubProcessSharedState } from "./hub-process.js";
export type { HubHealthSharedState } from "./hub-health.js";

// ── Abstractions for testability (no direct vscode import) ──────────────────

/**
 * Secret storage abstraction matching the vscode.SecretStorage interface.
 * Injected for testability — the real implementation uses context.secrets.
 */
export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Output channel abstraction for Hub process logging.
 * Matches the essential subset of vscode.OutputChannel.
 */
export interface OutputChannel {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

/**
 * Configuration values read from VSCode settings.
 */
export interface HubManagerConfig {
  /** Hub HTTP port. Default: 3000 */
  port: number;
  /** Whether to auto-start Hub if not running. Default: true */
  autoStart: boolean;
  /** Path to Node.js executable for spawning Hub. Empty = process.execPath */
  executablePath: string;
  /** Filesystem path to the Hub entry point JS file */
  hubEntryPoint: string;
  /**
   * Stable per-workspace identifier used to scope reconnect state.
   * Passed from extension-bootstrap via BridgeConfig.projectId.
   * Used to derive project-scoped SecretStorage keys and registry entries.
   */
  projectId: string;
  /**
   * Absolute path to the hubs.json registry file.
   * Default: ~/.accordo/hubs.json. Override in tests.
   * The Hub also writes to this file on spawn.
   */
  registryPath?: string;
}

/**
 * Events emitted by HubManager for the rest of the Bridge to observe.
 */
export interface HubManagerEvents {
  /** Fired when Hub process is confirmed ready (health check OK) */
  onHubReady: (port: number, token: string, isReconnect?: boolean) => void;
  /** Fired when Hub process stops unexpectedly or cannot be started */
  onHubError: (error: Error) => void;
  /** Fired when credentials are rotated (reauth or respawn) */
  onCredentialsRotated: (token: string, secret: string) => void;
}
