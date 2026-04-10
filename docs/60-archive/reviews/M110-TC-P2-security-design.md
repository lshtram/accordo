# M110-TC Phase 2: Security — Phase A Design Document

**Module:** Browser MCP Security (Origin Policy, PII Redaction, Audit Trail, Structured Errors)  
**Date:** 2026-04-04  
**Phase:** A (Design — interfaces and stubs only)  
**Requirement sources:**
- `docs/50-reviews/M110-TC-improvement-plan.md` — §3.5 (I1 security), §3.2 (H2 error taxonomy)
- `docs/20-requirements/requirements-browser2.0.md` — B2-PS-001..007, B2-ER-007..008
- `docs/20-requirements/requirements-browser-mcp.md` — MCP-ER-001..004, MCP-VC-005

---

## 1. Feature Summary

| # | Feature | Req ID(s) | Files Affected |
|---|---|---|---|
| F1 | Origin allow/deny policy | B2-PS-001..003, B2-ER-007, MCP-SEC-001 | `security-types.ts` (new), `security-policy.ts` (new), all handler files |
| F2 | PII text redaction | B2-PS-004..005, MCP-SEC-002 | `security-types.ts`, `redaction.ts` (new), `text-map-tool.ts`, `semantic-graph-tool.ts`, `page-tool-handlers-impl.ts` |
| F3 | Fail-closed redaction | B2-ER-008, MCP-SEC-003 | `redaction.ts`, all handler files |
| F4 | Audit trail | B2-PS-006, MCP-SEC-004 | `security-types.ts`, `audit-log.ts` (new), `extension.ts` |
| F5 | Redaction warning | MCP-VC-005, MCP-SEC-005 | `security-types.ts`, all handler files |
| F6 | Structured errors | MCP-ER-001..004 | `page-tool-types.ts`, all handler files |

---

## 2. New Files

All security modules will be created in `packages/browser/src/security/`:

| File | Purpose |
|---|---|
| `security-types.ts` | Shared type definitions: `OriginPolicy`, `RedactionPolicy`, `SecurityConfig`, `AuditEntry`, `StructuredError` |
| `security-policy.ts` | Origin policy evaluation: `checkOrigin(url, policy)` → `"allow" \| "block"` |
| `redaction.ts` | PII redaction engine: `redactText(text, policy)` → `RedactionResult` |
| `audit-log.ts` | In-memory audit log with file rotation: `AuditLog` class |
| `index.ts` | Barrel export for all security modules |

---

## 3. Feature Designs

### 3.1 F1: Origin Allow/Deny Policy

**Requirement:** B2-PS-001..003, B2-ER-007

**Type definitions (in `security-types.ts`):**

```typescript
/** Origin policy configuration. */
export interface OriginPolicy {
  /** When non-empty, only these origins are allowed. */
  allowedOrigins: string[];
  /** Origins that are always blocked. Takes precedence over allowedOrigins. */
  deniedOrigins: string[];
  /** Default action when both lists are empty. Default: "allow". */
  defaultAction: "allow" | "deny";
}
```

**Input schema changes:** Add to `GetPageMapArgs`, `GetTextMapArgs`, `GetSemanticGraphArgs`, `InspectElementArgs`, `GetDomExcerptArgs`, `CaptureRegionArgs`:

```typescript
/** I2-001: Allowed origins for this request. Overrides global policy. */
allowedOrigins?: string[];
/** I2-001: Denied origins for this request. Overrides global policy. */
deniedOrigins?: string[];
```

