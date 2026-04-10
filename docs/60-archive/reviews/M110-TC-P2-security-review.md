# Review — M110-TC P2 Security Implementation — Phase D2

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Design doc:** `docs/50-reviews/M110-TC-P2-security-design.md`  
**Scope:** `packages/browser/src/security/` + consumers (`text-map-tool.ts`, `semantic-graph-tool.ts`, `page-tool-handlers-impl.ts`, `page-tool-types.ts`, `types.ts`)  
**Test files reviewed:** `security-origin-policy.test.ts`, `security-redaction.test.ts`, `security-audit-log.test.ts`, `security-structured-errors.test.ts`, `security-tool-integration.test.ts`

---

## Verdict: REVISE

The core logic is correct and all 5 security test files pass. Three issues require fixes before this can be promoted:

1. `SecurityConfig.auditLog` typed as a concrete class instead of the `AuditSink` interface
2. Security-free inline handlers for `text_map` / `semantic_graph` whose routing through `buildPageUnderstandingTools` was not verified
3. `redactionWarning` logic for text tools deviates from design spec §3.5

---

## Test Suite Results

```
pnpm test (packages/browser)

security-origin-policy.test.ts    — 24/24 PASS
security-redaction.test.ts        — 27/27 PASS
security-audit-log.test.ts        — 29/29 PASS
security-structured-errors.test.ts — PASS
security-tool-integration.test.ts  — 13/13 PASS

Total security tests: all PASS

Pre-existing unrelated failure (not security):
  extension-activation.test.ts > BR-F-123: publishes relay state for observability
  Expected: relayPort: 40111  Received: relayPort: 40112
  → Unrelated to this changeset. No action required here.
```

---

## Feature-by-Feature Analysis

### F1 — Origin Blocking (B2-ER-007, B2-ER-008)

**Implementation:** `security-policy.ts` → `checkOrigin()` / `extractOrigin()`  
**Status: PASS with note**

`checkOrigin()` correctly handles `allowedOrigins` (allowlist mode), `deniedOrigins` (denylist mode), `*` wildcard, and `null` URL edge cases. `extractOrigin()` safely handles malformed URLs by returning `null`.

**Note — post-DOM-access check (design-acknowledged):** The origin check fires after `relay.request()` returns (using `pageUrl` from the response), meaning DOM access has already occurred before the check. Design §3.1 explicitly chose Option 2 (cached origin) and acknowledges this violates the B2-ER-007 acceptance criterion ("Error is returned before any DOM access occurs"). The design decision is recorded; flagged here for traceability.

---

### F2 — PII Redaction (B2-PS-007)

**Implementation:** `redaction.ts`, applied in `text-map-tool.ts` and `semantic-graph-tool.ts`  
**Status: PASS with deviation (see Finding 3)**

`redactText()`, `redactTextMapResponse()`, and `redactSemanticGraphResponse()` are correct. Pattern compilation, replacement, and counts all work as expected. The `DEFAULT_REDACTION_PATTERNS` cover email, phone (US), SSN, credit card, and IPv4.

**Deviation:** `redactionWarning` is only emitted when `redactPatterns.length > 0`. Design §3.5 says text-producing tools should warn whenever `redactPII` is not set, regardless of policy length. See Finding 3.

---

### F3 — Audit Logging (B2-AUD-001, B2-AUD-002)

**Implementation:** `audit-log.ts` → `BrowserAuditLog`  
**Status: PASS with type concern (see Finding 1)**

`createEntry()` / `completeEntry()` / `log()` lifecycle is correct. `getRecent()` is bounded (default 100). `flush()` correctly writes pending entries. All 29 audit log tests pass.

**Type concern:** `SecurityConfig.auditLog` is typed as the concrete `BrowserAuditLog` class instead of the `AuditSink` interface. See Finding 1.

---

### F4 — Structured Errors (B2-ER-001 through B2-ER-010)

