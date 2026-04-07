/**
 * @accordo/bridge-types
 *
 * Shared TypeScript type definitions for the Accordo IDE system.
 * All types used across Hub, Bridge, and Editor packages live here.
 *
 * This barrel re-exports every public symbol from the domain files.
 * Consumers always import from "@accordo/bridge-types" — no subpath imports.
 *
 * Domain files:
 *   - ide-types.ts      — IDE state snapshot (IDEState, OpenTab)
 *   - tool-types.ts     — Tool registration and schemas
 *   - ws-types.ts       — WebSocket message types (Hub ↔ Bridge)
 *   - comment-types.ts  — Comment system types and scale constants
 *   - constants.ts      — Protocol constants, audit, health, reauth, concurrency
 */

// ─── IDE State ──────────────────────────────────────────────────────────────

export { OPEN_TAB_TYPES } from "./ide-types.js";
export type { OpenTab, IDEState } from "./ide-types.js";

// ─── Tool Registration ──────────────────────────────────────────────────────

export type {
  ExtensionToolDefinition,
  DangerLevel,
  ToolRegistration,
  ToolInputSchema,
  ToolPropertySchema,
  McpTool,
} from "./tool-types.js";

// ─── WebSocket Messages ─────────────────────────────────────────────────────

export type {
  InvokeMessage,
  CancelMessage,
  GetStateMessage,
  PingMessage,
  HubToBridgeMessage,
  ResultMessage,
  StateUpdateMessage,
  StateSnapshotMessage,
  ToolRegistryMessage,
  PongMessage,
  CancelledMessage,
  BridgeToHubMessage,
  WsMessage,
} from "./ws-types.js";

// ─── Comment Types ──────────────────────────────────────────────────────────

export type {
  CommentAnchor,
  CommentAnchorText,
  CommentAnchorSurface,
  CommentAnchorFile,
  CommentRange,
  SurfaceType,
  SurfaceCoordinates,
  NormalizedCoordinates,
  DiagramNodeCoordinates,
  PdfPageCoordinates,
  SlideCoordinates,
  HeadingCoordinates,
  BlockCoordinates,
  AccordoComment,
  CommentAuthor,
  CommentIntent,
  CommentStatus,
  CommentRetention,
  CommentContext,
  CommentDiagnostic,
  CommentThread,
  CommentStoreFile,
  CommentStateSummary,
  CommentThreadSummary,
} from "./comment-types.js";

export {
  COMMENT_MAX_THREADS,
  COMMENT_WARN_THREADS,
  COMMENT_MAX_COMMENTS_PER_THREAD,
  COMMENT_MAX_STORE_SIZE,
  COMMENT_MAX_VIEWPORT_SNAP_SIZE,
  COMMENT_MAX_SUMMARY_THREADS,
  COMMENT_SUMMARY_PREVIEW_LENGTH,
  COMMENT_LIST_DEFAULT_LIMIT,
  COMMENT_LIST_MAX_LIMIT,
  COMMENT_LIST_BODY_PREVIEW_LENGTH,
  COMMENT_CREATE_RATE_LIMIT,
  COMMENT_CREATE_RATE_WINDOW_MS,
} from "./comment-types.js";

// ─── Constants & Operational Types ──────────────────────────────────────────

export {
  ACCORDO_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  DEFAULT_HUB_PORT,
  DEFAULT_MAX_CONCURRENT_INVOCATIONS,
  DEFAULT_MAX_QUEUE_DEPTH,
  PROMPT_TOKEN_BUDGET,
  PROMPT_EFFECTIVE_TOKEN_BUDGET,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  AUDIT_MAX_FILE_SIZE,
  AUDIT_MAX_FILES,
  DISCONNECT_GRACE_WINDOW_MS,
  KILL_SIGKILL_TIMEOUT_MS,
  DISCONNECT_REQUEST_TIMEOUT_MS,
} from "./constants.js";

export type {
  AuditEntry,
  HealthResponse,
  ReauthRequest,
  ConcurrencyStats,
  DisconnectResponse,
} from "./constants.js";
