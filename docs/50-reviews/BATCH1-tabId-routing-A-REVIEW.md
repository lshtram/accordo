# Phase A Review — BATCH1 tabId Routing Architecture

**Date:** 2026-04-01  
**Reviewer:** Reviewer agent  
**Design document:** `docs/50-reviews/BATCH1-tabId-routing-A.md`  
**Scope:** B2-CTX-002..005 — Multi-tab tabId routing for `capture_region` and `diff_snapshots`

---

## Verdict: APPROVED WITH REQUIRED FIXES

The design is architecturally sound and the root cause analysis is accurate. Code cross-reference confirms every identified break point against the actual source. However, **5 issues must be resolved before Phase B begins** — 2 are blockers, 3 are clarifications required to make the proposed tests unambiguous.

---

## Findings

### Finding 1 — BLOCKER: `capture_region` inputSchema does NOT expose `tabId` to agents

**Severity:** Blocker  
**Evidence:** `packages/browser/src/page-tool-definitions.ts`, lines 248–272

The MCP `inputSchema` for `browser_capture_region` does **not** include a `tabId` property:

```typescript
// line 248–272, page-tool-definitions.ts
{
  name: "browser_capture_region",
  inputSchema: {
    type: "object",
    properties: {
      anchorKey: ...,
      nodeRef: ...,
      rect: ...,
      padding: ...,
      quality: ...,
      // ← tabId is ABSENT
    },
  },
```

The design document (§8, §9a) correctly identifies that `CaptureRegionArgs` in `page-tool-types.ts` must gain `tabId?: number`. But the `inputSchema` in `page-tool-definitions.ts` is the **runtime-exposed contract** that the MCP protocol serialises and publishes to the agent. If `tabId` is not in the `inputSchema`, the agent cannot discover or call the parameter — the fix to `CaptureRegionArgs` alone is insufficient.

**The design document does not mention `page-tool-definitions.ts` in its §8 "Affected Files" table.** This is a gap.

**Required action before Phase B:** Add `page-tool-definitions.ts` to the §8 affected-files table with the explicit change: add `tabId: { type: "number", description: "B2-CTX-001: ..." }` to the `browser_capture_region` inputSchema properties.

---

### Finding 2 — BLOCKER: `diff_snapshots` inputSchema does NOT expose `tabId` to agents

**Severity:** Blocker  
**Evidence:** `packages/browser/src/diff-tool.ts`, lines 136–153

The MCP `inputSchema` built in `buildDiffSnapshotsTool()` does not include `tabId`:

```typescript
// lines 136–153, diff-tool.ts
inputSchema: {
  type: "object",
  properties: {
    fromSnapshotId: { type: "string", ... },
    toSnapshotId:   { type: "string", ... },
    // ← tabId is ABSENT
  },
},
```

`DiffSnapshotsArgs` **already has** `tabId?: number` at line 31–37 (this fix was applied before this design doc was written, or the file was updated in anticipation). But the `inputSchema` is what agents see at runtime — the `DiffSnapshotsArgs` type is purely a TypeScript compile-time contract.

Cross-referencing `diff-tool.ts` line 31 confirms `tabId` IS present in the interface, but it is NOT present in the `inputSchema` on line 140.

**Required action before Phase B:** Add `diff-tool.ts` to the §8 affected-files table with the explicit change: add `tabId: { type: "number", description: "B2-CTX-001: ..." }` to the `browser_diff_snapshots` inputSchema properties.

---

### Finding 3 — REQUIRED CLARIFICATION: `diff_snapshots` tabId threading — Hub handler gap

**Severity:** Must clarify before Phase B  
**Evidence:** `packages/browser/src/diff-tool.ts`, lines 337–345

The `handleDiffSnapshots` handler passes `fromSnapshotId` and `toSnapshotId` to the relay's `diff_snapshots` action on lines 338–344, but does **not** forward `tabId`:

```typescript
// lines 337–345, diff-tool.ts
const response = await relay.request(
  "diff_snapshots",
  {
    fromSnapshotId: resolvedFromSnapshotId,
    toSnapshotId: resolvedToSnapshotId,
    // ← tabId is NOT forwarded here
  },
  DIFF_TIMEOUT_MS,
);
```

The design correctly fixes `resolveFreshSnapshot` and `resolveFromSnapshot` to forward `tabId` for implicit captures (§5 Break 2 and Break 3). But the explicit `diff_snapshots` relay call — where the service worker handler (`handleDiffSnapshots` in `relay-capture-handler.ts`) receives the request — does not need `tabId` because the SW-side handler only retrieves from the store by snapshot ID (it does not do any tab targeting at this point).

