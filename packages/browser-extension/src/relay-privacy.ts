/**
 * relay-privacy.ts — Shared privacy/security middleware for text-producing read tools.
 *
 * Provides:
 * - In-memory audit store with audit log entries
 * - `auditId` (UUIDv4) minting and attachment
 * - Origin policy parsing and enforcement (allowedOrigins/deniedOrigins)
 * - PII regex redaction (email, phone, API key patterns)
 * - Redaction warning attachment
 *
 * Scope: get_page_map, get_text_map, get_semantic_graph,
 *        inspect_element, get_dom_excerpt
 *
 * Implements MCP-SEC-001..005.
 *
 * @module
 */

import { resolveRequestedUrl } from "./relay-forwarder.js";
import { resolveTargetTabId } from "./relay-forwarder.js";

// ── Audit Store ────────────────────────────────────────────────────────────────

/**
 * MCP-SEC-004: A single audit log entry for one tool invocation.
 */
export interface AuditLogEntry {
  auditId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  toolName: string;
  pageId: string;
  origin: string;
  /** "allowed" | "blocked" */
  action: "allowed" | "blocked";
  redacted: boolean;
  durationMs: number;
}

/**
 * MCP-SEC-004: In-memory audit store.
 *
 * Exported for use in tests. Not cleared between test files — call
 * `auditStore.clear()` in beforeEach when testing audit log contents.
 */
export class AuditStore {
  private readonly _entries: AuditLogEntry[] = [];

  /**
   * Log a tool invocation entry.
   */
  log(entry: AuditLogEntry): void {
    this._entries.push(entry);
  }

  /**
   * Return a read-only copy of all entries.
   */
  entries(): readonly AuditLogEntry[] {
    return [...this._entries];
  }

  /**
   * Clear all entries. Call this in beforeEach when testing audit logs.
   */
  clear(): void {
    this._entries.length = 0;
  }
}

/** Shared audit store singleton — module-level so tests can import it directly. */
export const auditStore = new AuditStore();

// ── Audit ID ─────────────────────────────────────────────────────────────────

/**
 * Mint a new UUIDv4 audit ID.
 * Uses crypto.randomUUID (available in Chrome extension service workers and content scripts).
 */
export function mintAuditId(): string {
  return crypto.randomUUID();
}

// ── Response Enrichment ────────────────────────────────────────────────────────

/**
 * MCP-SEC-004: Attach auditId to a relay action response.
 * Also logs the entry to the audit store.
 *
 * @param opts - All metadata needed for the audit log entry
 * @param response - The response object to enrich (mutated in place)
 */
export function enrichWithAuditLog(opts: {
  auditId: string;
  toolName: string;
  pageId: string;
  origin: string;
  action: "allowed" | "blocked";
  redacted: boolean;
  durationMs: number;
  response: { auditId?: string };
}): void {
  opts.response.auditId = opts.auditId;
  auditStore.log({
    auditId: opts.auditId,
    timestamp: new Date().toISOString(),
    toolName: opts.toolName,
    pageId: opts.pageId,
    origin: opts.origin,
    action: opts.action,
    redacted: opts.redacted,
    durationMs: opts.durationMs,
  });
}

// ── Origin Policy ──────────────────────────────────────────────────────────────

/**
 * MCP-SEC-001: Parse allowedOrigins and deniedOrigins from a request payload.
 * Returns undefined arrays when fields are absent or malformed.
 */
export function parseOriginPolicy(
  payload: Record<string, unknown>,
): {
  allowedOrigins: string[] | undefined;
  deniedOrigins: string[] | undefined;
} {
  const allowedOrigins = readOptionalStringArray(payload, "allowedOrigins");
  const deniedOrigins = readOptionalStringArray(payload, "deniedOrigins");
  return { allowedOrigins, deniedOrigins };
}

/**
 * MCP-SEC-001: Check whether the given origin is blocked by the policy.
 *
 * Rules (denied wins over allowed):
 * - If deniedOrigins is non-empty and origin is in deniedOrigins → blocked
 * - If allowedOrigins is non-empty and origin is NOT in allowedOrigins → blocked
 * - Otherwise → allowed
 *
 * @param origin - The origin to check (e.g. "https://example.com")
 * @param allowedOrigins - Optional allowlist
 * @param deniedOrigins - Optional denylist
 */
