/**
 * Bridge Hub Lifecycle Manager
 *
 * Manages Hub process lifecycle from the VSCode extension side:
 * - Read/persist secrets via SecretStorage
 * - Health-check existing Hub instances
 * - Spawn/kill Hub child process
 * - Handle restart (soft reauth + hard fallback)
 * - Handle unexpected Hub exit with single retry
 *
 * Delegates process management to HubProcess and HTTP health/reauth to HubHealth.
 *
 * Requirements: requirements-bridge.md §4 (LCM-01 to LCM-12)
 */

import * as fs from "node:fs";
import { HubProcess } from "./hub-process.js";
import type { HubProcessSharedState } from "./hub-process.js";
import { HubHealth } from "./hub-health.js";
import type { HubHealthSharedState } from "./hub-health.js";
import {
  scopedSecretKey,
  BRIDGE_SECRET_KEY,
  HUB_TOKEN_KEY,
} from "./project-identity.js";
import {
  probeRegistryEntry,
  resolveRegistryPath,
  ACCORDO_REGISTRY_PATH,
} from "./hub-registry.js";

// Re-export types from hub-process.ts for backwards compatibility
export type { ChildProcess } from "node:child_process";
export { HubProcess } from "./hub-process.js";
export { HubHealth } from "./hub-health.js";
export type { HubProcessEvents, HubProcessSharedState, SpawnArgs } from "./hub-process.js";
export type { HubHealthEvents, HubHealthSharedState } from "./hub-health.js";

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

// ── HubManager ────────────────────────────────────────────────────────────────

/**
 * HubManager — manages the Hub process lifecycle from the Bridge side.
 *
 * Delegates to HubProcess (child_process) and HubHealth (HTTP) internally.
 *
 * LCM-01: Reads secrets from SecretStorage on activate.
 * LCM-02: Health-checks existing Hub via GET /health.
 * LCM-03: Reuses running Hub if secret is valid.
 * LCM-04: If WS 4001 (secret mismatch), kills + respawns Hub.
 * LCM-05: Uses execFile (no shell). Node path from config or process.execPath.
 * LCM-06: Spawn env includes ACCORDO_BRIDGE_SECRET, ACCORDO_TOKEN, ACCORDO_HUB_PORT.
 * LCM-07: Polls /health at 500ms intervals, max 10s.
 * LCM-08: Shows error on timeout with Retry/Show Log actions.
 * LCM-09: Streams Hub stdout/stderr to OutputChannel.
 * LCM-10: On unexpected exit, attempts single restart.
 * LCM-11: On deactivate, closes WS but does NOT kill Hub.
 * LCM-12: Restart command: soft reauth first, hard kill+respawn as fallback.
 */
export class HubManager {
  private hubProcess: HubProcess;
  private hubHealth: HubHealth;
  private processState: HubProcessSharedState = {
    hubProcess: null,
    secret: null,
    token: null,
    restartAttempted: false,
    killRequested: false,
  };
  private healthState: HubHealthSharedState = { port: 0 };
  private port: number;
  private restartInProgress = false;
  private deactivated = false;
  private pollCancelled = false;

  constructor(
    private secretStorage: SecretStorage,
    private outputChannel: OutputChannel,
    private config: HubManagerConfig,
    private events: HubManagerEvents,
  ) {
    this.port = config.port;
    this.healthState.port = this.port;

    // HubProcess no longer writes per-project PID files — the Hub writes to
    // the registry (hubs.json) directly. pidFilePath is no longer needed.
    this.hubProcess = new HubProcess(
      {
        executablePath: config.executablePath,
        hubEntryPoint: config.hubEntryPoint,
      },
      outputChannel,
      { onUnexpectedExit: (code): void => { this._onProcessExit(code); } },
      this.processState,
    );

    this.hubHealth = new HubHealth(outputChannel, this.healthState);
  }

  /**
   * LCM-01 + LCM-02 + LCM-03: Activate the Hub manager.
   *
   * Reconnect-first logic (adr-reload-reconnect.md §D2):
   * - If no stored token → first launch: generateHubCredentials() then spawn
   * - If stored token exists → probeExistingHub():
   *   - alive → emit onHubReady(port, token, isReconnect=true) and return early
   *   - dead  → fall through to spawn with stored credentials
   */
  async activate(): Promise<void> {
    const bridgeSecretKey = scopedSecretKey(BRIDGE_SECRET_KEY, this.config.projectId);
    const hubTokenKey = scopedSecretKey(HUB_TOKEN_KEY, this.config.projectId);

    const storedSecret = await this.secretStorage.get(bridgeSecretKey);
    const storedToken = await this.secretStorage.get(hubTokenKey);

    if (!storedToken || !storedSecret) {
      // First launch: generate fresh credentials, store them, then spawn below.
      const creds = await this.generateHubCredentials();
      await this.secretStorage.store(bridgeSecretKey, creds.secret);
      await this.secretStorage.store(hubTokenKey, creds.token);
      if (this.config.autoStart) {
        await this._spawnHub(creds.secret, creds.token);
      }
      return;
    }

    // Credentials exist — apply to processState
    this.processState.secret = storedSecret;
    this.processState.token = storedToken;

    // Reconnect-first: check registry for an existing Hub for this project
    if (this.config.autoStart) {
      const probe = await this.probeExistingHub();
      if (probe.alive) {
        this.port = probe.port;
        this.healthState.port = probe.port;
        this.events.onHubReady(probe.port, storedToken, true);
        return;
      }
    }

    if (!this.config.autoStart) {
      return;
    }

    // Hub is dead or not in registry — spawn a fresh one with existing credentials
    await this._spawnHub(storedSecret, storedToken);
  }

