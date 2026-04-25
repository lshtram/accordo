# Accordo Browser MCP Wave 6 Evaluation — 2026-04-06

Target tab: `Hacker News` (`tabId=918300491`)  
Method: live MCP testing with `accordo_browser_*` tools only.

---

## 1) Category scores (1–5) with justification

### A. Page Map Quality — **5/5**
- `get_page_map` returned rich node data including `tag`, `ref`, `nodeId`, `persistentId`, `attrs`, and (when enabled) `bounds`, `viewportRatio`, `occluded`.
- Data is actionable and consistent on HN.

### B. Text Map & Semantic Graph — **4/5**
- `get_text_map` returns high-quality segments with `textRaw`, `textNormalized`, `bbox`, `visibility`, `readingOrderIndex`, `role`, and `accessibleName` (verified on link segments).
- `get_semantic_graph` returned a large `a11yTree`, `landmarks`, and form model.
- Minor gap: heading outline on HN came back empty (likely page-specific, but still limits this category on this page).

### C. Filter & Navigation — **3/5**
- Required check passed: `get_page_map(maxNodes:200, roles:["link"], tabId:918300491)` showed `filterSummary.totalBeforeFilter: 661` (hundreds), confirming fresh extension behavior.
- `interactiveOnly` behaved well and returned actionable links.
- `selector`, `textMatch`, and `visibleOnly` behaved inconsistently (several calls reported `totalBeforeFilter: 12` and unexpectedly narrow trees), so filtering is only partially reliable.

### D. Spatial & Inspect — **3/5**
- `get_spatial_relations` returned directional/containment metrics (`leftOf`, `above`, `contains`, `containedBy`, `overlap`, `distance`).
- `inspect_element` works well via selector and returns useful actionability context.
- Gaps: ref-based inspect failed when ref came from a different map snapshot, and inspect output did not expose explicit `accessibleName`/state payload as richly as expected.

### E. Screenshot & Capture — **5/5**
- `capture_region` succeeded for:
  - `mode:"viewport"` + `format:"png"` (inline)
  - `mode:"fullPage"` + `format:"png"` (inline)
  - `transport:"file-ref"` (returned valid `fileUri`/`filePath`)
- Metadata (`mode`, `sizeBytes`, `artifactMode`, `relatedSnapshotId`) was present.

### F. Diff & Snapshots — **2/5**
- `diff_snapshots` can work in limited cases (one successful diff observed earlier).
- Reliability is poor in normal flow: repeated `diff_snapshots` after navigation returned `{"success":false,"error":"action-failed"}` and explicit-ID diff returned `snapshot-not-found` for recent IDs.
- Snapshot lifecycle/lookup appears brittle.

### G. Wait & Navigate — **4/5**
- `wait_for` succeeded with text and selector conditions.
- `navigate` to explicit URLs worked reliably (`news?p=2`, `newsfaq.html`).
- Gap: `navigate(type:"back")` failed with `action-failed`, so history navigation is not fully reliable.

### H. Error Quality — **2/5**
- `wait_for` timeout test returned only `{"met":false,"error":"timeout","elapsedMs":1200}`.
- Missing expected structured recovery metadata (`retryable`, `recoveryHints`) on timeout path.
- Some other failures (`action-failed`) were also minimally descriptive.

### I. Redaction & Privacy — **3/5**
- `redactPII:true` clearly redacted emails (`hn@ycombinator.com` -> `[REDACTED]`).
- Not over-aggressive for normal prose/links, but **was** over-aggressive for benign numeric values (e.g., `10`, `20`, `180` became `[REDACTED]`).
- Privacy functionality exists, precision still needs tuning.

---

## 2) Total score

**31 / 45**

| Category | Score |
|---|---:|
| A | 5 |
| B | 4 |
| C | 3 |
| D | 3 |
| E | 5 |
| F | 2 |
| G | 4 |
| H | 2 |
| I | 3 |
| **Total** | **31 / 45** |

---

## 3) G1 gate status

G1 requires: **total ≥ 36** and **all categories ≥ 3**.

**Result: NOT MET**
- Total is 31 (<36)
- F and H are below 3

---

## 4) Top 3 remaining gaps + suggested fixes

1. **Diff/snapshot reliability is unstable (Category F)**
   - Symptoms: intermittent `action-failed`, recent snapshots reported `snapshot-not-found`.
   - Fix: unify snapshot retention/indexing contract and ensure `diff_snapshots` can always diff latest-known snapshots after navigation.

2. **Timeout/error payloads lack recovery structure (Category H)**
   - Symptoms: `wait_for` timeout omits `retryable`/`recoveryHints`.
   - Fix: standardize error schema across all browser tools to always include `code`, `retryable`, `recoveryHints`, and optional structured `details`.

3. **Filter consistency issues beyond roles-link path (Category C)**
   - Symptoms: `selector`/`textMatch`/`visibleOnly` sometimes collapse to shallow (`totalBeforeFilter: 12`) behavior.
   - Fix: align all filter paths with the same traversal depth and pre-filter node universe used by `roles` and `interactiveOnly`.

---

## 5) What improved vs previous report

Compared with `docs/60-archive/reviews/browser-mcp-post-fix-eval-2026-04-06.md`:

- **Improved:** the critical roles-link check is now healthy (`totalBeforeFilter` in the hundreds, not stale small counts).
- **Improved:** `get_text_map` now shows `accessibleName` on link segments in live output.
- **Still weak:** diff/snapshot robustness remains inconsistent and error-quality on timeout paths is still underpowered.
