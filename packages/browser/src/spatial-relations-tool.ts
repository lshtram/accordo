/**
 * GAP-D1 — Spatial Relations MCP Tool
 *
 * Defines the `browser_get_spatial_relations` MCP tool that gives AI agents
 * the ability to query pairwise spatial relationships between page elements.
 *
 * The tool takes a list of node IDs (from a prior `get_page_map` call with
 * `includeBounds: true`) and returns directional, containment, overlap, and
 * distance relationships for all pairs.
 *
 * Satisfies checklist item D2: Relative geometry helpers.
 *
 * Architecture:
 * - Tool definition + handler live here (follows `semantic-graph-tool.ts` pattern)
 * - Geometry computation runs in the content script (`spatial-helpers.ts`)
 * - Relay action: `get_spatial_relations`
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import {
  buildStructuredError,
  classifyRelayError,
  SPATIAL_RELATIONS_TIMEOUT_MS,
  type GetSpatialRelationsArgs,
  type SpatialRelationsResponse,
  type PageToolError,
} from "./page-tool-types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of node IDs accepted per request. O(n²) pairwise = 1,225 pairs max. */
export const MAX_SPATIAL_NODE_IDS = 50;

// ── Tool Result Types ────────────────────────────────────────────────────────

/**
 * A single pairwise spatial relationship between two nodes.
 */
export interface SpatialRelation {
  /** Source node ID */
  readonly sourceNodeId: number;
  /** Target node ID */
  readonly targetNodeId: number;
  /** True when source center is to the left of target center */
  readonly leftOf: boolean;
  /** True when source center is above target center */
  readonly above: boolean;
  /** True when source fully contains target */
  readonly contains: boolean;
  /** True when target fully contains source */
  readonly containedBy: boolean;
  /** Intersection-over-union ratio (0–1) */
  readonly overlap: number;
  /** Center-to-center distance in CSS px */
  readonly distance: number;
}

/**
 * Error response from the spatial relations tool.
 * Uses canonical BrowserToolErrorCode union from page-tool-types.
 */
export interface SpatialRelationsToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "origin-blocked" | "too-many-nodes" | "no-bounds";
}

// ── Runtime type guards ──────────────────────────────────────────────────────

/**
 * Narrow an unknown value to GetSpatialRelationsArgs.
 * Validates required fields and extracts only the typed fields.
 * B2-UID-001: accepts either nodeIds or uids (at least one required).
 */
function narrowArgs(raw: unknown): GetSpatialRelationsArgs | null {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  const result: GetSpatialRelationsArgs = {};

  // nodeIds: optional array of numbers
  if (Array.isArray(obj["nodeIds"])) {
    const nodeIds = (obj["nodeIds"] as unknown[]).filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id) && id >= 0,
    );
    if (nodeIds.length > 0) result.nodeIds = nodeIds;
  }

  // B2-UID-001: uids: optional array of strings
  if (Array.isArray(obj["uids"])) {
    const uids = (obj["uids"] as unknown[]).filter(
      (uid): uid is string => typeof uid === "string" && uid.length > 0,
    );
    if (uids.length > 0) result.uids = uids;
  }

  // At least one of nodeIds or uids must be non-empty
  const hasNodeIds = Array.isArray(obj["nodeIds"]) && (obj["nodeIds"] as unknown[]).length > 0;
  const hasUids = Array.isArray(obj["uids"]) && (obj["uids"] as unknown[]).length > 0;
  if (!hasNodeIds && !hasUids) return null;

  if (typeof obj["tabId"] === "number") {
    result.tabId = obj["tabId"];
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
 * Narrow an unknown relay data payload to SpatialRelationsResponse.
 * Returns undefined when the payload is not valid.
 */
function narrowSpatialRelationsResponse(data: unknown): SpatialRelationsResponse | undefined {
  if (typeof data !== "object" || data === null) return undefined;

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj["relations"])) return undefined;
  if (typeof obj["nodeCount"] !== "number") return undefined;
  if (typeof obj["pairCount"] !== "number") return undefined;
  if (typeof obj["pageUrl"] !== "string") return undefined;

  if (!hasSnapshotEnvelope(data)) return undefined;

  return data as SpatialRelationsResponse;
}

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Build the `browser_get_spatial_relations` tool definition.
 *
 * GAP-D1: Registers a separate MCP tool with dangerLevel "safe"
 * and idempotent: true. Takes node IDs from a prior page map and
 * returns pairwise spatial relationships.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store
 * @param security — Security configuration
 * @returns A single tool definition for `browser_get_spatial_relations`
 */
