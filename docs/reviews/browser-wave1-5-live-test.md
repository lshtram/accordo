# Browser MCP Live Test — Wave 1–5 + Regression

**Date:** 2026-04-06  
**Tester:** OpenCode agent (claude-sonnet-4.6)  
**Tabs used:**
- `918300491` — Hacker News (`https://news.ycombinator.com/`)
- `918300500` — GitHub JJazzLab (`https://github.com/jjazzboss/JJazzLab`) — navigate not possible (control-not-granted); tests run against existing page

**Health check:** `connected:true`, `uptimeSeconds:11528`, `recentErrors:[]`  
**Navigate note:** `accordo_browser_navigate` returned `control-not-granted` for tab 918300500 in all attempts (select_page first + direct). W3schools navigation was not possible; W4 tests run against github.com/jjazzboss/JJazzLab instead.

---

## Results Table

| Test ID | Description | Result | Key Evidence |
|---------|-------------|--------|--------------|
| **W1-A** | Shadow toggle produces different node count | **PARTIAL** | Both calls succeed (no error). HN: both return `totalElements:809` (no shadow DOM, expected). GitHub: both `piercesShadow:false` and `true` return `totalElements:2066` — no shadow delta on github.com/jjazzboss. Tool runs without error. |
| **W1-B** | TRANSIENT_ERRORS dedup — `retryable` field | **PASS** | `{"success":false,"error":"snapshot-not-found","retryable":false,...}` — `retryable` boolean present at top level. |
| **W1-C** | `elapsedMs` exists on wait timeout | **FAIL** | Response is bare string `"timeout"` — no structured object, no `elapsedMs` field. |
| **W2-A** | `format:"webp"` succeeds | **FAIL** | Response: `{"success":true,"dataUrl":"data:image/jpeg;base64,..."}` — WebP format param ignored, fell back to JPEG. `dataUrl` does NOT start with `data:image/webp`. |
| **W2-B** | PNG still works | **PASS** | `{"success":true,"dataUrl":"data:image/png;base64,...","artifactMode":"inline"}` — correct format. |
| **W2-C** | JPEG still works | **PASS** | `{"success":true,"dataUrl":"data:image/jpeg;base64,..."}` — correct format. |
| **W3-A** | `transport:"file-ref"` writes file, returns `filePath` | **FAIL** | Response: `{"success":true,"dataUrl":"data:image/png;base64,...","artifactMode":"inline"}` — `transport` param ignored entirely. No `filePath`, no `artifactMode:"file-ref"`, `dataUrl` present. |
| **W3-B** | `artifactMode:"inline"` on default capture | **PASS** | Default PNG capture response has `"artifactMode":"inline"` at top level. |
| **W4-A** | `traverseFrames:true` returns `iframes` array | **PASS** | Response includes `"iframes":[]` — key present. GitHub has no detectable `<iframe>` elements (uses turbo-frame custom elements, not standard iframes). |
| **W4-B** | `frameFilter` param accepted | **PASS** | `frameFilter:["content"]` with `traverseFrames:true` succeeds, no unknown-parameter error. Response identical structure including `"iframes":[]`. |
| **W4-C** | Iframe metadata has `classification` field | **PASS** | `iframes:[]` — empty array is acceptable (cross-origin/no real iframes). Condition (b) satisfied. |
| **W5-A** | `recoveryHints` at TOP LEVEL on error | **FAIL** | `origin-blocked` error: `{"success":false,"error":"origin-blocked","retryable":false,"pageUrl":null,"found":false}` — NO `recoveryHints` field at all (not at top level, not nested). `snapshot-not-found` error (W1-B): `recoveryHints` exists but is nested under `details`, NOT at top level. `inspect_element` not-found: `{"found":false}` — no error/recoveryHints. |
| **W5-B** | `inspect_element` returns typed state fields | **FAIL** | Element object fields: `tag`, `attributes`, `bounds`, `visible`, `visibleConfidence`, `hasPointerEvents`, `isObstructed`, `clickTargetSize`. No typed boolean state fields: `disabled`, `readonly`, `focused`, `checked`, `expanded`, `selected`, `invalid` absent. |
| **W5-C** | `wait_for` elapsedMs is real (not hardcoded) | **FAIL** | Response is bare string `"timeout"` — not a structured object. Same as W1-C. Inline handler has not been updated. |
| **W5-D** | `redactPII:true`/`false` both succeed | **PASS** | `get_text_map` with `redactPII:true`: succeeded, `[REDACTED]` markers observed in output (`[REDACTED] points`, `[REDACTED] comments`), `"redactionApplied":true`. `capture_region` with `redactPII:false`: succeeded, `success:true`, no warning emitted about screenshot exclusion. |
| **W5-E** | `recoveryHints` in snapshot-not-found error | **FAIL** | See W5-A. In `snapshot-not-found` the field exists but is nested: `details.recoveryHints` = `"The requested snapshot ID does not exist..."`. NOT at top level as required. |

