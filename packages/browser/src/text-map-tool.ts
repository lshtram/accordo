/**
 * M112-TEXT — Text Map MCP Tool
 *
 * Defines the `browser_get_text_map` MCP tool that gives AI agents access
 * to the text content of a live browser page — with raw and normalized
 * text, bounding boxes, visibility flags, semantic context, and reading
 * order.
 *
 * The tool handler forwards the request through the browser relay to the
 * Chrome extension's content script, which has live DOM access.
 *
 * Implements requirements B2-TX-001 through B2-TX-010.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactTextMapResponse, DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Relay timeout for text map collection (ms). */
export const TEXT_MAP_TIMEOUT_MS = 10_000;

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_get_text_map`.
 *
 * B2-TX-008: `maxSegments` caps the number of returned text segments.
 * PAG-01: `offset` and `limit` enable incremental pagination.
 */
export interface GetTextMapArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Maximum number of text segments to return (default: 500, max: 2000). B2-TX-008. */
  maxSegments?: number;
  /** F12: Target a specific iframe by its frameId from get_page_map iframes[]. */
  frameId?: string;
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. */
  redactPII?: boolean;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];

  // ── Pagination (PAG-01) ─────────────────────────────────────────────────

  /** Pagination offset — 0-based index of first segment to return (default: 0). */
  offset?: number;
  /** Pagination limit — max segments to return (default: effective cap = min(maxSegments ?? 500, 2000)). */
  limit?: number;
}

// ── Tool Result Types ────────────────────────────────────────────────────────

/**
 * Visibility state of a text segment (mirrors content-script type).
 * B2-TX-005.
 */
export type TextVisibility = "visible" | "hidden" | "offscreen";

/**
 * A single text segment in the text map response.
 * B2-TX-001..006.
 */
export interface TextSegment {
  textRaw: string;
  textNormalized: string;
  /** Per-call scoped ID — independent from page-map ref indices. B2-TX-002. */
  nodeId: number;
  role?: string;
  accessibleName?: string;
  bbox: { x: number; y: number; width: number; height: number };
  visibility: TextVisibility;
  readingOrderIndex: number;
}

/**
 * Successful response from `browser_get_text_map`.
 * Extends SnapshotEnvelopeFields (B2-TX-007).
 */
export interface TextMapResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  segments: TextSegment[];
  totalSegments: number;
  truncated: boolean;
  /** True when PII redaction was applied to text content. MCP-SEC-002. */
  redactionApplied?: boolean;
  /** Warning when PII may be present in response. MCP-VC-005. */
  redactionWarning?: string;

  // ── Pagination (PAG-03..06) ─────────────────────────────────────────────────
  // Present only when offset or limit is explicitly provided.

  /** True if there are more segments beyond the returned slice. */
  hasMore?: boolean;
  /** Suggested offset for the next page (offset + segments.length). */
  nextOffset?: number;
  /** Total segments available for pagination (post-filter, post-cap, pre-slice). */
  totalAvailable?: number;
}

/**
 * Error response from the text map tool (relay-level failures).
 */
export interface TextMapToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "iframe-cross-origin" | "no-content-script";
}

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Build the `browser_get_text_map` tool definition.
 *
 * B2-TX-009: Registers a separate MCP tool with dangerLevel "safe"
 * and idempotent: true. Does not modify existing tools (B2-TX-010).
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store (5-slot FIFO per page)
 * @returns A single tool definition for `browser_get_text_map`
 */
export function buildTextMapTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_text_map",
    description:
      "Extract the text content of the current page as structured segments with raw/normalized text, " +
      "bounding boxes, visibility flags, semantic context (role, accessible name), and reading-order indices. " +
      "Each segment includes: textRaw, textNormalized, readingOrderIndex, role, accessibleName, " +
      "bounds (x/y/width/height), isVisible, and isInViewport. " +
      "Use when you need to read page content in natural reading order, verify text presence, " +
      "or extract link labels and button names with their a11y context. " +
      "Use get_page_map instead when you need interactive element references (uid) for clicking or typing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        maxSegments: {
          type: "integer",
          description:
            "Maximum number of text segments to return (default: 500, max: 2000).",
          minimum: 1,
          maximum: 2000,
        },
        frameId: {
          type: "string",
          description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]",
        },
        redactPII: {
          type: "boolean",
          description:
            "When true, scan text content for email addresses, phone numbers, " +
            "and API keys and replace with [REDACTED]. I1-text.",
        },
        allowedOrigins: {
          type: "array",
          items: { type: "string" },
          description: "Only allow data from these origins. Empty = use global policy.",
        },
        deniedOrigins: {
          type: "array",
          items: { type: "string" },
          description: "Block data from these origins. Takes precedence over allowedOrigins.",
        },
        offset: {
          type: "number",
          description: "Pagination offset — 0-based index of first segment to return (default: 0).",
        },
        limit: {
          type: "number",
          description: "Pagination limit — max segments to return (default: effective cap = min(maxSegments ?? 500, 2000)).",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetTextMap(relay, args as GetTextMapArgs, store, security),
  };
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** Classify relay error messages into structured error codes. */
function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

// ── Tool Handler ─────────────────────────────────────────────────────────────

/**
 * Handler for `browser_get_text_map`.
 *
 * Forwards the request through the relay to the content script's
 * `collectTextMap()` function. On success, validates the SnapshotEnvelope
 * and persists the snapshot into the retention store.
 *
 * B2-TX-001..008: Text extraction with structured segments.
 * B2-TX-007: SnapshotEnvelope compliance + retention.
 * B2-TX-009: Safe, idempotent tool.
 * B2-TX-010: No effect on existing tools.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param args — Tool input arguments
 * @param store — Shared snapshot retention store
 * @param security — Security configuration (origin policy, redaction, audit)
 * @returns Text map response or error
 */
async function handleGetTextMap(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<TextMapResponse | TextMapToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as TextMapToolError;
  }

  // PAG-01: Apply pagination clamping before forwarding to relay.
  // offset is clamped to >= 0.
  // limit is clamped to >= 1 and <= effective cap (min(maxSegments ?? 500, 2000)).
  const effectiveCap = Math.min(args.maxSegments ?? 500, 2000);
  const clampedOffset = Math.max(0, args.offset ?? 0);
  const clampedLimit = args.limit !== undefined
    ? Math.min(Math.max(1, args.limit), effectiveCap)
    : undefined;

  // Build payload — only include offset/limit when explicitly provided by caller
  const paginationArgsProvided = args.offset !== undefined || args.limit !== undefined;
  const payload: Record<string, unknown> = { ...args };
  if (args.offset !== undefined) {
    payload.offset = clampedOffset;
  } else {
    delete payload.offset;
  }
  if (args.limit !== undefined) {
    payload.limit = clampedLimit;
  } else {
    delete payload.limit;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_text_map", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request(
      "get_text_map",
      payload,
      TEXT_MAP_TIMEOUT_MS,
    );

    if (!response.success || response.data === undefined) {
      const errCode = response.error ?? "action-failed";
      const mappedError: TextMapToolError["error"] =
        errCode === "browser-not-connected" ? "browser-not-connected"
        : errCode === "timeout" ? "timeout"
        : errCode === "iframe-cross-origin" ? "iframe-cross-origin"
        : errCode === "no-content-script" ? "no-content-script"
        : "action-failed";
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(mappedError) as TextMapToolError;
    }

    const data = response.data;
    const relayPageUrl = (data as { pageUrl?: string }).pageUrl;

    // F1: Origin policy check using the pageUrl from the relay response.
    // This runs after DOM access but BEFORE saving to the store or returning,
    // ensuring blocked origins never reach the store or the caller.
    if (relayPageUrl) {
      const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
      const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
      if (checkOrigin(origin, policy) === "block") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("origin-blocked") as TextMapToolError;
      }
    }

    // B2-TX-007: Validate SnapshotEnvelope and persist (only after origin check passes)
    if (hasSnapshotEnvelope(data)) {
      store.save(data.pageId, data as SnapshotEnvelopeFields);
    }

    // Create a shallow copy BEFORE mutating to avoid mutating the original mock/data object
    const result = { ...data } as TextMapResponse;

    // F2: Apply redaction if requested (fail-closed)
    if (args.redactPII) {
      try {
        const redactionOccurred = redactTextMapResponse(result as any, security.redactionPolicy);
        // redacted: true if patterns existed and matched content; false if no patterns or no matches
        (result as any).redactionApplied = redactionOccurred;
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("redaction-failed") as TextMapToolError;
      }
    } else {
      // F5: Redaction warning when redactPII is not set (unconditional per MCP-VC-005)
      (result as any).redactionWarning = "PII may be present in response";
    }

    // F4: Add auditId to response
    (result as any).auditId = auditEntry.auditId;

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!(result as any).redactionApplied,
      durationMs: Date.now() - startTime,
    });

    // PAG-03: Inject pagination metadata when offset or limit was explicitly provided.
    if (paginationArgsProvided) {
      const effectiveLimit = clampedLimit ?? effectiveCap;
      const allSegments = result.segments;
      const slicedSegments = allSegments.slice(clampedOffset, clampedOffset + effectiveLimit);
      result.segments = slicedSegments;

      const totalAvailable = result.truncated
        ? Math.min(result.totalSegments, effectiveCap)
        : result.totalSegments;
      const hasMore = (clampedOffset + slicedSegments.length) < totalAvailable;
      result.hasMore = hasMore;
      result.totalAvailable = totalAvailable;
      // PAG-04: Omit nextOffset when result is empty
      if (slicedSegments.length > 0) {
        result.nextOffset = clampedOffset + slicedSegments.length;
      }
    }

    // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
    return { ...result };
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as TextMapToolError;
  }
}
