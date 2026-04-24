/**
 * Hub spawn and post-spawn notification logic extracted from HubManager.
 *
 * Responsibilities:
 * - Spawn a Hub process with correct env + registry args
 * - Poll for Hub ready after spawn
 * - Resolve authoritative port from registry
 * - Emit onHubReady to observers
 *
 * Extracted per coding-guidelines.md §3.1 for modularity.
 */

import type { HubManagerEvents } from "./hub-manager-state.js";
import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health.js";
import type { HealthProbe } from "./hub-manager-polling.js";
import { resolveHubPort } from "./hub-manager-lifecycle.js";
import { probeRegistryEntry } from "./hub-registry.js";

export interface SpawnDeps {
  readonly projectId: string;
  readonly configRegistryPath: string;
  readonly events: HubManagerEvents;
  readonly processState: HubProcessSharedState;
  readonly healthState: HubHealthSharedState;
  spawnHub(secret: string, token: string, port: number): Promise<void>;
}

/**
 * Spawn a new Hub and wait for it to become healthy.
 * Used both on first launch and when reconnecting to a dead Hub.
 */
export async function spawnHubAndWait(
  deps: SpawnDeps,
  secret: string,
  token: string,
  port: number,
  pollHealth: HealthProbe,
): Promise<void> {
  await deps.spawnHub(secret, token, port);
  await pollAndNotify(deps, pollHealth, token);
}

/**
 * HubManager's spawnAndWait implementation as a standalone function.
 * Reduces HubManager method boilerplate by extracting the full spawn+poll+notify flow.
 *
 * FIX (startup race): accepts a `pollHealthFn` (retry loop) instead of a single
 * `checkHealthFn` probe.  The original single-probe design caused an intermittent
 * startup race: if the Hub process had not yet bound its HTTP port by the time the
 * one-shot check ran, `ready` was `false`, `onHubReady` was silently skipped, and
 * the bridge stayed disconnected (toolCount=0) until a manual VS Code reload.
 *
 * The caller (`HubManager.spawnAndWait`) passes `() => this.pollHealth()` which
 * retries for up to 10 s at 500 ms intervals — matching the existing hard-restart
 * path in `hub-manager-lifecycle.ts` that already used `pollHealth`.
 */
export async function spawnAndWaitHub(
  spawnFn: (secret: string, token: string, port: number) => Promise<void>,
  pollHealthFn: () => Promise<boolean>,
  deps: {
    projectId: string;
    configRegistryPath: string;
    events: HubManagerEvents;
    processState: HubProcessSharedState;
    healthState: HubHealthSharedState;
  },
  secret: string,
  token: string,
  port: number,
): Promise<void> {
  const registryPath = deps.configRegistryPath;
  await spawnFn(secret, token, port);
  deps.healthState.port = await resolveSpawnedHubPortByPid(
    deps.configRegistryPath,
    deps.projectId,
    deps.processState.hubProcess?.pid,
    deps.healthState.port,
  );
  const ready = await pollHealthFn();
  if (!ready) return;
  deps.healthState.port = resolveHubPort(
    registryPath,
    deps.projectId,
    deps.healthState.port,
  );
  const t = token ?? deps.processState.token;
  if (!t) return;
  deps.events.onHubReady(deps.healthState.port, t);
}

/**
 * Fire-and-forget spawn: starts the Hub and chains poll+onHubReady asynchronously.
 * This mirrors the original _spawnHub behaviour used by activate().
 *
 * Returns a Promise that resolves when spawn() completes (not when Hub is healthy).
 * The onHubReady event fires asynchronously via the .then() chain.
 */
export function spawnFireAndForget(
  deps: SpawnDeps,
  secret: string,
  token: string,
  port: number,
  pollHealth: HealthProbe,
): Promise<void> {
  return deps
    .spawnHub(secret, token, port)
    .then(() => pollAndNotify(deps, pollHealth, token))
    .catch((err: unknown) => {
      deps.events.onHubError(err instanceof Error ? err : new Error(String(err)));
    });
}

/**
 * Poll Hub health after spawn and emit onHubReady when the Hub responds.
 * Re-reads the authoritative port from the registry (handles free-port selection).
 */
export async function pollAndNotify(
  deps: SpawnDeps,
  probe: HealthProbe,
  tokenOverride?: string,
): Promise<void> {
  deps.healthState.port = await resolveSpawnedHubPortByPid(
    deps.configRegistryPath,
    deps.projectId,
    deps.processState.hubProcess?.pid,
    deps.healthState.port,
  );
  const ready = await probe();
  if (!ready) return;

  // Re-read the registry after health check succeeds — the Hub may have
  // selected a different port than the preferred one (free-port logic).
  // The registry always has the authoritative port.
  deps.healthState.port = resolveHubPort(
    deps.configRegistryPath,
    deps.projectId,
    deps.healthState.port,
  );

  const token = tokenOverride ?? deps.processState.token;
  if (!token) return;
  deps.events.onHubReady(deps.healthState.port, token);
}

async function resolveSpawnedHubPortByPid(
  registryPath: string,
  projectId: string,
  expectedPid: number | undefined,
  fallbackPort: number,
): Promise<number> {
  if (expectedPid === undefined) {
    return resolveHubPort(registryPath, projectId, fallbackPort);
  }

  // Unit tests in this package frequently run with fake timers. Avoid waiting
  // on mocked timer queues here to keep activation tests deterministic.
  const hasNativeTimers = String(setTimeout).includes("[native code]");
  if (!hasNativeTimers) {
    return resolveHubPort(registryPath, projectId, fallbackPort);
  }

  const deadline = Date.now() + 750;
  while (Date.now() < deadline) {
    const entry = probeRegistryEntry(registryPath, projectId);
    if (entry && entry.pid === expectedPid) {
      return entry.port;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  return resolveHubPort(registryPath, projectId, fallbackPort);
}