**Implementation:** `page-tool-types.ts` → `buildStructuredError()`, `CaptureError` union  
**Status: PASS with minor type weakness (see Finding 4)**

`buildStructuredError()` correctly maps every `BrowserToolErrorCode` to `retryable`, `userMessage`, and `category`. The `CaptureError` union correctly includes `origin-blocked` and `redaction-failed` variants. All structured error tests pass.

**Minor:** `retryable` is typed `?: boolean` (optional) on `PageToolError`, but design §3.6 specifies it as required. `buildStructuredError` always sets it in practice. See Finding 4.

---

### F5 — Audit ID Threading (B2-AUD-003)

**Implementation:** `auditId` propagated through response payloads  
**Status: PASS**

`SnapshotEnvelopeFields` (`types.ts` line 70) carries `auditId?: string`. The `handleGetTextMap` and `handleGetSemanticGraph` handlers set `auditId` on success responses. Integration tests verify the round-trip.

---

### F6 — Capture Region Warning (B2-PS-008)

**Implementation:** `page-tool-handlers-impl.ts` line ~354  
**Status: PASS with cosmetic mismatch**

The capture region handler emits `redactionWarning` when a `RedactionPolicy` is configured. Logic is correct and integration tests pass.

**Cosmetic:** Emitted string is `"screenshots are not subject to redaction policy."` (human prose). Design §3.5 shows `"screenshots-not-subject-to-redaction-policy"` (slug format). Tests check only `.toContain("screenshots")` so tests pass. Decide on one canonical format.

---

## Findings

### Finding 1 — REVISE (HIGH): `auditLog` typed as concrete class, not interface

**File:** `packages/browser/src/security/security-types.ts`, line 134  
**Code:**
```typescript
// Current (wrong)
auditLog: BrowserAuditLog;

// Design spec (correct)
auditLog: AuditSink;
```

**Issue:** The design (§4) specifies `SecurityConfig.auditLog` as `AuditSink` (the interface). The implementation uses the concrete `BrowserAuditLog` class. This:
1. Breaks the ports/adapters pattern — callers cannot substitute a test double or alternative implementation without extending `BrowserAuditLog`
2. Causes `DEFAULT_SECURITY_CONFIG` (line 150) to instantiate `new BrowserAuditLog()` at module import time — every `import` from `security/index.ts` creates an audit log object as a side effect
3. Contradicts the architectural constraint in `AGENTS.md §4`: external dependencies behind abstractions

**Fix:** Change the field type to `AuditSink`. All current callers already use `BrowserAuditLog` which implements `AuditSink`, so no runtime change is needed.

---

### Finding 2 — REVISE (MEDIUM): Unverified security-free inline handlers for `text_map` / `semantic_graph`

**File:** `packages/browser/src/page-tool-handlers-impl.ts`, lines 413–463  
**Code:** `handleGetTextMapInline()` and `handleGetSemanticGraphInline()` — no origin check, no redaction, no audit, no `redactionWarning`

**Issue:** Two inline handler functions exist alongside the security-aware `buildTextMapTool` / `buildSemanticGraphTool`. The comment says these are "inlined into buildPageUnderstandingTools". If `buildPageUnderstandingTools` routes `get_text_map` or `get_semantic_graph` through these inline handlers instead of delegating to the standalone secure tools, all F1–F5 security features are silently bypassed.

`page-understanding-tools.ts` was not read during this review — the routing cannot be confirmed from the files that were read. The security integration tests test `buildTextMapTool` and `buildSemanticGraphTool` directly, not via `buildPageUnderstandingTools`.

**Fix:** Either (a) confirm in `page-understanding-tools.ts` that these inline handlers are not on any active dispatch path, or (b) replace them with delegation to `buildTextMapTool` / `buildSemanticGraphTool`.

---

### Finding 3 — REVISE (MEDIUM): `redactionWarning` logic for text tools is weaker than spec