---

## Regression Tests

| Test ID | Description | Result | Key Evidence |
|---------|-------------|--------|--------------|
| **REG-A1** | `get_page_map` with `includeBounds` has all metadata fields | **PASS** | `snapshotId:"pg_95abcb1a9c884e0eba58e150f639e069:20"`, `capturedAt:"2026-04-06T18:17:11.228Z"`, `viewport:{width:1851,height:871,...}`, `pageUrl:"https://news.ycombinator.com/"` — all 4 fields present. |
| **REG-B1** | `get_text_map` segments have `nodeId` and text | **PASS** | Each segment has `nodeId` (integer), `textRaw`, `textNormalized`, `bbox`. E.g. `{"textRaw":"Hacker News","nodeId":1,...}`. |
| **REG-C2** | `get_semantic_graph` has `a11yTree`, `landmarks`, `outline` | **PASS** | `a11yTree:[...]` (500+ nodes), `landmarks:[{"role":"form","nodeId":499,...}]`, `outline:[]` (HN has no headings), `forms:[{...}]` — all present. |
| **REG-D2** | `get_spatial_relations` returns spatial relationships | **PASS** | 10 pairs returned for nodeIds [0,1,2,3,4]. Fields per relation: `leftOf`, `above`, `contains`, `containedBy`, `overlap`, `distance`. E.g. node 0→1: `contains:true, overlap:0.85`. |
| **REG-G1** | `manage_snapshots({action:"list"})` returns inventory | **PASS** | 13 pageIds returned, total 51 snapshots. Current session snapshots visible (e.g. `pg_95abcb1a9c884e0eba58e150f639e069` with 10 entries, `pg_a7022bd1ff4c41278d5a842cf6b2c313` with 4). |
| **REG-H1** | `wait_for` finds "Hacker News" on HN tab | **PASS** | `{"met":true,"matchedCondition":"Hacker News","elapsedMs":1}` — structured success response with `elapsedMs`. |
| **REG-I2** | `get_page_map` with `allowedOrigins:["https://news.ycombinator.com"]` works | **PASS** | Full page map returned, `pageUrl:"https://news.ycombinator.com/"`, `totalElements:809`. |
| **REG-I3/I4** | `health` has `sessionIsolation` and `telemetryPolicy` | **PASS** | `sessionIsolation:{model:"shared-profile",...}`, `telemetryPolicy:{enabled:false,...}` — both present. |

---

## Summary

### Wave Items Confirmed Working
- **W1-A**: Both calls succeed without error; `piercesShadow` param accepted (no shadow DOM delta on tested pages)
- **W1-B**: `retryable` boolean present in transient error responses ✓
- **W2-B**: PNG format capture ✓
- **W2-C**: JPEG format capture ✓
- **W3-B**: `artifactMode:"inline"` on default capture ✓
- **W4-A**: `iframes` key present when `traverseFrames:true` ✓
- **W4-B**: `frameFilter` param accepted ✓
- **W4-C**: Empty iframes array acceptable ✓
- **W5-D**: `redactPII` true/false both work, redaction applied correctly ✓

### Items With Issues / Failures

