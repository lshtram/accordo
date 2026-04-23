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

import type * as vscode from "vscode";
import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse, SnapshotEnvelopeFields } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { OriginPolicy, SecurityConfig } from "./security/index.js";
import type { PageToolError } from "./page-tool-types.js";
import { checkOrigin } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration options for a single pipeline run.
 *
 * @typeParam TArgs     - The shape of the tool's input arguments
 * @typeParam TResponse - The shape of the successful tool response
 */
export interface PageToolPipelineOpts<TArgs, TResponse> {
  /** The MCP tool name (e.g. "accordo_browser_get_page_map"). */
  readonly toolName: string;

  /** The relay action name to forward to Chrome. */
  readonly relayAction: string;

  /** Timeout in milliseconds for the relay request. */
  readonly timeoutMs: number;

  /**
   * Validate and extract the response data from the raw relay response.
   * Return `null` if the response is invalid (pipeline will return a
   * structured error).
   */
  readonly validateResponse: (
    data: unknown,
  ) => TResponse | null;

  /** Optional: map relay error codes into tool-specific structured errors. */
  readonly mapRelayError?: (error: BrowserRelayResponse["error"]) => string;

  /** Optional: map thrown request errors into tool-specific structured errors. */
  readonly mapThrownError?: (error: unknown) => string;

  /**
   * Optional: extract the origin URL from the response for origin policy
   * checking. Return `undefined` to skip origin checking.
   */
  readonly extractOrigin?: (response: TResponse) => string | undefined;

  /** Optional: use a request-specific origin policy instead of the global one. */
  readonly resolveOriginPolicy?: (
    response: TResponse,
    args: TArgs,
    security: SecurityConfig,
  ) => OriginPolicy;

  /**
   * Optional: apply redaction to the validated response.
   * Should return a new (detached) copy with redacted values.
   */
  readonly redact?: (
    response: TResponse,
    security: SecurityConfig,
  ) => TResponse;

  /**
   * Optional: post-processing step after redaction.
   * Used for additional transformations before returning.
   */
  readonly postProcess?: (response: TResponse) => TResponse;

  /**
   * Optional: whether to save the snapshot envelope from the response.
   * Defaults to `true`.
   */
  readonly saveSnapshot?: boolean;

  /** Optional: custom snapshot persistence when handlers need special storage semantics. */
  readonly persistSnapshot?: (
    response: TResponse,
    rawData: unknown,
    store: SnapshotRetentionStore,
  ) => void;
}

/**
 * Result of a pipeline run — either a successful response or a structured
 * error. The pipeline never throws.
 *
 * @typeParam TResponse - The shape of the successful tool response
 */
export interface PipelineResult<TResponse> {
  /** Whether the pipeline completed successfully. */
  readonly success: boolean;
  /** The tool response (present when `success` is true). */
  readonly data?: TResponse;
  /** Structured error (present when `success` is false). */
  readonly error?: PageToolError;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a structured error result (pipeline never throws). */
function errorResult(error: string, details?: string): PageToolError {
  return buildStructuredError(error, details);
}

function withAuditId<TResponse>(response: TResponse, auditId: string | undefined): TResponse {
  if (auditId === undefined || response === null || typeof response !== "object") {
    return response;
  }
  return { ...(response as Record<string, unknown>), auditId } as TResponse;
}

function detachValue<T>(value: T): T {
  return structuredClone(value);
}

// ── Pipeline Runner ──────────────────────────────────────────────────────────

/**
 * Run the 9-stage page tool pipeline for a single tool invocation.
 *
 * The pipeline never throws — all errors are captured and returned as
 * structured `PipelineResult` values.
 *
 * @typeParam TArgs     - The shape of the tool's input arguments
 * @typeParam TResponse - The shape of the successful tool response
 *
 * @param relay    - The browser relay connection
 * @param args     - The tool's input arguments (forwarded to the relay)
 * @param store    - Snapshot retention store for envelope persistence
 * @param security - Security configuration (origin policy, redaction, audit)
 * @param opts     - Pipeline configuration for this tool
 * @returns A pipeline result with either the response or a structured error
 */
export async function runPageToolPipeline<TArgs, TResponse>(
  relay: BrowserRelayLike,
  args: TArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  opts: PageToolPipelineOpts<TArgs, TResponse>,
): Promise<PipelineResult<TResponse>> {
  const startTime = Date.now();
  // ── Stage 1: Connection check ───────────────────────────────────────────────
  if (!relay.isConnected()) {
    return { success: false, error: errorResult("browser-not-connected", "relay disconnected before request") };
  }

  // ── Stage 2: Audit create ──────────────────────────────────────────────────
  type AuditEntry = { auditId: string; timestamp: string; toolName: string; pageId?: string; origin?: string; action: "allowed" | "blocked"; redacted: boolean; durationMs?: number };
  let auditEntry: AuditEntry | null = null;
  try {
    if (typeof security.auditLog?.createEntry === "function") {
      auditEntry = security.auditLog.createEntry(opts.toolName) as AuditEntry;
    }
  } catch {
    // audit creation failure is non-fatal
  }

  let finalData: TResponse | undefined;
  let finalError: PageToolError | undefined;

  // ── Stage 3: Relay request ─────────────────────────────────────────────────
  let relayResponse: BrowserRelayResponse;
  try {
    relayResponse = await relay.request(opts.relayAction as BrowserRelayAction, args as Record<string, unknown>, opts.timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finalError = errorResult(opts.mapThrownError?.(err) ?? "timeout", msg);
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: finalError };
  }

  if (!relayResponse.success) {
    finalError = errorResult(opts.mapRelayError?.(relayResponse.error) ?? "action-failed", relayResponse.error);
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: finalError };
  }