**Files:** `packages/browser/src/text-map-tool.ts` line 267; `packages/browser/src/semantic-graph-tool.ts` line 400  
**Code:**
```typescript
// Current — only warns when patterns are configured
} else if (security.redactionPolicy.redactPatterns.length > 0) {
  result.redactionWarning = "PII may be present in response";
}
```

**Design §3.5 says:**
> "When `redactPII: false` or not set on text-producing tools → add `redactionWarning: 'PII may be present in response'`"

**Issue:** With `DEFAULT_SECURITY_CONFIG` (which has an empty `redactPatterns` array), no warning is ever emitted even when `redactPII` is not set. The design note about conditional warnings applies explicitly to `capture_region`; text tools should warn unconditionally when PII redaction is off.

This means users of the default config receive no signal that PII is passing through unredacted.

**Fix:**
```typescript
// Warn whenever redactPII is not active
} else {
  result.redactionWarning = "PII may be present in response";
}
```

---

### Finding 4 — REVISE (LOW): `retryable` typed optional but spec requires it

**File:** `packages/browser/src/page-tool-types.ts`, line 226  
**Code:**
```typescript
retryable?: boolean;  // should be: retryable: boolean;
```

**Issue:** Design §3.6 specifies `retryable` as required. `buildStructuredError()` always sets it, so no runtime issue — but any code destructuring `PageToolError` cannot rely on the type contract. This is a minor weakening that could cause downstream type errors if callers add guard branches unnecessarily.

**Fix:** Remove the `?`.

---

### Finding 5 — INFO: Duplicate `TRANSIENT_ERRORS` constant (dead code)

**File:** `packages/browser/src/page-tool-handlers-impl.ts`  
**Issue:** `TRANSIENT_ERRORS` is defined at module scope (line ~359) and also inside `buildStructuredError` (line ~383), shadowing the outer one. The outer constant is unused. Minor dead code — no behavioural impact.

---

### Finding 6 — INFO: Capture region warning string format mismatch

**File:** `packages/browser/src/page-tool-handlers-impl.ts`, line ~354  
**Current:** `"screenshots are not subject to redaction policy."`  
**Design §3.5:** `"screenshots-not-subject-to-redaction-policy"`  
**Tests:** Only check `.toContain("screenshots")` — pass either way.

Pick one canonical form and apply it consistently. If this string is machine-parsed downstream, use the slug format from the design.

---

## Correctness Summary

| Feature | Tests | Logic | Type contracts | Design conformance |
|---|---|---|---|---|
| F1 Origin Blocking | ✅ 24/24 | ✅ | ✅ | ⚠️ post-DOM (by design) |
| F2 PII Redaction | ✅ 27/27 | ✅ | ✅ | ⚠️ warning conditional too narrow |
| F3 Audit Logging | ✅ 29/29 | ✅ | ⚠️ concrete not interface | ✅ |
| F4 Structured Errors | ✅ pass | ✅ | ⚠️ retryable optional | ✅ |
| F5 Audit ID Threading | ✅ pass | ✅ | ✅ | ✅ |
| F6 Capture Region Warning | ✅ pass | ✅ | ✅ | ⚠️ string format |

---

## Backward Compatibility

- All existing snapshot/text-map/semantic-graph/page-map tests continue to pass — the security layer is additive
- `DEFAULT_SECURITY_CONFIG` provides a zero-config path; behaviour unchanged for callers that don't opt in
- No breaking changes to public tool signatures

---

## Items Required Before PASS

| # | Priority | File | Fix |
|---|---|---|---|
| 1 | HIGH | `security-types.ts:134` | Change `auditLog: BrowserAuditLog` → `auditLog: AuditSink` |
| 2 | MEDIUM | `page-tool-handlers-impl.ts:413–463` | Confirm or eliminate the security-free inline handlers |
| 3 | MEDIUM | `text-map-tool.ts:267`, `semantic-graph-tool.ts:400` | Emit `redactionWarning` unconditionally when PII redaction is off |
| 4 | LOW | `page-tool-types.ts:226` | Change `retryable?: boolean` → `retryable: boolean` |
