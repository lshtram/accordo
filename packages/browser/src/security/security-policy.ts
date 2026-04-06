/**
 * Browser MCP Security — Origin Policy Evaluation
 *
 * Evaluates whether a page origin is allowed or blocked based on
 * the configured OriginPolicy.
 *
 * Implements requirements:
 * - B2-PS-001: Origin allow list
 * - B2-PS-002: Origin block list (takes precedence)
 * - B2-PS-003: Default origin policy
 * - B2-ER-007: origin-blocked error returned before DOM access
 *
 * @module
 */

import type { OriginPolicy } from "./security-types.js";

/**
 * Check if a page origin is allowed by the policy.
 *
 * Evaluation order:
 * 1. If origin is in deniedOrigins → "block" (B2-PS-002: block list takes precedence)
 * 2. If allowedOrigins is non-empty and origin is NOT in it → "block" (B2-PS-001)
 * 3. If allowedOrigins is non-empty and origin IS in it → "allow"
 * 4. If both lists are empty → return defaultAction (B2-PS-003)
 *
 * @param origin — The page's `document.location.origin` (e.g., "https://example.com")
 * @param policy — The origin policy to evaluate against
 * @returns "allow" if the origin is permitted, "block" if it should be rejected
 */
export function checkOrigin(
  origin: string,
  policy: OriginPolicy,
): "allow" | "block" {
  // B2-PS-002: deniedOrigins takes precedence over allowedOrigins
  if (policy.deniedOrigins.includes(origin)) {
    return "block";
  }

  // B2-PS-001: Non-empty allowedOrigins means only those origins are allowed
  if (policy.allowedOrigins.length > 0) {
    return policy.allowedOrigins.includes(origin) ? "allow" : "block";
  }

  // B2-PS-003: Both lists empty → use defaultAction
  return policy.defaultAction === "allow" ? "allow" : "block";
}

/**
 * Extract the origin from a full URL string.
 * Returns undefined if the URL is invalid or cannot be parsed.
 *
 * @param url — Full URL (e.g., "https://example.com/path?query=1")
 * @returns Origin string (e.g., "https://example.com") or undefined
 */
export function extractOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Merge a per-request origin override with the global policy.
 * Per-request parameters take precedence when provided.
 *
 * @param globalPolicy — The global OriginPolicy from SecurityConfig
 * @param requestAllowed — Per-request allowedOrigins (from tool input)
 * @param requestDenied — Per-request deniedOrigins (from tool input)
 * @returns Merged OriginPolicy
 */
export function mergeOriginPolicy(
  globalPolicy: OriginPolicy,
  requestAllowed?: string[],
  requestDenied?: string[],
): OriginPolicy {
  return {
    allowedOrigins: requestAllowed !== undefined ? requestAllowed : globalPolicy.allowedOrigins,
    deniedOrigins: requestDenied !== undefined ? requestDenied : globalPolicy.deniedOrigins,
    defaultAction: globalPolicy.defaultAction,
  };
}
