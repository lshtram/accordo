/**
 * @accordo/bridge-types
 *
 * Shared TypeScript type definitions for the Accordo IDE system.
 * All types used across Hub, Bridge, and Editor packages live here.
 *
 * Sources:
 *   - requirements-hub.md §3.3 (IDEState)
 *   - requirements-hub.md §3.4 (ToolRegistration)
 *   - requirements-hub.md §3.1/§3.2 (WS messages)
 *   - requirements-bridge.md §3.1 (ExtensionToolDefinition)
 *   - requirements-hub.md §7 (AuditEntry)
 */

// ─── IDE State ──────────────────────────────────────────────────────────────

/**
 * Flat snapshot of the current IDE state.
 * Pushed from Bridge to Hub over WebSocket.
 *
 * Source: requirements-hub.md §3.3
 */
export interface IDEState {
  /** Absolute path of the active editor file, or null */
  activeFile: string | null;
  /** 1-based line number of the cursor in the active file */
  activeFileLine: number;
  /** 1-based column number of the cursor in the active file */
  activeFileColumn: number;
  /** Absolute paths of all open editor tabs (from tabGroups API) */
  openEditors: string[];
  /** Absolute paths of editors visible in split panes */
  visibleEditors: string[];
  /** Absolute paths of all workspace folder roots */
  workspaceFolders: string[];
  /** Display name of the active terminal, or null */
  activeTerminal: string | null;
  /**
   * Display name of the workspace or root folder.
   * From vscode.workspace.name. Null when no folder is open.
   */
  workspaceName: string | null;
  /**
   * Remote authority identifier — describes the execution environment.
   * From vscode.env.remoteName.
   * null = local, or one of "ssh-remote", "wsl", "dev-container",
   * "codespaces", "tunnel", etc.
   */
  remoteAuthority: string | null;
  /** Per-extension modality state. Key = extension ID (e.g. "accordo-editor") */
  modalities: Record<string, Record<string, unknown>>;
}
/**
 * Tool definition as provided by extensions calling BridgeAPI.registerTools().
 * Includes the handler function, which is NEVER sent over the wire — it stays
 * in the extension host.
 *
 * Source: requirements-bridge.md §3.1, requirements-editor.md §4
 */
