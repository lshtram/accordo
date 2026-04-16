# Accordo Browser MCP Module — Comprehensive Review

Date: 2026-04-16  
Reviewer: Independent code + tests + tool-surface review

Scope reviewed:
- `packages/browser-extension/src/**`
- `packages/browser/src/**` (browser MCP tool definitions used by Hub/Bridge registration)
- `packages/browser-extension/tests/**` and `packages/browser/src/__tests__/**`
- Checklist rubric: `docs/30-development/mcp-webview-agent-evaluation-checklist.md`

---

## 0) Review method and evidence quality

- This was a fresh source-based review (not gap-fix context reuse).
- I validated behavior by reading implementation files and tool schemas directly.
- I also ran both package suites:
  - `packages/browser-extension`: **50 files, 1253 tests passing**
  - `packages/browser`: **37 files, 1037 tests passing**
- Note on path naming: the user prompt references `packages/accordo-hub/src/tools/`; in the current repo layout the browser MCP tools are implemented in `packages/browser/src/` and registered via `buildBrowserTools()` (`packages/browser/src/tool-assembly.ts:99-116`, `packages/browser/src/relay-lifecycle.ts:498-503`).

---

## 1) Section-by-section checklist assessment (§2 A–I)

## A. Session & page context

- **A1 Get page metadata** — ✅  
  Evidence: page map returns URL/title/viewport envelope (`page-map-collector.ts:251-259, 569-578`), tool contract exposes those fields (`page-tool-types.ts:242-276`).
- **A2 Load/readiness state + wait support** — ✅  
  Evidence: navigate returns `readyState` and supports `waitUntil` (`relay-control-handlers.ts:217-223, 292-315`; `control-tool-types.ts:45-52, 65`), plus explicit wait primitives (`wait-tool.ts:50-61`, `wait-provider.ts:158-383`).
- **A3 Multiple tabs/pages with stable IDs** — ✅  
  Evidence: `list_pages`/`select_page` (`relay-tab-handlers.ts:14-35`, `page-tool-definitions.ts:382-410`).
- **A4 Iframe handling with relationships** — 🟡  
  Evidence: iframe metadata includes lineage (`page-map-collector.ts:200-227, 473-485`), frame-targeted forwarding exists (`relay-page-handlers.ts:150-355`, `relay-forwarder.ts:166-189`), but child-frame DOM stitching is explicitly limited and non-merged (`page-map-collector.ts:235-247, 270-280`).
- **A5 Shadow DOM handling** — ✅  
  Evidence: open shadow traversal + closed-host annotation in page map (`page-map-traversal.ts:261-283, 489-499`), semantic graph also supports `piercesShadow` (`semantic-graph-tool.ts:45-49, 288-293`).

## B. Text extraction quality

- **B1 Visible text extraction quality** — 🟡  
  Evidence: collector captures both visible/hidden/offscreen and flags visibility (`text-map-collector.ts:146-164, 245-261`), but extraction is direct-text-node based (`text-map-collector.ts:213-221, 243-249`) rather than explicit "user-visible only" by default.
- **B2 Per-text-node mapping to element IDs/bboxes** — 🟡  
  Evidence: `bbox` + `nodeId` exist (`text-map-collector.ts:35-52`), but `nodeId` is per-call scoped counter (`text-map-tool.ts:67-74`) and not a guaranteed cross-tool stable ID.
- **B3 Raw + normalized modes** — ✅  
  Evidence: `textRaw` + `textNormalized` (`text-map-collector.ts:36-40, 247-253`).
- **B4 Reading order output** — ✅  
  Evidence: ordered sort with RTL handling (`text-map-collector.ts:278-304`).
- **B5 Hidden/offscreen flags** — ✅  
  Evidence: explicit `visibility` enum (`text-map-collector.ts:20-27, 146-164`).

## C. Structural and semantic understanding

- **C1 DOM snapshot API with stable node IDs** — ✅  
  Evidence: page map nodeId and envelope snapshot identity (`page-map-collector.ts:28-31, 556-578`; `snapshot-versioning.ts:71-75, 298-308`).
- **C2 Accessibility tree snapshot** — ✅  
  Evidence: semantic graph includes a11y tree (`semantic-graph-collector.ts:89-105`; `semantic-graph-tool.ts:139-149`).
- **C3 Cross-frame model with lineage** — 🟡  
  Evidence: frame metadata includes `parentFrameId/depth/classification` (`page-map-collector.ts:200-227`), but node-level lineage is still frame-container based, not unified per-node lineage.
