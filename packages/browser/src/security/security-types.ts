/**
 * Browser MCP Security — Type Definitions
 *
 * Shared types for origin policy, PII redaction, audit trail, and
 * structured error responses.
 *
 * Implements requirements:
 * - B2-PS-001..007 (privacy/security)
 * - B2-ER-007..008 (origin-blocked, redaction-failed)
 * - MCP-ER-001..004 (structured errors)
 * - MCP-VC-005 (redaction warning)
 * - MCP-SEC-001..005 (new security requirements)
 *
 * @module
 */

import { BrowserAuditLog } from "./audit-log.js";

// ── Origin Policy ────────────────────────────────────────────────────────────

/**
 * Origin policy configuration.
 * B2-PS-001: allowedOrigins whitelist.
 * B2-PS-002: deniedOrigins blacklist (takes precedence).
 * B2-PS-003: defaultAction when both lists are empty.
 */
export interface OriginPolicy {
  /** When non-empty, only these origins are allowed. B2-PS-001. */
  allowedOrigins: string[];
  /** Origins that are always blocked. Takes precedence over allowedOrigins. B2-PS-002. */
  deniedOrigins: string[];
  /** Default action when both lists are empty. Default: "allow". B2-PS-003. */
  defaultAction: "allow" | "deny";
}

// ── Redaction Policy ─────────────────────────────────────────────────────────

/**
 * A single redaction pattern for PII detection.
 */
export interface RedactionPattern {
  /** Human-readable name (e.g., "email", "phone", "api-key"). */
  name: string;
  /** Regex pattern string. Compiled at config time. */
  pattern: string;
}

/**
 * Pattern-based redaction policy.
 * B2-PS-004: PII redaction in text outputs.
 */
export interface RedactionPolicy {
  /** Regex patterns to detect PII. Built-in defaults for email, phone, API keys. */
  redactPatterns: RedactionPattern[];
  /** Replacement string. Default: "[REDACTED]". */
  replacement: string;
}

/**
 * Result of applying redaction to a text string.
 */
export interface RedactionResult {
  /** The redacted text. */
  text: string;
  /** Whether any redaction was applied. */
  redactionApplied: boolean;
  /** Number of individual redactions made. */
  redactionCount: number;
}

/**
 * Default built-in redaction patterns.
 * Covers email addresses, phone numbers, and API key-like strings.
 */
export const DEFAULT_REDACTION_PATTERNS: RedactionPattern[] = [
  { name: "email", pattern: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}" },
  { name: "phone", pattern: "\\+?[1-9]\\d{1,14}|\\(\\d{3}\\)\\s?\\d{3}[\\-.]\\d{4}" },
  {
    name: "api-key",
    pattern: "(?:api[_-]?key|token|secret|password)\\s*[:=]\\s*['\"]?[a-zA-Z0-9_\\-]{20,}['\"]?",
  },
];

// ── Audit Trail ──────────────────────────────────────────────────────────────

/**
 * A single audit log entry.
 * B2-PS-006: Every tool invocation is logged with security metadata.
 */
export interface AuditEntry {
  /** Unique audit ID (UUIDv4). I3-001. */
  auditId: string;
  /** ISO 8601 timestamp when the request started. */
  timestamp: string;
  /** MCP tool name (e.g., "accordo_browser_get_text_map"). */
  toolName: string;
  /** Page identifier (from snapshot envelope), if available. */
  pageId?: string;
  /** Page origin (e.g., "https://example.com"), if available. */
  origin?: string;
  /** Whether the request was allowed or blocked by origin policy. */
  action: "allowed" | "blocked";
  /** Whether PII redaction was applied to the response. */
  redacted: boolean;
  /** Duration of the tool call in milliseconds. */
  durationMs?: number;
}

/**
 * Sink interface for audit log persistence.
 * Abstracts the audit log so implementations can be swapped (in-memory, file, etc.).
 *
 * B2-PS-006: Every tool invocation is logged with security metadata.
 */
export interface AuditSink {
  /**
   * Create a new audit entry with a fresh UUID and timestamp.
   * Returns the entry so fields can be updated before completion.
   */
  createEntry(toolName: string, pageUrl?: string, origin?: string): AuditEntry;
  /**
   * Finalise and persist an audit entry with its outcome.
   * The entry should have been created via createEntry first.
   */
  completeEntry(
    entry: AuditEntry,
    outcome: { action: "allowed" | "blocked"; redacted: boolean; durationMs: number },
  ): void;
  /** Flush any pending writes to persistent storage. */
  flush(): void;
}

// ── Security Configuration ───────────────────────────────────────────────────

/**
 * Unified security configuration for all browser MCP tools.
 * Created once during extension activation and passed to all tool builders.
 */
export interface SecurityConfig {
  /** Origin policy. Default: allow all. */
  originPolicy: OriginPolicy;
  /** PII redaction policy. Default: no redaction. */
  redactionPolicy: RedactionPolicy;
  /** Audit log sink. Any implementation of AuditSink (e.g. BrowserAuditLog). */
  auditLog: AuditSink;
  /**
   * GAP-I1: Snapshot retention policy.
   * Default: no TTL (snapshots retained until FIFO slot is reclaimed).
   */
  snapshotRetention?: {
    /** Maximum age in milliseconds before a snapshot is considered stale. 0 = no TTL. */
    maxAgeMs: number;
  };
}

/**
 * Default security configuration (permissive — all origins allowed, no redaction).
 * GAP-I1: snapshotRetention defaults to maxAgeMs=0 (no TTL).
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  originPolicy: {
    allowedOrigins: [],
    deniedOrigins: [],
    defaultAction: "allow",
  },
  redactionPolicy: {
    redactPatterns: [],
    replacement: "[REDACTED]",
  },
  auditLog: new BrowserAuditLog(),
  snapshotRetention: { maxAgeMs: 0 },
};
