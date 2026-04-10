# Review — M110-TC-P2 Security — Re-review v2

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Scope:** Confirm 3 findings from previous D2 review are fixed  
**Files inspected:**  
- `packages/browser/src/security/security-types.ts`  
- `packages/browser/src/security/audit-log.ts`  
- `packages/browser/src/security/index.ts`  
- `packages/browser/src/page-tool-handlers-impl.ts`  
- `packages/browser/src/text-map-tool.ts`  
- `packages/browser/src/semantic-graph-tool.ts`

---

## PASS

All three prior findings are resolved. Details below.

---

## Finding 1 (HIGH) — AuditSink interface — ✅ FIXED

**Check:** `AuditSink` interface defined in `security-types.ts`; `SecurityConfig.auditLog` typed as `AuditSink`; `BrowserAuditLog` implements `AuditSink`.

| Sub-check | Result |
|---|---|
| `AuditSink` interface at `security-types.ts:115–131` | ✅ Present — declares `createEntry`, `completeEntry`, `flush` |
| `SecurityConfig.auditLog: AuditSink` at line 145 | ✅ Typed as `AuditSink` (not concrete `BrowserAuditLog`) |
| `BrowserAuditLog implements AuditSink` at `audit-log.ts:47` | ✅ Implements all three methods |
| `AuditSink` re-exported from `security/index.ts:15` | ✅ Accessible to consumers |

**Note:** `AuditSink.flush()` is declared `void` but `BrowserAuditLog.flush()` returns `Promise<void>`. TypeScript permits this (a `Promise<void>` is assignable to a `void`-returning interface slot). `tsc --noEmit` confirms zero type errors.

---

## Finding 2 (MEDIUM) — Inline handlers bypass — ✅ FIXED

**Check:** `handleGetTextMapInline` and `handleGetSemanticGraphInline` in `page-tool-handlers-impl.ts` now accept `SecurityConfig`, call `createEntry`/`completeEntry`, check origin policy, set `auditId`, and set `redactionWarning`.

### `handleGetTextMapInline` (lines 413–481)

| Sub-check | Result |
|---|---|
| Accepts `security: SecurityConfig` parameter | ✅ Line 417 |
| Calls `security.auditLog.createEntry(...)` | ✅ Line 424 |
| Calls `security.auditLog.completeEntry(...)` on all paths | ✅ Lines 430–434, 444–449, 466–470, 476–479 |
| Checks origin policy via `checkOrigin` | ✅ Lines 441–451 |
| Sets `result.auditId = auditEntry.auditId` | ✅ Line 460 |
| Sets `result.redactionWarning` | ✅ Lines 462–464 (when `!args.redactPII`) |

### `handleGetSemanticGraphInline` (lines 486–558)

| Sub-check | Result |
|---|---|
| Accepts `security: SecurityConfig` parameter | ✅ Line 490 |
| Calls `security.auditLog.createEntry(...)` | ✅ Line 497 |
| Calls `security.auditLog.completeEntry(...)` on all paths | ✅ Lines 508–512, 523–528, 544–548, 553–557 |
| Checks origin policy via `checkOrigin` | ✅ Lines 519–529 |
| Sets `result.auditId = auditEntry.auditId` | ✅ Line 538 |
| Sets `result.redactionWarning` | ✅ Lines 540–542 (when `!args.redactPII`) |

---

## Finding 3 (MEDIUM) — redactionWarning unconditional — ✅ FIXED

**Check:** Warning is now unconditional (no `patterns.length > 0` guard) in the dedicated tool files.

### `text-map-tool.ts` (lines 267–270)

```typescript
} else {
  // F5: Redaction warning when redactPII is not set (unconditional per MCP-VC-005)
  (result as any).redactionWarning = "PII may be present in response";
}
```

The `else` branch fires whenever `args.redactPII` is falsy — no `patterns.length` check. ✅

### `semantic-graph-tool.ts` (lines 400–403)

```typescript
} else {
  // F5: Redaction warning when redactPII is not set (unconditional per MCP-VC-005)
  result.redactionWarning = "PII may be present in response";
}
```

Same pattern — no `patterns.length` guard. ✅

**Consistency note:** `handleCaptureRegion` in `page-tool-handlers-impl.ts` still has a `patterns.length > 0` guard (line 353) for screenshot warnings. This is architecturally intentional (screenshots cannot be text-redacted; the warning only makes sense when patterns are configured) and is outside the scope of these three findings.

---

## Test Run

```
pnpm test  (packages/browser)

 Test Files  1 failed | 23 passed (24)
       Tests  1 failed | 604 passed (605)
```

The single failure is the **pre-existing** `BR-F-123: publishes relay state for observability` (port mismatch: test hardcodes `40111`, runtime uses `40112`). This was known before this review cycle and is unrelated to the three security findings.

**Type check:** `tsc --noEmit` — zero errors.

---

## Verdict

**PASS** — all three findings from the prior D2 review are correctly addressed. The code may proceed to Phase D3 / Phase E.