- **C4 Shadow-root aware semantic model** — ✅  
  Evidence: semantic graph supports and annotates shadow traversal (`semantic-graph-tool.ts:45-49, 291-293`; helpers support shadow-aware roles/state traversal).
- **C5 Landmark extraction** — ✅  
  Evidence: semantic graph returns landmarks (`semantic-graph-collector.ts:90-105`; `semantic-graph-tool.ts:144-146`).
- **C6 Document outline extraction** — ✅  
  Evidence: semantic graph returns heading outline (`semantic-graph-collector.ts:91-104`; `semantic-graph-tool.ts:147-149`).
- **C7 Form model extraction incl. validation/value** — 🟡  
  Evidence: forms include labels, required, value, type (`semantic-graph-forms.ts:56-87, 114-140`), but explicit validation-state fields are not strongly represented.

## D. Spatial/layout intelligence

- **D1 Bounding boxes** — ✅  
  Evidence: page map/inspect/text map bbox support (`page-map-collector.ts:43-44`, `element-inspector.ts:76`, `text-map-collector.ts:47`).
- **D2 Relative geometry helpers** — ✅  
  Evidence: dedicated spatial relations tool (`spatial-relations-tool.ts:146-152`, `spatial-relations-handler.ts:90-104`).
- **D3 Z-order / occlusion hints** — ✅  
  Evidence: `zIndex/isStacked/occluded` in page map (`page-map-collector.ts:57-74`, `page-map-traversal.ts:217-258`), `isObstructed` in inspect (`element-inspector.ts:106-110, 329-364`).
- **D4 Viewport intersection ratios** — ✅  
  Evidence: `viewportRatio` computation (`page-map-collector.ts:45-49`, `page-map-traversal.ts:198-206`).
- **D5 Container/section grouping** — ✅  
  Evidence: `containerId` support (`page-map-collector.ts:51-55`, `page-map-traversal.ts:207-214`).

## E. Visual capture for multimodal agents

- **E1 Viewport screenshot capture** — ✅  
  Evidence: `mode: "viewport"` path (`relay-capture-handler.ts:469-553`, schema in `page-tool-definitions.ts:348-352`).
- **E2 Full-page screenshot capture** — ✅  
  Evidence: `mode: "fullPage"` via CDP (`relay-capture-handler.ts:386-467`).
- **E3 Element/region screenshot by node/box** — ✅  
  Evidence: anchor/nodeRef/rect support (`relay-capture-handler.ts:123-184, 261-373`; schema `page-tool-definitions.ts:334-345`).
- **E4 Configurable quality/format** — ✅  
  Evidence: format + quality handling (`relay-capture-handler.ts:39-45, 61, 192-197, 416-425`; schema `page-tool-definitions.ts:347-353`).
- **E5 Visual-to-structure linkage** — ✅  
  Evidence: envelope + `relatedSnapshotId` in capture response (`page-tool-handlers-impl.ts:471-490`).

## F. Interaction discoverability

- **F1 Interactive element inventory** — ✅  
  Evidence: `interactiveOnly` filtering pipeline (`page-map-filters.ts:141-178`; `page-map-collector.ts:114-119, 523-536`).
- **F2 Actionability state** — ✅  
  Evidence: states/disabled/readonly/obstruction pointers (`element-inspector.ts:86-115, 267-364`; `semantic-graph-helpers.ts:86-140`).
- **F3 Selector + semantic handles** — 🟡  
  Evidence: strong CSS/ref/nodeId + role/name handling (`page-tool-definitions.ts:265-269`, `element-inspector.ts:42-46, 456-466`), but no XPath handle in exposed contract.
- **F4 Eventability hints** — ✅  
  Evidence: `hasPointerEvents`, `isObstructed`, `clickTargetSize` (`element-inspector.ts:101-114, 320-336`).

## G. Change tracking / efficiency

- **G1 Snapshot versioning monotonic IDs** — ✅  
  Evidence: monotonic manager + `{pageId}:{version}` (`snapshot-versioning.ts:36-38, 169-228, 298-308`).
- **G2 Delta APIs (text/DOM/layout)** — ✅  
  Evidence: `diff_snapshots` and diff engine (`diff-tool.ts:213-244, 555-735`; `diff-engine.ts:139-232`).
- **G3 Incremental retrieval (paging/chunking)** — 🟡  
  Evidence: max-limits exist (`page-tool-definitions.ts:195-196`, `text-map-tool.ts:40-41`), but true cursor/paging offset contracts are not present.
