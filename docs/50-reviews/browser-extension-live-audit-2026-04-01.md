# Browser Extension Live Audit — 2026-04-01

**Scope:** `accordo-browser` MCP surface + Chrome browser extension live runtime behavior  
**Method:** live tool execution against the connected browser/runtime  
**Reference docs:**
- `docs/30-development/mcp-webview-agent-evaluation-checklist.md`
- `docs/20-requirements/requirements-browser-extension.md`
- `docs/20-requirements/requirements-browser2.0.md`
- `docs/10-architecture/browser-tab-control-architecture.md`

---

## Executive Summary

The browser stack is **partially working but not production-ready**. Basic page understanding works on the active tab, but there are still major reliability and completeness gaps:

1. `tabId`-scoped operation is inconsistent and appears broken on some tools.
2. `browser_diff_snapshots` is unreliable and does not honor explicit snapshot IDs consistently.
3. `browser_capture_region` silently succeeds on invalid targets instead of returning a structured error.
4. `browser_get_text_map` returns large amounts of hidden/offscreen text, weakening the “what the user sees” contract.
5. Browser control tools (`browser_navigate`, `browser_click`, `browser_type`, `browser_press_key`) were not validated as a live MCP surface in this session and remain an exposure/verification gap.

---

## Live Smoke Test — Control Confirmed

The following live operations succeeded:

- `accordo_browser_list_pages`
- `accordo_browser_select_page`
- `accordo_browser_get_page_map`
- `accordo_browser_inspect_element`
- `accordo_browser_get_dom_excerpt`
- `accordo_browser_capture_region`
- `accordo_browser_wait_for`

This confirms the browser extension/relay is connected and the agent can roam across browser tabs at least at the session-management level.

---

## Evidence Summary

### Working in this live session

| Capability | Result | Evidence summary |
|---|---|---|
| List tabs | ✅ | `accordo_browser_list_pages` returned multiple tabs with stable `tabId` values |
| Select tab | ✅ | `accordo_browser_select_page` succeeded on Wikipedia tab |
| Page map (active tab) | ✅ | Returned `snapshotId`, page metadata, nodes, filter summary |
| Inspect element | ✅ | Returned bounds, visibility, anchor strategy/confidence, context |
| DOM excerpt | ✅ | Returned `found`, sanitized `html`, `text`, `nodeCount` |
| Wait primitive | ✅ | `accordo_browser_wait_for` matched visible text immediately |
| Semantic graph (active tab) | ✅ | Returned `a11yTree`, `landmarks`, `outline`, `forms` |
| Region capture (valid target) | ✅ | Returned `success: true`, `dataUrl`, dimensions, snapshot envelope |

### Broken or suspect in this live session

| Capability | Result | Evidence summary |
|---|---|---|
| `tabId` on non-active tools | ❌ | `accordo_browser_get_page_map(tabId=918297954)` returned `action-failed`; `get_text_map(tabId=...)` and `get_semantic_graph(tabId=...)` also failed |
| `browser_diff_snapshots()` implicit behavior | ❌ | Empty call returned `snapshot-not-found` |
| `browser_diff_snapshots` explicit IDs | ❌ | `fromSnapshotId=page:3,toSnapshotId=page:5` returned `snapshot-not-found` even though `page:5` had just been produced |
| Invalid region target handling | ❌ | `accordo_browser_capture_region(anchorKey="ref-99999")` returned `success: true` instead of `element-not-found` / `no-target` |
| Visible-text quality | 🟡 | `accordo_browser_get_text_map` returned many `hidden`/`offscreen` zero-size segments ahead of user-relevant visible content |

---

## Findings

### F1 — `tabId` support is inconsistent

