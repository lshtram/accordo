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
 * Requirements: requirements-bridge.md §4 (LCM-01 to LCM-12)
 */

import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
   * Absolute path to the Hub PID file for stale-PID detection on activation.
   * Default: ~/.accordo/hub.pid. Override in tests to avoid touching the filesystem.
   * requirements-hub.md §8
   */
  pidFilePath?: string;
}

/**
 * Events emitted by HubManager for the rest of the Bridge to observe.
 */
export interface HubManagerEvents {
  /** Fired when Hub process is confirmed ready (health check OK) */
  onHubReady: (port: number, token: string) => void;
  /** Fired when Hub process stops unexpectedly or cannot be started */
  onHubError: (error: Error) => void;
  /** Fired when credentials are rotated (reauth or respawn) */
  onCredentialsRotated: (token: string, secret: string) => void;
}

/**
 * HubManager — manages the Hub process lifecycle from the Bridge side.
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
  private hubProcess: ChildProcess | null = null;
  private token: string | null = null;
  private secret: string | null = null;
  private port: number;
  private restartAttempted = false;
  private killRequested = false;
  /** Guards against concurrent restart() calls (e.g. exit handler + onAuthFailure racing). */
  private restartInProgress = false;

  constructor(
    private secretStorage: SecretStorage,
    private outputChannel: OutputChannel,
    private config: HubManagerConfig,
    private events: HubManagerEvents,
  ) {
    this.port = config.port;
  }

  /**
   * LCM-01 + LCM-02 + LCM-03: Activate the Hub manager.
   * Reads stored credentials, generating and persisting them if absent (first
   * launch). Bridge owns the credentials — Hub accepts whatever it receives
   * at spawn time via env vars. Checks for an existing Hub and connects to it
   * if healthy, otherwise spawns a new one.
   *
   * @returns Promise that resolves when Hub is ready or activation fails
   */
  async activate(): Promise<void> {
    let secret = await this.secretStorage.get("accordo.bridgeSecret");
    let token = await this.secretStorage.get("accordo.hubToken");

    // First launch: generate fresh UUID credentials and persist them so that
    // every restart reconnects to the same Hub without credential churn.
    if (!secret) {
      secret = crypto.randomUUID();
      await this.secretStorage.store("accordo.bridgeSecret", secret);
    }
    if (!token) {
      token = crypto.randomUUID();
      await this.secretStorage.store("accordo.hubToken", token);
    }

    this.secret = secret;
    this.token = token;

    // M29: stale-PID detection — skip health check if PID file says Hub is dead
    if (this.config.pidFilePath) {
      const pid = this.readPidFile(this.config.pidFilePath);
      if (pid !== null && !this.isProcessAlive(pid)) {
        // Hub process is definitely gone — skip health check, spawn directly
        if (this.config.autoStart) {
          this.spawn(this.secret, this.token)
            .then(() => this.pollHealth())
            .then((ready) => {
              if (ready) this.events.onHubReady(this.port, this.token!);
            })
            .catch((err: unknown) => {
              this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
            });
        }
        return;
      }
    }

    const healthy = await this.checkHealth();
    if (healthy) {
      // Hub already running (e.g. persisted from a previous VS Code session).
      // Connect with stored credentials; WS auth failure will trigger rotation.
      this.events.onHubReady(this.port, this.token);
      return;
    }

    if (!this.config.autoStart) {
      return;
    }

    // Fire-and-forget: spawn Hub then poll until ready
    this.spawn(this.secret, this.token)
      .then(() => this.pollHealth())
      .then((ready) => {
        if (ready) {
          this.events.onHubReady(this.port, this.token!);
        }
      })
      .catch((err: unknown) => {
        this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  /**
   * LCM-11: Graceful deactivation. Close WS but do NOT kill Hub.
   */
  async deactivate(): Promise<void> {
    // LCM-11: do NOT kill the Hub process — it stays alive for CLI agents
    return;
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

  private async _doRestart(): Promise<void> {
    const newSecret = crypto.randomUUID();
    const newToken = crypto.randomUUID();
    const reauthOk = await this.attemptReauth(this.secret ?? "", newSecret, newToken);
    if (reauthOk) {
      this.secret = newSecret;
      this.token = newToken;
      // M30-bridge: persist rotated credentials so they survive VS Code restarts
      await this.secretStorage.store("accordo.bridgeSecret", newSecret);
      await this.secretStorage.store("accordo.hubToken", newToken);
      this.events.onCredentialsRotated(newToken, newSecret);
      return;
    }
    // Hard fallback: kill + respawn
    await this.killHub();
    await this.spawn(newSecret, newToken);
    // Fire-and-forget poll so restart() resolves promptly
    this.pollHealth()
      .then((ready) => {
        if (ready) {
          this.secret = newSecret;
          this.token = newToken;
          // M30-bridge: persist after hard restart too
          void this.secretStorage.store("accordo.bridgeSecret", newSecret);
          void this.secretStorage.store("accordo.hubToken", newToken);
          this.events.onCredentialsRotated(newToken, newSecret);
        }
      })
      .catch(() => {});
  }

  /**
   * LCM-02: Check if Hub is alive via GET /health.
   *
   * @returns true if Hub responds to health check within 2s
   */
  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port: this.port, path: "/health", timeout: 2000 },
        (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * LCM-05 + LCM-06: Spawn Hub as a child process.
   *
   * @param secret - Bridge secret to pass in env
   * @param token - Bearer token to pass in env
   */
  async spawn(secret: string, token: string): Promise<void> {
    this.secret = secret;
    this.token = token;
    this.restartAttempted = false;
    this.killRequested = false;

    const execPath = this.config.executablePath || process.execPath;
    const proc = execFile(
      execPath,
      [this.config.hubEntryPoint, "--port", String(this.port)],
      {
        env: {
          ...process.env,
          ACCORDO_BRIDGE_SECRET: secret,
          ACCORDO_TOKEN: token,
          ACCORDO_HUB_PORT: String(this.port),
        },
      },
    );
    this.hubProcess = proc;

    // M29: write PID from the parent as soon as the child is forked — this
    // ensures hub.pid is present before pollHealth() completes even if the
    // Hub process hasn't flushed its own write yet.
    if (this.config.pidFilePath && proc.pid !== undefined) {
      try {
        fs.mkdirSync(path.dirname(this.config.pidFilePath), { recursive: true });
        fs.writeFileSync(this.config.pidFilePath, String(proc.pid), { mode: 0o600 });
      } catch { /* ignore — hub writes its own PID; this is best-effort */ }
    }

    proc.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(data.toString());
    });
    proc.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(data.toString());
    });

    proc.on("exit", (code: number | null) => {
      // M29: clean up PID file when the Hub process exits so stale-PID
      // detection works correctly on the next activation.
      if (this.config.pidFilePath) {
        try { fs.unlinkSync(this.config.pidFilePath); } catch { /* already gone */ }
      }
      if (!this.killRequested) {
        this.hubProcess = null;
        if (!this.restartAttempted) {
          this.restartAttempted = true;
          this.restart().catch((err: unknown) => {
            this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
          });
        }
      }
    });
  }

  /**
   * LCM-07: Poll /health until Hub responds or timeout.
   *
   * @param maxWaitMs - Maximum wait time (default: 10000)
   * @param intervalMs - Poll interval (default: 500)
   * @returns true if Hub became healthy, false on timeout
   */
  async pollHealth(maxWaitMs = 10000, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    return new Promise((resolve) => {
      const attempt = () => {
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        this.checkHealth()
          .then((healthy) => {
            if (healthy) {
              resolve(true);
            } else if (Date.now() < deadline) {
              setTimeout(attempt, intervalMs);
            } else {
              resolve(false);
            }
          })
          .catch(() => {
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
    if (this.hubProcess === null) {
      return;
    }
    this.killRequested = true;
    const proc = this.hubProcess;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.kill();
    });
    this.hubProcess = null;
    this.killRequested = false;
  }

  /**
   * LCM-12: Attempt soft credential rotation via POST /bridge/reauth.
   *
   * @param currentSecret - Current bridge secret for auth
   * @param newSecret - New bridge secret
   * @param newToken - New bearer token
   * @returns true if reauth succeeded (200 response)
   */
  async attemptReauth(
    currentSecret: string,
    newSecret: string,
    newToken: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ newToken, newSecret });
      const options: http.RequestOptions = {
        host: "127.0.0.1",
        port: this.port,
        path: "/bridge/reauth",
        method: "POST",
        headers: {
          "x-accordo-secret": currentSecret,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on("error", () => resolve(false));
      req.write(body);
      req.end();
    });
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
    return this.token;
  }

  /**
   * Get the current bridge secret (if available).
   */
  getSecret(): string | null {
    return this.secret;
  }

  /**
   * Check if Hub process is currently running.
   */
  isHubRunning(): boolean {
    return this.hubProcess !== null && this.hubProcess.exitCode === null;
  }

  /**
   * LCM-08 / requirements-hub.md §8: Read the PID from the Hub PID file.
   * Returns null if the file does not exist or contains an invalid integer.
   *
   * @param pidFilePath - Absolute path to the hub.pid file
   * @returns Process ID number, or null if absent/unreadable
   */
  readPidFile(pidFilePath: string): number | null {
    try {
      const contents = fs.readFileSync(pidFilePath, "utf8").trim();
      const pid = parseInt(contents, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  /**
   * requirements-hub.md §8 stale-PID detection: send signal 0 to check if
   * a process with the given PID is alive.
   *
   * @param pid - Process ID to check
   * @returns true if the process exists, false if it does not (ESRCH)
   */
  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