- **G4 Server-side filtering** — ✅  
  Evidence: rich filter pipeline (`page-map-filters.ts:287-336`, `page-map-collector.ts:512-536`).
- **G5 Deterministic ordering** — ✅  
  Evidence: deterministic traversal and reading-order assignment (`page-map-traversal.ts`, `text-map-collector.ts:284-304`).
- **G6 Artifact indirection default (ref vs inline)** — 🟡  
  Evidence: file-ref exists (`page-tool-handlers-impl.ts:498-515`), but default remains inline/base64 (`page-tool-definitions.ts:329, 364-369`).

## H. Robustness and operability

- **H1 Wait primitives** — ✅  
  Evidence: text/selector/stable layout (`wait-provider.ts:74-92, 158-383`; `wait-tool.ts:53-58`).
- **H2 Timeout controls + semantics** — ✅  
  Evidence: timeout bounds and structured timeout outcomes (`wait-tool.ts:22-27, 231-237`, `wait-provider.ts:31-35, 184-186`).
- **H3 Retry/backoff hints** — ✅  
  Evidence: `retryable/retryAfterMs/recoveryHints` in wait + structured errors (`wait-tool.ts:89-114, 243-300`; `page-tool-types.ts:603-666`; `relay-definitions.ts:134-175`).
- **H4 Error taxonomy (incl. minimum contract)** — ✅  
  Evidence: minimum required errors all present (`relay-definitions.ts:77-89, 141-146`; capture handlers map them through).

## I. Security/privacy controls

- **I1 Redaction hooks (text + screenshot)** — ✅  
  Evidence: text redaction pipeline (`relay-privacy.ts:331-365`; browser security redaction modules), screenshot redaction integration (`relay-capture-handler.ts:607-652`, `screenshot-redaction.ts:228-287`).
- **I2 Origin allow/deny policies** — ✅  
  Evidence: per-request + merged policy checks (`relay-privacy.ts:118-170`; `page-tool-handlers-impl.ts:109-123, 231-243, 457-469`).
- **I3 Session/storage isolation controls explicitness** — 🟡  
  Evidence: disclosed as shared profile in health (`health-tool.ts:48-60, 107-113`), but no direct tool-level "fresh profile/session isolation mode" control.
- **I4 Telemetry disclosure/opt-out** — ✅  
  Evidence: explicit telemetry policy fields (`health-tool.ts:31-46, 99-106`).
- **I5 Audit trail of calls/artifacts** — ✅  
  Evidence: browser audit log with UUID auditId (`security-types.ts:90-107`, `audit-log.ts:47-112`, handler attachment in `page-tool-handlers-impl.ts:95-99, 247-248, 430-432`).
- **I6 Data-retention controls (snapshots/images)** — 🟡  
  Evidence: snapshot retention control tool exists (`manage-snapshots-tool.ts:63-138`) + TTL support (`snapshot-retention.ts:12-15, 44-54`), but screenshot artifact retention lifecycle is not centrally managed beyond optional file write.

---

## 2) Scorecard (§7)

| Category | Score (0-5) | Notes |
|---|---:|---|
| Session & Context | 4 | Strong tab/readiness/context support; iframe continuity is good but not fully unified at node lineage level. |
| Text Extraction | 3 | Good structure and ordering; mapping/visibility semantics are solid but not perfect for strict "visible-only by default" and cross-tool node identity. |
| Semantic Structure | 4 | Strong a11y/landmark/outline/forms coverage; validation-state depth and cross-frame node lineage are partial. |
| Layout/Geometry | 5 | Very strong: bbox, intersection ratio, container grouping, occlusion, pairwise geometry helpers. |
| Visual Capture | 4 | Region/viewport/full-page + format/quality + linkage implemented; artifact transport defaults still inline. |
| Interaction Model | 4 | Rich actionability/eventability; missing XPath-style alternative keeps this below 5. |
| Deltas/Efficiency | 3 | Versioning/diff/filtering are strong; true paging/chunked retrieval and default artifact indirection are partial. |
| Robustness | 4 | Clear wait + timeout + retry semantics and taxonomy; generally robust operationally. |
| Security/Privacy | 4 | Good origin/redaction/audit/telemetry disclosure; session isolation and retention controls not fully operator-facing end-to-end. |

**Total: 35 / 45**

---

