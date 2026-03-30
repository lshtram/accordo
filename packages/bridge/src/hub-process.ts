/**
 * Hub Process Lifecycle — child_process spawn, kill, PID file management
 *
 * Pure process-management responsibilities:
 * - execFile spawn with correct env vars (LCM-05, LCM-06)
 * - PID file write on spawn + cleanup on exit (M29)
 * - Hub stdout/stderr streaming to OutputChannel (LCM-09)
 * - Exit handler callback for HubManager
 *
 * Requirements: requirements-bridge.md §4 (LCM-05, LCM-06, LCM-09, LCM-10)
 */

import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Re-exported types used by hub-manager.ts
export type { ChildProcess };

/**
 * Output channel abstraction for Hub process logging.
 * Matches the essential subset of vscode.OutputChannel.
 */
export interface OutputChannel {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

/**
 * Events emitted by the process layer for HubManager to handle.
 */
export interface HubProcessEvents {
  /** Fired when the Hub process exits unexpectedly (not due to killHub). */
  onUnexpectedExit(code: number | null): void;
}

/**
 * Shared mutable state between HubProcess and HubManager.
 * Passed in to avoid circular HubManager ↔ HubProcess dependencies.
 */
export interface HubProcessSharedState {
  hubProcess: ChildProcess | null;
  secret: string | null;
  token: string | null;
  restartAttempted: boolean;
  killRequested: boolean;
}

/**
 * Build the spawn() arguments object.
 * Exposed for testing.
 */
export interface SpawnArgs {
  secret: string;
  token: string;
  port: number;
}

/**
 * Resolve the Node.js executable used to spawn accordo-hub.
 *
 * In VS Code extension host, process.execPath points to Electron ("code"),
 * not a plain Node binary. Spawning Hub with Electron can fail to start the
 * server loop (process appears alive, high CPU, no listening port).
 *
 * Resolution strategy:
 * 1) Respect explicit user config (`accordo.hub.executablePath`)
 * 2) In extension-host/Electron contexts, prefer a real system `node`
 * 3) Fallback to process.execPath
 */
export function resolveHubExecPath(configuredPath: string): string {
  if (configuredPath) {
    return configuredPath;
  }

  const procType = process.env["VSCODE_CRASH_REPORTER_PROCESS_TYPE"];
  const execBase = path.basename(process.execPath).toLowerCase();
  const looksLikeCodeBinary =
    execBase === "code"
    || execBase === "code-insiders"
    || execBase.startsWith("code-");
  const likelyElectronContext = Boolean(process.versions.electron) || procType === "extensionHost" || looksLikeCodeBinary;

  if (!likelyElectronContext) {
    return process.execPath;
  }

  const fromPath = findSystemNode();
  if (fromPath !== null) {
    return fromPath;
  }

  return process.execPath;
}

function findSystemNode(): string | null {
  try {
    const result = execFileSync("which", ["node"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch { /* not found or timed out */ }

  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(os.homedir(), ".nvm/current/bin/node"),
    path.join(os.homedir(), ".local/share/fnm/aliases/default/bin/node"),
    path.join(os.homedir(), ".volta/bin/node"),
    "/usr/bin/node",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return null;
}

/**
 * Create a HubProcess that manages the child process lifecycle.
 *
 * @param config   - Hub manager configuration (subset needed for process management)
 * @param outputChannel - Output channel for Hub stdout/stderr
 * @param events   - Process lifecycle event callbacks
 * @param state    - Shared mutable state with HubManager
 */
export class HubProcess {
  constructor(
    private readonly config: {
      readonly executablePath: string;
      readonly hubEntryPoint: string;
      readonly pidFilePath?: string;
    },
    private readonly outputChannel: OutputChannel,
    private readonly events: HubProcessEvents,
    private readonly state: HubProcessSharedState,
  ) {}

  /**
   * LCM-05 + LCM-06: Spawn Hub as a child process.
   * Uses execFile (no shell). Node path from config or process.execPath.
   *
   * @param secret - Bridge secret to pass in env
   * @param token  - Bearer token to pass in env
   * @param port   - Hub HTTP port for --port argument and ACCORDO_HUB_PORT env var
   */
  async spawn(secret: string, token: string, port: number): Promise<void> {
    this.state.secret = secret;
    this.state.token = token;
    this.state.restartAttempted = false;
    this.state.killRequested = false;

    const execPath = resolveHubExecPath(this.config.executablePath);
    const proc = execFile(
      execPath,
      [this.config.hubEntryPoint, "--port", String(port)],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ACCORDO_BRIDGE_SECRET: secret,
          ACCORDO_TOKEN: token,
          ACCORDO_HUB_PORT: String(port),
        },
      },
    );
    this.state.hubProcess = proc;

    // M29: write PID from the parent as soon as the child is forked
    if (this.config.pidFilePath && proc.pid !== undefined) {
      try {
        fs.mkdirSync(path.dirname(this.config.pidFilePath), { recursive: true });
        fs.writeFileSync(this.config.pidFilePath, String(proc.pid), { mode: 0o600 });
      } catch { /* best-effort */ }
    }

    proc.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(data.toString());
    });
    proc.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(data.toString());
    });

    proc.on("exit", (code: number | null) => {
      // M29: clean up PID file when Hub process exits
      if (this.config.pidFilePath) {
        try { fs.unlinkSync(this.config.pidFilePath); } catch { /* already gone */ }
      }
      if (!this.state.killRequested) {
        this.state.hubProcess = null;
        this.events.onUnexpectedExit(code);
      }
    });
  }

  /**
   * Kill the Hub process if running.
   */
  async killHub(): Promise<void> {
    if (this.state.hubProcess === null) {
      return;
    }
    this.state.killRequested = true;
    const proc = this.state.hubProcess;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.kill();
    });
    this.state.hubProcess = null;
    this.state.killRequested = false;
  }

  /**
   * LCM-08 / requirements-hub.md §8: Read the PID from the Hub PID file.
   * Returns null if the file does not exist or contains an invalid integer.
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
