# Browser MCP Fresh Independent Review — 2026-04-06

Scope reviewed:
- `packages/browser/src/`
- `packages/browser-extension/src/`
- Live MCP calls using `accordo_browser_*`, `accordo_comment_*`, `accordo_browser_health`

Test target requested: `http://127.0.0.1:8123/browser-tools-test.html`

## Executive summary

This stack is feature-rich in code (broad tool surface, security hooks, snapshotting, semantic/text/layout pipelines), but **live agent usability is currently poor in this session**:

- I could list/select tabs and use comment tools successfully.
- I could not navigate to the fixture page due `control-not-granted`.
- Read/inspection tools (`get_page_map`, `get_text_map`, `get_semantic_graph`, capture) returned `action-failed` in live use.

So the implementation appears advanced, but real-world operability from an agent perspective is not yet at passing quality.

---

## §7 Scorecard

| Category | Score (0-5) | Notes |
|---|---:|---|
| Session & Context | 2 | `list_pages`/`select_page` work; readiness/context flow blocked by control gating + failed page-understanding calls. |
| Text Extraction | 1 | Strong collector in code, but live tool calls failed (`action-failed`). |
| Semantic Structure | 1 | Strong code architecture; no successful live semantic response in this run. |
| Layout/Geometry | 2 | `includeBounds` + spatial relations exist in code; not validated end-to-end live. |
| Visual Capture | 1 | Capture API is extensive in code; live capture failed (`action-failed`). |
| Interaction Model | 2 | Clear control-permission contract and errors, but no discoverability path to grant control via MCP. |
| Deltas/Efficiency | 2 | Snapshot management works; diff call failed live; artifact is inline base64 (inefficient default). |
| Robustness | 2 | Health + structured errors exist; too many generic `action-failed` outcomes reduce diagnosability. |
| Security/Privacy | 3 | Origin policies, PII redaction hooks, audit IDs/logging present; partial live verification only. |

**Total: 16 / 45**

---

## §7.1 Evidence table (A1–I5)

