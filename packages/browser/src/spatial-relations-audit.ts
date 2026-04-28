/**
 * GAP-D1 — Spatial Relations Audit Helpers
 *
 * Creates and completes audit log entries for get_spatial_relations.
 *
 * @module
 */

import type { SecurityConfig } from "./security/index.js";

/**
 * Begin an audit entry for get_spatial_relations.
 * Returns the entry and start time for computing duration.
 */
export function beginSpatialAudit(security: SecurityConfig): {
  entry: ReturnType<SecurityConfig["auditLog"]["createEntry"]>;
  startTime: number;
} {
  const entry = security.auditLog.createEntry(
    "accordo_browser_get_spatial_relations",
    undefined,
    undefined,
  );
  return { entry, startTime: Date.now() };
}

/**
 * Complete an audit entry with a "blocked" action.
 */
export function completeAuditBlocked(
  security: SecurityConfig,
  entry: ReturnType<SecurityConfig["auditLog"]["createEntry"]>,
  startTime: number,
): void {
  security.auditLog.completeEntry(entry, {
    action: "blocked",
    redacted: false,
    durationMs: Date.now() - startTime,
  });
}

/**
 * Complete an audit entry with an "allowed" action.
 */
export function completeAuditAllowed(
  security: SecurityConfig,
  entry: ReturnType<SecurityConfig["auditLog"]["createEntry"]>,
  startTime: number,
): void {
  security.auditLog.completeEntry(entry, {
    action: "allowed",
    redacted: false,
    durationMs: Date.now() - startTime,
  });
}
