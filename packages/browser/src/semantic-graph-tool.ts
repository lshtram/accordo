/**
 * M113-SEM — Semantic Graph MCP Tool
 *
 * Defines the `browser_get_semantic_graph` MCP tool that gives AI agents
 * access to the semantic structure of a live browser page — accessibility
 * tree, landmarks, document outline, and form models.
 *
 * The tool handler forwards the request through the browser relay to the
 * Chrome extension's content script, which has live DOM access.
 *
 * Implements requirements B2-SG-001 through B2-SG-015.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactSemanticGraphResponse, DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Relay timeout for semantic graph collection (ms). B2-SG-010. */
export const SEMANTIC_GRAPH_TOOL_TIMEOUT_MS = 15_000;

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_get_semantic_graph`.
 *
 * B2-SG-008: `maxDepth` caps the a11y tree nesting depth.
 * B2-SG-009: `visibleOnly` filters hidden elements.
 */
export interface GetSemanticGraphArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Maximum depth for a11y tree (default: 8, max: 16). B2-SG-008. */
  maxDepth?: number;
  /** Exclude hidden elements (default: true). B2-SG-009. */
  visibleOnly?: boolean;
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. */
  redactPII?: boolean;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
}

// ── Tool Result Types ────────────────────────────────────────────────────────

/**
 * A node in the accessibility tree (mirrors content-script type).
 * B2-SG-002.
 */
export interface SemanticA11yNode {
  role: string;
  name?: string;
  level?: number;
  nodeId: number;
  children: SemanticA11yNode[];
}

/**
 * A landmark region (mirrors content-script type).
 * B2-SG-003.
 */
export interface Landmark {
  role: string;
  label?: string;
  nodeId: number;
  tag: string;
}

/**
 * A document heading (mirrors content-script type).
 * B2-SG-004.
 */
export interface OutlineHeading {
  level: number;
  text: string;
  nodeId: number;
  id?: string;
}

/**
 * A form field (mirrors content-script type).
 * B2-SG-005.
 */
export interface FormField {
  tag: string;
  type?: string;
  name?: string;
  label?: string;
  required: boolean;
  value?: string;
  nodeId: number;
}

/**
 * A form model (mirrors content-script type).
 * B2-SG-005.
 */
export interface FormModel {
  formId?: string;
  name?: string;
  action?: string;
  method: string;
  nodeId: number;
  fields: FormField[];
}

/**
 * Successful response from `browser_get_semantic_graph`.
 * Extends SnapshotEnvelopeFields (B2-SG-007).
 */
export interface SemanticGraphResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  /** B2-SG-002: Accessibility tree snapshot. */
  a11yTree: SemanticA11yNode[];
  /** B2-SG-003: Landmark regions. */
  landmarks: Landmark[];
  /** B2-SG-004: Document heading outline. */
  outline: OutlineHeading[];
  /** B2-SG-005: Form models. */
  forms: FormModel[];
  /** True when PII redaction was applied to text content. MCP-SEC-002. */
  redactionApplied?: boolean;
  /** Warning when PII may be present in response. MCP-VC-005. */
  redactionWarning?: string;
  /**审计 ID. I3-001. */
  auditId?: string;
}

/**
 * Error response from the semantic graph tool (relay-level failures).
 */
export interface SemanticGraphToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed";
}

// ── Runtime type guards ──────────────────────────────────────────────────────

/**
 * Narrow an unknown value to GetSemanticGraphArgs.
 * Accepts any object (or empty args) and extracts only the typed fields.
 * This prevents trusting unknown relay payloads without narrowing.
 */
function narrowArgs(raw: unknown): GetSemanticGraphArgs {
  if (typeof raw !== "object" || raw === null) return {};

  const obj = raw as Record<string, unknown>;
  const result: GetSemanticGraphArgs = {};

  if (typeof obj["tabId"] === "number") {
    result.tabId = obj["tabId"];
  }
  if (typeof obj["maxDepth"] === "number") {
    result.maxDepth = obj["maxDepth"];
  }
  if (typeof obj["visibleOnly"] === "boolean") {
    result.visibleOnly = obj["visibleOnly"];
  }
  if (typeof obj["redactPII"] === "boolean") {
    result.redactPII = obj["redactPII"];
  }
  if (Array.isArray(obj["allowedOrigins"])) {
    result.allowedOrigins = obj["allowedOrigins"] as string[];
  }
  if (Array.isArray(obj["deniedOrigins"])) {
    result.deniedOrigins = obj["deniedOrigins"] as string[];
  }

  return result;
}

/**
 * Narrow an unknown relay data payload to SemanticGraphResponse.
 * Returns undefined when the payload is not a valid SemanticGraphResponse.
 */
function narrowSemanticGraphResponse(data: unknown): SemanticGraphResponse | undefined {
  if (typeof data !== "object" || data === null) return undefined;

  const obj = data as Record<string, unknown>;

  // Required sub-tree arrays must be present
  if (
    !Array.isArray(obj["a11yTree"]) ||
    !Array.isArray(obj["landmarks"]) ||
    !Array.isArray(obj["outline"]) ||
    !Array.isArray(obj["forms"])
  ) {
    return undefined;
  }

  // pageUrl and title must be strings
  if (typeof obj["pageUrl"] !== "string" || typeof obj["title"] !== "string") {
    return undefined;
  }

  // Must carry a valid snapshot envelope
  if (!hasSnapshotEnvelope(data)) return undefined;

  return data as SemanticGraphResponse;
}

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Build the `browser_get_semantic_graph` tool definition.
 *
 * B2-SG-011: Registers a separate MCP tool with dangerLevel "safe"
 * and idempotent: true. Does not modify existing tools (B2-SG-012).
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store (5-slot FIFO per page)
 * @returns A single tool definition for `browser_get_semantic_graph`
 */
export function buildSemanticGraphTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_semantic_graph",
    description:
      "Extract the semantic structure of the current page: accessibility tree, " +
      "landmark regions, document heading outline (H1–H6), and form models " +
      "with field details. Returns all four sub-trees in a single call.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        maxDepth: {
          type: "integer",
          description:
            "Maximum depth for the accessibility tree (default: 8, max: 16).",
          minimum: 1,
          maximum: 16,
        },
        visibleOnly: {
          type: "boolean",
          description:
            "Exclude hidden elements from all sub-trees (default: true).",
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
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (rawArgs) => handleGetSemanticGraph(relay, narrowArgs(rawArgs), store, security),
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
 * Handler for `browser_get_semantic_graph`.
 *
 * Forwards the request through the relay to the content script's
 * `collectSemanticGraph()` function. On success, validates the
 * SnapshotEnvelope and persists the snapshot into the retention store.
 *
 * B2-SG-001..009: Semantic graph extraction with four sub-trees.
 * B2-SG-007: SnapshotEnvelope compliance + retention.
 * B2-SG-011: Safe, idempotent tool.
 * B2-SG-012: No effect on existing tools.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param args — Narrowed tool input arguments
 * @param store — Shared snapshot retention store
 * @param security — Security configuration (origin policy, redaction, audit)
 * @returns Semantic graph response or error
 */
async function handleGetSemanticGraph(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<SemanticGraphResponse | SemanticGraphToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as SemanticGraphToolError;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_semantic_graph", undefined, undefined);
  const startTime = Date.now();

  try {
    const payload: Record<string, unknown> = {};
    if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
    if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;

    const response = await relay.request(
      "get_semantic_graph",
      payload,
      SEMANTIC_GRAPH_TOOL_TIMEOUT_MS,
    );

    if (!response.success || response.data === undefined) {
      const errCode = response.error ?? "action-failed";
      const mappedError: SemanticGraphToolError["error"] =
        errCode === "browser-not-connected" ? "browser-not-connected"
        : errCode === "timeout" ? "timeout"
        : "action-failed";
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(mappedError) as SemanticGraphToolError;
    }

    // B2-SG-007: Validate SnapshotEnvelope and persist
    // F1: Origin policy check using the pageUrl from the relay response.
    // This runs after DOM access but BEFORE saving to the store,
    // ensuring blocked origins never reach the store or the caller.
    const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;
    if (relayPageUrl) {
      const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
      const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
      if (checkOrigin(origin, policy) === "block") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("origin-blocked") as SemanticGraphToolError;
      }
    }

    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }

    // Narrow the payload to SemanticGraphResponse with a runtime guard
    const narrowed = narrowSemanticGraphResponse(response.data);
    if (narrowed === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError("action-failed") as SemanticGraphToolError;
    }

    const result = narrowed;

    // F2: Apply redaction if requested (fail-closed)
    if (args.redactPII) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const redactionOccurred = redactSemanticGraphResponse(result as any, security.redactionPolicy);
        // redacted: true if patterns existed and matched content; false if no patterns or no matches
        result.redactionApplied = redactionOccurred;
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("redaction-failed") as SemanticGraphToolError;
      }
    } else {
      // F5: Redaction warning when redactPII is not set (unconditional per MCP-VC-005)
      result.redactionWarning = "PII may be present in response";
    }

    // F4: Add auditId to response
    result.auditId = auditEntry.auditId;

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!result.redactionApplied,
      durationMs: Date.now() - startTime,
    });

    // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
    return { ...result };
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as SemanticGraphToolError;
  }
}