  /**
   * LCM-11: Graceful deactivation. Kill Hub so no orphan processes are left
   * when the VS Code window or extension host closes.
   */
  async deactivate(): Promise<void> {
    this.deactivated = true;
    this.pollCancelled = true;
    await this.killHub();
  }

  /**
   * LCM-11-R: Soft disconnect for reload survival.
   *
   * Sends POST /bridge/disconnect to the Hub (starting the grace timer),
   * then returns. Does NOT kill the Hub process. The Hub will self-terminate
   * after the grace window (default 10s) if no Bridge reconnects.
   *
   * Called by `cleanupExtension()` during deactivation.
   *
   * Flow:
   * 1. Send POST /bridge/disconnect with bridge secret auth
   * 2. If the request fails (Hub already dead, network error), log and return
   * 3. Hub starts grace timer — if Bridge reconnects within window, timer cancels
   *
   * Requirements: adr-reload-reconnect.md §D1
   *
   * @returns true if the disconnect request was acknowledged by the Hub
   */
  async softDisconnect(): Promise<boolean> {
    try {
      const result = await this.hubHealth.sendDisconnect(this.processState.secret ?? "");
      this.outputChannel.appendLine(
        `[accordo-bridge] softDisconnect: Hub acknowledged=${result}`,
      );
      return result;
    } catch {
      this.outputChannel.appendLine(
        "[accordo-bridge] softDisconnect: Hub unreachable, skipping",
      );
      return false;
    }
  }

  /**
   * LCM-01-R: Probe an existing Hub for reconnection via registry.
   *
   * Checks the hubs.json registry for a live entry for this projectId,
   * validates the PID is alive, then performs an HTTP health check.
   *
   * Flow:
   * 1. Read entry from registry for this projectId
   * 2. Validate PID is alive (removes stale entry if dead)
   * 3. Send GET /health to the registered port
   * 4. If health response is 200 → return { alive: true, port }
   * 5. Otherwise return { alive: false }
   *
   * @returns Probe result with alive status and discovered port
   */
  async probeExistingHub(): Promise<{ alive: boolean; port: number }> {
    const registryPath = this.config.registryPath ?? resolveRegistryPath();

    // Step 1: Read registry entry + validate PID liveness (removes stale entry if dead)
    const entry = probeRegistryEntry(registryPath, this.config.projectId);
    if (!entry) {
      return { alive: false, port: 0 };
    }

    // Step 2: Health check at the registered port
    this.port = entry.port;
    this.healthState.port = entry.port;

    const healthy = await this.checkHealth();
    if (!healthy) {
      return { alive: false, port: 0 };
    }

    return { alive: true, port: entry.port };
  }

  /**
   * AR-08: Generate new Hub credentials (bridgeSecret + hubToken), store them
   * in SecretStorage, and apply them to processState.
   *
   * Called by activate() on first launch (no stored token) and after a forced
   * respawn that requires fresh credentials.
   */
  async generateHubCredentials(): Promise<{ secret: string; token: string }> {
    const secret = crypto.randomUUID();
    const token = crypto.randomUUID();
    this.processState.secret = secret;
    this.processState.token = token;
    return { secret, token };
  }

  /**
   * LCM-12: Restart Hub — soft reauth first, hard fallback if needed.
   */
  async restart(): Promise<void> {
    if (this.restartInProgress) {
      return;
    }
    this.restartInProgress = true;
    try {
      await this._doRestart();
    } finally {
      this.restartInProgress = false;
    }
  }

  /**
   * LCM-02: Check if Hub is alive via GET /health.
   */
  async checkHealth(): Promise<boolean> {
    return this.hubHealth.checkHealth();
  }

  /**
   * LCM-05 + LCM-06: Spawn Hub as a child process with registry args.
   * Passes --project-id and --registry so the Hub can write its own entry.
   */
  async spawn(secret: string, token: string): Promise<void> {
    const registryPath = this.config.registryPath ?? resolveRegistryPath();
    return this.hubProcess.spawn(secret, token, this.port, {
      projectId: this.config.projectId,
      registryPath,
    });
  }

