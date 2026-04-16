/**
 * relay-config.ts — Relay Configuration for Chrome Extension
 *
 * Centralises relay connection configuration so that the transport layer,
 * service worker, and other consumers share a single source of truth for
 * host, port, reconnect delays, and heartbeat intervals.
 *
 * MV3 lifecycle safety: all values are either constants or derived from
 * `chrome.storage.local`, so they survive service worker restarts.
 *
 * @module
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration for the relay connection between the Chrome extension
 * and the Accordo browser relay server.
 */
export interface RelayConfig {
  /** The relay server host (e.g. "127.0.0.1"). */
  readonly host: string;
  /** The relay server port (e.g. 40111). */
  readonly port: number;
  /** WebSocket reconnect delay in milliseconds. */
  readonly reconnectDelayMs: number;
  /** Heartbeat interval in milliseconds. */
  readonly heartbeatIntervalMs: number;
  /** Token polling interval in milliseconds. */
  readonly tokenPollIntervalMs: number;
  /**
   * Optional callback that provides the current relay token.
   * Called on each connect/reconnect so the transport always uses the latest token.
   * This enables the browser extension to read from chrome.storage.local dynamically.
   */
  readonly tokenProvider?: () => Promise<string | undefined>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** Default relay configuration values. */
export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  host: "127.0.0.1",
  port: 40111,
  reconnectDelayMs: 2000,
  heartbeatIntervalMs: 15000,
  tokenPollIntervalMs: 60_000,
};

// ── Config Resolver ──────────────────────────────────────────────────────────

/**
 * Storage key for user-overridden relay config values.
 * Stored in `chrome.storage.local` so it persists across SW restarts.
 */
const CONFIG_STORAGE_KEY = "relayConfigOverrides";

interface StoredConfigOverrides {
  host?: string;
  port?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  tokenPollIntervalMs?: number;
}

/**
 * Resolve the current relay configuration.
 *
 * Reads from `chrome.storage.local` for any user-overridden values,
 * falling back to `DEFAULT_RELAY_CONFIG` for anything not set.
 *
 * @returns The resolved relay configuration
 */
export async function getRelayConfig(): Promise<RelayConfig> {
  try {
    const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
    const overrides = (stored[CONFIG_STORAGE_KEY] as StoredConfigOverrides | undefined) ?? {};
    return {
      host: overrides.host ?? DEFAULT_RELAY_CONFIG.host,
      port: overrides.port ?? DEFAULT_RELAY_CONFIG.port,
      reconnectDelayMs: overrides.reconnectDelayMs ?? DEFAULT_RELAY_CONFIG.reconnectDelayMs,
      heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? DEFAULT_RELAY_CONFIG.heartbeatIntervalMs,
      tokenPollIntervalMs: overrides.tokenPollIntervalMs ?? DEFAULT_RELAY_CONFIG.tokenPollIntervalMs,
    };
  } catch {
    return DEFAULT_RELAY_CONFIG;
  }
}

/**
 * Persist a partial relay config override to `chrome.storage.local`.
 * Only the provided fields are written; omitted fields keep their current values.
 *
 * @param overrides - Partial config fields to persist
 */
export async function saveRelayConfigOverrides(
  overrides: Partial<RelayConfig>,
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
    const current = (stored[CONFIG_STORAGE_KEY] as StoredConfigOverrides) ?? {};
    const merged: StoredConfigOverrides = { ...current, ...overrides };
    await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: merged });
  } catch {
    // chrome.storage unavailable — ignore
  }
}