export interface ExtensionToolDefinition {
  /** Fully qualified tool name. Convention: "accordo.<category>.<action>" */
  name: string;
  /** One-line description. Appears in system prompt. Max 120 chars. */
  description: string;
  /** JSON Schema describing the input. Must be type: "object". */
  inputSchema: ToolInputSchema;
  /** How dangerous is this tool? Drives confirmation policy. */
  dangerLevel: DangerLevel;
  /** Whether to show confirmation dialog. Defaults by dangerLevel. */
  requiresConfirmation?: boolean;
  /** Whether this tool is safe to retry on timeout. Default: false */
  idempotent?: boolean;
  /**
   * Optional grouping key (e.g. "editor", "terminal", "comments").
   * Grouped tools are hidden in the system prompt — the agent discovers them
   * by calling the corresponding accordo.<group>.discover tool.
   */
  group?: string;
  /**
   * The actual handler function. Runs in the extension host.
   * NEVER serialized. NEVER sent to Hub.
   */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
// ─── Tool Registration ──────────────────────────────────────────────────────

/** Tool danger classification. Drives confirmation policy. */
export type DangerLevel = "safe" | "moderate" | "destructive";

/**
 * Wire-format tool registration sent from Bridge to Hub.
 * Handler is NEVER included — it stays in the extension host.
 *
 * Source: requirements-hub.md §3.4, requirements-bridge.md §3.2
 */
export interface ToolRegistration {
  /** Fully qualified name, e.g. "accordo.editor.open" */
  name: string;
  /** One-line description for the system prompt. Max 120 chars. */
  description: string;
  /** JSON Schema describing the input. Must be type: "object". */
  inputSchema: ToolInputSchema;
  /** How dangerous is this tool? */
  dangerLevel: DangerLevel;
  /** Whether to show a confirmation dialog before execution */
  requiresConfirmation: boolean;
  /** Whether this tool is safe to retry on timeout */
  idempotent: boolean;
  /**
   * Optional grouping key. Grouped tools are hidden in the system prompt;
   * the agent discovers them via the corresponding .discover tool.
   */
  group?: string;
}

/**
 * JSON Schema for tool input. Always an object at the top level.
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  /** Nested property definitions for type:'object' properties */
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

/**
 * MCP-formatted tool for the tools/list response.
 * Subset of ToolRegistration — only what MCP clients need.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

// ─── WebSocket Messages: Hub → Bridge ────────────────────────────────────────

/**
 * Invoke a tool on the Bridge side.
 * Source: requirements-hub.md §3.1
 */
export interface InvokeMessage {
  type: "invoke";
  /** UUID v4 correlation ID */
  id: string;
  /** Fully qualified tool name, e.g. "accordo.editor.open" */
  tool: string;
  /** Tool arguments matching the inputSchema */
  args: Record<string, unknown>;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Cancel an in-flight invocation.
 * Source: requirements-hub.md §3.1
 */
export interface CancelMessage {
  type: "cancel";
  /** UUID of the InvokeMessage to cancel */
  id: string;
}

/**
 * Request a full state snapshot from Bridge.
 * Source: requirements-hub.md §3.1
 */
export interface GetStateMessage {
  type: "getState";
  /** UUID v4 correlation ID */
  id: string;
}

/**
 * Heartbeat from Hub.
 * Source: requirements-hub.md §3.1
 */
export interface PingMessage {
  type: "ping";
  /** Date.now() timestamp */
  ts: number;
}

/** Union of all Hub → Bridge message types */
export type HubToBridgeMessage =
  | InvokeMessage
  | CancelMessage
  | GetStateMessage
  | PingMessage;

// ─── WebSocket Messages: Bridge → Hub ────────────────────────────────────────

/**
 * Tool invocation result.
 * Source: requirements-hub.md §3.2
 */
export interface ResultMessage {
  type: "result";
  /** Correlates with InvokeMessage.id */
  id: string;
  success: boolean;
  /** Tool-specific return value (if success) */
  data?: unknown;
  /** Human-readable error (if !success) */
  error?: string;
}

/**
 * Partial state update (changed fields only).
 * Source: requirements-hub.md §3.2
 */
export interface StateUpdateMessage {
  type: "stateUpdate";
  patch: Partial<IDEState>;
}

/**
 * Full state snapshot. Sent on connect/reconnect.
 * Source: requirements-hub.md §3.2
 */
export interface StateSnapshotMessage {
  type: "stateSnapshot";
  /** Protocol version for compatibility checking. "1" for Phase 1. */
  protocolVersion: string;
  state: IDEState;
}

/**
 * Full replacement of the tool registry.
 * Source: requirements-hub.md §3.2
 */
export interface ToolRegistryMessage {
  type: "toolRegistry";
  /** Complete list — replaces previous registry */
  tools: ToolRegistration[];
}

/**
 * Heartbeat response.
 * Source: requirements-hub.md §3.2
 */
export interface PongMessage {
  type: "pong";
  /** Echo back the Hub's timestamp */
  ts: number;
}

/**
 * Acknowledgement that a cancellation was processed.
 * Source: requirements-hub.md §3.2
 */
export interface CancelledMessage {
  type: "cancelled";
  /** Correlates with CancelMessage.id */
  id: string;
  /** true if the handler completed before cancel arrived */
  late: boolean;
}

/** Union of all Bridge → Hub message types */
export type BridgeToHubMessage =
  | ResultMessage
  | StateUpdateMessage
  | StateSnapshotMessage
  | ToolRegistryMessage
  | PongMessage
  | CancelledMessage;

/** Union of ALL WebSocket messages (either direction) */
export type WsMessage = HubToBridgeMessage | BridgeToHubMessage;

// ─── Audit Log ───────────────────────────────────────────────────────────────

/**
 * Single audit log entry. Written as newline-delimited JSON.
 * Source: requirements-hub.md §7
 */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Tool name */
  tool: string;
  /** sha256 of JSON.stringify(args) */
  argsHash: string;
  /** MCP session ID */
  sessionId: string;
  /** Outcome of the invocation */
  result: "success" | "error" | "timeout" | "cancelled";
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if result is "error" */
  errorMessage?: string;
}

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * Shape of the GET /health response.
 * Source: requirements-hub.md §2.4
 */
export interface HealthResponse {
  ok: true;
  /** Seconds since Hub start */
  uptime: number;
  /** Bridge WebSocket connection status */
  bridge: "connected" | "disconnected";
  /** Number of registered tools */
  toolCount: number;
  /** Protocol version string */
  protocolVersion: string;
  /** Currently in-flight invocations */
  inflight: number;
  /** Queued invocations waiting for a slot */
  queued: number;
}

// ─── Reauth ──────────────────────────────────────────────────────────────────

/**
 * Request body for POST /bridge/reauth.
 * Source: requirements-hub.md §2.6
 */
export interface ReauthRequest {
  /** New Bridge→Hub shared secret */
  newSecret: string;
  /** New bearer token for MCP/instructions auth */
  newToken: string;
}

// ─── Concurrency Stats ──────────────────────────────────────────────────────

/**
 * Concurrency state returned by bridge-server for diagnostics.
 * Source: requirements-hub.md §9 (CONC-01 to CONC-07)
 */
export interface ConcurrencyStats {
  /** Currently in-flight invocations */
  inflight: number;
  /** Invocations waiting in the FIFO queue */
  queued: number;
  /** Maximum in-flight limit */
  limit: number;
}

// ─── Protocol Constants ──────────────────────────────────────────────────────

/** Current protocol version. Hub and Bridge must agree on this. */
export const ACCORDO_PROTOCOL_VERSION = "1";

/** Default Hub port */
export const DEFAULT_HUB_PORT = 3000;

/** Default max concurrent invocations (Hub-wide) */
export const DEFAULT_MAX_CONCURRENT_INVOCATIONS = 16;

/** Default invocation queue depth */
export const DEFAULT_MAX_QUEUE_DEPTH = 64;

/** Prompt engine token budget for dynamic section */
export const PROMPT_TOKEN_BUDGET = 1500;

/** Effective token budget after 10% safety margin */
export const PROMPT_EFFECTIVE_TOKEN_BUDGET = 1350;

/** Heartbeat interval (ms) — Hub sends ping every 5s */
export const HEARTBEAT_INTERVAL_MS = 5000;

/** Heartbeat timeout (ms) — disconnect if no pong in 15s */
export const HEARTBEAT_TIMEOUT_MS = 15000;

/** Audit log max file size before rotation (bytes) — 10 MB */
export const AUDIT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Audit log max rotated files */
export const AUDIT_MAX_FILES = 2;

// ─── Comment Types (Phase 2) ────────────────────────────────────────────────

/**
 * Where a comment points — a line range in a text file, a point on a visual
 * surface, or an entire file.
 *
 * Source: comments-architecture.md §3.1
 */
export type CommentAnchor =
  | CommentAnchorText
  | CommentAnchorSurface
  | CommentAnchorFile;

/** Text-file anchor — line range in a code/config/markdown source file. */
export interface CommentAnchorText {
  kind: "text";
  /** File URI (e.g. "file:///project/src/auth.ts") */
  uri: string;
  /** Line/char range the comment is attached to */
  range: CommentRange;
  /** TextDocument.version at creation time */
  docVersion: number;
}

/** Visual-surface anchor — a point on a diagram, image, PDF, etc. */
export interface CommentAnchorSurface {
  kind: "surface";
  /** File URI of the underlying resource */
  uri: string;
  surfaceType: SurfaceType;
  coordinates: SurfaceCoordinates;
}

/** File-level anchor — comment on an entire file, no specific location. */
export interface CommentAnchorFile {
  kind: "file";
  /** File URI */
  uri: string;
}

/**
 * Line/character range for text anchors.
 * All values are 0-based.
 */
export interface CommentRange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

/** Visual surface types supported by the Comment SDK. */
export type SurfaceType =
  | "diagram"
  | "image"
  | "pdf"
  | "markdown-preview"
  | "slide"
  | "browser";

/**
 * Coordinates on a visual surface. Each type is specific to its surface.
 *
 * Source: comments-architecture.md §3.1
 */
export type SurfaceCoordinates =
  | NormalizedCoordinates
  | DiagramNodeCoordinates
  | PdfPageCoordinates
  | SlideCoordinates
  | HeadingCoordinates
  | BlockCoordinates;

export interface NormalizedCoordinates {
  type: "normalized";
  /** 0..1 range */
  x: number;
  /** 0..1 range */
  y: number;
}

export interface DiagramNodeCoordinates {
  type: "diagram-node";
  /** Mermaid/Excalidraw node ID */
  nodeId: string;
}

export interface PdfPageCoordinates {
  type: "pdf-page";
  page: number;
  /** 0..1 range within page */
  x: number;
  /** 0..1 range within page */
  y: number;
}

export interface SlideCoordinates {
  type: "slide";
  slideIndex: number;
  /** 0..1 range within slide */
  x: number;
  /** 0..1 range within slide */
  y: number;
}

export interface HeadingCoordinates {
  type: "heading";
  headingText: string;
  headingLevel: number;
}

/**
 * Block-level coordinate for rendered document surfaces (markdown-preview, etc.).
 * BlockId format: "heading:{level}:{slug}" | "p:{index}" | "li:{listIdx}:{itemIdx}" | "pre:{index}"
 *
 * Source: comments-architecture.md §8.4 (M41b variant)
 */
export interface BlockCoordinates {
  type: "block";
  /** Stable content-addressable ID for the block element — see BlockIdPlugin */
  blockId: string;
  blockType: "heading" | "paragraph" | "list-item" | "code-block";
}

/**
 * A single comment in a thread.
 *
 * Source: comments-architecture.md §3.2
 */
export interface AccordoComment {
  /** UUID */
  id: string;
  /** Groups replies together — same as the thread's ID */
  threadId: string;
  /** ISO 8601 */
  createdAt: string;
  author: CommentAuthor;
  /** Markdown body */
  body: string;
  /** Where this comment points (copied from thread on creation) */
  anchor: CommentAnchor;
  intent?: CommentIntent;
  status: CommentStatus;
  /** Set when status → "resolved" */
  resolutionNote?: string;
  /** Captured at creation time */
  context?: CommentContext;
}

/** Who wrote the comment. */
export interface CommentAuthor {
  kind: "user" | "agent";
  name: string;
  /** MCP session or agent identifier */
  agentId?: string;
}

/** Intent tag — what the commenter wants done. */
export type CommentIntent =
  | "fix"
  | "explain"
  | "refactor"
  | "review"
  | "design"
  | "question";

/** Thread/comment lifecycle. */
export type CommentStatus = "open" | "resolved";

/**
 * Context captured automatically when a comment is created.
 *
 * Source: comments-architecture.md §3.2
 */
export interface CommentContext {
  viewportSnap?: {
    /** ~20 lines above, capped at 1KB */
    before: string;
    /** Selected text at creation */
    selected?: string;
    /** ~20 lines below, capped at 1KB */
    after: string;
  };
  diagnostics?: CommentDiagnostic[];
  git?: {
    branch?: string;
    commit?: string;
  };
  languageId?: string;
  /** Surface-specific context */
  surfaceMetadata?: Record<string, string>;
}

/** Diagnostic captured in comment context. */
export interface CommentDiagnostic {
  range: { startLine: number; endLine: number };
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
}

/**
 * A thread is a group of comments sharing the same threadId and anchor.
 *
 * Source: comments-architecture.md §3.3
 */
export interface CommentThread {
  /** Same as threadId on contained comments */
  id: string;
  anchor: CommentAnchor;
  comments: AccordoComment[];
  /** Derived: "resolved" if last resolve action set it */
  status: CommentStatus;
  /** First comment's timestamp */
  createdAt: string;
  /** Most recent comment's timestamp */
  lastActivity: string;
}

/**
 * On-disk format of .accordo/comments.json.
 *
 * Source: comments-architecture.md §5.2
 */
export interface CommentStoreFile {
  version: "1.0";
  threads: CommentThread[];
}

/**
 * Modality state published via bridge.publishState('accordo-comments', ...).
 *
 * Source: comments-architecture.md §7
 */
export interface CommentStateSummary {
  isOpen: true;
  openThreadCount: number;
  resolvedThreadCount: number;
  /** At most 10 open threads, most recent first, body truncated to 80 chars */
  summary: CommentThreadSummary[];
  /** Pipe-separated list of available MCP tool names for agent guidance */
  tools?: string;
  /**
   * Full list of all threads (open + resolved), un-truncated.
   * Published by state-contribution for the /state debug endpoint (M43).
   * Not used by the prompt engine — prompt uses `summary` (capped/truncated).
   */
  threads?: CommentThread[];
}

/** Single entry in the modality state summary. */
export interface CommentThreadSummary {
  threadId: string;
  uri: string;
  /** Line number for text anchors */
  line?: number;
  /** Surface type for surface anchors */
  surfaceType?: SurfaceType;
  /** Node ID for diagram-node anchors */
  nodeId?: string;
  intent?: CommentIntent;
  /** First 80 chars of the body */
  preview: string;
}

// ─── Comment Scale Constants ─────────────────────────────────────────────────

/** Maximum number of comment threads per workspace */
export const COMMENT_MAX_THREADS = 500;

/** Warning threshold for thread count (warn at this, refuse at COMMENT_MAX_THREADS) */
export const COMMENT_WARN_THREADS = 400;

/** Maximum number of comments per thread */
export const COMMENT_MAX_COMMENTS_PER_THREAD = 50;

/** Maximum size of .accordo/comments.json in bytes (2 MB) */
export const COMMENT_MAX_STORE_SIZE = 2 * 1024 * 1024;

/** Maximum viewport snap size per comment in bytes (2 KB) */
export const COMMENT_MAX_VIEWPORT_SNAP_SIZE = 2 * 1024;

/** Maximum open threads shown in modality state summary */
export const COMMENT_MAX_SUMMARY_THREADS = 10;

/** Maximum body preview length in summary (chars) */
export const COMMENT_SUMMARY_PREVIEW_LENGTH = 80;

/** Default limit for comment.list results */
export const COMMENT_LIST_DEFAULT_LIMIT = 50;

/** Maximum limit for comment.list results */
export const COMMENT_LIST_MAX_LIMIT = 200;

/** Maximum body preview length in comment.list firstComment (chars) */
export const COMMENT_LIST_BODY_PREVIEW_LENGTH = 200;

/** Rate limit: max comment.create calls per minute per agent */
export const COMMENT_CREATE_RATE_LIMIT = 10;

/** Rate limit window in milliseconds (1 minute) */
export const COMMENT_CREATE_RATE_WINDOW_MS = 60_000;