  /**
   * LCM-07: Poll /health until Hub responds or timeout.
   */
  async pollHealth(maxWaitMs = 10000, intervalMs = 500): Promise<boolean> {
    this.pollCancelled = false;
    const deadline = Date.now() + maxWaitMs;
    return new Promise((resolve) => {
      const attempt = (): void => {
        if (this.pollCancelled || Date.now() >= deadline) {
          resolve(false);
          return;
        }
        this.checkHealth()
          .then((healthy) => {
            if (this.pollCancelled) { resolve(false); return; }
            if (healthy) {
              resolve(true);
            } else if (Date.now() < deadline) {
              setTimeout(attempt, intervalMs);
            } else {
              resolve(false);
            }
          })
          .catch(() => {
            if (this.pollCancelled) { resolve(false); return; }
            if (Date.now() < deadline) {
              setTimeout(attempt, intervalMs);
            } else {
              resolve(false);
            }
          });
      };
      setTimeout(attempt, intervalMs);
    });
  }

  /**
   * Kill the Hub process if running.
   */
  async killHub(): Promise<void> {
    return this.hubProcess.killHub();
  }

  /**
   * LCM-12: Attempt soft credential rotation via POST /bridge/reauth.
   */
  async attemptReauth(currentSecret: string, newSecret: string, newToken: string): Promise<boolean> {
    return this.hubHealth.attemptReauth(currentSecret, newSecret, newToken);
  }

  /**
   * Get the current Hub port.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the current bearer token (if available).
   */
  getToken(): string | null {
    return this.processState.token;
  }

  /**
   * Get the current bridge secret (if available).
   */
  getSecret(): string | null {
    return this.processState.secret;
  }

  /**
   * Check if Hub process is currently running.
   */
  isHubRunning(): boolean {
    return this.processState.hubProcess !== null;
  }

  /**
   * LCM-08: Read the PID from the Hub PID file.
   */
  readPidFile(pidFilePath: string): number | null {
    return this.hubProcess.readPidFile(pidFilePath);
  }

  /**
   * §8 stale-PID detection.
   */
  isProcessAlive(pid: number): boolean {
    return this.hubProcess.isProcessAlive(pid);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _doRestart(): Promise<void> {
    const bridgeSecretKey = scopedSecretKey(BRIDGE_SECRET_KEY, this.config.projectId);
    const hubTokenKey = scopedSecretKey(HUB_TOKEN_KEY, this.config.projectId);
    const newSecret = crypto.randomUUID();
    const newToken = crypto.randomUUID();
    const reauthOk = await this.attemptReauth(
      this.processState.secret ?? "",
      newSecret,
      newToken,
    );
    if (reauthOk) {
      this.processState.secret = newSecret;
      this.processState.token = newToken;
      await this.secretStorage.store(bridgeSecretKey, newSecret);
      await this.secretStorage.store(hubTokenKey, newToken);
      this.events.onCredentialsRotated(newToken, newSecret);
      return;
    }
    await this.killHub();
    await this.spawn(newSecret, newToken);
    this._pollAndNotify()
      .then(() => {
        this.processState.secret = newSecret;
        this.processState.token = newToken;
        void this.secretStorage.store(bridgeSecretKey, newSecret);
        void this.secretStorage.store(hubTokenKey, newToken);
        this.events.onCredentialsRotated(newToken, newSecret);
      })
      .catch(() => {});
  }

  private async _pollAndNotify(): Promise<void> {
    const ready = await this.pollHealth();
    if (ready) {
      // Re-read the registry after health check succeeds — the Hub may have
      // selected a different port than the preferred one (free-port logic).
      // The registry always has the authoritative port.
      const registryPath = this.config.registryPath ?? resolveRegistryPath();
      const entry = probeRegistryEntry(registryPath, this.config.projectId);
      if (entry) {
        this.port = entry.port;
        this.healthState.port = entry.port;
      }
      this.events.onHubReady(this.port, this.processState.token!);
    }
  }

  /**
   * Spawn a new Hub and wait for it to become healthy.
   * Used both on first launch and when reconnecting to a dead Hub.
   */
  private async _spawnHub(secret: string, token: string): Promise<void> {
    this.hubProcess
      .spawn(secret, token, this.port, {
        projectId: this.config.projectId,
        registryPath: this.config.registryPath ?? resolveRegistryPath(),
      })
      .then(() => this._pollAndNotify())
      .catch((err: unknown) => {
        this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  private _onProcessExit(code: number | null): void {
    if (this.deactivated) return;
    if (!this.processState.killRequested) {
      this.processState.hubProcess = null;
      if (!this.processState.restartAttempted) {
        this.processState.restartAttempted = true;
        this.restart().catch((err: unknown) => {
          this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
        });
      }
    }
  }

}
