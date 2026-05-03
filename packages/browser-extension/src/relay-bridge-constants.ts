export const DEFAULT_RELAY_HOST = "127.0.0.1";
export const DEFAULT_RELAY_PORT = 40111;
export const RELAY_TOKEN_STORAGE_KEY = "relayToken";

/**
 * DEV-BYPASS-FLAG — Temporary insecure dev-only pairing bypass.
 *
 * When true, the extension connects to ws://127.0.0.1:40111/chrome without
 * requiring or storing a relayToken, and the popup shows a dev-paring-disabled
 * status instead of the normal pair-code UI.
 *
 * TODO: Remove this flag and reinstate redesigned pairing flow before any
 * production release. This is intentionally insecure and must never be
 * enabled outside of local development environments.
 */
export const DEV_BROWSER_PAIRING_BYPASS = process.env.NODE_ENV !== "test";
