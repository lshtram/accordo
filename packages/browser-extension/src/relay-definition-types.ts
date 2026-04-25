export type RelayAction =
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
  | "manage_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page"
  | "get_spatial_relations"
  | "navigate"
  | "click"
  | "type"
  | "press_key"
  | "focus_thread";

export interface RelayActionRequest {
  requestId: string;
  action: RelayAction;
  payload: Record<string, unknown>;
}

export interface RelayActionResponse {
  requestId: string;
  success: boolean;
  /**
   * B2-SV-003: For data-producing tool responses, the full SnapshotEnvelope
   * is included inside `data`. The relay forwards the envelope created by
   * the content script without modification. This top-level `snapshotId`
   * is retained for backward compatibility on error responses only.
   */
  snapshotId?: string;
  data?: unknown;
  /**
   * MCP-SEC-004: UUIDv4 audit identifier for this tool invocation.
   * Present on all responses (success and failure) for traceability.
   */
  auditId?: string;
  /**
   * MCP-SEC-005: Present when redactPII is false/omitted on text-producing
   * read tools. Warns callers that PII may be present in the response.
   */
  redactionWarning?: string;
  error?:
    | "action-failed"
    | "unsupported-action"
    | "invalid-request"
    | "no-target"
    | "capture-failed"
    | "image-too-large"
    | "snapshot-not-found"
    | "snapshot-stale"
    | "navigation-interrupted"
    | "page-closed"
    | "control-not-granted"
    | "tab-not-found"
    | "unsupported-page"
    | "element-not-found"
    | "element-not-focusable"
    | "element-off-screen"
    | "iframe-cross-origin"
    | "no-content-script"
    | "origin-blocked"
    | "redaction-failed";
  /**
   * MCP-ER-002: Whether the error is retryable.
   * Present on error responses only.
   */
  retryable?: boolean;
  /** Index signature — allows RelayActionResponse to satisfy Record<string, unknown> */
  [key: string]: unknown;
}

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
