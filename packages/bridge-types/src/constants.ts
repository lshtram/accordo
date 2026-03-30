/**
 * Protocol constants and HTTP/operational types.
 *
 * Sources:
 *   - requirements-hub.md §2.4 (HealthResponse)
 *   - requirements-hub.md §2.6 (ReauthRequest)
 *   - requirements-hub.md §7 (AuditEntry)
 *   - requirements-hub.md §9 (ConcurrencyStats)
 */

// ─── Protocol Constants ──────────────────────────────────────────────────────

/** Current protocol version. Hub and Bridge must agree on this. */
export const ACCORDO_PROTOCOL_VERSION = "1";

/** MCP specification protocol version returned in initialize responses. */
export const MCP_PROTOCOL_VERSION = "2025-03-26";

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
  /** New bearer token for MCP/instructions auth */
  newToken: string;
  /** New Bridge→Hub shared secret */
  newSecret: string;
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
