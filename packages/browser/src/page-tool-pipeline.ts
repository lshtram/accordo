/**
 * page-tool-pipeline.ts — Page Tool Pipeline
 *
 * Defines the 9-stage pipeline contract for page tool handlers that pass
 * through the browser relay. Provides a generic `runPageToolPipeline` function
 * that centralises the connection check → audit → relay → validate → origin →
 * snapshot → redact → post-process → audit-complete flow.
 *
 * ## Fixed stage ordering
 *
 * 1. connection check
 * 2. audit create
 * 3. relay request
 * 4. response validation
 * 5. origin policy check
 * 6. snapshot save
 * 7. redaction
 * 8. post-process
 * 9. audit complete
 *
 * ## Invariants
 *
 * - audit entry always completes (even on error paths)
 * - redaction failures are fail-closed
 * - origin block happens before persistence
 * - pipeline never throws; returns structured error values
 * - returned object is detached copy, not aliased store data
 *
 * ## Handlers that stay outside pipeline
 *
 * - `handleWaitForInline`
 * - `handleListPages`
 * - `handleSelectPage`
 *
 * @module
 */

import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import type { BrowserRelayLike } from "./types.js";
import type { PageToolPipelineOpts, PipelineResult } from "./page-tool-pipeline-types.js";
import { completeAudit, responseWasRedacted } from "./page-tool-pipeline-audit.js";
import {
  stageCheckConnection,
  stageCreateAudit,
  stageRelayRequest,
  stageValidateResponse,
  stageCheckOrigin,
  stagePersistSnapshot,
  stageRedact,
  errorResult,
  withAuditId,
  detachValue,
} from "./page-tool-pipeline-stages.js";

// ── Pipeline Runner ────────────────────────────────────────────────────────────

/**
 * Run the 9-stage page tool pipeline for a single tool invocation.
 *
 * The pipeline never throws — all errors are captured and returned as
 * structured `PipelineResult` values.
 */
export async function runPageToolPipeline<TArgs, TResponse>(
  relay: BrowserRelayLike,
  args: TArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  opts: PageToolPipelineOpts<TArgs, TResponse>,
): Promise<PipelineResult<TResponse>> {
  const startTime = Date.now();

  // Stage 1: Connection check
  if (!await stageCheckConnection(relay)) {
    return { success: false, error: errorResult("browser-not-connected", "relay disconnected before request") };
  }

  // Stage 2: Audit create
  const auditEntry = stageCreateAudit(security, opts.toolName);

  // Stage 3: Relay request
  const relayResult = await stageRelayRequest(relay, opts.relayAction, args, opts.timeoutMs);
  if (!relayResult.ok) {
    const errCode = relayResult.fromRelay
      ? (opts.mapRelayError?.(relayResult.error) ?? "action-failed")
      : (opts.mapThrownError?.(relayResult.error) ?? "timeout");
    const err = errorResult(errCode, relayResult.error);
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: err };
  }

  // Stage 4: Response validation
  const validatedResult = stageValidateResponse(relayResult.data, opts.validateResponse);
  if (!validatedResult.ok) {
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: errorResult("action-failed", validatedResult.error) };
  }

  // Stage 5: Origin policy check
  const originResult = stageCheckOrigin(validatedResult.data, security, opts, args);
  if (!originResult.ok) {
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: errorResult("origin-blocked", originResult.error) };
  }

  // Stage 6: Snapshot save
  stagePersistSnapshot(validatedResult.data, relayResult.data, store, opts, args);

  // Work on a detached copy from this point forward
  let processed: TResponse = detachValue(validatedResult.data);

  // Stage 7: Redaction
  const redactResult = stageRedact(processed, security, opts);
  if (!redactResult.ok) {
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: errorResult("redaction-failed", redactResult.error) };
  }
  processed = redactResult.data;

  // Stage 8: Post-process
  if (opts.postProcess) {
    processed = opts.postProcess(processed);
  }
  processed = withAuditId(processed, auditEntry?.auditId);

  // Stage 9: Audit complete
  void completeAudit(
    security.auditLog,
    auditEntry,
    "complete",
    "allowed",
    responseWasRedacted(processed),
    Date.now() - startTime,
  );

  return { success: true, data: processed };
}

// Re-export types for consumers
export type { PageToolPipelineOpts, PipelineResult } from "./page-tool-pipeline-types.js";
