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

// ── Constants ────────────────────────────────────────────────────────────────

/** Relay timeout for text map collection (ms). */
export const TEXT_MAP_TIMEOUT_MS = 10_000;

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_get_text_map`.
 *
 * B2-TX-008: `maxSegments` caps the number of returned text segments.
 */
export interface GetTextMapArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Maximum number of text segments to return (default: 500, max: 2000). B2-TX-008. */
  maxSegments?: number;
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
}

/**
 * Error response from the text map tool (relay-level failures).
 */
export interface TextMapToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed";
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
): ExtensionToolDefinition {
  return {
    name: "browser_get_text_map",
    description:
      "Extract the text content of the current page as structured segments " +
      "with raw/normalized text, bounding boxes, visibility flags, " +
      "semantic context (role, accessible name), and reading-order indices.",
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
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetTextMap(relay, args as GetTextMapArgs, store),
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
 * @returns Text map response or error
 */
async function handleGetTextMap(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
): Promise<TextMapResponse | TextMapToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "get_text_map",
      args as Record<string, unknown>,
      TEXT_MAP_TIMEOUT_MS,
    );

    if (!response.success || response.data === undefined) {
      const errCode = response.error ?? "action-failed";
      const mappedError: TextMapToolError["error"] =
        errCode === "browser-not-connected" ? "browser-not-connected"
        : errCode === "timeout" ? "timeout"
        : "action-failed";
      return { success: false, error: mappedError };
    }

    const data = response.data;

    // B2-TX-007: Validate SnapshotEnvelope and persist
    if (hasSnapshotEnvelope(data)) {
      store.save(data.pageId, data as SnapshotEnvelopeFields);
    }

    return data as TextMapResponse;
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}
