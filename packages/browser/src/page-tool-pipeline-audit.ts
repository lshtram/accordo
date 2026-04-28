/**
 * page-tool-pipeline.ts — Audit Helper
 *
 * completeAudit helper for the page tool pipeline.
 * Handles audit entry completion for both real AuditLog and test mocks.
 *
 * @module
 */

import type { AuditEntry, AuditLog } from "./page-tool-pipeline-types.js";

/**
 * Complete an audit entry with outcome data.
 * Non-fatal: failures are swallowed silently.
 */
export function completeAudit(
  auditLog: AuditLog | undefined,
  entry: AuditEntry | null,
  event: string,
  action: "allowed" | "blocked",
  redacted: boolean,
  durationMs: number | undefined,
): void {
  if (!auditLog) return;
  try {
    if (typeof auditLog.completeEntry === "function" && entry) {
      // Mutate the original entry's outcome fields in place
      entry.action = action;
      entry.redacted = redacted;
      if (durationMs !== undefined) entry.durationMs = durationMs;
      auditLog.completeEntry(entry, { action, redacted, durationMs: durationMs ?? 0 });
      void auditLog.flush?.();
    } else if (typeof auditLog.log === "function") {
      // Test mock path
      auditLog.log(event);
    }
  } catch {
    // audit completion failure is non-fatal
  }
}

/**
 * Detect if a response was redacted based on marker fields.
 */
export function responseWasRedacted<TResponse>(response: TResponse): boolean {
  if (response === null || typeof response !== "object") {
    return false;
  }
  const record = response as Record<string, unknown>;
  return record["redactionApplied"] === true || record["screenshotRedactionApplied"] === true;
}
