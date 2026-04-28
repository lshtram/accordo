/**
 * page-tool-pipeline.ts — Page Tool Pipeline Types
 *
 * Shared TypeScript types for the 9-stage page tool pipeline.
 *
 * @module
 */

import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { OriginPolicy, SecurityConfig } from "./security/index.js";
import type { PageToolError } from "./page-tool-types.js";

// ── Audit entry (inline to avoid import cycle) ─────────────────────────────────

export type AuditAction = "allowed" | "blocked";

export interface AuditEntry {
  auditId: string;
  timestamp: string;
  toolName: string;
  pageId?: string;
  origin?: string;
  action: AuditAction;
  redacted: boolean;
  durationMs?: number;
}

// ── Pipeline Configuration ──────────────────────────────────────────────────────

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
  readonly validateResponse: (data: unknown) => TResponse | null;

  /** Optional: map relay error codes into tool-specific structured errors. */
  readonly mapRelayError?: (error: string) => string;

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
  readonly redact?: (response: TResponse, security: SecurityConfig) => TResponse;

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

  /**
   * B2-CTX-002: Optional function to extract tabId from the original args so it
   * can be recorded alongside the snapshot envelope for diff_snapshots tabId
   * recovery when the caller later omits tabId.
   */
  readonly persistTabId?: (args: TArgs) => number | undefined;
}

// ── Pipeline Result ─────────────────────────────────────────────────────────────

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

// ── Audit Log Interface (for completeAudit) ─────────────────────────────────────

export interface AuditLog {
  createEntry(
    toolName: string,
    pageUrl?: string,
    origin?: string,
  ): AuditEntry;
  completeEntry(entry: AuditEntry, outcome: { action: AuditAction; redacted: boolean; durationMs: number }): void;
  flush?(): Promise<void>;
  log?: (event: string) => void;
}
