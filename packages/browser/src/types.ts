import type { ExtensionToolDefinition } from "@accordo/bridge-types";

export type BrowserRelayAction =
  | "get_all_comments"
  | "get_comments"
  | "get_comments_version"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread"
  | "notify_comments_updated"
  | "get_page_map"
  | "inspect_element"
  | "get_dom_excerpt"
  | "capture_region"
  | "diff_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page"
  | "navigate"
  | "click"
  | "type"
  | "press_key";

// ── Snapshot Envelope (shared contract) ──────────────────────────────────────

/**
 * Valid source types for a snapshot.
 * Mirrors `SnapshotSource` in browser-extension/snapshot-versioning.ts.
 */
export type SnapshotSource = "dom" | "a11y" | "visual" | "layout" | "network";

/**
 * Viewport dimensions and scroll position at capture time.
 */
export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

/**
 * B2-SV-003: Canonical metadata envelope included in all data-producing
 * tool responses. This is the shared contract between the browser-extension
 * (which mints envelopes) and the browser package (which consumes them).
 *
 * All four data-producing tools (get_page_map, inspect_element,
 * get_dom_excerpt, capture_region) embed these fields in their response.
 */
export interface SnapshotEnvelopeFields {
  /** Stable page identifier. */
  pageId: string;
  /** Frame identifier. Top-level frame = "main". */
  frameId: string;
  /** Monotonically increasing snapshot version. Format: {pageId}:{version} */
  snapshotId: string;
  /** ISO 8601 timestamp when snapshot was captured. */
  capturedAt: string;
  /** Viewport state at capture time. */
  viewport: Viewport;
  /** Data source type. */
  source: SnapshotSource;
  /** Unique audit ID for this capture (UUIDv4). I3-001. Optional — set by MCP handler. */
  auditId?: string;
  /** Page URL from which this snapshot was captured. Optional — available after first successful response. */
  pageUrl?: string;
}

/**
 * Runtime type guard for SnapshotEnvelopeFields.
 * Validates that an unknown value contains all required envelope fields.
 */
export function hasSnapshotEnvelope(value: unknown): value is SnapshotEnvelopeFields {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pageId === "string" &&
    typeof v.frameId === "string" &&
    typeof v.snapshotId === "string" &&
    typeof v.capturedAt === "string" &&
    typeof v.viewport === "object" && v.viewport !== null &&
    typeof v.source === "string"
  );
}

// ── Relay Request/Response ───────────────────────────────────────────────────

export interface BrowserRelayRequest {
  requestId: string;
  action: BrowserRelayAction;
  payload: Record<string, unknown>;
}

export interface BrowserRelayResponse {
  requestId: string;
  success: boolean;
  /**
   * B2-SV-003: Deprecated at the top level. For data-producing tool responses
   * (get_page_map, inspect_element, get_dom_excerpt, capture_region), the full
   * SnapshotEnvelope (pageId, frameId, snapshotId, capturedAt, viewport, source)
   * is embedded inside `data` by the content script. The relay passes through
   * this envelope without modification. Top-level `snapshotId` is retained only
   * for backward compatibility on error responses; callers should prefer
   * reading the envelope from `data` on success responses.
   */
  snapshotId?: string;
  data?: unknown;
  error?: "browser-not-connected" | "unauthorized" | "timeout" | "action-failed" | "invalid-request" | "navigation-interrupted" | "page-closed";
}

export interface BrowserRelayLike {
  request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs?: number): Promise<BrowserRelayResponse>;
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void;
  isConnected(): boolean;
  /** Returns the CDP debugger WebSocket URL if connected. Undefined when disconnected. */
  getDebuggerUrl?(): string;
  /**
   * Optional error listener: the relay calls this whenever it returns an error
   * response (e.g. browser-not-connected, timeout). The subscriber can use this
   * to populate a local error ring buffer (e.g. for browser_health).
   */
  onError?(error: string): void;
  /**
   * Optional interceptor: if set, the relay calls this instead of forwarding
   * to Chrome. The extension uses this to route browser events through the
   * unified comment_* tools.
   *
   * Return a BrowserRelayResponse to short-circuit the Chrome round-trip.
   */
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;
}

export interface BrowserBridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
  /**
   * Invoke a registered tool directly, routing Chrome relay events through
   * unified comment_* tools.
   */
  invokeTool(toolName: string, args: Record<string, unknown>, timeout?: number): Promise<unknown>;
}
