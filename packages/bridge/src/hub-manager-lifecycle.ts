/**
 * Hub lifecycle helpers extracted from HubManager.
 *
 * These functions are tightly coupled to HubManager's internal state and are
 * extracted purely for modularity (coding-guidelines.md §3.1).
 *
 * Responsibilities:
 * - Restart soft/hard path orchestration
 * - Health polling + onHubReady notification
 * - Hub spawn orchestration
 *
 * Requirements: requirements-bridge.md §4 (LCM-12), adr-reload-reconnect.md §D1-D3
 */

import type { HubManagerEvents, SecretStorage } from "./hub-manager.js";
import type { HubProcessSharedState } from "./hub-process.js";
import type { HubHealthSharedState } from "./hub-health.js";
import { scopedSecretKey, BRIDGE_SECRET_KEY, HUB_TOKEN_KEY } from "./project-identity.js";
import { probeRegistryEntry, resolveRegistryPath } from "./hub-registry.js";

/**
 * Resolve the authoritative port from the registry after Hub health is confirmed.
 * The Hub may select a different port than the preferred one (free-port logic).
 */
export function resolveHubPort(
  registryPath: string,
  projectId: string,
  preferredPort: number,
): number {
  const entry = probeRegistryEntry(registryPath, projectId);
  return entry ? entry.port : preferredPort;
}

// ── Restart helpers ──────────────────────────────────────────────────────────

export interface RestartContext {
  readonly projectId: string;
  readonly configRegistryPath: string | undefined;
  readonly secretStorage: SecretStorage;
  readonly processState: HubProcessSharedState;
  readonly healthState: HubHealthSharedState;
  readonly events: HubManagerEvents;
  killHub(): Promise<void>;
  spawn(secret: string, token: string, port: number): Promise<void>;
  pollHealth(maxWaitMs?: number, intervalMs?: number): Promise<boolean>;
  attemptReauth(currentSecret: string, newSecret: string, newToken: string): Promise<boolean>;
}

async function persistCredentials(
  ctx: RestartContext,
  newSecret: string,
  newToken: string,
): Promise<void> {
  const bridgeSecretKey = scopedSecretKey(BRIDGE_SECRET_KEY, ctx.projectId);
  const hubTokenKey = scopedSecretKey(HUB_TOKEN_KEY, ctx.projectId);
  await ctx.secretStorage.store(bridgeSecretKey, newSecret);
  await ctx.secretStorage.store(hubTokenKey, newToken);
}

/**
 * Soft-reauth path — Hub supports in-place rotation.
 * Updates in-memory state and persists to SecretStorage before notifying.
 */
export async function softRestart(
  ctx: RestartContext,
  newSecret: string,
  newToken: string,
): Promise<void> {
  ctx.processState.secret = newSecret;
  ctx.processState.token = newToken;
  await persistCredentials(ctx, newSecret, newToken);
  ctx.events.onCredentialsRotated(newToken, newSecret);
}

/**
 * Hard-fallback path — Hub does not support reauth, must kill+respawn.
 *
 * LCM-12 guarantees:
 * 1. processState is updated BEFORE _pollAndNotify() reads it (new token in memory)
 * 2. SecretStorage is persisted and awaited before any ready/config-sync observer fires
 * 3. onHubReady reads the NEW token, not the stale one
 */
export async function hardRestart(
  ctx: RestartContext,
  newSecret: string,
  newToken: string,
): Promise<void> {
  // Step 1: kill + respawn
  await ctx.killHub();
  await ctx.spawn(newSecret, newToken, ctx.healthState.port);
  // Step 2: commit credentials to storage BEFORE any observer reads them
  ctx.processState.secret = newSecret;
  ctx.processState.token = newToken;
  await persistCredentials(ctx, newSecret, newToken);
  // Step 3: poll for Hub ready and emit onHubReady with the new token
  await pollAndNotify(ctx, newToken);
  ctx.events.onCredentialsRotated(newToken, newSecret);
}

/**
 * Orchestrate restart: try soft reauth first, fall back to hard respawn.
 */
export async function doRestart(ctx: RestartContext): Promise<void> {
  const newSecret = crypto.randomUUID();
  const newToken = crypto.randomUUID();
  const reauthOk = await ctx.attemptReauth(
    ctx.processState.secret ?? "",
    newSecret,
    newToken,
  );
  if (reauthOk) {
    await softRestart(ctx, newSecret, newToken);
  } else {
    await hardRestart(ctx, newSecret, newToken);
  }
}

/**
 * Poll Hub health and emit onHubReady when the Hub responds.
 * Re-reads the authoritative port from the registry (handles free-port selection).
 * Reads token from processState — caller must ensure processState.token is set.
 */
export async function pollAndNotify(
  ctx: RestartContext,
  tokenOverride?: string,
): Promise<void> {
  const ready = await ctx.pollHealth();
  if (!ready) return;
  const registryPath = ctx.configRegistryPath ?? resolveRegistryPath();
  ctx.healthState.port = resolveHubPort(registryPath, ctx.projectId, ctx.healthState.port);
  const token = tokenOverride ?? ctx.processState.token;
  if (!token) return;
  ctx.events.onHubReady(ctx.healthState.port, token);
}