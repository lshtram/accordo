## Review — M100-SNAP — Phase A (Final Re-review)

**Module:** M100-SNAP (Snapshot Version Manager)  
**Date:** 2026-03-28  
**Reviewer gate:** Post-Phase-A architecture/interface coherence (final re-check after architect fixes)

### Inputs reviewed (focus set)
- `packages/browser/src/types.ts`
- `packages/browser/src/page-understanding-tools.ts`
- `packages/browser-extension/src/relay-actions.ts`
- `packages/browser-extension/src/content/content-entry.ts`
- `packages/browser-extension/src/content/element-inspector.ts`
- `packages/browser-extension/src/service-worker.ts`
- `packages/browser-extension/tests/setup/chrome-mock.ts`

---

## Decision

## **PASS (Phase A gate cleared)**

All previously unresolved blockers from the prior A review are now addressed to a Phase-A-acceptable level.

---

## Re-validation of prior blockers

### 1) Canonical envelope at public tool boundary
**Prior:** open critical  
**Now:** ✅ **resolved for Phase A**

- `SnapshotEnvelopeFields` is defined as shared contract in `packages/browser/src/types.ts`.
- Browser tool handlers now return typed responses and validate envelope presence via `hasSnapshotEnvelope(...)` before returning data:
  - `handleGetPageMap`
  - `handleInspectElement`
  - `handleGetDomExcerpt`
- This closes the earlier “raw unknown pass-through only” issue at handler level.

### 2) Snapshot counter ownership boundary
**Prior:** open critical  
**Now:** ✅ **resolved for Phase A**

- `capture_region` now requests envelope from content script via `CAPTURE_SNAPSHOT_ENVELOPE` (`relay-actions.ts` + `content-entry.ts`), making content script the primary sequencer.
- Service-worker local minting is fallback-only when content script is unavailable (acceptable as degraded-path design at architecture stage).

### 3) Node identity propagation (`nodeId`/`persistentId`)
**Prior:** open major  
**Now:** ✅ **resolved**

- `nodeId` is now in the browser public inspect args (`packages/browser/src/page-understanding-tools.ts`).
- Relay forwards `nodeId`.
- Content inspector supports `nodeId` lookup path and resolves via page-map ref index (`element-inspector.ts`).

### 4) Navigation reset lifecycle wiring
**Prior:** open major  
**Now:** ✅ **resolved**

- Concrete wiring added in `service-worker.ts` using `chrome.webNavigation.onCommitted` and top-frame check (`frameId === 0`) calling `handleNavigationReset()`.
- Test mock includes `chrome.webNavigation.onCommitted` stubs (`tests/setup/chrome-mock.ts`).

### 5) Relay/tool boundary desync risk
**Prior:** open major  
**Now:** ✅ **resolved for Phase A**

- `get_page_map`, `inspect_element`, `get_dom_excerpt` remain relay pass-through from content script payload.
- `capture_region` now attaches envelope sourced from content script rather than independently minting in normal path.
- Envelope contract is now validated in browser handlers for key page-understanding tools.

---

## Requirement-to-design status (A gate)

| Requirement | Status | Notes |
|---|---|---|
| **B2-SV-001** snapshotId in data-producing responses | **Design-covered** | Envelope contract present and propagated. |
| **B2-SV-002** monotonic per-page version | **Design-covered** | Content script is primary sequencer; SW fallback documented. |
| **B2-SV-003** full SnapshotEnvelope on responses | **Design-covered** | Shared envelope fields + handler-level validation added. |
| **B2-SV-004** snapshot storage | **Design-present** | Existing snapshot manager/store architecture remains coherent. |
| **B2-SV-005** navigation reset | **Design-covered** | webNavigation listener wired to reset function. |
| **B2-SV-006** stable nodeId within snapshot | **Design-covered** | inspect-by-nodeId contract path is now present end-to-end. |
| **B2-SV-007** experimental persistentId | **Design-present** | Already exposed/populated in content mapping path. |

---

## Non-blocking notes (for B/B2/D hardening)

1. Consider tightening `BrowserRelayResponse.data?: unknown` into action-specific discriminated unions in a later refactor.
2. Add explicit tests for fallback envelope path (content script unavailable) to avoid regression.
3. Keep `capture_region` envelope validation symmetric with other handlers if/when capture response typing is hardened.

---

## Gate outcome

**PASS — Phase A complete for M100-SNAP.**  
Ready to proceed to Phase B.
