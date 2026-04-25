## Review — M110-TC GAPs (E1, E2, A1, G1) — Phase D2

**Reviewer:** Reviewer agent  
**Date:** 2026-04-05  
**Scope:** 4 immediate gap implementations for M110-TC 31→45 plan (direct implementation, not full TDD)  
**Test run:** browser package 662/663 ✓ (1 pre-existing failure unrelated to GAPs), browser-extension 955/955 ✓

---

### PASS

- **GAP-G1 (RETENTION_SLOTS + listAll + manage_snapshots):** All items clean.
  - `RETENTION_SLOTS` correctly changed 5→10 in `snapshot-retention.ts:18`
  - `listAll()` added, returns a defensive copy (`new Map`)
  - `clear(pageId?)` overload correctly implemented with TypeScript function overloads
  - `buildManageSnapshotsTool` correctly implements `list` and `clear` actions
  - Tool registered in `extension.ts` (lines 306, 308)
  - Full test coverage: RETENTION_SLOTS=10, listAll, clear(pageId), clear(), no-op clear
  - _Design note (info only):_ `idempotent: false` on `manage-snapshots-tool.ts:135` — the `list` action is read-only and is technically idempotent. `clear` is not. Acceptable as-is since a single flag errs on the safe side; the schema doesn't support per-action granularity.

- **GAP-E2 (viewport crop skip + relatedSnapshotId):** Functionally correct.
  - `CaptureRegionResponse.relatedSnapshotId?: string` added in `page-tool-types.ts:287`
  - `hasTarget` check in `relay-capture-handler.ts` (lines 243-275) correctly skips `cropImageToBounds` for viewport captures
  - `relatedSnapshotId` populated from snapshot store in `page-tool-handlers-impl.ts` (lines 348-363)
  - Tests cover has-snapshot and no-snapshot cases

---

### FAIL — must fix before Phase E

#### 1. GAP-E1 — `executeCaptureFullPage` hardcodes PNG MIME type regardless of format

**File:** `packages/browser-extension/src/relay-capture-handler.ts:376`  
**Severity:** Medium

```typescript
// CURRENT (wrong when format="jpeg"):
const dataUrl = `data:image/png;base64,${cdpResult.data}`;
```

The `format` parameter IS forwarded to CDP correctly (line 373), so the image bytes are JPEG when requested — but the data URL prefix is always `image/png`. Any consumer parsing the MIME type from the data URL will be wrong.

**Fix:**
```typescript
const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
const dataUrl = `data:${mimeType};base64,${cdpResult.data}`;
```

---

#### 2. GAP-E2 — `any` cast in `page-tool-handlers-impl.ts`

**File:** `packages/browser/src/page-tool-handlers-impl.ts:362`  
**Severity:** Low (type safety / banned pattern)

```typescript
// CURRENT (violates no-any rule):
(result as any).relatedSnapshotId = relatedSnapshotId;
```

`CaptureRegionResponse` already declares `relatedSnapshotId?: string`, so the `any` cast is unnecessary.

**Fix:**
```typescript
(result as CaptureRegionResponse).relatedSnapshotId = relatedSnapshotId;
```

_Note: The same pattern likely exists for `auditId` a few lines above — fix that too if so, for consistency._

---

#### 3. GAP-A1 — `waitUntil` is declared and forwarded but never honoured

**File:** `packages/browser-extension/src/relay-control-handlers.ts` — `handleNavigate` function (lines 64-119)  
**Severity:** Medium (functional gap — parameter is a documented no-op)

`NavigateArgs.waitUntil` is correctly typed and forwarded in the payload, and `handleNavigate` in `control-tool-types.ts` correctly extracts `readyState` from the response. However, in `relay-control-handlers.ts` the relay handler:

1. Fires `Page.navigate`
2. **Immediately** calls `Runtime.evaluate("document.readyState")`
3. Returns — it does not subscribe to `Page.loadEventFired`, `Page.domContentEventFired`, or use `Page.navigate`'s `frameStopLoading` pattern to wait for the requested condition

This means `waitUntil: "load"` / `"domcontentloaded"` / `"networkidle"` are silently ignored. Callers relying on `waitUntil` to ensure the page is fully loaded before proceeding will get race conditions. Tests don't catch this because they mock CDP to resolve instantly.

**Fix (outline):**
```typescript
// After Page.navigate, conditionally wait:
if (payload.waitUntil === "load") {
  await session.send("Page.enable");
  await new Promise<void>(resolve => session.once("Page.loadEventFired", () => resolve()));
} else if (payload.waitUntil === "domcontentloaded") {
  await session.send("Page.enable");
  await new Promise<void>(resolve => session.once("Page.domContentEventFired", () => resolve()));
}
// networkidle requires Network.enable + idle tracking — implement as appropriate
// Then read readyState after waiting
```

Or document that `waitUntil` is deferred (add a TODO with a tracking reference and update the type docs to say "currently a no-op — reserved"). Do not leave it silently ignored without documentation.

---

### Pre-existing failure (unrelated — no action required)

`extension-activation.test.ts` BR-F-123 fails due to a port mismatch (40111 vs 40112). Pre-dates these GAP changes; unrelated.

---

### Summary

| GAP | Verdict | Blocker? |
|-----|---------|----------|
| GAP-E1 (format parameter) | **FAIL** | Yes — fullPage MIME type bug |
| GAP-E2 (relatedSnapshotId) | **FAIL** | Yes — `any` cast (banned pattern) |
| GAP-A1 (readyState + waitUntil) | **FAIL** | Yes — `waitUntil` silently ignored |
| GAP-G1 (retention + manage_snapshots) | **PASS** | — |

Return items 1–3 to the developer to fix. Re-review not required for GAP-G1.