However, the design document does not discuss this leg of the routing at all, creating ambiguity: should `tabId` be threaded through to the extension's `diff_snapshots` action, or only to the implicit `get_page_map` calls? The design must explicitly state which forwarding paths carry `tabId` and which do not.

**Required action before Phase B:** Add an explicit statement in §5 clarifying that `tabId` is threaded through `resolveFreshSnapshot` and `resolveFromSnapshot` relay calls only, and is NOT forwarded in the final `diff_snapshots` relay request (because snapshot retrieval is keyed by snapshotId, not tabId).

---

### Finding 4 — REQUIRED CLARIFICATION: `requestContentScriptEnvelope` tabId threading in `retryCaptureAtReducedQuality`

**Severity:** Must clarify before Phase B  
**Evidence:** `packages/browser-extension/src/relay-capture-handler.ts`, lines 169–193

The design (§8) says `retryCaptureAtReducedQuality()` must pass `tabId` to `requestContentScriptEnvelope`. But the function signature currently is:

```typescript
async function retryCaptureAtReducedQuality(
  fullDataUrl: string,
  paddedBounds: { ... },
  quality: number,
  anchorSource: string,
): Promise<Record<string, unknown>>
```

There is no `tabId` parameter. The design mentions adding `tabId` to `requestContentScriptEnvelope` (§8 relay-forwarder.ts row) and to `buildCaptureSuccess` and `retryCaptureAtReducedQuality`. However, the proposed stub in §9b only shows the `CapturePayload` change — there is no updated stub for `retryCaptureAtReducedQuality` or `buildCaptureSuccess` showing the new signature.

The test in §10 (`requestContentScriptEnvelope uses explicit tabId when provided`) tests `requestContentScriptEnvelope` directly but there is no test verifying that `retryCaptureAtReducedQuality` passes the correct `tabId` through — leaving a potential silent routing gap in the retry path.

**Required action before Phase B:** Either (a) add a stub for `retryCaptureAtReducedQuality(payload, quality, anchorSource)` taking `tabId` from the payload, or (b) restructure so `executeCaptureRegion` resolves `tabId` once and passes it explicitly through all sub-calls. Add a corresponding test entry for the retry path.

---

### Finding 5 — ADMINISTRATIVE: DEC-008 number collision in `docs/decisions.md`

**Severity:** Administrative (non-blocking for Phase B, but must be fixed before commit)  
**Evidence:** `docs/decisions.md`, lines 161 and 214

`DEC-008` is used twice:
- Line 161: "Relay action type governance: `types.ts` as source of truth"  
- Line 214: "capture_region: tab-swap strategy for non-active tab screenshots"

The second DEC-008 (the tab-swap decision) should be renumbered to **DEC-010** (DEC-009 already exists at line 188). The design document §7 refers to "DEC-008" — that reference will remain accurate if DEC-010 is the renumbered entry, but the design doc must also be updated to match.

**Required action:** Renumber the second `DEC-008` in `docs/decisions.md` to `DEC-010` and update any cross-references in the design doc.

---

## Confirmed-Correct Findings (no action required)

The following aspects of the design were verified against source and are accurate:

**C1. Break inventory for `capture_region` is complete and correct.**  
Six breaks identified; verified in `relay-capture-handler.ts` (lines 109, 139, 156), `relay-definitions.ts` (line 78), `relay-type-guards.ts` (line 100), and `page-tool-types.ts` (line 100). All confirmed.

**C2. Break inventory for `diff_snapshots` is complete and correct.**  
Three breaks identified; verified in `diff-tool.ts` (lines 30–35, 221, 261). `DiffSnapshotsArgs` already has `tabId` at line 31 — this field was added before this review, but the `resolveFreshSnapshot` and `resolveFromSnapshot` functions still pass `{}` to the relay (confirmed at lines 221, 261). Both breaks confirmed.

**C3. Tool coverage table (§2) is accurate for all 14 tools.**  
All 12 tools marked WORKING were verified to have `tabId` in their `inputSchema` and in their handler payloads. The 2 tools marked BROKEN were confirmed broken. `list_pages` and `select_page` are correctly classified.

**C4. Chrome API constraint analysis (§7, DEC-008) is technically sound.**  
`chrome.tabs.captureVisibleTab()` indeed only captures the active tab. The tab-swap strategy is the correct no-new-permissions approach. The cross-window `windowId` concern (§11 Q1) is real and correctly flagged — implementing `chrome.tabs.get(tabId)` to retrieve `windowId` before capture is the right solution and the design correctly recommends handling it in Phase C.

