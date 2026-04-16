/**
 * @accordo/bridge-types — Browser Relay Shared Contract
 *
 * Type definitions for the communication protocol between Hub clients
 * (browser package) and the browser extension relay server.
 *
 * These types are runtime-free — no functions, no classes, no Chrome/Node APIs.
 * They represent the wire contract shared between two packages.
 *
 * What stays local (NOT here):
 *   - hasSnapshotEnvelope()          → packages/browser/src/types.ts
 *   - BrowserRelayLike interface     → packages/browser/src/types.ts (browser-specific runtime)
 *   - BrowserBridgeAPI interface     → packages/browser/src/types.ts (VSCode extension host API)
 *   - actionFailed(), getErrorMeta() → packages/browser-extension/src/relay-definitions.ts (local error policy)
 *   - isVersionedSnapshot()           → packages/browser-extension/src/relay-definitions.ts (needs VersionedSnapshot)
 *   - SnapshotManager, SnapshotStore → packages/browser-extension/src/snapshot-versioning.ts (Chrome runtime)
 *   - VersionedSnapshot              → packages/browser-extension/src/snapshot-versioning.ts (Chrome runtime)
 *   - RelayActionResponse audit/redaction fields → packages/browser-extension/src/relay-definitions.ts (extension-specific)
 *
 * @module
 */

// ── Action Union ───────────────────────────────────────────────────────────────

/**
 * Canonical union of all browser relay actions.
 *
 * Covers the full surface used by both the browser (client) and browser-extension (server).
 * The browser-extension supports `capture_full_page_screenshot` which the browser does not
 * invoke directly — it is included here for completeness so the union covers the full
 * relay surface.
 */
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
  | "capture_full_page_screenshot"
  | "diff_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page"
  | "navigate"
  | "click"
  | "type"
  | "press_key"
  | "get_spatial_relations";

// ── Snapshot Envelope ──────────────────────────────────────────────────────────

/**
 * Valid source types for a snapshot.
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

// ── Relay Request / Response ───────────────────────────────────────────────────

/**
 * Browser relay request envelope — the wire format for relay requests
 * sent from the browser package to the browser-extension relay server.
 */
export interface BrowserRelayRequest {
  requestId: string;
  action: BrowserRelayAction;
  payload: Record<string, unknown>;
}

/**
 * Browser relay response envelope — the wire format for relay responses
 * returned from the browser-extension relay server to the browser package.
 *
 * Note: The browser-extension adds `auditId` and `redactionWarning` fields
 * to this envelope at the relay layer. Those extension-specific fields are
 * NOT included here — they are added by the extension's relay handler.
 */
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
  error?: string;
}

/**
 * Known error codes for browser relay responses.
 *
 * These are the shared error codes known to both the browser and browser-extension.
 * The `BrowserRelayResponse.error` field is typed as `string` to accommodate
 * extension-specific codes beyond this union (e.g. "image-too-large",
 * "unsupported-page", "snapshot-not-found") that the browser-extension may
 * return. Consumers that need to recognise known codes may narrow using
 * `BrowserRelayError.includes(errorCode)`.
 *
 * Extension-specific error codes (e.g., "image-too-large", "unsupported-page")
 * are NOT included here — they remain browser-extension-internal.
 */
export type BrowserRelayError =
  | "browser-not-connected"
  | "unauthorized"
  | "timeout"
  | "action-failed"
  | "invalid-request"
  | "navigation-interrupted"
  | "page-closed"
  | "iframe-cross-origin"
  | "no-content-script";

// ── Capture Payload ────────────────────────────────────────────────────────────

/**
 * Payload shape for the capture_region relay action.
 * Shared between browser (client) and browser-extension (server).
 */
export interface CapturePayload {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
  /** P4-CR: "viewport" (default) or "fullPage" */
  mode?: "viewport" | "fullPage";
  /** GAP-E1 / E4: Output image format — "jpeg" (default), "png", or "webp" */
  format?: "jpeg" | "png" | "webp";
  /** GAP-I1: Redaction regex patterns to apply to screenshot (bbox-based). */
  redactPatterns?: string[];
}