## 3) Evidence table (§7.1 required)

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 | ✅ | Source review | `collectPageMap` returns URL/title/envelope viewport (`page-map-collector.ts:251-259,569-578`). |
| A2 | ✅ | Source review | `navigate` returns `readyState`; `wait_for` supports conditions/timeouts (`relay-control-handlers.ts:292-315`, `wait-tool.ts:50-61`). |
| A3 | ✅ | Source review | `list_pages` + `select_page` implemented (`relay-tab-handlers.ts:14-35`). |
| A4 | 🟡 | Source review | Iframe metadata + frame-targeted forwarding exist, but child DOM continuity is limited (`page-map-collector.ts:235-247`; `relay-page-handlers.ts:234-355`). |
| A5 | ✅ | Source review | Shadow traversal flags + closed shadow host annotation (`page-map-traversal.ts:261-283`). |
| B1 | 🟡 | Source review | Text extraction includes visibility states but not visible-only default (`text-map-collector.ts:146-164,327-355`). |
| B2 | 🟡 | Source review | Segment bbox + nodeId present, nodeId is per-call scoped (`text-map-tool.ts:67-74`). |
| B3 | ✅ | Source review | `textRaw` + `textNormalized` both returned (`text-map-collector.ts:36-40`). |
| B4 | ✅ | Source review | Reading-order sort includes RTL support (`text-map-collector.ts:284-295`). |
| B5 | ✅ | Source review | `visibility: visible|hidden|offscreen` (`text-map-collector.ts:20-27`). |
| C1 | ✅ | Source review | Stable nodeId within snapshots + envelope IDs (`snapshot-versioning.ts:71-73,169-228`). |
| C2 | ✅ | Source review | Semantic graph includes `a11yTree` (`semantic-graph-tool.ts:142-144`). |
| C3 | 🟡 | Source review | Frame lineage metadata exists; node-level lineage not fully unified (`page-map-collector.ts:200-227`). |
| C4 | ✅ | Source review | Shadow-aware semantic traversal exposed via `piercesShadow` (`semantic-graph-tool.ts:45-49`). |
| C5 | ✅ | Source review | Landmarks extracted and returned (`semantic-graph-collector.ts:90-105`). |
| C6 | ✅ | Source review | Outline extracted and returned (`semantic-graph-collector.ts:91-104`). |
| C7 | 🟡 | Source review | Form models include label/required/value but limited explicit validation state (`semantic-graph-forms.ts:56-87`). |
| D1 | ✅ | Source review | Bboxes in page map/text map/inspect (`page-map-collector.ts:43-44`; `text-map-collector.ts:47`). |
| D2 | ✅ | Source review | Dedicated spatial relations API (`spatial-relations-tool.ts:146-152`). |
| D3 | ✅ | Source review | `zIndex/isStacked/occluded` + `isObstructed` support (`page-map-traversal.ts:217-258`; `element-inspector.ts:329-364`). |
| D4 | ✅ | Source review | `viewportRatio` computed (`page-map-traversal.ts:198-206`). |
| D5 | ✅ | Source review | `containerId` grouping (`page-map-traversal.ts:207-214`). |
| E1 | ✅ | Source review | Viewport mode capture path (`relay-capture-handler.ts:469-553`). |
| E2 | ✅ | Source review | Full-page CDP capture path (`relay-capture-handler.ts:386-467`). |
| E3 | ✅ | Source review | Region capture by anchor/nodeRef/rect (`relay-capture-handler.ts:123-184`). |
| E4 | ✅ | Source review | Configurable `format` + `quality` (`relay-capture-handler.ts:274-276,497-502`). |
| E5 | ✅ | Source review | `relatedSnapshotId` and envelope linkage (`page-tool-handlers-impl.ts:471-490`). |
| F1 | ✅ | Source review | `interactiveOnly` server-side inventory (`page-map-filters.ts:141-178`). |
| F2 | ✅ | Source review | Disabled/readonly/states/obstruction pointers (`element-inspector.ts:267-364`). |
| F3 | 🟡 | Source review | CSS/ref/nodeId + semantic handles yes; no XPath contract. |
| F4 | ✅ | Source review | Eventability hints exposed (`element-inspector.ts:319-336`). |
| G1 | ✅ | Source review | Monotonic snapshot IDs (`snapshot-versioning.ts:225-228`). |
| G2 | ✅ | Source review | Diff API and engine in place (`diff-tool.ts:555-735`; `diff-engine.ts:139-232`). |
| G3 | 🟡 | Source review | Limits exist, but no true paging/cursor (`page-tool-definitions.ts:195-196`; `text-map-tool.ts:40-41`). |
| G4 | ✅ | Source review | Rich filter pipeline (`page-map-filters.ts:300-336`). |
| G5 | ✅ | Source review | Deterministic traversal/sorting (`text-map-collector.ts:284-304`). |
| G6 | 🟡 | Source review | `file-ref` supported, but inline default (`page-tool-handlers-impl.ts:498-515`; `page-tool-definitions.ts:329,364-369`). |
| H1 | ✅ | Source review | Wait primitives all present (`wait-provider.ts:74-92`). |
| H2 | ✅ | Source review | Timeout clamp + semantics (`wait-tool.ts:231-237`; `wait-provider.ts:31-35`). |
| H3 | ✅ | Source review | Retryable + backoff hints implemented (`wait-tool.ts:243-300`; `page-tool-types.ts:603-666`). |
| H4 | ✅ | Source review | Minimum required capture error taxonomy present (`relay-definitions.ts:87-89,141-146`). |
| I1 | ✅ | Source review | Text and screenshot redaction hooks (`relay-privacy.ts:339-365`; `relay-capture-handler.ts:607-652`). |
| I2 | ✅ | Source review | Allow/deny policy checks in handlers (`page-tool-handlers-impl.ts:109-123`). |
| I3 | 🟡 | Source review | Isolation is disclosed but not tool-configurable (`health-tool.ts:55-60,107-113`). |
| I4 | ✅ | Source review | Telemetry policy surfaced (`health-tool.ts:39-46,99-106`). |
| I5 | ✅ | Source review | Audit trail with UUID + sink (`audit-log.ts:47-112`). |
| I6 | 🟡 | Source review | Snapshot retention controls strong; screenshot retention controls partial (`manage-snapshots-tool.ts:63-138`). |