export function buildSpatialRelationsTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_spatial_relations",
    description:
      "Compute pairwise spatial relationships between page elements. " +
      "Takes node IDs or uids from a prior get_page_map call (with includeBounds: true) " +
      "and returns directional (leftOf, above), containment, overlap (IoU), " +
      "and distance relationships for all pairs. Maximum 50 node IDs per request. " +
      "B2-UID-001: Pass uids (\"{frameId}:{nodeId}\") instead of nodeIds for cross-frame identity.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        nodeIds: {
          type: "array",
          items: { type: "integer" },
          description:
            "Node IDs from a prior get_page_map call (with includeBounds: true). " +
            "Maximum 50 IDs — pairwise computation is O(n²). Alternative to uids.",
          minItems: 1,
          maxItems: 50,
        },
        /** B2-UID-001: Canonical uid strings "{frameId}:{nodeId}". Alternative to nodeIds. */
        uids: {
          type: "array",
          items: { type: "string" },
          description:
            "Canonical node identities from a prior get_page_map call. " +
            'Format: "{frameId}:{nodeId}" (e.g. "main:3"). Alternative to nodeIds.',
          minItems: 1,
          maxItems: 50,
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
      // At least one of nodeIds or uids is required — validated by narrowArgs at runtime
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: async (rawArgs) => {
      const args = narrowArgs(rawArgs);
      if (!args) {
        return buildStructuredError(
          "action-failed",
          "nodeIds or uids is required and must be a non-empty array",
        );
      }
      const nodeIds = args.nodeIds ?? [];
      const totalIds = nodeIds.length + (args.uids?.length ?? 0);
      if (totalIds > MAX_SPATIAL_NODE_IDS) {
        return buildStructuredError(
          "too-many-nodes",
          `Maximum ${MAX_SPATIAL_NODE_IDS} IDs allowed, got ${totalIds}`,
        );
      }
      return handleGetSpatialRelations(relay, args, store, security);
    },
  };
}

// ── Tool Handler ─────────────────────────────────────────────────────────────

/**
 * Handler for `browser_get_spatial_relations`.
 *
 * Forwards the request through the relay to the content script's
 * spatial helpers. On success, validates the SnapshotEnvelope and
 * persists the snapshot into the retention store.
 *
 * GAP-D1: Spatial relationship computation.
 * - D2: leftOf, above, contains, overlap, distance
 * - Pairwise for requested node IDs
 * - Capped at 50 nodes (O(n²) = 1,225 pairs max)
 *
 * @param relay — The relay connection to the Chrome extension
 * @param args — Narrowed tool input arguments
 * @param store — Shared snapshot retention store
 * @param security — Security configuration
 * @returns Spatial relations response or error
 */
async function handleGetSpatialRelations(
  relay: BrowserRelayLike,
  args: GetSpatialRelationsArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<SpatialRelationsResponse | SpatialRelationsToolError | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as SpatialRelationsToolError;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry(
    "accordo_browser_get_spatial_relations",
    undefined,
    undefined,
  );
  const startTime = Date.now();

  try {
    const payload: Record<string, unknown> = {};
    // B2-UID-001: Pass at least one of nodeIds or uids
    if (args.nodeIds !== undefined && args.nodeIds.length > 0) {
      payload["nodeIds"] = args.nodeIds;
    }
    if (args.uids !== undefined && args.uids.length > 0) {
      payload["uids"] = args.uids;
    }
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;

    const response = await relay.request(
      "get_spatial_relations",
      payload,
      SPATIAL_RELATIONS_TIMEOUT_MS,
    );

    if (!response.success || response.data === undefined) {
      const errCode = response.error ?? "action-failed";
      const mappedError: SpatialRelationsToolError["error"] =
        errCode === "browser-not-connected" ? "browser-not-connected"
        : errCode === "timeout" ? "timeout"
        : "action-failed";
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(mappedError) as SpatialRelationsToolError;
    }

    // F1: Origin policy check using the pageUrl from the relay response
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
        return buildStructuredError("origin-blocked") as SpatialRelationsToolError;
      }
    }

    // Validate SnapshotEnvelope and persist
    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }

    // Narrow the payload with a runtime guard
    const narrowed = narrowSpatialRelationsResponse(response.data);
    if (narrowed === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError("action-failed") as SpatialRelationsToolError;
    }

    const result = { ...narrowed };

    // F4: Add auditId to response
    result.auditId = auditEntry.auditId;

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: false,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as SpatialRelationsToolError;
  }
}