**C5. Snapshot namespace collision (§5 Note) is correctly scoped as deferred.**  
`DEFAULT_PAGE_ID = "page"` in `snapshot-versioning.ts` (line 240) is confirmed. The rationale for deferral is sound: the service-worker-side `defaultStore` is a single SnapshotStore instance and DOES have cross-tab collision risk. However, since the agent typically diffs within a single tab session, deferral is acceptable for Phase 1. The risk is correctly documented.

**C6. Duplicate `resolveTargetTabId` (§6) is confirmed.**  
`relay-forwarder.ts` line 83 returns `number | undefined`. `relay-control-handlers.ts` line 36 returns `number` with a hardcoded `1` fallback. The fallback-to-1 in the control handler is fragile (tab ID 1 may not exist) but the control handlers are tested and working. Deferring consolidation is acceptable.

**C7. `toCapturePayload` omission confirmed.**  
`relay-type-guards.ts` line 100 does NOT include `tabId` in the returned object. The fix described in §4 Break 3 is accurate.

**C8. `requestContentScriptEnvelope` hardcodes active tab.**  
`relay-forwarder.ts` line 56 confirmed: `chrome.tabs.query({ active: true, currentWindow: true })` — no tabId parameter. The proposed fix (add optional `tabId?: number`) is correct.

**C9. Hub pass-through assertion (§8) is correct for `capture_region`.**  
`page-tool-handlers-impl.ts` line 207 confirms `args as Record<string, unknown>` is passed to the relay. Once `CaptureRegionArgs` includes `tabId`, it will flow through without any handler change.

---

## Test Plan Assessment (§10)

The 16 proposed tests across 3 files are well-structured and correctly target the failure modes. The following observations apply:

**Adequate:**
- Tests in `capture-region-tabid.test.ts` — 3 tests covering Hub-side type and pass-through. Correct scope.
- Tests in `diff-snapshots-tabid.test.ts` — 4 tests. The `resolveFreshSnapshot` and `resolveFromSnapshot` tests (tests 1 and 2) directly exercise the break points. Test 3 (backward compat) is essential. Test 4 (type-level) is lightweight but useful.
- Tests 1–2 in `capture-tabid-routing.test.ts` — `toCapturePayload` extraction tests are precise.
- Tests 5–7 — tab-swap behavior tests are exactly right for verifying DEC-008 implementation.
- Tests 8–9 — `requestContentScriptEnvelope` tabId routing tests are correct.

**Gap identified (links to Finding 4):**  
There is no test for the **retry path** — when `sizeBytes > MAX_CAPTURE_BYTES`, `retryCaptureAtReducedQuality` is called. This path also calls `requestContentScriptEnvelope` and must pass the correct `tabId`. The test plan should add:

> `retryCaptureAtReducedQuality calls requestContentScriptEnvelope with correct tabId on retry` (B2-CTX-004)

**Gap identified (links to Finding 1 & 2):**  
There are no tests verifying that the `tabId` field appears in the MCP `inputSchema` for `browser_capture_region` and `browser_diff_snapshots`. Schema-level exposure is what the agent sees — a test that checks `inputSchema.properties.tabId` exists would prevent a regression where the type-level fix is made but the schema is not updated.

> Add 2 schema-level tests (one per tool) that assert `tabId` is present in `inputSchema.properties`.

---

## Summary of Actions Required Before Phase B

| # | Severity | Action |
|---|---|---|
| 1 | **Blocker** | Add `page-tool-definitions.ts` to §8 affected files — expose `tabId` in `browser_capture_region` inputSchema |
| 2 | **Blocker** | Add `diff-tool.ts` inputSchema update to §8 affected files — expose `tabId` in `browser_diff_snapshots` inputSchema |
| 3 | Must clarify | Add statement in §5 clarifying `tabId` is NOT forwarded in the final `diff_snapshots` relay request |
| 4 | Must clarify | Add stub for `retryCaptureAtReducedQuality` showing new `tabId` parameter, and add retry-path test to §10 |
| 5 | Administrative | Renumber second DEC-008 in `docs/decisions.md` to DEC-010; update design doc §7 cross-reference |

The two Phase B test-plan gaps (inputSchema tests, retry path test) should be added to §10 when the design doc is updated.

Once these 5 items are resolved, the design is approved for Phase B.