**JSON Schema additions** (for each tool's `inputSchema.properties`):

```json
"allowedOrigins": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Only allow data from these origins. Empty = use global policy."
},
"deniedOrigins": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Block data from these origins. Takes precedence over allowedOrigins."
}
```

**Function signature (in `security-policy.ts`):**

```typescript
/**
 * Check if a page origin is allowed by the policy.
 * B2-PS-001: allowedOrigins whitelist
 * B2-PS-002: deniedOrigins blacklist (takes precedence)
 * B2-PS-003: defaultAction when both lists empty
 *
 * @param origin — The page's `document.location.origin`
 * @param policy — Merged policy (per-request overrides + global config)
 * @returns "allow" or "block"
 */
export function checkOrigin(
  origin: string,
  policy: OriginPolicy,
): "allow" | "block";
```

**Error code:** `"origin-blocked"` added to `CaptureError` type.

**Handler integration:** Every data-producing handler checks origin BEFORE sending the relay request. The origin is obtained from the relay response metadata (the content script includes `document.location.origin` in the response — this is already available as `pageUrl` from which we extract origin). However, since we need to check BEFORE the relay call to prevent DOM access (B2-ER-007 acceptance: "Error is returned before any DOM access occurs"), we need a pre-flight approach:

**Design decision:** The origin check happens at the MCP handler level using the per-request `allowedOrigins`/`deniedOrigins` parameters. Since the handler doesn't know the page origin before making a relay call, we have two options:

1. **Pre-flight relay call** — a lightweight `get_origin` relay action that returns only `document.location.origin` without DOM access.
2. **Handler-level check with cached origin** — use the last-known `pageUrl` from the snapshot retention store.

**Decision: Option 2 (cached origin from retention store).** Rationale:
- The retention store already has `pageUrl` from the last successful call.
- For the first call (cold cache), origin checking is skipped (lenient behavior, consistent with `defaultAction: "allow"`).
- Adding a new relay action would require Chrome extension changes (out of scope for P2).
- The origin in the relay response is also checked post-hoc for validation.

### 3.2 F2: PII Text Redaction

**Requirement:** B2-PS-004..005

**Type definitions (in `security-types.ts`):**

```typescript
/** Pattern-based redaction policy. */
export interface RedactionPolicy {
  /** Regex patterns to detect PII. Built-in defaults for email, phone, API keys. */
  redactPatterns: RedactionPattern[];
  /** Replacement string. Default: "[REDACTED]". */
  replacement: string;
}

/** A single redaction pattern. */
export interface RedactionPattern {
  /** Human-readable name (e.g., "email", "phone", "api-key"). */
  name: string;
  /** Regex pattern string. Compiled at config time. */
  pattern: string;
}

/** Result of applying redaction to a text string. */
export interface RedactionResult {
  /** The redacted text. */
  text: string;
  /** Whether any redaction was applied. */
  redactionApplied: boolean;
  /** Number of redactions made. */
  redactionCount: number;
}
```

**Default built-in patterns:**

```typescript
export const DEFAULT_REDACTION_PATTERNS: RedactionPattern[] = [
  { name: "email", pattern: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}" },
  { name: "phone", pattern: "\\+?[1-9]\\d{1,14}|\\(\\d{3}\\)\\s?\\d{3}[\\-.]\\d{4}" },
  { name: "api-key", pattern: "(?:api[_-]?key|token|secret|password)\\s*[:=]\\s*['\"]?[a-zA-Z0-9_\\-]{20,}['\"]?" },
];
```

**Input schema changes:** Add to `GetTextMapArgs` and `GetSemanticGraphArgs`:

```typescript
/** I1-text: When true, scan text content for PII and replace with [REDACTED]. */
redactPII?: boolean;
```

**JSON Schema addition:**

```json
"redactPII": {
  "type": "boolean",
  "description": "When true, scan text content for email addresses, phone numbers, and API keys and replace with [REDACTED]."
}
```

**Output schema changes:** Add to `TextMapResponse` and `SemanticGraphResponse`:

```typescript
/** True when PII redaction was applied to any text content. */
redactionApplied?: boolean;
```

Also add to all text-producing responses (page map, inspect, DOM excerpt):

```typescript
/** True when PII redaction was applied to any text content. */
redactionApplied?: boolean;
```

**Function signature (in `redaction.ts`):**

```typescript
/**
 * Apply PII redaction to a text string.
 * B2-PS-004: Pattern-based replacement.
 * B2-PS-005: Applied before data leaves the handler.
 *
 * @param text — Input text to scan
 * @param policy — Redaction policy with compiled patterns
 * @returns RedactionResult with redacted text and metadata
 * @throws Error if a pattern fails to compile (caught by fail-closed logic)
 */
export function redactText(
  text: string,
  policy: RedactionPolicy,
): RedactionResult;

/**
 * Apply redaction to all text fields in a text map response.
 * Mutates the segments array in-place for efficiency.
 *
 * @param response — TextMapResponse to redact
 * @param policy — Redaction policy
 * @returns Whether any redaction was applied
 */
export function redactTextMapResponse(
  response: TextMapResponse,
  policy: RedactionPolicy,
): boolean;

/**
 * Apply redaction to all text fields in a semantic graph response.
 * Walks the a11y tree, landmarks, outline, and forms.
 *
 * @param response — SemanticGraphResponse to redact
 * @param policy — Redaction policy
 * @returns Whether any redaction was applied
 */
export function redactSemanticGraphResponse(
  response: SemanticGraphResponse,
  policy: RedactionPolicy,
): boolean;
```

**Handler integration:** After receiving relay response and before returning to agent:
1. If `args.redactPII === true`, apply `redactTextMapResponse()` / `redactSemanticGraphResponse()`.
2. Set `response.redactionApplied = true` if any substitutions were made.
3. If `args.redactPII !== true`, add `redactionWarning` field (see F5).

### 3.3 F3: Fail-Closed Redaction

**Requirement:** B2-ER-008

**Error code:** `"redaction-failed"` added to `CaptureError` type.

**Behavior:** If `redactText()` throws (e.g., invalid regex pattern in the policy), the handler MUST NOT return unredacted content. Instead:

```typescript
return { success: false, error: "redaction-failed" };
```

**Handler pattern:**

```typescript
try {
  const redacted = redactTextMapResponse(response, policy);
  if (redacted) response.redactionApplied = true;
} catch {
  // B2-ER-008: Fail closed — never return unredacted content
  return { success: false, error: "redaction-failed" };
}
```

### 3.4 F4: Audit Trail

**Requirement:** B2-PS-006

**Type definitions (in `security-types.ts`):**

```typescript
/** A single audit log entry. B2-PS-006. */
export interface AuditEntry {
  /** Unique audit ID (UUIDv4). */
  auditId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** MCP tool name. */
  toolName: string;
  /** Page identifier (from snapshot envelope). */
  pageId?: string;
  /** Page origin (e.g., "https://example.com"). */
  origin?: string;
  /** Whether the request was allowed or blocked. */
  action: "allowed" | "blocked";
  /** Whether PII redaction was applied. */
  redacted: boolean;
  /** Duration of the tool call in ms. */
  durationMs?: number;
}

/** Sink interface for audit log persistence. */
export interface AuditSink {
  /** Log an audit entry. */
  log(entry: AuditEntry): void;
  /** Get recent entries (for diagnostics). */
  getRecent(count: number): AuditEntry[];
  /** Flush any pending writes. */
  flush(): Promise<void>;
}
```

**SnapshotEnvelopeFields addition (in `types.ts`):**

```typescript
/** Unique audit ID for this capture (UUIDv4). I3-001. */
auditId?: string;
```

**Note:** `auditId` is optional on `SnapshotEnvelopeFields` to maintain backward compatibility. It is populated by the MCP handler, not the content script. The content script doesn't know about audit IDs — they are minted at the handler level.

**Class definition (in `audit-log.ts`):**

```typescript
/**
 * In-memory audit log with optional file persistence.
 * B2-PS-006: Logs tool invocations with security-relevant metadata.
 *
 * - In-memory ring buffer (default: 1000 entries)
 * - Optional file persistence to `~/.accordo/browser-audit.jsonl`
 * - Size-based rotation at 10MB (consistent with Hub audit log)
 */
export class BrowserAuditLog implements AuditSink {
  constructor(options?: {
    maxEntries?: number;
    filePath?: string;
    maxFileSizeBytes?: number;
  });

  /** Generate a new audit ID and create an entry. */
  createEntry(toolName: string, origin?: string, pageId?: string): AuditEntry;

  /** Complete an entry with outcome and duration. */
  completeEntry(entry: AuditEntry, outcome: { action: "allowed" | "blocked"; redacted: boolean; durationMs: number }): void;

  /** Log an audit entry. */
  log(entry: AuditEntry): void;

  /** Get recent entries. */
  getRecent(count: number): AuditEntry[];

  /** Flush pending file writes. */
  flush(): Promise<void>;
}
```

**Handler integration:** Each handler wraps its logic with audit tracking:

```typescript
const auditEntry = auditLog.createEntry("browser_get_text_map", origin, pageId);
try {
  // ... handler logic ...
  auditLog.completeEntry(auditEntry, { action: "allowed", redacted: !!redactionApplied, durationMs });
  response.auditId = auditEntry.auditId;
  return response;
} catch {
  auditLog.completeEntry(auditEntry, { action: "blocked", redacted: false, durationMs });
  // ... error return ...
}
```

### 3.5 F5: Redaction Warning

**Requirement:** MCP-VC-005

**Output schema changes:** Add to ALL tool response types:

```typescript
/** Warning when PII redaction is not applied. MCP-VC-005. */
redactionWarning?: string;
```

**Behavior:**
- When `redactPII: false` or not set on text-producing tools → add `redactionWarning: "PII may be present in response"`
- When `capture_region` is called (any mode) and a `RedactionPolicy` exists → add `redactionWarning: "screenshots-not-subject-to-redaction-policy"` (per MCP-VC-005)
- When `redactPII: true` and redaction succeeds → no warning field

**Note:** The `redactionWarning` on capture_region is conditional on a `RedactionPolicy` being configured. Without a policy, no warning is needed.

### 3.6 F6: Structured Errors

**Requirement:** MCP-ER-001..004

**Type changes (in `page-tool-types.ts`):**

Replace `PageToolError`:

```typescript
/** Structured error response from page understanding tools. MCP-ER-001. */
export interface PageToolError {
  success: false;
  /** Machine-readable error code. */
  error: CaptureError | RelayError | SecurityError;
  /** Whether the agent should retry this operation. MCP-ER-002. */
  retryable: boolean;
  /** Suggested delay before retry in ms. MCP-ER-002. */
  retryAfterMs?: number;
  /** Human-readable detail for diagnostics. */
  details?: string;
  /** Preserved for backward compatibility on specific tools. */
  pageUrl?: null;
  found?: false;
}
```

**New error type unions:**

```typescript
/** Relay-level errors (transient). */
export type RelayError =
  | "browser-not-connected"
  | "timeout"
  | "action-failed";

/** Security-related errors (permanent). */
export type SecurityError =
  | "origin-blocked"
  | "redaction-failed";

/** All possible error codes. */
export type BrowserToolErrorCode = CaptureError | RelayError | SecurityError;
```

**Updated `CaptureError`:**

```typescript
export type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"   // keep for backward compat
  | "timeout"                  // keep for backward compat
  | "origin-blocked"           // NEW — F1
  | "redaction-failed";        // NEW — F3
```

**Error classification helper (updated `classifyRelayError`):**

```typescript
/** Build a structured error response. MCP-ER-001. */
export function buildStructuredError(
  errorCode: BrowserToolErrorCode,
  details?: string,
): PageToolError;
```

**Retry classification (MCP-ER-002):**

| Error Code | `retryable` | `retryAfterMs` |
|---|---|---|
| `browser-not-connected` | `true` | `2000` |
| `timeout` | `true` | `1000` |
| `action-failed` | `true` | `1000` |
| `element-not-found` | `false` | — |
| `element-off-screen` | `false` | — |
| `image-too-large` | `false` | — |
| `capture-failed` | `false` | — |
| `no-target` | `false` | — |
| `origin-blocked` | `false` | — |
| `redaction-failed` | `false` | — |

---

## 4. SecurityConfig — Unified Configuration

All security features are configured through a single `SecurityConfig` object:

```typescript
/** Unified security configuration for browser MCP tools. */
export interface SecurityConfig {
  /** Origin policy. Default: allow all. */
  originPolicy: OriginPolicy;
  /** PII redaction policy. Default: no redaction. */
  redactionPolicy: RedactionPolicy;
  /** Audit log sink. */
  auditLog: AuditSink;
}

/** Default security configuration (permissive — all allowed, no redaction). */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig;
```

**Extension integration (`extension.ts`):**

The `SecurityConfig` is created during extension activation and passed to all tool builders:

```typescript
const auditLog = new BrowserAuditLog({ filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl") });
const securityConfig: SecurityConfig = {
  originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
  redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
  auditLog,
};
```

Tool builder signatures are updated to accept `SecurityConfig`:

```typescript
export function buildTextMapTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,  // NEW
): ExtensionToolDefinition;
```

---

## 5. Handler Flow (Unified Pattern)

Every data-producing handler follows this flow after the security features are integrated:

```
1. Check relay connection → error "browser-not-connected" (retryable)
2. Create audit entry
3. Check origin policy (from cache) → error "origin-blocked" (permanent)
4. Forward request through relay
5. Validate response envelope
6. If redactPII requested:
   a. Apply redaction → set redactionApplied
   b. If redaction throws → error "redaction-failed" (fail-closed)
7. If redactPII not requested → set redactionWarning
8. Set auditId on response
9. Complete audit entry
10. Return response
```

---

## 6. Backward Compatibility

All changes are additive — no existing fields are removed or have their types changed:

| Change | Backward Compatible? | Rationale |
|---|---|---|
| New input params (`allowedOrigins`, `deniedOrigins`, `redactPII`) | Yes | Optional params, omitting yields current behavior |
| New output fields (`redactionApplied`, `redactionWarning`, `auditId`) | Yes | Optional fields, absent = not applicable |
| `PageToolError` adds `retryable`, `retryAfterMs`, `details` | Yes | New fields; `error` remains `string` type |
| New error codes in `CaptureError` | Yes | Union is additive; existing code handles unknown strings |
| `SnapshotEnvelopeFields.auditId` | Yes | Optional field |

---

## 7. Files Changed Summary

### New files (`packages/browser/src/security/`):

| File | LOC (est.) | Purpose |
|---|---|---|
| `security-types.ts` | ~80 | All type definitions |
| `security-policy.ts` | ~40 | Origin policy evaluation |
| `redaction.ts` | ~100 | PII redaction engine |
| `audit-log.ts` | ~120 | Audit log with file persistence |
| `index.ts` | ~10 | Barrel exports |

### Modified files:

| File | Changes |
|---|---|
| `page-tool-types.ts` | Add `origin-blocked`, `redaction-failed` to `CaptureError`; add `RelayError`, `SecurityError`, `BrowserToolErrorCode` types; update `PageToolError` with `retryable`, `retryAfterMs`, `details`; add `buildStructuredError()` |
| `types.ts` | Add optional `auditId` to `SnapshotEnvelopeFields` |
| `page-tool-handlers-impl.ts` | Accept `SecurityConfig` param; add origin check, redaction, audit, structured errors to each handler |
| `text-map-tool.ts` | Add `redactPII` to inputSchema; accept `SecurityConfig`; apply redaction in handler |
| `semantic-graph-tool.ts` | Add `redactPII` to inputSchema; accept `SecurityConfig`; apply redaction in handler |
| `extension.ts` | Create `SecurityConfig` and `BrowserAuditLog`; pass to all tool builders |

---

## 8. Requirement Traceability

| Requirement | Feature | Interface Element | Test Strategy |
|---|---|---|---|
| B2-PS-001 | F1 | `OriginPolicy.allowedOrigins`, `checkOrigin()` | Unit: allow-listed origin passes |
| B2-PS-002 | F1 | `OriginPolicy.deniedOrigins`, `checkOrigin()` | Unit: denied origin is blocked even if allow-listed |
| B2-PS-003 | F1 | `OriginPolicy.defaultAction`, `checkOrigin()` | Unit: empty lists + deny = blocked |
| B2-PS-004 | F2 | `RedactionPolicy`, `redactText()` | Unit: email/phone/key patterns replaced |
| B2-PS-005 | F2 | `redactTextMapResponse()`, `redactSemanticGraphResponse()` | Unit: redaction before return |
| B2-PS-006 | F4 | `AuditSink`, `BrowserAuditLog` | Unit: N calls = N entries |
| B2-PS-007 | F5 | `CaptureRegionResponse.redactionWarning` | Unit: warning present on screenshots with policy |
| B2-ER-007 | F1 | `CaptureError: "origin-blocked"` | Unit: blocked origin returns error |
| B2-ER-008 | F3 | `CaptureError: "redaction-failed"` | Unit: regex failure → fail-closed |
| MCP-ER-001 | F6 | `PageToolError.retryable`, `buildStructuredError()` | Unit: all errors match structured shape |
| MCP-ER-002 | F6 | `PageToolError.retryAfterMs` | Unit: transient errors have retry hints |
| MCP-ER-004 | F6 | `CaptureError` codes propagated | Integration: error codes reach MCP layer |
| MCP-VC-005 | F5 | `redactionWarning` field | Unit: warning on non-redacted responses |
| MCP-SEC-001 | F1 | `allowedOrigins`/`deniedOrigins` input params | Unit: per-request origin override |
| MCP-SEC-002 | F2 | `redactPII` input param, `redactionApplied` output | Unit: text redaction on demand |
| MCP-SEC-003 | F3 | Fail-closed behavior | Unit: exception → no data returned |
| MCP-SEC-004 | F4 | `auditId`, `BrowserAuditLog` | Unit: UUID in response, entries in log |
| MCP-SEC-005 | F5 | `redactionWarning` | Unit: warning on unredacted responses |