Legend: ✅ implemented/works, 🟡 partial, ❌ missing or failed in live evaluation.

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 | 🟡 | `accordo_browser_list_pages`, `accordo_browser_get_page_map` | Tab metadata works (`tabId/url/title/active`), but page map metadata retrieval failed live with `action-failed`. |
| A2 | 🟡 | `accordo_browser_navigate`, `accordo_browser_wait_for` | Navigate returns `control-not-granted`; wait timed out. Readiness contract exists in control handler code (`readyState`). |
| A3 | ✅ | `accordo_browser_list_pages`, `accordo_browser_select_page` | Multi-tab enumeration and selection worked in live calls. |
| A4 | 🟡 | `accordo_browser_get_page_map` (with `traverseFrames`), code review | Code supports iframe metadata and frame-targeted forwarding (`frameId`), but live call failed. |
| A5 | 🟡 | code review | Shadow traversal supported in schema/collector (`piercesShadow`, shadow flags), not live-validated due failures. |
| B1 | ❌ | `accordo_browser_get_text_map` | Live `get_text_map` failed with `action-failed`; visible-text extraction not demonstrated. |
| B2 | 🟡 | code review | `TextSegment` includes `nodeId` + `bbox`; mapping model exists in collector. |
| B3 | ✅ | code review | `textRaw` + `textNormalized` explicitly modeled in text collector/types. |
| B4 | ✅ | code review | Reading order implemented (`readingOrderIndex`, top-to-bottom + bidi-aware horizontal sort). |
| B5 | ✅ | code review | Visibility states modeled (`visible`/`hidden`/`offscreen`). |
| C1 | 🟡 | code review | Snapshot envelope and node IDs are present; live retrieval failed. |
| C2 | 🟡 | `accordo_browser_get_semantic_graph`, code review | Unified semantic graph implemented; live call failed (`action-failed`). |
| C3 | 🟡 | code review | Cross-frame routing logic implemented (`frameId`, `forwardToFrame`, iframe metadata resolution). |
| C4 | 🟡 | code review | Shadow-aware traversal exists in page map path; semantic continuity not proven live. |
| C5 | ✅ | code review | Landmark extraction present (`semantic-graph-landmarks`). |
| C6 | ✅ | code review | Outline extraction present (`semantic-graph-outline`). |
| C7 | ✅ | code review | Form model extraction present (`semantic-graph-forms`). |
| D1 | 🟡 | `accordo_browser_get_page_map` (attempt), code review | Bbox fields available when requested; no successful live payload seen. |
| D2 | 🟡 | code review | Dedicated `accordo_browser_get_spatial_relations` tool and relation model exist. |
| D3 | 🟡 | code review | Occlusion and z-order hints exist in page map collector fields (`occluded`, `zIndex`, `isStacked`). |
| D4 | ✅ | code review | Viewport intersection ratio modeled (`viewportRatio`). |
| D5 | ✅ | code review | Container grouping modeled (`containerId`). |
| E1 | ❌ | `accordo_browser_capture_region` with `mode:"viewport"` | Live viewport capture failed with `action-failed`. |
| E2 | ❌ | code review + live capture attempts | Full-page capture path exists (`mode:"fullPage"`), but no successful live validation. |
| E3 | ❌ | `accordo_browser_capture_region` | Region capture path exists, but live call failed. |
| E4 | ✅ | code review | Format and quality options exposed (`jpeg`/`png`, quality). |
| E5 | 🟡 | code review | Response links visual to snapshot (`relatedSnapshotId`, envelope); not observed live. |
| F1 | 🟡 | code review | Interactive discovery via `interactiveOnly` filter exists; not live-validated. |
| F2 | 🟡 | code review | Actionability partially modeled (visibility/occlusion, errors), but no unified actionable inventory response. |
| F3 | 🟡 | code review | Multiple handles supported (uid/selector/coords, role/name in semantic/text surfaces). |
| F4 | ❌ | code review | No explicit click target-size/interception “eventability” hints in tool responses. |
| G1 | ✅ | `accordo_browser_manage_snapshots` | Snapshot IDs retained/listed; monotonic IDs visible in stored snapshots. |
| G2 | ❌ | `accordo_browser_diff_snapshots` | Live diff call failed (`action-failed`). |
| G3 | 🟡 | code review | Incremental retrieval present via max limits/filters; live effectiveness not validated. |
| G4 | ✅ | `accordo_browser_get_page_map` schema, code review | Server-side filtering options are extensive (`visibleOnly`, `interactiveOnly`, roles, textMatch, selector, regionFilter). |
| G5 | 🟡 | code review | Deterministic ordering explicitly implemented for text map; less explicit for all map traversals. |
| G6 | ❌ | `accordo_browser_capture_region` schema/code | Binary artifacts default to inline base64 (`artifactMode:"inline"`), not indirection-first. |
| H1 | 🟡 | `accordo_browser_wait_for` | Wait primitive exists but timed out in live run; no successful positive condition demonstrated. |
| H2 | ✅ | `accordo_browser_wait_for` | Timeout controls are exposed and used. |
| H3 | 🟡 | code review | Retry hints exist in structured errors (`retryable`, `retryAfterMs`) for some tools. |
| H4 | 🟡 | `control` tool calls + code review | Error taxonomy partly present (`control-not-granted`, `element-not-found`, capture errors), but many read-tool failures collapse to `action-failed`. |
| H5 | ❌ | live + code review | Minimum capture error contract not consistently observable live; generic failures dominate. |
| I1 | 🟡 | code review | Text redaction hooks are present; screenshot redaction implemented as pattern-based best effort. |
| I2 | ✅ | code review | Per-call allow/deny origin controls implemented and checked in handlers. |
| I3 | 🟡 | code review | Session behavior partly explicit; control permissions are session-like, but storage uses local state and policy clarity could improve. |
| I4 | ❌ | code review | No explicit telemetry disclosure/opt-out surfaced to MCP consumer contract. |
| I5 | ✅ | `accordo_browser_manage_snapshots`, code review | Snapshot retention controls + audit log plumbing (`auditId`, audit log file) are present. |