**Severity:** High  
**Expected:** Browser continuity requirements say the agent should keep operating on a selected/background tab.  
**Observed:**
- `accordo_browser_get_page_map(tabId=918297961)` succeeded.
- `accordo_browser_get_page_map(tabId=918297954)` returned `action-failed`.
- `accordo_browser_get_text_map(tabId=...)` returned `action-failed`.
- `accordo_browser_get_semantic_graph(tabId=...)` returned `action-failed`.

**Impact:** Non-active-tab continuity is not reliable. This directly blocks the Priority A continuity goal.

### F2 — `browser_diff_snapshots` is not trustworthy

**Severity:** High  
**Observed:**
- `accordo_browser_diff_snapshots({})` → `snapshot-not-found`
- `accordo_browser_diff_snapshots({ fromSnapshotId: "page:3" })` → succeeded
- `accordo_browser_diff_snapshots({ fromSnapshotId: "page:3", toSnapshotId: "page:5" })` → `snapshot-not-found`

**Impact:** Snapshot retention/lookup/versioning semantics are inconsistent. Agents cannot rely on change tracking.

### F3 — `browser_capture_region` returns false positives on invalid targets

**Severity:** High  
**Observed:** Invalid `anchorKey` capture still returned `success: true` with an image payload and no error.

**Expected:** Structured failure such as `element-not-found` or `no-target` per requirements/checklist.

**Impact:** Agents can believe they captured the requested element when they actually captured a fallback image.

### F4 — `browser_get_text_map` does not cleanly represent visible user text

**Severity:** Medium  
**Observed:** Returned segments were heavily populated by hidden/offscreen navigation and chrome text, including many zero-size boxes.

**Impact:** Weakens the core “what the user sees” contract and wastes tokens.

### F5 — Browser control tool surface remains unverified as a live MCP capability

**Severity:** High  
**Expected from architecture:** live MCP tools for `browser_navigate`, `browser_click`, `browser_type`, `browser_press_key`.

**Observed in this session:** these tools were not part of the live validation path here, so there is still a real ship-risk around registration/exposure/E2E behavior.

**Impact:** The browser stack cannot be considered “fully tested” until action tools are reachable and validated end-to-end.

---

## Missing or Incomplete Requirements Coverage

### Critical

1. Reliable `tabId` support across all browser tools
2. Stable snapshot versioning and explicit diff semantics
3. Correct invalid-target error behavior for region capture
4. Live-exposed and validated browser control tools
5. Real E2E testing under tab switching / background-tab workflows

### Important

6. Viewport screenshot on `browser_*` surface
7. Full-page screenshot on `browser_*` surface
8. Privacy controls: allow/deny origin policy, redaction hooks, audit trail, retention controls
9. Geometry helpers: `leftOf`, `above`, `contains`, `overlap`, `distance`
10. Better actionability model: enabled/disabled/readonly/obstructed
11. Occlusion / intersection / z-order visibility quality
12. Iframe and shadow-DOM depth coverage
13. Retry/backoff hints and tighter error taxonomy

---

## Recommended Priority Order

### P0

1. Fix `tabId` routing and background-tab support for **all** browser tools.
2. Fix `browser_diff_snapshots` snapshot lookup, retention, and explicit-ID behavior.
3. Fix `browser_capture_region` so invalid targets fail with structured errors.
4. Validate and, if needed, expose `browser_navigate`, `browser_click`, `browser_type`, `browser_press_key` in the live MCP surface.
5. Add true live E2E coverage for tab switching and browser control.

### P1

6. Tighten `browser_get_text_map` so default output better matches visible user text.
7. Add viewport/full-page screenshot tools on the browser surface.
8. Add privacy/security controls from Browser 2.0 P3.
9. Add geometry and occlusion helpers.

### P2

10. Reconcile stale review docs with current live behavior.
11. Add benchmark/perf gates and stronger regression tests for browser-core behavior.

---

## Bottom Line

The browser extension stack is **connected and partially functional**, but it is **not yet in top shape**. The most important next work is reliability: background-tab continuity, diff correctness, strict capture error handling, and live validation of browser control tools.