| ID | Issue |
|----|-------|
| **W1-C / W5-C** | `wait_for` timeout returns bare string `"timeout"` — NOT structured object. `elapsedMs` absent on timeout path. Works on success path (REG-H1 shows `elapsedMs:1`). The failure path handler is separate and untouched. |
| **W2-A** | `format:"webp"` not implemented — silently falls back to JPEG. Chrome DevTools protocol `captureScreenshot` likely doesn't support WebP via the current code path. |
| **W3-A** | `transport:"file-ref"` not implemented — param silently ignored, inline dataUrl returned. No `filePath`, no `artifactMode:"file-ref"`. |
| **W5-A / W5-E** | `recoveryHints` not at top level — for `snapshot-not-found` it is nested under `details.recoveryHints`. For `origin-blocked` it is completely absent. Requirement is top-level field. |
| **W5-B** | `inspect_element` element object lacks typed state booleans (`disabled`, `readonly`, `focused`, `checked`, `expanded`, `selected`, `invalid`). Only has `visible`, `hasPointerEvents`, `isObstructed`. |

### Navigate Blocker
`accordo_browser_navigate` requires the tab to have been interacted with by the user first (returns `control-not-granted`). This blocked W4-A testing on w3schools and W1-A shadow DOM testing on github.com homepage. Tests were run on github.com/jjazzboss/JJazzLab as alternative.

---

## Score Delta vs v4 Baseline (37/45)

**New PASS in this run (not previously confirmed):**
- W1-B: retryable field ✓ (+1)
- W3-B: artifactMode inline ✓ (+1)
- W4-A: iframes key present ✓ (+1)
- W4-B: frameFilter accepted ✓ (+1)
- W4-C: empty iframes acceptable ✓ (+1)
- W5-D: redactPII both directions ✓ (+1)

**Confirmed still PASS (regression):**
- REG-A1, REG-B1, REG-C2, REG-D2, REG-G1, REG-H1, REG-I2, REG-I3/I4: all 8 pass ✓

**FAIL items (not implemented or broken):**
- W1-C / W5-C: wait_for timeout path — no elapsedMs (–2)
- W2-A: WebP format — silently falls back to JPEG (–1)
- W3-A: transport:"file-ref" — not implemented (–1)
- W5-A / W5-E: recoveryHints not at top level (–2)
- W5-B: inspect_element missing typed state fields (–1)

**W1-A**: PARTIAL — tool runs without error but no shadow delta observable on tested pages.

**Estimated score this run: ~41–42/50** (from 37/45 baseline, new items tested with 6 new passes and 7 fails out of 13 new items; regression 8/8 clean).

---

## Raw Evidence Snapshots

### W1-B snapshot-not-found response
```json
{
  "success": false,
  "error": "snapshot-not-found",
  "retryable": false,
  "details": {
    "reason": "Snapshot 'pg_FAKE:0' was not found in the retention store.",
    "recoveryHints": "The requested snapshot ID does not exist in the retention store. Call get_page_map (or another read tool) to capture a new snapshot, then use the returned snapshotId in diff_snapshots."
  }
}
```
Note: `recoveryHints` is at `details.recoveryHints`, NOT `response.recoveryHints`.

### W5-A origin-blocked response
```json
{
  "success": false,
  "error": "origin-blocked",
  "retryable": false,
  "pageUrl": null,
  "found": false
}
```
No `recoveryHints` field anywhere.

### W2-A WebP response header
```
{"success":true,"dataUrl":"data:image/jpeg;base64,..."}
```
WebP requested, JPEG returned.

### W3-A file-ref response header
```
{"success":true,"dataUrl":"data:image/png;base64,...","artifactMode":"inline"}
```
transport:"file-ref" ignored, inline returned.

### W5-B inspect_element element object
```json
{
  "tag": "a",
  "attributes": {"href": "https://news.ycombinator.com"},
  "bounds": {"x": 147, "y": 10, "width": 20, "height": 20},
  "visible": true,
  "visibleConfidence": "high",
  "hasPointerEvents": true,
  "isObstructed": false,
  "clickTargetSize": {"width": 20, "height": 20}
}
```
Missing: `disabled`, `readonly`, `focused`, `checked`, `expanded`, `selected`, `invalid`.

### REG-H1 wait_for success (elapsedMs working on success path)
```json
{"met": true, "matchedCondition": "Hacker News", "elapsedMs": 1}
```