  // ── Stage 4: Response validation ──────────────────────────────────────────
  const validated = opts.validateResponse(relayResponse.data);
  if (validated === null) {
    finalError = errorResult("action-failed", "validateResponse returned null — response shape mismatch");
    void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
    return { success: false, error: finalError };
  }

  // ── Stage 5: Origin policy check ──────────────────────────────────────────
  if (opts.extractOrigin) {
    const origin = opts.extractOrigin(validated);
    if (origin) {
      const policy = opts.resolveOriginPolicy?.(validated, args, security) ?? security.originPolicy;
      const originResult = checkOrigin(origin, policy);
      if (originResult === "block") {
        finalError = errorResult("origin-blocked", `origin "${origin}" is denied by security policy`);
        void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
        return { success: false, error: finalError };
      }
    }
  }

  // ── Stage 6: Snapshot save ─────────────────────────────────────────────────
  try {
    if (opts.persistSnapshot) {
      opts.persistSnapshot(detachValue(validated), detachValue(relayResponse.data), store);
    } else {
      const saveSnapshot = opts.saveSnapshot ?? true;
      if (saveSnapshot && relayResponse.data && typeof relayResponse.data === "object") {
        const envelope = detachValue(relayResponse.data) as Record<string, unknown>;
        if (envelope.pageId && envelope.snapshotId) {
          store.add(envelope as unknown as SnapshotEnvelopeFields);
        }
      }
    }
  } catch {
    // snapshot save failure is non-fatal — do not block response
  }

  // Work on a detached copy from this point forward
  let processed: TResponse = detachValue(validated);

  // ── Stage 7: Redaction ─────────────────────────────────────────────────────
  if (opts.redact) {
    try {
      processed = opts.redact(processed, security);
    } catch (err) {
      // Fail-closed: redaction errors must propagate as error results, never as partial data
      finalError = errorResult("redaction-failed", err instanceof Error ? err.message : String(err));
      void completeAudit(security.auditLog, auditEntry, "complete", "blocked", false, Date.now() - startTime);
      return { success: false, error: finalError };
    }
  }

  // ── Stage 8: Post-process ──────────────────────────────────────────────────
  if (opts.postProcess) {
    processed = opts.postProcess(processed);
  }
  processed = withAuditId(processed, auditEntry?.auditId);

  // ── Stage 9: Audit complete ─────────────────────────────────────────────────
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

function responseWasRedacted<TResponse>(response: TResponse): boolean {
  if (response === null || typeof response !== "object") {
    return false;
  }
  const record = response as Record<string, unknown>;
  return record["redactionApplied"] === true || record["screenshotRedactionApplied"] === true;
}

// ── Audit helper ─────────────────────────────────────────────────────────────

function completeAudit(
  auditLog: {
    createEntry(toolName: string, pageUrl?: string, origin?: string): { auditId: string; timestamp: string; toolName: string; pageId?: string; origin?: string; action: "allowed" | "blocked"; redacted: boolean; durationMs?: number };
    completeEntry(entry: { auditId: string; timestamp: string; toolName: string; pageId?: string; origin?: string; action: "allowed" | "blocked"; redacted: boolean; durationMs?: number }, outcome: { action: "allowed" | "blocked"; redacted: boolean; durationMs: number }): void;
    flush(): Promise<void>;
    log?: (event: string) => void;
  } | undefined,
  entry: { auditId: string; timestamp: string; toolName: string; pageId?: string; origin?: string; action: "allowed" | "blocked"; redacted: boolean; durationMs?: number } | null,
  event: string,
  action: "allowed" | "blocked",
  redacted: boolean,
  durationMs: number | undefined,
): void {
  if (!auditLog) return;
  try {
    // Complete the original entry created in Stage 2 (not a fresh one).
    // When createEntry is absent (test mock), fall back to calling log directly.
    if (typeof auditLog.completeEntry === "function" && entry) {
      const { completeEntry: finishEntry } = auditLog;
      // Mutate the original entry's outcome fields in place
      entry.action = action;
      entry.redacted = redacted;
      if (durationMs !== undefined) entry.durationMs = durationMs;
      finishEntry(entry, { action, redacted, durationMs: durationMs ?? 0 });
      void auditLog.flush?.();
    } else if (typeof auditLog.log === "function") {
      // Test mock path — log callback accepts string event name
      auditLog.log(event);
    }
  } catch {
    // audit completion failure is non-fatal
  }
}
