# Testing Guide — M113-SEM (Semantic Graph Tool)

Module: `browser_get_semantic_graph`  
Date: 2026-03-29  
Status: Phase D3 complete — D2 PASS

---

## Section 1 — Automated Tests

These are the automated tests covering M113-SEM. I ran all commands below and confirmed they pass.

### Command 1 — Collector layer (browser-extension)

```bash
pnpm --filter browser-extension test -- --run tests/semantic-graph-collector.test.ts
```

Result observed: **751 passed, 0 failed** (includes `semantic-graph-collector.test.ts`: **87 tests**).

This suite verifies:
- **B2-SG-001..005**: response shape includes all subtrees; a11y tree nodes include role/name/value/description/bounds; maxDepth behavior.
- **B2-SG-006 & B2-SG-009**: visibility and attachment flags, plus `visibleOnly` filtering across **a11yTree, landmarks, outline, and forms**.
- **B2-SG-007 & B2-SG-014**: landmark extraction and role mapping (including `<search>`, labelled `<section>` → `region`, and exclusion of non-landmark explicit roles).
- **B2-SG-008**: heading outline extraction (`h1`–`h6`) and DOM-order semantics.
- **B2-SG-009 & B2-SG-013**: form model extraction (labels/types/required/invalid/options) and password redaction.
- **B2-SG-010**: large-DOM performance fixture (~5000 nodes) completes within budget.
- **B2-SG-015**: empty/edge DOM behavior returns valid empty arrays without crashing.

### Command 2 — Tool/relay layer (browser)

```bash
pnpm --filter accordo-browser test -- --run src/__tests__/semantic-graph-tool.test.ts
```

Result observed: **366 passed, 0 failed** (includes `semantic-graph-tool.test.ts`: **31 tests**).

This suite verifies:
- Tool registration and schema for `browser_get_semantic_graph`.
- **B2-SG-011**: handler calls the page-understanding relay action for semantic graph.
- **B2-SG-012**: snapshot envelope persistence in retention store.
- **B2-SG-013**: response shape includes `snapshotId`, `origin`, `timestamp`, `expiry`, and semantic subtrees.
- **B2-SG-014**: `origin` is derived from active webview URL.
- **B2-SG-015**: graceful error mapping and stable failure responses.

### Coverage summary

Total M113-SEM tests: **118** (87 collector + 31 tool).  
All requirement IDs **B2-SG-001..015** are covered by automated tests and currently passing.

---

## Section 2 — User Journey Tests

These are manual, user-facing checks for a non-technical tester using Accordo with a connected browser.

### Scenario 1 — Get a semantic snapshot of a regular content page

**Setup:** Open any article/docs page and connect Accordo browser integration.

**Steps:**
1. Invoke `browser_get_semantic_graph` with default options.
2. Inspect returned top-level fields and subtrees.

**Expected:**
- Response includes: `snapshotId`, `origin`, `timestamp`, `expiry`, `a11yTree`, `landmarks`, `outline`, `forms`.
- `a11yTree` is non-empty on typical pages and contains readable role/name entries.

### Scenario 2 — Landmarks and heading outline match page structure

**Setup:** Use a page with header/nav/main/footer and multiple headings.

**Steps:**
1. Invoke `browser_get_semantic_graph`.
2. Check `landmarks` and `outline` arrays.

**Expected:**
- Landmarks include expected regions (e.g., `banner`, `navigation`, `main`, `contentinfo`) when present.
- Outline entries reflect visible heading hierarchy (`h1` to `h6`) in page reading order.

### Scenario 3 — Forms are captured with useful field metadata

**Setup:** Open a page containing a sign-in/search form.

**Steps:**
1. Invoke `browser_get_semantic_graph`.
2. Inspect `forms[].fields`.

**Expected:**
- Field metadata includes label/type/name/required/placeholder as available.
- Password-like values are redacted (`"[REDACTED]"`) rather than returned in plain text.

### Scenario 4 — Visibility filtering for user-visible structure only

**Setup:** Use a page with hidden/offscreen elements (collapsed menus, hidden dialogs).

**Steps:**
1. Invoke `browser_get_semantic_graph` with `{ "visibleOnly": true }`.
2. Compare against default call without `visibleOnly`.

**Expected:**
- Hidden/offscreen structures are removed from all four subtrees (`a11yTree`, `landmarks`, `outline`, `forms`).
- Visible content remains represented.

### Scenario 5 — Depth-limited semantic graph

**Setup:** Use a complex page with deeply nested UI.

**Steps:**
1. Invoke `browser_get_semantic_graph` with `{ "maxDepth": 2 }`.
2. Compare with default depth call.

**Expected:**
- Depth-limited result is shallower and contains fewer descendant nodes.
- Response stays valid and does not error.

### Scenario 6 — Browser disconnected behavior

**Setup:** Disconnect extension/hub integration.

**Steps:**
1. Invoke `browser_get_semantic_graph`.

**Expected:**
- Tool returns a clear failure response (for example, browser-not-connected/action-failed), without crashing the system.
