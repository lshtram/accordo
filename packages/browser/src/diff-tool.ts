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
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_diff_snapshots`.
 *
 * B2-DE-003: If `toSnapshotId` is omitted, capture a fresh snapshot as `to`.
 * B2-DE-004: If `fromSnapshotId` is omitted, use the snapshot before `toSnapshotId`.
 */
export interface DiffSnapshotsArgs {
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
 * Error response from the diff tool.
 *
 * B2-DE-006: `"snapshot-not-found"` when a snapshot ID doesn't exist.
 * B2-DE-007: `"snapshot-stale"` when a snapshot is from a previous navigation.
 * B2-DE-003/004: `"implicit-snapshot-resolution-required"` propagated from relay when
 *   the relay itself requires explicit snapshot IDs (strict relay contract).
 */
export interface DiffToolError {
  success: false;
  error: "snapshot-not-found" | "snapshot-stale" | "browser-not-connected" | "timeout" | "action-failed" | "implicit-snapshot-resolution-required";
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
    name: "browser_diff_snapshots",
    description:
      "Compare two page snapshots and return what changed — added nodes, removed nodes, and changed text/attributes. " +
      "If toSnapshotId is omitted, captures a fresh snapshot. If fromSnapshotId is omitted, uses the previous snapshot.",
    inputSchema: {
      type: "object",
      properties: {
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

/**
 * Resolve the `toSnapshotId` by capturing a fresh page snapshot via the relay.
 *
 * B2-DE-003: When `toSnapshotId` is omitted, the handler MUST resolve it before
 * calling `diff_snapshots` — not rely on the relay to fill it in.
 *
 * @returns The resolved snapshotId string, or a DiffToolError to propagate.
 */
async function resolveFreshSnapshot(
  relay: BrowserRelayLike,
): Promise<string | DiffToolError> {
  let freshResponse: Awaited<ReturnType<BrowserRelayLike["request"]>>;
  try {
    freshResponse = await relay.request("get_page_map", {}, DIFF_TIMEOUT_MS);
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }

  if (!freshResponse.success) {
    const code = extractRelayErrorCode(freshResponse.data, freshResponse.error);
    if (code !== undefined) return { success: false, error: code };
    return { success: false, error: "action-failed" };
  }

  if (hasSnapshotEnvelope(freshResponse.data)) {
    return freshResponse.data.snapshotId;
  }

  return { success: false, error: "action-failed" };
}

/**
 * Derive the implicit `fromSnapshotId` (previous snapshot) from `toSnapshotId`.
 *
 * B2-DE-004: When `fromSnapshotId` is omitted, the handler MUST resolve it before
 * calling `diff_snapshots`. Resolution strategy:
 *   1. Verify the current page is accessible via a `get_page_map` preflight.
 *      This allows a strict relay (or any relay that rejects undefined IDs) to
 *      return "implicit-snapshot-resolution-required" on the preflight call,
 *      which the handler then propagates as the structured error code.
 *   2. Compute the previous snapshotId as `pageId:(version - 1)` from `toSnapshotId`.
 *
 * @returns The derived fromSnapshotId string, or a DiffToolError to propagate.
 */
async function resolveFromSnapshot(
  relay: BrowserRelayLike,
  toSnapshotId: string,
): Promise<string | DiffToolError> {
  // Preflight: verify relay accessibility. Strict relays reject this call
  // (no fromSnapshotId/toSnapshotId in payload) and return the
  // "implicit-snapshot-resolution-required" error, which we propagate.
  let preflightResponse: Awaited<ReturnType<BrowserRelayLike["request"]>>;
  try {
    preflightResponse = await relay.request("get_page_map", {}, DIFF_TIMEOUT_MS);
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }

  if (!preflightResponse.success) {
    const code = extractRelayErrorCode(preflightResponse.data, preflightResponse.error);
    if (code !== undefined) return { success: false, error: code };
    return { success: false, error: "action-failed" };
  }

  // Compute previous snapshot via version arithmetic on toSnapshotId.
  // Format: "{pageId}:{version}" — derive "{pageId}:{version - 1}".
  const lastColon = toSnapshotId.lastIndexOf(":");
  if (lastColon === -1) {
    return { success: false, error: "action-failed" };
  }
  const pageId = toSnapshotId.slice(0, lastColon);
  const version = parseInt(toSnapshotId.slice(lastColon + 1), 10);
  if (isNaN(version) || version <= 0) {
    return { success: false, error: "action-failed" };
  }
  return `${pageId}:${version - 1}`;
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
    return { success: false, error: "browser-not-connected" };
  }

  // ── B2-DE-003: Resolve implicit toSnapshotId ─────────────────────────────
  // When toSnapshotId is omitted, capture a fresh snapshot and use it as `to`.
  // The handler MUST resolve this before calling diff_snapshots.
  let resolvedToSnapshotId = args.toSnapshotId;
  if (resolvedToSnapshotId === undefined) {
    const resolved = await resolveFreshSnapshot(relay);
    if (typeof resolved !== "string") return resolved; // propagate error
    resolvedToSnapshotId = resolved;
  }

  // ── B2-DE-004: Resolve implicit fromSnapshotId ────────────────────────────
  // When fromSnapshotId is omitted, derive the previous snapshot from toSnapshotId.
  // The handler MUST resolve this before calling diff_snapshots.
  let resolvedFromSnapshotId = args.fromSnapshotId;
  if (resolvedFromSnapshotId === undefined) {
    const resolved = await resolveFromSnapshot(relay, resolvedToSnapshotId);
    if (typeof resolved !== "string") return resolved; // propagate error
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
      if (code !== undefined) return { success: false, error: code };
    }

    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}