---

## 4) §6 Must-have checklist

### Must-have to pass

- [x] Visible text extraction with element mapping coverage ≥95% on benchmark pages  
  Evidence: benchmark test suite exists and passes (`packages/browser-extension/tests/text-map-coverage-benchmark.test.ts`; runtime run showed all passing).
- [x] Semantic structure via DOM + accessibility surfaces  
  Evidence: page map + semantic graph (`page-map-collector.ts`, `semantic-graph-collector.ts`).
- [x] Spatial/layout context includes element bboxes for inspected targets  
  Evidence: inspect + page map include bounds (`element-inspector.ts:76`, `page-map-traversal.ts:190-196`).
- [x] Screenshot capture supports viewport + full-page + region  
  Evidence: `relay-capture-handler.ts:386-553`.
- [x] Stable `nodeId` within snapshot  
  Evidence: snapshot/page-map contracts (`snapshot-versioning.ts:71-73`; `page-map-collector.ts:28-31`).

### Strongly recommended

- [x] Snapshot versioning + delta/change APIs
- [x] Occlusion/visibility quality
- [x] Progressive detail retrieval (page map → inspect/dom excerpt/semantic/text)
- [x] Privacy/redaction controls
- [x] Cross-frame + shadow-DOM continuity (partial but meaningful)

### Nice-to-have

- [ ] Saliency ranking endpoint
- [ ] Heuristic content blocks endpoint
- [ ] Built-in "agent briefing" summary endpoint

---

## 5) Overall verdict

**PASS** (recommended threshold met)  
**Total score: 35/45**

Rationale:
- All checklist categories are at least usable (no category <2).
- All §6 must-have items are satisfied.
- The module is feature-rich and production-leaning, especially in geometry, capture, and operational robustness.
- Main limitations are around retrieval efficiency defaults (inline artifacts by default), fully unified cross-frame identity continuity, and stronger incremental/paging contracts.

---

## 6) Top actionable improvement recommendations (score <45)

1. **Make artifact indirection the default for screenshots (G6).**  
   Prefer `file-ref` default and require explicit opt-in for inline base64 blobs to reduce payload overhead.

2. **Add true incremental pagination for large maps/text outputs.**  
   Introduce `cursor/offset + limit` contracts for `get_page_map` and `get_text_map` so agents can request chunks without hard truncation.

3. **Unify node identity across tools and frames.**  
   Align text-map segment identity with page-map node IDs (or add explicit mapping field), and optionally add frame lineage fields on returned nodes, not only iframe containers.

4. **Expand form model validation semantics.**  
   Add explicit validation state (`valid/invalid/errors`) to semantic form fields to meet checklist C7 more completely.

5. **Add retention management for screenshot artifacts.**  
   Extend retention controls (`manage_snapshots`-style) to file-ref screenshots (age/size limits + cleanup API).