export function isOriginBlockedByPolicy(
  origin: string,
  allowedOrigins: string[] | undefined,
  deniedOrigins: string[] | undefined,
): boolean {
  // Normalize: strip trailing slashes for consistent comparison
  const normalize = (o: string): string => o.endsWith("/") ? o.slice(0, -1) : o;

  if (deniedOrigins !== undefined && deniedOrigins.length > 0) {
    const denied = deniedOrigins.map(normalize);
    const normalizedOrigin = normalize(origin);
    if (denied.includes(normalizedOrigin)) {
      return true;
    }
  }

  if (allowedOrigins !== undefined && allowedOrigins.length > 0) {
    const allowed = allowedOrigins.map(normalize);
    const normalizedOrigin = normalize(origin);
    if (!allowed.includes(normalizedOrigin)) {
      return true;
    }
  }

  return false;
}

/**
 * MCP-SEC-001: Resolve the current page origin from the request payload and
 * SW context, then check against the origin policy.
 *
 * Returns a blocked response object if the origin is denied, or null if allowed.
 *
 * @param request - The relay action request
 * @returns Blocked response object with error + retryable, or null if allowed
 */
export async function checkOriginBlocked(
  request: { requestId: string; payload: Record<string, unknown> },
): Promise<{ blocked: true; response: { requestId: string; success: false; error: "origin-blocked"; retryable: false } } | { blocked: false; origin: string; pageId: string }> {
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);

  // If no policy configured, skip origin check
  if (allowedOrigins === undefined && deniedOrigins === undefined) {
    const origin = typeof document !== "undefined" ? window.location.origin : "unknown";
    return { blocked: false, origin, pageId: "" };
  }

  // Resolve the page origin
  const tabId = await resolveTargetTabId(request.payload);
  let origin = "unknown";
  let pageId = "";

  if (typeof document !== "undefined") {
    // Content script context — use window.location directly
    origin = window.location.origin;
  } else if (tabId !== undefined) {
    // SW context — resolve tab URL
    const url = await resolveRequestedUrl(request.payload);
    if (url) {
      try {
        origin = new URL(url).origin;
        pageId = `tab-${tabId}`;
      } catch {
        origin = "unknown";
      }
    }
  }

  if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
    return {
      blocked: true,
      response: {
        requestId: request.requestId,
        success: false,
        error: "origin-blocked",
        retryable: false,
      },
    };
  }

  return { blocked: false, origin, pageId };
}

// ── PII Redaction ─────────────────────────────────────────────────────────────

/** Text-bearing field names that may contain PII */
const TEXT_FIELDS = new Set([
  "text",
  "textRaw",
  "textNormalized",
  "name",
  "role",
  "ariaLabel",
  "accessibleName",
  "textContent",
  "description",
  "value",
  "label",
  "alt",
  "title",
  "placeholder",
  "action",
  "method",
]);

/** PII regex patterns */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const API_KEY_RE = /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer|password|passwd|pwd)["\s:=]+[a-zA-Z0-9_\-]{8,}/gi;
const API_KEY_VALUE_RE = /[a-zA-Z0-9_\-]{32,}/g;

/**
 * MCP-SEC-002: Redact PII patterns in a string value.
 * Returns the redacted string and whether any redaction was applied.
 */
function redactString(value: string): { value: string; redacted: boolean } {
  let result = value;
  let didRedact = false;

  const before = result;
  // Redact emails
  result = result.replace(EMAIL_RE, "[REDACTED]");
  // Redact phone numbers
  result = result.replace(PHONE_RE, "[REDACTED]");
  // Redact API key patterns (key=value or key: value style)
  result = result.replace(API_KEY_RE, (match) => {
    // Replace only the value portion, keep the key name
    const colon = match.indexOf(":");
    const equals = match.indexOf("=");
    const sep = colon !== -1 ? colon : equals;
    if (sep !== -1 && sep < match.length - 1) {
      return `${match.slice(0, sep + 1)}[REDACTED]`;
    }
    return "[REDACTED]";
  });

  didRedact = result !== before;
  return { value: result, redacted: didRedact };
}

/**
 * MCP-SEC-002: Recursively scan and redact PII in a value.
 * Returns the redacted value and whether any redaction was applied.
 *
 * Only string fields listed in TEXT_FIELDS are scanned.
 * Arrays are traversed recursively.
 */
function redactValue(value: unknown): { value: unknown; redacted: boolean } {
  if (typeof value === "string") {
    const { value: redacted, redacted: didRedact } = redactString(value);
    return { value: redacted, redacted: didRedact };
  }

  if (Array.isArray(value)) {
    let anyRedacted = false;
    const result = value.map((item) => {
      const { value: r, redacted } = redactValue(item);
      if (redacted) anyRedacted = true;
      return r;
    });
    return { value: result, redacted: anyRedacted };
  }

  if (value !== null && typeof value === "object") {
    let anyRedacted = false;
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, fieldVal] of Object.entries(obj)) {
      if (TEXT_FIELDS.has(key) && typeof fieldVal === "string") {
        const { value: redacted, redacted: didRedact } = redactString(fieldVal);
        result[key] = redacted;
        if (didRedact) anyRedacted = true;
      } else {
        const { value: r, redacted } = redactValue(fieldVal);
        result[key] = r;
        if (redacted) anyRedacted = true;
      }
    }

    return { value: result, redacted: anyRedacted };
  }

  return { value, redacted: false };
}

