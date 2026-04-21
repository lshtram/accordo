/**
 * Hub activation logic extracted from HubManager.
 *
 * Responsibilities:
 * - First launch: generate + store credentials then spawn
 * - Reconnect: probe registry for existing Hub, emit onHubReady if alive
 * - Respawn: spawn with stored credentials
 *
 * Extracted per coding-guidelines.md §3.1 for modularity.
 */

import type { HubManagerConfig, HubManagerEvents, SecretStorage } from "./hub-manager-state.js";
import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health.js";
import { scopedSecretKey, BRIDGE_SECRET_KEY, HUB_TOKEN_KEY } from "./project-identity.js";
import { probeRegistryEntry, resolveRegistryPath } from "./hub-registry.js";

export interface HubManagerAgent {
  readonly config: HubManagerConfig;
  readonly secretStorage: SecretStorage;
  readonly processState: HubProcessSharedState;
  readonly healthState: HubHealthSharedState;
  readonly events: HubManagerEvents;
  /** Get the current preferred port. */
  getPort(): number;
  /** Update the preferred port (e.g., after discovering Hub at a different port). */
  setPort(port: number): void;
  generateHubCredentials(): Promise<{ secret: string; token: string }>;
  probeExistingHub(): Promise<{ alive: boolean; port: number }>;
  checkHealth(): Promise<boolean>;
  spawnAndWait(secret: string, token: string): Promise<void>;
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
export async function activateHub(manager: HubManagerAgent): Promise<void> {
  const bridgeSecretKey = scopedSecretKey(BRIDGE_SECRET_KEY, manager.config.projectId);
  const hubTokenKey = scopedSecretKey(HUB_TOKEN_KEY, manager.config.projectId);

  const storedSecret = await manager.secretStorage.get(bridgeSecretKey);
  const storedToken = await manager.secretStorage.get(hubTokenKey);

  if (!storedToken || !storedSecret) {
    await activateFirstLaunch(manager, bridgeSecretKey, hubTokenKey);
    return;
  }

  // Credentials exist — apply to processState
  manager.processState.secret = storedSecret;
  manager.processState.token = storedToken;

  // Reconnect-first: check registry for an existing Hub for this project
  if (!manager.config.autoStart) {
    return;
  }

  const probe = await manager.probeExistingHub();
  if (probe.alive) {
    manager.setPort(probe.port);
    manager.healthState.port = probe.port;
    manager.events.onHubReady(probe.port, storedToken, true);
    return;
  }

  // Hub is dead or not in registry — spawn with existing credentials
  await manager.spawnAndWait(storedSecret, storedToken);
}

/**
 * First launch: generate fresh credentials, store them, then spawn.
 */
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

/**
 * AR-08: Generate new Hub credentials (bridgeSecret + hubToken), store them
 * in SecretStorage, and apply them to processState.
 */
export async function generateHubCredentials(
  manager: HubManagerAgent,
): Promise<{ secret: string; token: string }> {
  const secret = crypto.randomUUID();
  const token = crypto.randomUUID();
  manager.processState.secret = secret;
  manager.processState.token = token;
  return { secret, token };
}

/**
 * LCM-01-R: Probe an existing Hub for reconnection via registry.
 *
 * Checks the hubs.json registry for a live entry for this projectId,
 * validates the PID is alive, then performs an HTTP health check.
 *
 * @returns Probe result with alive status and discovered port
 */
export async function probeExistingHub(
  manager: HubManagerAgent,
): Promise<{ alive: boolean; port: number }> {
  const registryPath = manager.config.registryPath ?? resolveRegistryPath();

  // Step 1: Read registry entry + validate PID liveness (removes stale entry if dead)
  const entry = probeRegistryEntry(registryPath, manager.config.projectId);
  if (!entry) {
    return { alive: false, port: 0 };
  }

  // Step 2: Health check at the registered port
  manager.healthState.port = entry.port;

  const healthy = await manager.checkHealth();
  if (!healthy) {
    return { alive: false, port: 0 };
  }

  // Step 3: Update the manager's port so subsequent spawn calls use the correct port
  manager.healthState.port = entry.port;

  return { alive: true, port: entry.port };
}
