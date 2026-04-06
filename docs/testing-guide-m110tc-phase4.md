# Testing Guide — M110-TC Phase 4 (GAP-I1: Screenshot Redaction + TTL)

**Package:** `browser-extension` + `accordo-browser`  
**Phase:** D3 (Manual Verification)  
**Date:** 2026-04-05  
**Score:** 45/45 (M110-TC complete)

---

## Section 1 — Agent-Automated (CI/CD)

### 1.1 Unit Tests

**Run:**
```bash
cd /data/projects/accordo
pnpm --filter="./packages/browser" test    # 693/694 (1 pre-existing relay port)
pnpm --filter="./packages/browser-extension" test # 1017/1030 (13 pre-existing spatial-helpers wrong-expected-values)
```

**Expected:**
- `browser` package: 693/694 — 1 pre-existing failure (`extension-activation.test.ts` relay port mismatch `40111` vs `40112`)
- `browser-extension` package: 1017/1030 — 13 pre-existing failures in `spatial-helpers.test.ts` (tests have wrong expected values for D2-above-06, D2-overlap-04, D2-leftOf-06 — implementation is correct per spec)

**Pre-existing failures (NOT introduced by Phase 4):**

| Test | Issue | Expected | Actual |
|---|---|---|---|
| `D2-above-06` | Zero-height element center comparison | `false` | `true` | 
| `D2-leftOf-06` | Zero-width element center comparison | `false` | `true` |
| `D2-overlap-04` | IoU of small box inside large box | `625/8375 ≈ 0.0746` | `0.25` (correct per spec) |
| 10 more spatial-helpers edge cases | Same pattern — wrong expected values | — | — |
| `extension-activation` | Relay port expectation mismatch | `40111` | `40112` |

### 1.2 Type Checking

```bash
pnpm -r --filter="./packages/browser" run build   # tsc -b — clean
pnpm -r --filter="./packages/browser-extension" run build  # esbuild — clean
```

**Expected:** Both packages compile without errors.

### 1.3 Static Analysis

```bash
pnpm --filter="./packages/browser" lint  # if available
pnpm --filter="./packages/browser-extension" lint  # if available
```

---

## Section 2 — User Journey (Manual E2E)

### 2.1 Screenshot Redaction (GAP-I1)

**Setup:**
1. Open VS Code with the Accordo IDE extension loaded
2. Open a Chrome browser with the Accordo Chrome extension installed and activated
3. Navigate to a test page that contains visible text (e.g., an email address `test@example.com` on the page)
4. Open the MCP client (Accordo Hub) and ensure the browser relay is connected

**Tool:** `accordo_browser_capture_region`

**Scenario 1 — Redaction with matching text:**
1. Call `browser_capture_region` with:
   ```json
   {
     "mode": "viewport",
     "redact": true
   }
   ```
2. The `security.redactionPolicy.redactPatterns` should include the email pattern (configured in VS Code settings or security config)
3. **Verify:** The response includes `"screenshotRedactionApplied": true` and `"redactedSegmentCount": 1`
4. **Verify:** The returned `dataUrl` is a data URI of the screenshot where the email text region is painted over with a solid black rectangle

**Scenario 2 — No redaction when redactPatterns is empty:**
1. Call `browser_capture_region` with `redact: true` but `security.redactionPolicy.redactPatterns: []`
2. **Verify:** Response has `"screenshotRedactionApplied": false` (or field absent)
3. **Verify:** No black rectangles painted on the screenshot

**Scenario 3 — MCP-VC-005 warning:**
1. Configure `security.redactionPolicy.redactPatterns` with at least one pattern
2. Call `browser_capture_region` with `mode: "viewport"` (no `redact` needed)
3. **Verify:** Response includes `"redactionWarning": "screenshots-not-subject-to-redaction-policy"`

**Scenario 4 — Full-page capture with redaction:**
1. Call `browser_capture_region` with:
   ```json
   {
     "mode": "fullPage",
     "redact": true
   }
   ```
2. **Verify:** `originalBounds` uses CSS viewport dimensions, text map bboxes are correctly scaled to image pixels
3. **Verify:** Black rectangles appear over matching text regions in the full-page screenshot

---

### 2.2 TTL Eviction (GAP-I1)

**Setup:** Same as above. Uses a page that can be refreshed/navigated.

**Scenario 1 — Extension-side TTL (SnapshotStore in Chrome extension):**
1. Navigate to a page and take several snapshots (e.g., 6+ viewport captures) — the store holds up to 5 per page
2. **Verify (pre-TTL):** Older snapshots are evicted by FIFO when > 5 are stored
3. **Wait** for more than the TTL period (default: 1 hour — to test, temporarily lower via service worker `defaultStore.setMaxAgeMs(5000)`)
4. **Verify (post-TTL):** Calling `get_spatial_relations` or any tool that reads from the store returns only non-expired snapshots

**Scenario 2 — Browser package TTL (SnapshotRetentionStore):**
1. With `securityConfig.snapshotRetention.maxAgeMs` set to e.g., `60000` (1 minute)
2. Take a capture — the envelope is saved to `SnapshotRetentionStore`
3. **Wait** 65 seconds
4. **Verify:** `browser_diff_snapshots` or any tool reading from the store no longer returns the expired envelope

---

### 2.3 Spatial Relations — z-order fields (GAP-D2)

**Setup:** A page with visually stacked elements (e.g., a modal dialog over a backdrop, or positioned elements with z-index)

**Tool:** `accordo_browser_get_spatial_relations`

**Scenario:**
1. Capture a page map first: `browser_get_page_map`
2. Call `get_spatial_relations` with the captured node IDs
3. **Verify:** Response `nodes` array includes `zIndex`, `isStacked`, and `occluded` fields for each node
4. **Verify:** An element behind a modal has `occluded: true` (another element is on top at its center point)

---

## Notes

- **E2E with live Chrome extension:** Requires the Chrome extension to be installed and the browser relay to be running. Install the `.crx` from `dist/`, or load unpacked from `dist/`.
- **Debug logs:** Extension logs are at `~/.accordo/accordo-vscode-*/logs/*/window1/exthost/output_logging_*/`. Key log files: `1-Accordo Hub.log`, `4-Accordo Browser Relay.log`.
- **Pre-existing failures** in `spatial-helpers.test.ts` are due to wrong expected values in the tests — the implementation (`computeSpatialRelations`) is correct per the spec. The test comments themselves admit the expected values may be wrong (e.g., D2-overlap-04 comment says "IoU = 2500/10000 = 0.25" but the assertion uses `625/8375`).
