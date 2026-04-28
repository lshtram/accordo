/**
 * GAP-D1 — Spatial Relations Origin Policy
 *
 * Checks the origin of a relay response against the configured policy.
 *
 * @module
 */

import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy } from "./security/index.js";

/**
 * Check whether the origin of a relay response pageUrl is allowed.
 * Returns "blocked" if the origin is denied, "allowed" otherwise.
 */
export function checkRelayOrigin(
  pageUrl: string | undefined,
  security: SecurityConfig,
  allowedOrigins?: string[],
  deniedOrigins?: string[],
): "allowed" | "blocked" {
  if (!pageUrl) return "allowed";
  const origin = extractOrigin(pageUrl) ?? pageUrl;
  const policy = mergeOriginPolicy(security.originPolicy, allowedOrigins, deniedOrigins);
  const result = checkOrigin(origin, policy);
  return result === "allow" ? "allowed" : "blocked";
}