/**
 * MCP-SEC-002: Apply PII redaction to response data.
 *
 * - Scans all text-bearing fields recursively
 * - Replaces email, phone, and API key patterns with [REDACTED]
 * - Returns redacted data and whether any redaction was applied
 * - Throws if redaction processing itself fails (fail-closed per MCP-SEC-003)
 */
export function applyRedaction(
  data: unknown,
): { data: unknown; redactionApplied: boolean } {
  try {
    const { value, redacted } = redactValue(data);
    return { data: value, redactionApplied: redacted };
  } catch (err) {
    // Fail-closed: if redaction processing itself errors, do not return unredacted content
    throw new Error("redaction-processing-error");
  }
}

/**
 * MCP-SEC-005: Attach a redaction warning to a response object if redactPII is
 * false or omitted.
 *
 * @param response - The response object to enrich (mutated in place)
 * @param redactPII - The redactPII flag from the request
 */
export function attachRedactionWarning(
  response: Record<string, unknown>,
  redactPII: boolean | undefined,
): void {
  if (!redactPII) {
    response.redactionWarning = "PII may be present in response";
  }
}

// ── Combined Privacy Middleware ─────────────────────────────────────────────────

/**
 * MCP-SEC-001..005: Full privacy middleware for text-producing read tools.
 *
 * Call this at the START of each handler's SW path (after tab resolution),
 * before any DOM access occurs.
 *
 * Returns a blocked response if origin is denied.
 * Otherwise, returns { auditId, origin, pageId } for use in the response enrichment.
 */
export async function runPrivacyMiddlewareSW(opts: {
  request: { requestId: string; payload: Record<string, unknown> };
  pageId: string;
  origin: string;
}): Promise<
  | { blocked: true; response: { requestId: string; success: false; error: "origin-blocked"; retryable: false; auditId: string } }
  | { blocked: false; auditId: string }
> {
  const auditId = mintAuditId();
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(opts.request.payload);

  if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
    const originCheck = await checkOriginBlocked(opts.request);
    if (originCheck.blocked) {
      const blockedResponse = {
        ...originCheck.response,
        auditId,
      };
      enrichWithAuditLog({
        auditId,
        toolName: "unknown",
        pageId: opts.pageId,
        origin: opts.origin,
        action: "blocked",
        redacted: false,
        durationMs: 0,
        response: blockedResponse,
      });
      return { blocked: true, response: blockedResponse };
    }
  }

  return { blocked: false, auditId };
}

/**
 * Build a blocked response with retryable: false (MCP-ER-002).
 */
export function buildBlockedResponse(requestId: string, auditId: string): {
  requestId: string;
  success: false;
  error: "origin-blocked";
  retryable: false;
  auditId: string;
} {
  return { requestId, success: false, error: "origin-blocked", retryable: false, auditId };
}

/**
 * Build a redaction-failed response with retryable: false (MCP-ER-002 / MCP-SEC-003).
 */
export function buildRedactionFailedResponse(
  requestId: string,
  auditId: string,
): {
  requestId: string;
  success: false;
  error: "redaction-failed";
  retryable: false;
  auditId: string;
} {
  return { requestId, success: false, error: "redaction-failed", retryable: false, auditId };
}

// ── Internal helpers re-exported ───────────────────────────────────────────────

function readOptionalStringArray(
  payload: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const val = payload[field];
  if (!Array.isArray(val)) return undefined;
  if (val.every((item) => typeof item === "string")) {
    return val as string[];
  }
  return undefined;
}
