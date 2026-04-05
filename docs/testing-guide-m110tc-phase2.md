# Testing Guide — M110-TC Phase 2 Gaps (E1, E2, A1, G1)

**Date:** 2026-04-05  
**Scope:** GAP-E1 (PNG format), GAP-E2 (screenshot modes), GAP-A1 (readyState), GAP-G1 (retention control)  
**Hub:** `http://localhost:3006` | **Auth:** configured via `opencode.json`

---

## Prerequisites

- Hub running on configured port (check `opencode.json`)
- Chrome DevTools connected (`browser_health` returns `connected: true`)
- An active browser tab with a page loaded
- Optional: fixture page `https://lshtram.github.io/accordo-browser-fixture/browser-tools-test.html`

---

## Section 1 — Agent-Automated Tests

All unit tests run via: `pnpm test` in `packages/browser`

### GAP-E1 — PNG/JPEG Format Support

**What it does:** `capture_region` now accepts `format: "jpeg" | "png"` and returns the correct MIME type.

**Tests to verify (in `capture-region-tabid.test.ts`):**
1. `format` param defaults to `"jpeg"` when omitted
2. `format: "jpeg"` → response MIME type `image/jpeg`
3. `format: "png"` → response MIME type `image/png`
4. `format` with all other params (quality, anchorKey) still works

```bash
cd packages/browser && pnpm test -- --grep "format"
```

**Expected:** All 4 tests pass.

---

### GAP-E2 — Screenshot Modes + relatedSnapshotId

**What it does:** Viewport capture returns uncropped image; response includes `relatedSnapshotId` linking to the latest DOM snapshot.

**Tests to verify:**
1. `capture_region` with no target returns `mode: "viewport"` in response
2. `relatedSnapshotId` is populated from retention store (non-null after a page map call)
3. `relatedSnapshotId` is omitted when no previous snapshot exists
4. `mode: "fullPage"` still triggers full-page capture

```bash
cd packages/browser && pnpm test -- --grep "relatedSnapshotId"
```

**Expected:** All 2 tests pass.

---

### GAP-A1 — readyState on Navigate

**What it does:** `browser_navigate` response includes `readyState: "loading" | "interactive" | "complete"`. The `waitUntil` param controls when the response is returned.

**Tests to verify (in `control-tools.test.ts`):**
1. Navigate response includes `readyState` field
2. `readyState` value is one of `"loading"`, `"interactive"`, `"complete"`
3. `waitUntil: "load"` waits for Page.loadEventFired before returning
4. `waitUntil: "networkidle"` waits for Page.lifecycleEvent "networkIdle"
5. Default (no `waitUntil`) returns immediately — `readyState` is `"complete"` or `"interactive"`
6. `waitUntil` timeout rejects after 30 seconds if event never fires

```bash
cd packages/browser && pnpm test -- --grep "readyState"
```

**Expected:** All 6 tests pass.

---

### GAP-G1 — Retention Control

**What it does:** `RETENTION_SLOTS` increased from 5→10; new `manage_snapshots` tool with list/clear actions.

**Tests to verify (in `snapshot-retention.test.ts`):**
1. `RETENTION_SLots === 10` in the module
2. `listAll()` returns a Map with all tracked pageIds
3. `clear()` empties the entire store
4. `clear(pageId)` clears only that pageId
5. `manage_snapshots` tool registered with correct schema
6. `action: "list"` returns snapshot metadata array
7. `action: "clear"` returns `{ cleared: true }`

```bash
cd packages/browser && pnpm test -- --grep "RETENTION_SLOTS\|manage_snapshots\|listAll"
```

**Expected:** All 11 tests pass.

---

## Section 2 — User Journey (Manual)

### Scenario 1 — Screenshot in PNG format (GAP-E1)

1. Navigate to any page, e.g. Wikipedia
2. Call `accordo_accordo_browser_capture_region` with `format: "png"` (no other params)
3. Verify response has `data:image/png;base64,...` data URL prefix
4. Verify response MIME type is `image/png`

### Scenario 2 — Viewport capture is uncropped (GAP-E2)

1. Navigate to a page with content below the fold
2. Call `accordo_accordo_browser_capture_region` with no target (no anchorKey, no rect)
3. Verify response dimensions match the full viewport (not cropped to 1200px)
4. Verify `mode` field is `"viewport"`

### Scenario 3 — Visual-to-structure linkage (GAP-E2)

1. Call `accordo_accordo_browser_get_page_map` on any page
2. Call `accordo_accordo_browser_capture_region` with no target
3. Verify the capture response includes `relatedSnapshotId` matching the snapshotId from step 1

### Scenario 4 — Navigate waits for page readiness (GAP-A1)

1. Navigate to a slow page (e.g. a large GitHub repo)
2. Call `accordo_accordo_browser_navigate` with `waitUntil: "load"`
3. Verify `readyState` is `"complete"` when response returns
4. Call again with `waitUntil: "networkidle"` — response should take longer on a page with many resources

### Scenario 5 — Retention slots increased (GAP-G1)

1. Navigate to 8 different pages (8 calls to `browser_navigate`)
2. Call `browser_manage_snapshots` with `action: "list"`
3. Verify at least 8 snapshot entries are listed (up from previous max of 5)

### Scenario 6 — Clear specific page snapshots (GAP-G1)

1. Navigate to 3 pages (A, B, C)
2. Call `browser_manage_snapshots` with `action: "clear", pageId: "A's pageId"`
3. Call `browser_manage_snapshots` with `action: "list"`
4. Verify pages B and C still have snapshots; page A does not

---

## Common Issues

| Symptom | Likely Cause |
|---------|-------------|
| `readyState` always `"complete"` | Page loaded too fast to catch `"loading"` or `"interactive"` — try a heavier page |
| `relatedSnapshotId` is null | No prior `get_page_map` call — snapshot store is empty |
| `format: "png"` returns JPEG | `format` param not reaching CDP — check `toCapturePayload` extraction |
| `waitUntil: "networkidle"` hangs | Page never fires `networkIdle` (e.g., streaming resources) — 30s timeout kicks in |
| `manage_snapshots` returns empty list | Retention store is per-page; call `list` after navigating to pages first |
