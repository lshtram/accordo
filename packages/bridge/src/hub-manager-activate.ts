/**
 * Hub activation logic extracted from HubManager.
 *
 * Responsibilities:
 * - First launch: generate + store credentials then spawn
 * - Reconnect: consume structured rebind probe reports, reuse only reusable outcomes
 * - Respawn: spawn with stored credentials
 */
import * as crypto from "node:crypto";
import type { HubManagerConfig, HubManagerEvents, SecretStorage } from "./hub-manager-state.js";
import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health-types.js";
import type { HubRebindDiagnosticSink, HubRebindProbeReport } from "./hub-rebind-types.js";
import type { HealthResponse } from "@accordo/bridge-types";
import { probeHubRebind } from "./hub-rebind-probe.js";
import { scopedSecretKey, BRIDGE_SECRET_KEY, HUB_TOKEN_KEY } from "./project-identity.js";
import { probeRegistryEntry, resolveRegistryPath } from "./hub-registry.js";

export interface HubManagerAgent {
  readonly config: HubManagerConfig;
  readonly secretStorage: SecretStorage;
  readonly processState: HubProcessSharedState;
  readonly healthState: HubHealthSharedState;
  readonly events: HubManagerEvents;
  /** Optional diagnostic sink for rebind probe records (LCM-16). */
  readonly diagnosticSink?: HubRebindDiagnosticSink;
  getPort(): number;
  setPort(port: number): void;
  generateHubCredentials(): Promise<{ secret: string; token: string }>;
  probeExistingHub(): Promise<HubRebindProbeReport>;
  readHealth(port: number): Promise<HealthResponse | null>;
  checkHealth(): Promise<boolean>;
  spawnAndWait(secret: string, token: string): Promise<void>;
}

/** LCM-01 + LCM-02 + LCM-03: main activation entry point. */
export async function activateHub(manager: HubManagerAgent): Promise<void> {
  const bridgeSecretKey = scopedSecretKey(BRIDGE_SECRET_KEY, manager.config.projectId);
  const hubTokenKey = scopedSecretKey(HUB_TOKEN_KEY, manager.config.projectId);

  const storedSecret = await manager.secretStorage.get(bridgeSecretKey);
  const storedToken = await manager.secretStorage.get(hubTokenKey);

  if (!storedToken || !storedSecret) {
    await activateFirstLaunch(manager, bridgeSecretKey, hubTokenKey);
    return;
  }

  manager.processState.secret = storedSecret;
  manager.processState.token = storedToken;

  if (!manager.config.autoStart) return;

  const probe = await manager.probeExistingHub();
  if (probe.outcome === "bridge-connected" || probe.outcome === "registry-loaded") {
    await activateReusable(manager, probe);
  } else {
    await manager.spawnAndWait(storedSecret, storedToken);
  }
}

/** Reusable outcome: adopt the existing Hub (reconnect path). */
async function activateReusable(
  manager: HubManagerAgent,
  probe: HubRebindProbeReport,
): Promise<void> {
  const port = probe.port ?? manager.getPort();
  manager.setPort(port);
  manager.healthState.port = port;
  // token is guaranteed non-null here: activateHub sets processState.token from
  // storedToken (string) before calling this branch; null would mean secret storage
  // returned undefined for a token that was previously stored.
  manager.events.onHubReady(port, manager.processState.token!, true);
}

/** First launch: no stored credentials — generate, store, and spawn. */
async function activateFirstLaunch(
  manager: HubManagerAgent,
  bridgeSecretKey: string,
  hubTokenKey: string,
): Promise<void> {
  const creds = await manager.generateHubCredentials();
  await manager.secretStorage.store(bridgeSecretKey, creds.secret);
  await manager.secretStorage.store(hubTokenKey, creds.token);
  if (manager.config.autoStart) {
    await manager.spawnAndWait(creds.secret, creds.token);
  }
}

/** AR-08: Generate new Hub credentials, store them, apply to processState. */
export async function generateHubCredentials(
  manager: HubManagerAgent,
): Promise<{ secret: string; token: string }> {
  const secret = crypto.randomUUID();
  const token = crypto.randomUUID();
  manager.processState.secret = secret;
  manager.processState.token = token;
  return { secret, token };
}

/** LCM-13..16: Probe an existing Hub for reconnection. */
export async function probeExistingHub(
  manager: HubManagerAgent,
): Promise<HubRebindProbeReport> {
  const registryPath = manager.config.registryPath ?? resolveRegistryPath();
  return probeHubRebind(
    {
      registryReader: { probeEntry: (rp, pid) => probeRegistryEntry(rp, pid) },
      healthReader: { readHealth: (port) => manager.readHealth(port) },
      diagnosticSink: manager.diagnosticSink,
    },
    registryPath,
    manager.config.projectId,
  );
}
