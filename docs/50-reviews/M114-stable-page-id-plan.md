# M114 — Stable Page ID Plan

**Date:** 2026-04-05  
**Status:** Design ready  
**Scope:** `packages/browser-extension` + `packages/browser`

---

## 1. Problem

The browser MCP stack currently emits `pageId = "page"` from the content script snapshot envelope. That creates a shared namespace for all tabs and document sessions.

Practical consequence:
- snapshots from different tabs can collide or interleave in retention stores
- implicit diff resolution can select snapshots from the wrong page session
- `manage_snapshots` cannot distinguish multiple live pages cleanly

This is a real capability gap, not just a quality issue.

---

## 2. Goal

Introduce a **real stable `pageId`** that is:

- stable within one loaded top-level document session
- different across concurrently open tabs
- different after top-level reload/navigation
- opaque to callers
- compatible with existing `snapshotId = {pageId}:{version}` parsing

---

## 3. Architecture Summary

### 3.1 Chosen Model

Use a **content-script-owned opaque page-session ID**.

- The content script mints `pageId` once at bootstrap.
- The same content script instance owns snapshot version sequencing.
- The service worker and `packages/browser` treat the returned envelope as authoritative.
- `tabId` remains request routing only.

### 3.2 Why this model

- fixes cross-tab collisions with minimal change
- avoids introducing a second page registry in the service worker
- preserves the existing ownership rule that the content script mints snapshot metadata
- avoids leaking URL/title/tab details through `pageId`

### 3.3 Proposed format

Opaque string with no colon:

```ts
const pageId = `pg_${crypto.randomUUID().replace(/-/g, "")}`;
```

Rules:
- callers must treat `pageId` as opaque
- only the last `:` in `snapshotId` is structural
- no consumer may parse semantics from `pageId`

---

## 4. Requirements Impact

See `requirements-browser-extension.md` §3.17 (`BR-F-150..156`).

Key contract changes:
- `pageId` is now real and unique per document session
- retention/diff logic is page-local by actual `pageId`, not a placeholder
- reload/navigation produces a new `pageId` and resets versioning to `0`

---

## 5. Implementation Plan

### Phase A — Content-script page identity

Files:
- `packages/browser-extension/src/snapshot-versioning.ts`

Changes:
1. Replace `DEFAULT_PAGE_ID = "page"` with `createPageSessionId()`
2. Initialize the default `SnapshotManager` with the generated page ID
3. Update `resetDefaultManager()` to mint a **new** page ID, not just reset the version counter
4. Keep `captureSnapshotEnvelope()` and `getCurrentSnapshotId()` as the single source of truth

### Phase B — Tests for page identity semantics

Files:
- `packages/browser-extension/tests/*snapshot*`
- `packages/browser-extension/tests/*page-understanding*`

Add tests for:
1. stable `pageId` across repeated calls in one session
2. new `pageId` after reset/navigation
3. no colon in generated `pageId`
4. distinct `pageId` values for separate manager/page sessions

### Phase C — Browser retention/diff validation

Files:
- `packages/browser/src/__tests__/diff-tool.test.ts`
- `packages/browser/src/snapshot-retention.ts` tests

Add tests for:
1. multiple page IDs retained simultaneously
2. implicit diff resolution stays within the same page ID namespace
3. `manage_snapshots list` can surface multiple pages distinctly

### Phase D — Live verification

Manual checks:
1. open two tabs to the same URL
2. call `get_page_map` on both tabs
3. verify different `pageId`s
4. reload one tab and verify its `pageId` changes and snapshot version restarts at `:0`
5. verify `diff_snapshots` stays within the selected tab/page session

---

## 6. Risks and Non-Goals

### Risks

1. Existing tests may still assume literal `pageId = "page"`
2. Any code that implicitly parses meaning from `pageId` will need cleanup
3. Debugging becomes slightly less human-readable because IDs are opaque

### Non-goals for M114

1. URL-derived human-readable page IDs
2. A service-worker-owned global page registry
3. Cross-navigation diff continuity across full reloads
4. Forcing same-document SPA route changes to mint a new page ID

Those can be considered later if product semantics require them.

---

## 7. Success Criteria

M114 is done when:

1. multiple tabs no longer collide in snapshot retention
2. `pageId` is stable within a loaded page and changes on reload/navigation
3. `diff_snapshots` never mixes snapshots from different page sessions
4. live MCP testing confirms distinct page IDs across tabs and after reload
