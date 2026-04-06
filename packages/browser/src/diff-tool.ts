/**
 * M101-DIFF — Diff Snapshots MCP Tool
 *
 * Defines the `browser_diff_snapshots` MCP tool that lets agents compare
 * two page snapshots and see what changed — added, removed, and changed nodes.
 *
 * The tool handler forwards the request through the browser relay to the
 * Chrome extension's service worker, where the `SnapshotStore` holds full
 * snapshots with `NodeIdentity[]` data. The diff engine (`computeDiff`)
 * runs as a pure function in that context and returns the result.
 *
 * Implements B2-DE-001 through B2-DE-007.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import { SnapshotRetentionStore, RETENTION_SLOTS } from "./snapshot-retention.js";

/**
 * B2-SV-004 / GAP-G1: Eviction hint carried in `snapshot-not-found` errors
 * when the local retention store can infer that the snapshot was retained
 * once (therefore was evicted due to FIFO overflow) vs never existed.
 *
 * This makes diff failures actionable: the agent knows whether to
 * re-capture and retry, or to check the snapshot ID spelling.
 */
export interface EvictionHint {
  /** The snapshot ID the agent requested. */
  requestedSnapshotId: string;
  /** How many snapshots are retained per page (FIFO window size). */
  retentionWindow: number;
  /**
   * Whether the requested ID falls within the retention window but was
   * not found — strongly suggests it was evicted.
   */
  wasEvicted: boolean;
  /** Human-readable suggested next action for the agent. */
  suggestedAction: string;
}

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_diff_snapshots`.
 *
 * B2-DE-003: If `toSnapshotId` is omitted, capture a fresh snapshot as `to`.
 * B2-DE-004: If `fromSnapshotId` is omitted, use the snapshot before `toSnapshotId`.
 */
export interface DiffSnapshotsArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Earlier snapshot ID (baseline). If omitted, uses the snapshot before `toSnapshotId` (B2-DE-004). */
  fromSnapshotId?: string;
  /** Later snapshot ID (current). If omitted, captures a fresh snapshot (B2-DE-003). */
  toSnapshotId?: string;
}

// ── Diff Result Types (browser package contract) ─────────────────────────────

/**
 * A node that was added or removed between snapshots.
 */
export interface DiffNodeResult {
  nodeId: number;
  tag: string;
  text?: string;
  role?: string;
}

/**
 * A single field-level change on a matched node.
 */
export interface DiffChangeResult {
  nodeId: number;
  tag: string;
  field: string;
  before: string;
  after: string;
}

/**
 * Summary statistics for the diff.
 */
export interface DiffSummaryResult {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  textDelta: string;
}

/**
 * Successful diff response — extends `SnapshotEnvelopeFields` with the
 * envelope from the `to` snapshot.
 *
 * B2-DE-002: Contains `added`, `removed`, `changed` arrays.
 * B2-DE-005: Contains `summary` with counts matching array lengths.
 */
export interface DiffSnapshotsResponse extends SnapshotEnvelopeFields {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: DiffNodeResult[];
  removed: DiffNodeResult[];
  changed: DiffChangeResult[];
  summary: DiffSummaryResult;
}

/**
 * B2-DE-006 / B2-DE-007 / F-4: Structured diff error response.
 *
 * On `snapshot-not-found`, the `details` field carries an `EvictionHint`
 * when the local retention store can determine that the snapshot ID was
 * within the retention window at some point — implying FIFO eviction rather
 * than a never-existed ID. This makes eviction actionable for agents.
 *
 * On `snapshot-stale`, `details` carries the navigation version boundary
 * so the agent knows how far the snapshot drifted.
 *
 * Per MCP-ER-002, `snapshot-not-found` and `snapshot-stale` are
 * non-retryable: the agent must re-capture or check the snapshot ID.
 */
export interface DiffToolError {
  success: false;
  error: "snapshot-not-found" | "snapshot-stale" | "browser-not-connected" | "timeout" | "action-failed" | "implicit-snapshot-resolution-required";
  /** Per MCP-ER-002: retryable is true for transient errors, false for permanent ones */
  retryable: boolean;
  /** Per MCP-ER-002: suggested backoff for transient errors. */
  retryAfterMs?: number;
  /**
   * Structured detail about why the error occurred.
   * Present on `snapshot-not-found` (eviction analysis) and `snapshot-stale`
   * (navigation version boundary).
   */
  details?: {
    /** Present when the error is `snapshot-not-found` and eviction is inferred. */
    eviction?: EvictionHint;
    /** Present when the error is `snapshot-stale`: the version after navigation. */
    navigationBoundary?: { currentVersion: number };
    /** Human-readable description of the failure cause. */
    reason: string;
  };
}

function normalizeSnapshotId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const trimmed = id.trim();
  return trimmed === "" ? undefined : trimmed;
}

// ── Tool Timeout ─────────────────────────────────────────────────────────────

/**
 * MCP tool-level relay round-trip timeout.
 *
 * B2-PF-002 requires diff **computation** (pure diff engine in the service
 * worker) to complete within 1.0s. This constant covers the full relay
 * round-trip: WebSocket → service worker → diff engine → response. The
 * additional headroom accounts for relay serialization and transport latency.
 *
 * See docs/10-architecture/browser2.0-architecture.md §12.2 for the distinction between
 * computation budget and tool-level timeout.
 */
const DIFF_TIMEOUT_MS = 5_000;

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Build the `browser_diff_snapshots` tool definition.
 *
 * B2-DE-001: Tool is registered with `dangerLevel: "safe"` and `idempotent: true`.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store (for envelope persistence)
 * @returns A single tool definition for `browser_diff_snapshots`
 */
export function buildDiffSnapshotsTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_diff_snapshots",
    description:
      "Compare two page snapshots and return what changed — added nodes, removed nodes, and changed text/attributes. " +
      "If toSnapshotId is omitted, captures a fresh snapshot. If fromSnapshotId is omitted, uses the previous snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        fromSnapshotId: {
          type: "string",
          description: "Earlier snapshot ID (baseline). Omit to use the snapshot before toSnapshotId.",
        },
        toSnapshotId: {
          type: "string",
          description: "Later snapshot ID (current state). Omit to capture a fresh snapshot.",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleDiffSnapshots(relay, args as DiffSnapshotsArgs, store),
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

/**
 * Extract a known relay error code from a failed relay response.
 *
 * Checks two locations in priority order:
 *  1. `data.error` — used by the mock relay in tests and by some relay paths
 *     that embed the error inside the data object.
 *  2. `topLevelError` — the top-level `BrowserRelayResponse.error` field that
 *     the real relay-server populates when the Chrome extension returns a
 *     `{ success: false, error: "snapshot-not-found" }` response.
 *     The relay-server sets `response.data = parsed["data"]` (undefined) and
 *     `response.error = parsed["error"]` (the error string), so without this
 *     second check the code would never be found in production.
 *
 * Returns the code if it is a recognised string, otherwise undefined.
 */
function extractRelayErrorCode(
  data: unknown,
  topLevelError?: unknown,
): "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" | undefined {
  const isKnownCode = (
    code: unknown,
  ): code is "snapshot-not-found" | "snapshot-stale" | "implicit-snapshot-resolution-required" =>
    code === "snapshot-not-found" ||
    code === "snapshot-stale" ||
    code === "implicit-snapshot-resolution-required";

  // 1. Check data.error (test mock path and some relay paths)
  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error: unknown }).error;
    if (isKnownCode(code)) return code;
  }

  // 2. Check top-level response.error (real relay-server path: Chrome extension
  //    returns { success: false, error: "snapshot-not-found" }, relay-server sets
  //    response.data = undefined and response.error = the error string).
  if (isKnownCode(topLevelError)) return topLevelError;

  return undefined;
}

function buildTransientRelayError(topLevelError?: unknown): DiffToolError | undefined {
  if (topLevelError === "browser-not-connected") {
    return {
      success: false,
      error: "browser-not-connected",
      retryable: true,
      retryAfterMs: 2000,
    };
  }
  if (topLevelError === "timeout") {
    return {
      success: false,
      error: "timeout",
      retryable: true,
      retryAfterMs: 1000,
    };
  }
  return undefined;
}

/**
 * Resolve the `toSnapshotId` by capturing a fresh page snapshot via the relay.
 *
 * B2-DE-003: When `toSnapshotId` is omitted, the handler MUST resolve it before
 * calling `diff_snapshots` — not rely on the relay to fill it in.
 *
 * B2-CTX-002: When tabId is provided, it MUST be included in the get_page_map
 * payload so the fresh snapshot is captured from the correct tab.
 *
 * @returns The resolved snapshotId string, or a DiffToolError to propagate.
 */
async function resolveFreshSnapshot(
  relay: BrowserRelayLike,
  tabId?: number,
): Promise<string | DiffToolError> {
  const payload: Record<string, unknown> = {};
  if (tabId !== undefined) {
    payload.tabId = tabId;
  }
  let freshResponse: Awaited<ReturnType<BrowserRelayLike["request"]>>;
  try {
    freshResponse = await relay.request("get_page_map", payload, DIFF_TIMEOUT_MS);
  } catch (err: unknown) {
    const error = classifyRelayError(err);
    return {
      success: false,
      error,
      retryable: true,
      retryAfterMs: error === "browser-not-connected" ? 2000 : 1000,
    };
  }

  if (!freshResponse.success) {
    const code = extractRelayErrorCode(freshResponse.data, freshResponse.error);
    if (code !== undefined) return { success: false, error: code, retryable: false };
    const transient = buildTransientRelayError(freshResponse.error);
    if (transient !== undefined) return transient;
    return { success: false, error: "action-failed", retryable: false };
  }

  if (hasSnapshotEnvelope(freshResponse.data)) {
    return freshResponse.data.snapshotId;
  }

  return { success: false, error: "action-failed", retryable: false };
}

/**
 * Derive the implicit `fromSnapshotId` (previous snapshot) from `toSnapshotId`.
 *
 * B2-DE-004: When `fromSnapshotId` is omitted, the handler resolves it locally
 * from the explicit `toSnapshotId` format by deriving `pageId:(version - 1)`.
 * This avoids side effects from extra captures while keeping the contract
 * deterministic for callers.
 *
 * @returns The derived fromSnapshotId string, or a DiffToolError to propagate.
 */
async function resolveFromSnapshot(
  toSnapshotId: string,
): Promise<string | DiffToolError> {
  // Compute previous snapshot via version arithmetic on toSnapshotId.
  // Format: "{pageId}:{version}" — derive "{pageId}:{version - 1}".
  const lastColon = toSnapshotId.lastIndexOf(":");
  if (lastColon === -1) {
    return { success: false, error: "action-failed", retryable: false };
  }
  const pageId = toSnapshotId.slice(0, lastColon);
  const version = parseInt(toSnapshotId.slice(lastColon + 1), 10);
  if (isNaN(version) || version <= 0) {
    return { success: false, error: "action-failed", retryable: false };
  }
  return `${pageId}:${version - 1}`;
}

function findMissingSnapshotId(
  store: SnapshotRetentionStore,
  fromSnapshotId: string,
  toSnapshotId: string,
): string {
  const hasFrom = store.get(fromSnapshotId) !== undefined;
  const hasTo = store.get(toSnapshotId) !== undefined;

  if (!hasFrom && hasTo) return fromSnapshotId;
  if (!hasTo && hasFrom) return toSnapshotId;
  return fromSnapshotId;
}

// ── Eviction Analysis ─────────────────────────────────────────────────────────

/**
 * B2-DE-006 / F-4: Analyze a missing snapshot ID against the local retention
 * store to determine whether it was likely evicted (vs never existed).
 *
 * Strategy: parse the requested version from `snapshotId`, compare against
 * the newest and oldest currently-retained versions for the same pageId.
 * If the missing version is older than the oldest retained AND the store is
 * at capacity, the snapshot was almost certainly evicted.
 *
 * @param store - The local retention store
 * @param requestedId - The snapshot ID that was not found
 * @returns An EvictionHint if analysis is possible, otherwise undefined
 */
function analyzeEviction(
  store: SnapshotRetentionStore,
  requestedId: string,
): EvictionHint | undefined {
  const lastColon = requestedId.lastIndexOf(":");
  if (lastColon === -1) return undefined;
  const pageId = requestedId.slice(0, lastColon);
  const requestedVersion = parseInt(requestedId.slice(lastColon + 1), 10);
  if (isNaN(requestedVersion)) return undefined;

  const slots = store.list(pageId);
  if (slots.length === 0) return undefined;

  const versions = slots
    .map((s) => {
      const lc = s.snapshotId.lastIndexOf(":");
      return lc === -1 ? -1 : parseInt(s.snapshotId.slice(lc + 1), 10);
    })
    .filter((v) => v >= 0);

  if (versions.length === 0) return undefined;

  const newestVersion = Math.max(...versions);
  const oldestVersion = Math.min(...versions);

  // The snapshot was likely evicted if:
  // 1. The store is at (or near) capacity — only true when it has been accumulating
  // 2. The missing version is older than the oldest retained version
  const wasEvicted =
    slots.length >= RETENTION_SLOTS && requestedVersion < oldestVersion;

  const suggestedAction = wasEvicted
    ? `Snapshot ${requestedId} was evicted (retention window: ${RETENTION_SLOTS} snapshots). ` +
      `Capture a fresh snapshot and retry the diff.`
    : `Snapshot ${requestedId} was not found in retention store. ` +
      `Check the snapshot ID spelling, or capture a fresh snapshot.`;

  return {
    requestedSnapshotId: requestedId,
    retentionWindow: RETENTION_SLOTS,
    wasEvicted,
    suggestedAction,
  };
}

// ── Tool Handler ─────────────────────────────────────────────────────────────

/**
 * Handler for `browser_diff_snapshots`.
 *
 * Forwards to the Chrome relay's `diff_snapshots` action and returns
 * the structured diff result. The actual diff computation happens in the
 * service worker context (where `SnapshotStore` has full node data).
 *
 * B2-DE-001: Tool exists with correct metadata.
 * B2-DE-002: Returns `added`, `removed`, `changed` arrays.
 * B2-DE-003: Implicit `to` (fresh capture) when `toSnapshotId` omitted.
 * B2-DE-004: Implicit `from` (previous snapshot) when `fromSnapshotId` omitted.
 * B2-DE-005: Returns `summary` with matching counts.
 * B2-DE-006: Returns `snapshot-not-found` error for missing snapshots.
 * B2-DE-007: Returns `snapshot-stale` error for pre-navigation snapshots.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param args — Tool input arguments
 * @param store — Shared snapshot retention store
 * @returns Diff result or error
 */
export async function handleDiffSnapshots(
  relay: BrowserRelayLike,
  args: DiffSnapshotsArgs,
  store: SnapshotRetentionStore,
): Promise<DiffSnapshotsResponse | DiffToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", retryable: true, retryAfterMs: 2000 };
  }

  // ── B2-DE-003: Resolve implicit toSnapshotId ─────────────────────────────
  // When toSnapshotId is omitted, capture a fresh snapshot and use it as `to`.
  // The handler MUST resolve this before calling diff_snapshots.
  let resolvedToSnapshotId = normalizeSnapshotId(args.toSnapshotId);
  if (resolvedToSnapshotId === undefined) {
    const resolved = await resolveFreshSnapshot(relay, args.tabId);
    if (typeof resolved !== "string") return resolved; // propagate error
    resolvedToSnapshotId = resolved;
  }

  // ── B2-DE-004: Resolve implicit fromSnapshotId ────────────────────────────
  // When fromSnapshotId is omitted, derive the previous snapshot from toSnapshotId.
  // The handler MUST resolve this before calling diff_snapshots.
  let resolvedFromSnapshotId = normalizeSnapshotId(args.fromSnapshotId);
  if (resolvedFromSnapshotId === undefined) {
    const resolved = await resolveFromSnapshot(resolvedToSnapshotId);
    // Propagate DiffToolError (which has retryable: false)
    if (typeof resolved !== "string") return resolved;
    resolvedFromSnapshotId = resolved;
  }

  try {
    const response = await relay.request(
      "diff_snapshots",
      {
        fromSnapshotId: resolvedFromSnapshotId,
        toSnapshotId: resolvedToSnapshotId,
      },
      DIFF_TIMEOUT_MS,
    );

    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "added" in response.data &&
      "removed" in response.data &&
      "changed" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      // Persist the diff result's envelope for retention tracking
      store.save(response.data.pageId, response.data);
      return response.data as DiffSnapshotsResponse;
    }

    // Check for known diff error codes (B2-DE-006, B2-DE-007 and relay-level)
    if (!response.success) {
      const code = extractRelayErrorCode(response.data, response.error);
      if (code !== undefined) {
        // B2-DE-006 / F-4: Enrich snapshot-not-found with eviction hint
        if (code === "snapshot-not-found") {
          const snapshotIdForAnalysis = findMissingSnapshotId(
            store,
            resolvedFromSnapshotId,
            resolvedToSnapshotId,
          );
          const eviction = analyzeEviction(store, snapshotIdForAnalysis);
          return {
            success: false,
            error: code,
            retryable: false,
            details: {
              eviction,
              reason: eviction?.wasEvicted
                ? `Snapshot '${eviction.requestedSnapshotId}' was evicted from the ${RETENTION_SLOTS}-slot FIFO retention store.`
                : `Snapshot '${eviction?.requestedSnapshotId ?? snapshotIdForAnalysis}' was not found in the retention store.`,
            },
          };
        }
        // B2-DE-007: snapshot-stale — non-retryable
        if (code === "snapshot-stale") {
          return { success: false, error: code, retryable: false };
        }
        return { success: false, error: code, retryable: false };
      }
      const transient = buildTransientRelayError(response.error);
      if (transient !== undefined) return transient;
    }

    return { success: false, error: "action-failed", retryable: false };
  } catch (err: unknown) {
    const error = classifyRelayError(err);
    return {
      success: false,
      error,
      retryable: true,
      retryAfterMs: error === "browser-not-connected" ? 2000 : 1000,
    };
  }
}
