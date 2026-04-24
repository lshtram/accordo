/** Bridge Hub Lifecycle Manager — thin facade wiring hub-manager-activate, polling, spawn, lifecycle modules. */
export type { ChildProcess } from "node:child_process";
export { HubProcess } from "./hub-process.js";
export { HubHealth } from "./hub-health.js";
export type { HubProcessEvents, HubProcessSharedState, SpawnArgs } from "./hub-process.js";
export type { HubHealthEvents, HubHealthSharedState } from "./hub-health.js";
export type { SecretStorage, OutputChannel, HubManagerConfig, HubManagerEvents } from "./hub-manager-state.js";
import type { SecretStorage, OutputChannel, HubManagerConfig, HubManagerEvents } from "./hub-manager-state.js";
import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health.js";
import { HubProcess } from "./hub-process.js";
import { HubHealth } from "./hub-health.js";
import { activateHub, generateHubCredentials, probeExistingHub } from "./hub-manager-activate.js";
import { pollHealth } from "./hub-manager-polling.js";
import { spawnAndWaitHub } from "./hub-manager-spawn.js";
import { doRestart, makeRestartContext } from "./hub-manager-lifecycle.js";
import { resolveRegistryPath } from "./hub-registry.js";
// ── HubManager ───────────────────────────────────────────────────────────────
/** Thin facade: delegates to HubProcess (child_process) and HubHealth (HTTP). */
export class HubManager {
  private readonly hubProcess: HubProcess;
  private readonly hubHealth: HubHealth;
  readonly processState: HubProcessSharedState = {
    hubProcess: null, secret: null, token: null,
    restartAttempted: false, killRequested: false,
  };
  readonly healthState: HubHealthSharedState = { port: 0 };
  private port: number;
  private restartInProgress = false;
  private deactivated = false;
  private pollCancelled = { value: false };
  private regPath(): string { return this.config.registryPath ?? resolveRegistryPath(); }
  constructor(
    public secretStorage: SecretStorage,
    public outputChannel: OutputChannel,
    public config: HubManagerConfig,
    public events: HubManagerEvents,
  ) {
    this.port = config.port;
    this.healthState.port = this.port;
    this.hubProcess = new HubProcess(
      { executablePath: config.executablePath, hubEntryPoint: config.hubEntryPoint },
      outputChannel,
      { onUnexpectedExit: (code): void => { this._onProcessExit(code); } },
      this.processState,
    );
    this.hubHealth = new HubHealth(outputChannel, this.healthState);
  }
  // Public API
  async activate(): Promise<void> { return activateHub(this); }
  async deactivate(): Promise<void> { this.deactivated = true; this.pollCancelled.value = true; await this.killHub(); }
  async softDisconnect(): Promise<boolean> {
    try {
      const result = await this.hubHealth.sendDisconnect(this.processState.secret ?? "");
      this.outputChannel.appendLine(`[accordo-bridge] softDisconnect: Hub acknowledged=${result}`);
      return result;
    } catch {
      this.outputChannel.appendLine("[accordo-bridge] softDisconnect: Hub unreachable, skipping");
      return false;
    }
  }
  // Getters
  getPort(): number { return this.port; }
  setPort(port: number): void { this.port = port; }
  getToken(): string | null { return this.processState.token; }
  getSecret(): string | null { return this.processState.secret; }
  isHubRunning(): boolean { return this.processState.hubProcess !== null; }
  readPidFile(pid: string): number | null { return this.hubProcess.readPidFile(pid); }
  isProcessAlive(pid: number): boolean { return this.hubProcess.isProcessAlive(pid); }
  // Lifecycle methods
  async generateHubCredentials(): Promise<{ secret: string; token: string }> { return generateHubCredentials(this); }
  async probeExistingHub(): Promise<{ alive: boolean; port: number }> { return probeExistingHub(this); }
  async checkHealth(): Promise<boolean> { return this.hubHealth.checkHealth(); }
  async killHub(): Promise<void> { return this.hubProcess.killHub(); }
  async spawn(secret: string, token: string): Promise<void> {
    return this.hubProcess.spawn(secret, token, this.port, {
      projectId: this.config.projectId, registryPath: this.regPath(),
    });
  }
  async spawnAndWait(secret: string, token: string): Promise<void> {
    const rp = this.regPath();
    return spawnAndWaitHub(
      (s, t, p) => this.hubProcess.spawn(s, t, p, { projectId: this.config.projectId, registryPath: rp }),
      () => this.pollHealth(),
      { projectId: this.config.projectId, configRegistryPath: rp,
        events: this.events, processState: this.processState, healthState: this.healthState },
      secret, token, this.port,
    );
  }
  async attemptReauth(cS: string, nS: string, nT: string): Promise<boolean> { return this.hubHealth.attemptReauth(cS, nS, nT); }
  async pollHealth(maxWaitMs = 10000, intervalMs = 500): Promise<boolean> {
    return pollHealth(this.pollCancelled, maxWaitMs, intervalMs, () => this.checkHealth());
  }
  async restart(): Promise<void> { if (this.restartInProgress) return; this.restartInProgress = true; try { await this._doRestart(); } finally { this.restartInProgress = false; } }
  // Private helpers
  private async _doRestart(): Promise<void> {
    const rp = this.regPath();
    await doRestart(makeRestartContext({
      projectId: this.config.projectId, configRegistryPath: rp,
      secretStorage: this.secretStorage, processState: this.processState,
      healthState: this.healthState, events: this.events,
      killHub: () => this.killHub(),
      spawn: (s, t, p) => this.hubProcess.spawn(s, t, p, { projectId: this.config.projectId, registryPath: rp }),
      pollHealth: (m?, i?) => this.pollHealth(m, i),
      attemptReauth: (cS, nS, nT) => this.attemptReauth(cS, nS, nT),
    }));
  }
  private _onProcessExit(code: number | null): void {
    if (this.deactivated || this.processState.killRequested) return;
    this.processState.hubProcess = null;
    if (!this.processState.restartAttempted) {
      this.processState.restartAttempted = true;
      this.restart().catch((err: unknown) => {
        this.events.onHubError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  }
}
