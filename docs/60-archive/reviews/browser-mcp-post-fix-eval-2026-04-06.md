# Accordo Browser MCP Post-Fix Evaluation — 2026-04-06

Target page: `https://news.ycombinator.com/` (tabId `918300491`)  
Method: live tool-driven evaluation using `accordo_browser_*` APIs only.

---

## Category Scores (0–5) with Evidence

### A — Session & page context
**Score: 5/5**

Evidence observed:
- `list_pages` returned full tab inventory and included target tab `918300491` (HN).
- `select_page(tabId:918300491)` returned `{"success":true}`.
- `navigate(type:"reload")` returned `readyState:"interactive"`, URL/title aligned to HN.
- `wait_for` checks passed for:
  - text: `"Hacker News"`
  - selector: `"tr.athing"`
  - stable layout: `stable-layout` in ~802ms
- `get_page_map(traverseFrames:true)` returned `iframes: []` (explicit frame enumeration result).

Assessment: routing and page-readiness behavior looked reliable.

---

### B — Text extraction quality
**Score: 3/5**

Evidence observed from `get_text_map`:
- Segment fields present and useful: `textRaw`, `textNormalized`, `nodeId`, `bbox`, `visibility`, `readingOrderIndex`, `role`.
- Link-role tagging worked well on many HN links (`role:"link"`).
- **Gap:** `accessibleName` was not present in returned segments (including link segments), despite expected fallback behavior.

Assessment: strong baseline text segmentation and ordering, but accessibility naming metadata appears incomplete.

---

### C — Structural/semantic understanding
**Score: 4/5**

Evidence observed:
- `get_semantic_graph` returned all major structures:
  - `a11yTree` (large, detailed)
  - `landmarks` (form landmark present)
  - `outline` (empty on this page)
  - `forms` (search form parsed with field model)
- `get_dom_excerpt(selector:"table#hnmain")` returned sanitized HTML/text excerpt with truncation flag and extracted content.

Assessment: semantic model is rich and practical; no visible shadow/frame lineage issues on this page (no iframes found).

---

### D — Spatial/layout intelligence
**Score: 3/5**

Evidence observed:
- `get_page_map(includeBounds:true)` returned:
  - `bounds`, `viewportRatio`, `occluded`
  - stack signals (`zIndex`, `isStacked`) for overlay layer
- `get_spatial_relations(nodeIds:[0,1,6,10])` produced pairwise relations with `leftOf`, `above`, `contains`, `containedBy`, `overlap`, `distance`.
- **Gap:** expected `containerId` style lineage signal was not present in map output.
- Minor quality concern: one relation pair showed surprising semantics (`contains:true` and `containedBy:true` simultaneously), suggesting edge-case ambiguity.

Assessment: usable spatial model, but not yet fully robust/clear for all relationship semantics.

---

### E — Visual capture
**Score: 5/5**

Evidence observed from `capture_region`:
- `mode:"viewport"` (PNG, inline) succeeded.
- `mode:"fullPage"` (WEBP, `transport:"file-ref"`) succeeded with `fileUri` + `filePath`.
- Explicit `rect` capture (JPEG) succeeded with dimensions/size metadata.
- `nodeRef` capture succeeded (PNG file-ref).
- Visual outputs include linkage fields (`relatedSnapshotId`, `snapshotId`, `auditId`).

Assessment: capture modes/formats/transports are complete and work reliably.

---

### F — Interaction discoverability
**Score: 2/5**

Evidence observed:
- `get_page_map(interactiveOnly:true)` returned many actionable elements with hrefs and bounds (good).
- `inspect_element` returned strong actionability details (`visible`, `hasPointerEvents`, `isObstructed`, `clickTargetSize`, anchor metadata).
- **Major gap:** `get_page_map(roles:["link"])` returned only 8 footer links (`filterSummary.totalAfterFilter: 8`) instead of broad nested link discovery expected on HN.

Assessment: inspection is good, but roles filter behavior appears under-inclusive and blocks discoverability workflows.

---

### G — Change tracking
**Score: 2/5**

Evidence observed:
- `manage_snapshots(action:"list")` provided retention inventory across pages/sources.
- First `diff_snapshots(fromSnapshotId:"...:10")` failed with:
  - `error:"snapshot-not-found"`
  - detailed hints/recovery guidance
  - confusing requested id in details (`...:18`) not matching input.
- Retried with recommended flow:
  1) `get_page_map` baseline (`snapshotId:"...:24"`)
  2) `diff_snapshots(fromSnapshotId:"...:24")`
  -> succeeded (`toSnapshotId:"...:25"`, summary returned).

Assessment: works, but lifecycle/ID ergonomics are brittle and can mislead operators.

---

### H — Robustness
**Score: 3/5**

Evidence observed:
- Positive: `wait_for` works for text, selector, and `stableLayoutMs`.
- Timeout path tested with nonexistent selector:
  - response: `{"met":false,"error":"timeout","elapsedMs":1200}`.
- Error-shape consistency is mixed:
  - `diff_snapshots` includes rich `retryable` + `recoveryHints` + details.
  - `wait_for` timeout lacks equivalent `retryable`/hint metadata.

Assessment: core behavior is stable; error payload consistency could be improved.

---

### I — Security/privacy
**Score: 3/5**

Evidence observed:
- Origin controls worked:
  - `allowedOrigins:["https://news.ycombinator.com"]` succeeded.
  - `deniedOrigins:["https://news.ycombinator.com"]` returned `error:"origin-blocked"` with recovery hints.
- `redactPII:true` on text map applied redaction (`redactionApplied:true`).
- **Gap:** redaction appears over-aggressive on non-PII numeric/text content (e.g., counts/user suffixes).
- Screenshot responses explicitly warn: `"screenshots-not-subject-to-redaction-policy"`.

Assessment: controls exist and enforce correctly, but privacy defaults/precision need refinement for practical use.

---

## Final Scorecard

| Category | Score (0–5) |
|---|---:|
| A — Session & page context | 5 |
| B — Text extraction quality | 3 |
| C — Structural/semantic understanding | 4 |
| D — Spatial/layout intelligence | 3 |
| E — Visual capture | 5 |
| F — Interaction discoverability | 2 |
| G — Change tracking | 2 |
| H — Robustness | 3 |
| I — Security/privacy | 3 |
| **Total** | **30 / 45** |

---

## Gate Status

**PASS** (threshold met: total ≥ 30 and no category below 2).

---

## Remaining Gaps / Recommendations

1. **Fix `roles:["link"]` coverage** in `get_page_map` (currently under-returning on deeply nested links).
2. **Add `accessibleName` to `get_text_map` segments** for links/buttons/headings as expected.
3. **Harden snapshot diff ergonomics**:
   - ensure requested `fromSnapshotId` is honored consistently,
   - remove confusing mismatched IDs in error details.
4. **Unify error contract** so `wait_for` timeout includes `retryable` and `recoveryHints`.
5. **Tune PII redaction precision** to avoid redacting benign numeric/article content.
6. Consider optional **screenshot redaction mode** (or explicit policy toggle) for privacy-sensitive audits.
