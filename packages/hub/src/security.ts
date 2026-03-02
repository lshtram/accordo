/**
 * Hub Security Module
 *
 * Validates HTTP requests for authentication and origin policy.
 *
 * Requirements: requirements-hub.md §2.1 (Origin, Bearer), §5.6
 */

import type http from "node:http";

/**
 * Validate the Origin header on an incoming HTTP request.
 *
 * - If no Origin header is present → PASS (non-browser client).
 * - If Origin is http://localhost:* or http://127.0.0.1:* → PASS.
 * - Otherwise → FAIL (potential DNS rebinding / browser attack).
 *
 * @param req - Incoming HTTP request
 * @returns true if the request passes origin validation
 */
export function validateOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers["origin"];
  // No Origin header — non-browser client, allow
  if (origin === undefined) return true;
  // Empty or any other falsy value — reject
  if (!origin) return false;
  // Must be exactly http://localhost[:<port>] or http://127.0.0.1[:<port>]
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * Validate the Authorization header against the Hub's bearer token.
 *
 * Expected format: "Bearer <ACCORDO_TOKEN>"
 *
 * @param req - Incoming HTTP request
 * @param token - The expected ACCORDO_TOKEN value
 * @returns true if the bearer token matches
 */
export function validateBearer(
  req: http.IncomingMessage,
  token: string,
): boolean {
  const auth = req.headers["authorization"];
  if (!auth) return false;
  return auth === `Bearer ${token}`;
}

/**
 * Validate the x-accordo-secret header against the Hub's bridge secret.
 *
 * Used on WebSocket upgrade and /bridge/reauth requests.
 *
 * @param req - Incoming HTTP request
 * @param secret - The expected ACCORDO_BRIDGE_SECRET value
 * @returns true if the secret matches
 */
export function validateBridgeSecret(
  req: http.IncomingMessage,
  secret: string,
): boolean {
  const val = req.headers["x-accordo-secret"];
  if (!val) return false;
  return val === secret;
}

/**
 * Generate a cryptographically random token string.
 *
 * Uses crypto.randomUUID() for simplicity and sufficient entropy.
 *
 * @returns A new random token string
 */
export function generateToken(): string {
  return crypto.randomUUID();
}
