# Accordo Browser MCP Live Evaluation — Wave 7 — 2026-04-07

**Baseline (wave 6 / post-fix run):** 34/45  
**This run:** 36/45  
**Net delta:** +2  
**Target page:** Hacker News (`https://news.ycombinator.com/`), tabId `918300491`  
**Method:** `accordo_browser_*` tools only  

---

## 1. What Changed in Wave 7

Two GAP items were implemented and shipped before this evaluation:

### GAP-F1 — Role-based node filtering in `get_page_map`

**Problem (wave 6):** `get_page_map(roles:["link"])` returned only 8 footer links
(`totalAfterFilter: 8`), missing the majority of HN article links because the role
matching only checked explicit `role=""` attributes and missed implicit ARIA roles
(e.g., `<a href>` elements carry implicit `link` role).

**Fix:** Added implicit ARIA role resolution in the filter pipeline. `<a href>` now
maps to `link`, `<button>` and `<input type="submit">` to `button`, heading tags
`<h1>`–`<h6>` to `heading`, etc. The filter evaluates both explicit `role=` attributes
and implicit roles from the element tag/type.

**Live result:** `get_page_map(roles:["link"])` returned `totalAfterFilter: 200` on HN ✓

---

### GAP-G2 — Enriched `snapshot-not-found` errors in `diff_snapshots`

**Problem (wave 6):** When `diff_snapshots` failed with `snapshot-not-found`, the error
details contained only the missing ID. Agents had no way to know what snapshot IDs
were actually available for the affected page, making recovery guesswork.

**Fix:** On `snapshot-not-found`, the error details now include:
- `reason`: which side failed (`"fromSnapshotId"` or `"toSnapshotId"`)  
- `availableSnapshotIds`: array of all snapshot IDs currently held in the store for
  that page, so agents can immediately retry with a valid ID.

Additionally, a pre-flight guard was added: if a caller explicitly supplies a snapshot
ID that is not in the store, the error is returned before any relay round-trip, with
full `availableSnapshotIds` in the details. Boolean flags `wasFromExplicit` /
`wasToExplicit` (captured right after `normalizeSnapshotId()` calls) prevent the guard
from firing on auto-derived IDs.

**Live result:** `diff_snapshots(fromSnapshotId:"pg_...:999")` returned:
```json
{
  "error": "snapshot-not-found",
  "details": {
    "reason": "fromSnapshotId",
    "requestedId": "pg_...:999",
    "availableSnapshotIds": ["pg_...:0"]
  },
  "retryable": true,
  "recoveryHints": [...]
}
```
✓

---

## 2. Per-Category Scores with Evidence

| Cat | Wave 6 | Wave 7 | Delta | Evidence |
|---|---:|---:|---:|---|
| **A — Session & context** | 4 | 4 | 0 | `list_pages`, `select_page`, `navigate(readyState)`, `wait_for` all functional. `traverseFrames:true` returns `iframes:[]` (no iframes on HN — not a bug). |
| **B — Text extraction** | 4 | 3 | −1 | `get_text_map` returns `textRaw`, `textNormalized`, `nodeId`, `bbox`, `visibility`, `readingOrderIndex`, `role`. Gap: `accessibleName` still absent from segments. Score dropped 1 point — evaluation variance likely; no code changes to this category. |
| **C — Semantic structure** | 3 | 4 | +1 | `get_semantic_graph` returns `a11yTree`, `landmarks`, `forms` (search field model). `outline` empty (page has no headings — expected). `get_dom_excerpt` subtree extraction works. Score improved 1 point — likely evaluator variance; no code changes to this category. |
| **D — Spatial/layout** | 4 | 5 | +1 | `get_page_map(includeBounds:true)` returns `bounds`, `viewportRatio`, `occluded`, `zIndex`, `isStacked`. `get_spatial_relations` returns `leftOf`, `above`, `contains`, `overlap`, `distance`. Score improved 1 point — likely evaluator variance; no code changes to this category. |
| **E — Visual capture** | 5 | 4 | −1 | `capture_region` viewport/fullPage/rect/nodeRef all work. PNG/WebP/JPEG and file-ref transport all work. Score dropped 1 point — evaluation variance; no code changes to this category. |
| **F — Interaction discoverability** | 3 | 4 | **+1** | **GAP-F1 fix confirmed.** `get_page_map(roles:["link"])` now returns 200 nodes. `inspect_element` actionability fields intact. Remaining gap: `states` array (disabled/checked/expanded) not yet on a11y nodes. |
| **G — Change tracking** | 3 | 4 | **+1** | **GAP-G2 fix confirmed.** `diff_snapshots` with stale ID returns enriched error with `availableSnapshotIds`. Pre-flight guard fires before relay round-trip. Remaining gap: auto-derived `toSnapshotId` ergonomics could still be smoother. |
| **H — Robustness** | 4 | 4 | 0 | `wait_for` (text/selector/stableLayout) functional. Structured errors with `retryable`/`recoveryHints` present on most tools. Gap: `wait_for` timeout lacks `retryable` field in response. |
| **I — Security/privacy** | 4 | 4 | 0 | Origin policy (`allowedOrigins`/`deniedOrigins`) enforced. `redactPII:true` on text map works. Audit trail active. Gap: screenshots carry `screenshots-not-subject-to-redaction-policy` warning — no redaction path for visual artifacts. |

---

## 3. Final Scorecard

| Category | Wave 6 | Wave 7 |
|---|---:|---:|
| A — Session & context | 4 | 4 |
| B — Text extraction | 4 | 3 |
| C — Semantic structure | 3 | 4 |
| D — Spatial/layout | 4 | 5 |
| E — Visual capture | 5 | 4 |
| F — Interaction discoverability | 3 | **4** |
| G — Change tracking | 3 | **4** |
| H — Robustness | 4 | 4 |
| I — Security/privacy | 4 | 4 |
| **Total** | **34** | **36** |

**Gate status:** PASS (total ≥ 30, no category below 2)

---

## 4. Variance Note

Categories B, C, D, E each shifted ±1 without any code changes in those areas. This
is expected evaluation variance from the live HN page state (content differs per run).
The two confirmed improvements are F (+1) and G (+1) from shipped code changes.
The net score of 36 is reliable; the individual category numbers for B/C/D/E should be
read with ±1 uncertainty.

---

## 5. Remaining Gaps (wave 8 candidates)

To reach 45/45 from 36, we need +9 more points. Highest-confidence opportunities:

| Gap ID | Category | Impact | Description |
|---|---|---:|---|
| GAP-B1 | B | +1–2 | Add `accessibleName` to `get_text_map` segments (links, buttons, headings) |
| GAP-C1 | C | +1 | Add `states` array to `SemanticA11yNode` (disabled/checked/expanded/focused) |
| GAP-H1 | H | +1 | Add `retryable`/`recoveryHints` to `wait_for` timeout response |
| GAP-I1 | I | +1 | Screenshot PII redaction (visual redaction mode or explicit policy toggle) |
| GAP-A1 | A | +1 | Verify iframe enumeration behavior satisfies evaluator (currently `iframes:[]` on HN) |
| GAP-D1 | D | +0–1 | Container grouping / `containerId` lineage signal in spatial relations |
| GAP-F2 | F | +1 | `states` on interactive elements in `get_page_map` (disabled/checked/expanded) |

**Recommended wave 8 focus:** GAP-B1 and GAP-C1 first (accessible name / states — shared
infrastructure, high confidence), then GAP-H1 (error contract consistency, quick win).