---

## Findings

### What works well

1. **Breadth of implementation is strong**
   - Full page-understanding suite exists: page map, text map, semantic graph, spatial relations, diffs, capture, waits, tab mgmt, control actions.

2. **Good security primitives in hub handlers**
   - Origin allow/deny checks, PII redaction hooks, audit IDs, and audit log lifecycle are integrated across handlers.

3. **Schema quality is generally high**
   - Tool schemas are detailed, with explicit constraints and meaningful descriptions.

4. **Comment tools worked live end-to-end**
   - Created, replied, listed, resolved/reopened, and deleted browser-scoped thread successfully.

5. **Snapshot admin tool is useful operationally**
   - `browser_manage_snapshots` successfully listed retained snapshots, giving at least partial observability despite functional failures elsewhere.

### Gaps / broken behaviors observed

1. **Unable to execute requested live fixture workflow**
   - `accordo_browser_navigate` to `http://127.0.0.1:8123/browser-tools-test.html` failed with `control-not-granted`.
   - No MCP tool exists to grant permission; this creates an agent dead-end.

2. **Read-only page understanding calls failed broadly**
   - `accordo_browser_get_page_map`, `accordo_browser_get_text_map`, `accordo_browser_get_semantic_graph` all failed (`action-failed`) across tested tabs.
   - This is a severe usability blocker for “agent understanding” workflows.

3. **Visual capture failed in live run**
   - `accordo_browser_capture_region` (viewport mode) failed with `action-failed`.

4. **Error observability is weak in failure paths**
   - Many paths return generic `action-failed`, obscuring root cause and reducing autonomous recovery capability.

5. **Potential policy/code inconsistencies**
   - Browser health tool is registered as `browser_health` in extension code while MCP callable surface here is `accordo_browser_health`.
   - Comments in code mention `chrome.storage.session`, while permission store uses `chrome.storage.local`.
   - Production-path `console.error` remains in capture handler (`relay-capture-handler.ts`).

---

## Verdict (per §6 threshold)

### Must-have checks

- [ ] Visible text extraction with mapping coverage ≥95%
- [ ] Semantic structure available via DOM + accessibility surfaces
- [ ] Spatial/layout context includes bboxes for inspected targets
- [ ] Screenshot capture supports viewport + full-page + region (live-proven)
- [ ] Stable nodeId within snapshot (code yes, live not proven)

### Threshold evaluation

- **No category below 2:** ❌ (several categories scored 1)
- **All must-haves checked:** ❌
- **Total ≥ 30/45:** ❌ (16/45)

## Final verdict: **FAIL**

The implementation is promising but **does not pass live agent-quality criteria** in this run due to control gating and repeated `action-failed` behavior on core read/capture tools.

---

## Top 5 prioritized recommendations

1. **Unblock first-run operability for read tools (P0)**
   - Ensure content-script availability and fallback injection/bootstrap for existing tabs so `get_page_map`/`get_text_map`/`get_semantic_graph` do not fail generically.

2. **Add explicit MCP control-grant flow (P0)**
   - Provide a safe `accordo_browser_grant_control` (or equivalent guided handshake) so agents can satisfy navigation/click/type prerequisites without manual UI steps.

3. **Improve error taxonomy propagation (P0)**
   - Replace generic `action-failed` on key paths with actionable codes (`no-content-script`, `unsupported-page`, `iframe-cross-origin`, `permission-required`, etc.) and details.

4. **Artifact transport upgrade (P1)**
   - Add `file-ref`/`remote-ref` path and make inline base64 optional; keep inline for explicit requests only.

5. **Harden consistency + hygiene (P1)**
   - Align tool naming to `accordo_browser_*` consistently, fix session/local permission doc mismatch, and remove production `console.error` in favor of structured logging.
