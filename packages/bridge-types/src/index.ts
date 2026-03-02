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
  /** Per-extension modality state. Key = extension ID (e.g. "accordo-editor") */
  modalities: Record<string, Record<string, unknown>>;
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
  secret: string;
  /** New bearer token for MCP/instructions auth */
  token: string;
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
