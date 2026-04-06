# M110-TC Improvement Plan — Browser MCP Tool Surface

**Date:** 2026-04-04 (revised 2026-04-04)  
**Baseline score:** 29/45 (fails: security 0/5, total < 30)  
**Target score:** 34–36/45  
**Source evaluation:** [`docs/50-reviews/M110-TC-browser-tools-evaluation.md`](M110-TC-browser-tools-evaluation.md)  
**Checklist:** [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md)  
**Plan review:** [`docs/50-reviews/M110-TC-plan-review.md`](M110-TC-plan-review.md)

---

## Revision History

| Date | Change | Findings addressed |
|---|---|---|
| 2026-04-04 (initial) | Original plan | — |
| 2026-04-04 (rev 1) | F1: Revised I score projection (0→2 conservative, path to 3); added `redactionWarning` mitigation and I1 scope split. F2: Added H2 error taxonomy item with three missing codes. F3: Dropped §3.4 snapshot ID change. F4: Added B2-ER-008 fail-closed requirement to §3.5/I1. Low-severity: reworded Phase 1 gate annotation (F5), bundled §3.7+§3.10 (F6). | F1, F2, F3, F4, F5, F6 |

---

## 1. Summary

The `accordo_browser_*` MCP tool surface scores 29/45 — just below the passing threshold of 30, and critically fails on security (0/5). This plan maps 10 identified gaps to concrete fixes, estimates effort, projects score impact, and sequences work by score-per-effort ratio.

**Three key moves:**
1. Fix the P1 `interactiveOnly` bug and complete the H4 error taxonomy (quick wins, unblocks F and H scores)
2. Implement security fundamentals to reach I: 2–3 (origin policy + text redaction + audit trail)
3. Add viewport/full-page screenshot to close the Visual Capture gap

These three alone would move the score from 29 → 34–35 (passes all thresholds).

---

## 2. Current Scorecard

| # | Category | Current | Target | Delta |
|---|---|---:|---:|---:|
| A | Session & Context | 4 | 4 | 0 |
| B | Text Extraction | 5 | 5 | 0 |
| C | Semantic Structure | 4 | 4–5 | 0–1 |
| D | Layout/Geometry | 3 | 3 | 0 |
| E | Visual Capture | 3 | 4 | +1 |
| F | Interaction Model | 3 | 4 | +1 |
| G | Deltas/Efficiency | 4 | 4 | 0 |
| H | Robustness | 3 | 4 | +1 |
| I | Security/Privacy | **0** | **2–3** | **+2–3** |
| | **Total** | **29** | **34–36** | **+5–7** |

> **Scoring note (F1 revision):** The I-category target is revised from 3 to 2–3. The checklist I1 criterion ("Redaction hooks for PII/secrets in text **and** screenshots") tests both surfaces. Since screenshot redaction is deferred (B2-PS-007), implementing text-only redaction yields partial I1 credit. The mitigation strategy (§3.5) adds a `redactionWarning` field to screenshot responses to make the gap explicit and auditable, which strengthens the case for I=3 but does not guarantee it. See §3.5 for the detailed score path.

---

## 3. Gap-to-Fix Mapping

### 3.1 P1 — `interactiveOnly` filter broken at shallow depth

**Gap:** `get_page_map(interactiveOnly: true, maxDepth: 3)` returns 0 interactive elements on deeply nested pages because depth truncation happens before the interactive filter.

**Evaluation items affected:** F1 (Interactive element inventory)

**Fix options (pick one):**
- **Option A (recommended):** Add a flat-list mode — when `interactiveOnly: true`, collect ALL interactive elements across the full DOM regardless of `maxDepth`, then return them as a flat array rather than a tree. This matches what agents actually want: "give me everything I can click."
- **Option B:** Apply the interactive filter *before* depth truncation — walk the full DOM, tag interactive elements, then prune non-interactive branches before applying depth limit. More complex but preserves tree structure.

**Effort:** 0.5–1 day  
**Score impact:** F: 3 → 4 (+1)  
**Multi-category unlock:** Also improves G4 (filtering effectiveness) confidence  
**Requirements:** B2-FI-002 (existing, needs implementation fix)  
**Location:** `packages/browser-extension/src/content/page-map-traversal.ts`

---

### 3.2 P1 — Bridge disconnect with no reconnect guidance + incomplete error taxonomy

**Gap:** After heavy navigation, "Bridge not connected" / "Bridge reconnecting" errors appear with no retry guidance. Additionally, three minimum-contract error codes required by H4 (error taxonomy) are not returned by the MCP handler layer: `element-off-screen`, `image-too-large`, `capture-failed`.

**Evaluation items affected:** H3 (Retry/backoff hints), H4 (Error taxonomy)

**Fix (three sub-items):**

**H2-structured-errors (MCP-ER-001):**
- Add `retryable: boolean` and `retryAfterMs: number` fields to all error responses
- Replace bare string errors with structured error objects: `{ success: false, error: string, retryable: boolean, retryAfterMs?: number, details?: string }`

**H2-retry-hints (MCP-ER-002):**
- Return `retryable: true, retryAfterMs: 2000` for `browser-not-connected`
- Return `retryable: true, retryAfterMs: 3000` for `Bridge reconnecting`
- Return `retryable: true, retryAfterMs: 1000` for `timeout`
- Return `retryable: false` for `element-not-found`, `origin-blocked`, `snapshot-not-found`, `snapshot-stale`

**H2-error-taxonomy (F2 revision — missing minimum-contract error codes):**
- Verify that `element-off-screen`, `image-too-large`, and `capture-failed` error codes from the `CaptureError` type (defined in `packages/browser/src/page-tool-types.ts`) are returned by the MCP handler in `page-tool-handlers.ts` for the corresponding failure scenarios
- These codes already exist in the content script layer (`relay-capture-handler.ts`) and are tested at the extension level (`capture-region.test.ts`); this item ensures they propagate correctly through the relay → MCP handler path and appear in the structured error format (MCP-ER-001)
- Cross-reference: `CaptureError` type includes `"element-not-found" | "element-off-screen" | "image-too-large" | "capture-failed" | "no-target"`; CR-F-12 requires all five codes; existing tests in `page-understanding-tools.test.ts` already validate these at the handler level

**H2-connection-health (MCP-ER-003):**
- Add `connection-health` action to the relay for proactive health checking

**Effort:** 1.5 days (increased from 1d to accommodate error taxonomy verification)  
**Score impact:** H: 3 → 4 (+1)  
**Requirements:** MCP-ER-001..003 in `requirements-browser-mcp.md`  
**Location:** `packages/browser/src/relay/`, `packages/browser-extension/src/relay/`, `packages/browser/src/page-tool-handlers.ts`

---

### 3.3 P2 — No viewport/full-page screenshot in `accordo_browser_*`

**Gap:** E1 (viewport) and E2 (full-page) screenshots are only available via `chrome-devtools_take_screenshot`, which is outside the evaluated surface.

**Evaluation items affected:** E1, E2

**Fix:** Extend `accordo_browser_capture_region` with an optional `mode` parameter:
```typescript
mode?: "region" | "viewport" | "fullPage"  // default: "region"
```
- `"viewport"` → calls `chrome.tabs.captureVisibleTab()` without cropping
- `"fullPage"` → uses CDP `Page.captureScreenshot({ captureBeyondViewport: true })` via the relay's existing CDP connection
- `"region"` → current behavior (default, backward-compatible)

**Screenshot redaction interaction:** When a `RedactionPolicy` is configured, screenshot responses (all modes) MUST include a `redactionWarning: "screenshots-not-subject-to-redaction-policy"` field. This makes the limitation explicit and auditable. See §3.5 for the security interaction.

**Effort:** 1–2 days  
**Score impact:** E: 3 → 4 (+1)  
**Multi-category unlock:** Also satisfies §6 Must-Have (screenshot supports viewport + full-page + region)  
**Requirements:** New — add to `requirements-browser-mcp.md` as MCP-VC-001..003  
**Location:** `packages/browser-extension/src/content/region-capture.ts`, `packages/browser/src/page-understanding-tools.ts`

---

### ~~3.4 P2 — Cross-navigation snapshot ID reset~~ (DROPPED — F3 revision)

> **Dropped per reviewer finding F3.** The proposed change to global monotonic snapshot IDs directly contradicts B2-SV-002 (monotonic within page session, reset on navigation) and B2-SV-005 (navigation resets version counter) in `requirements-browser2.0.md`. The original plan proposed modifying these requirements but did not provide revised acceptance criteria.
>
> **Decision:** Accept the current ephemeral versioning. G stays at 4/5, which is already a strong score. Cross-navigation diff is a nice-to-have that doesn't move any category score. The effort (1d) is better allocated elsewhere.
>
> **If revisited later:** Would require updating B2-SV-002 acceptance criteria to: "version increments globally within tab session, never resets on navigation." And B2-SV-005 to: "Navigation does not reset version counter but MUST update the `pageId` component of `snapshotId` to signal navigation to diff consumers." Both would need corresponding test updates.

---

### 3.5 P3 — Security/Privacy: 0 → 2–3

**Gap:** All four security items (I1–I4) are missing. Requirements B2-PS-001..007 exist in `requirements-browser2.0.md` but are tagged P3 (unimplemented).

**Evaluation items affected:** I1, I2, I3, I4

#### I-category scoring analysis (F1 revision)

The evaluation checklist scores I as a **category** on a 0–5 scale, not as an accumulation of sub-item points. The four I sub-items are:

| Sub-item | Checklist text | Surface tested |
|---|---|---|
| I1 | Redaction hooks for PII/secrets in text **and screenshots** | Text + visual |
| I2 | Origin allow/deny policies | Policy |
| I3 | Audit trail of tool calls and artifacts generated | Logging |
| I4 | Data-retention controls for snapshots/images | Lifecycle |

**The key constraint:** I1 tests both text and screenshot redaction. B2-PS-007 explicitly defers screenshot redaction ("Implementation is NOT required until OCR integration is available"). This means I1 is only partially satisfied by text redaction alone.

**Scoring rubric:**
- 0 = missing → current state
- 1 = minimal stub/unusable
- 2 = partial/major gaps
- 3 = usable with known limitations
- 4 = strong/minor gaps
- 5 = production-ready

**Conservative projection (I = 2):** With I2 (origin policy) + I1-text (text redaction only) + I3 (audit trail) all implemented:
- Origin policy is complete (I2 ✅)
- Text redaction works but screenshot redaction is missing (I1 partial)
- Audit trail is complete (I3 ✅)
- Result: "partial implementation with major gap" (screenshot PII exposure) → **I = 2**

**Stretch projection (I = 3):** Achievable if the evaluator considers the screenshot gap a "known limitation" rather than a "major gap." Three factors strengthen this case:
1. **`redactionWarning` field** on all screenshot responses when a `RedactionPolicy` is active — makes the gap explicit and auditable, not silent
2. **Fail-closed behavior** (B2-ER-008) — on redaction engine error, data is blocked, not returned unredacted
3. **Three of four sub-items are fully implemented** (I2, I3, I4-partial) and one is partially implemented (I1-text)

**Plan approach:** Project **I = 2 (conservative)** for gate calculations, with I = 3 as the stretch target contingent on `redactionWarning` mitigation and evaluator interpretation.

#### Implementation path

| Sub-item | What to implement | Effort | Score contribution |
|---|---|---|---|
| I2 — Origin policy | `OriginPolicy` with allowList/blockList; checked before any tool processes a request. Config stored in VS Code settings. Returns `origin-blocked` error (B2-ER-007). | 1.5 days | ✅ (full) |
| I1 — Text redaction | `RedactionPolicy` with configurable regex patterns; applied in relay before data reaches the MCP response. Email/phone built-in patterns. **Fail-closed (B2-ER-008): if redaction engine encounters an error (e.g., malformed regex, processing timeout), the entire response is blocked with `redaction-failed` error — never returned unredacted.** Screenshots: deferred per B2-PS-007, but `redactionWarning` field added (see below). Redaction wiring points: `get_text_map`, `get_page_map` text content, `get_semantic_graph` form values, `inspect_element` text content. | 2 days (revised from 1.5d — fail-closed + 4 wiring points) | 🟡 (partial — text only; screenshot gap acknowledged) |
| I1-screenshot-warning | When a `RedactionPolicy` is configured and `redactPatterns` is non-empty, ALL screenshot responses (`capture_region` in any mode) MUST include `redactionWarning: "screenshots-not-subject-to-redaction-policy"`. This surfaces the limitation to both agents and evaluators. | (included in §3.3 effort) | Mitigation for I1 partial credit |
| I3 — Audit trail | Per-tool-call logging: `timestamp`, `toolName`, `tabId`, `origin`, `action` (allowed/blocked), `redacted` (boolean). Write to VS Code output channel + optional JSON file. | 1 day | ✅ (full) |
| I4 — Retention control | Expose `snapshotRetentionLimit` config (default 5). Add `browser_clear_snapshots` action. | 0.5 days | 🟡 (partial — no time-based TTL, but explicit control exists) |

**Total effort for I1-text + I2 + I3 (conservative I=2):** 4.5 days  
**Total effort for I1-text + I2 + I3 + I4 (stretch I=3):** 5 days  
**Score impact:** I: 0 → 2 (conservative), 0 → 3 (stretch)  
**Requirements:** B2-PS-001..007 (existing, promote from P3); B2-ER-007 and **B2-ER-008** (existing in `requirements-browser2.0.md`; B2-ER-008 specifies fail-closed behavior)  
**Location:** New module in `packages/browser/src/security/`, content script filtering in `packages/browser-extension/src/content/`

#### Screenshot redaction — future path to I = 4+

Screenshot redaction (B2-PS-007) requires OCR or pixel-level analysis to detect PII in images. This is categorized as **hard/later** because:
- No OCR library is currently integrated
- Real-time OCR on full-page screenshots introduces latency (300ms+ per image)
- False positive/negative rates are non-trivial for regex-equivalent PII patterns in images
- The architecture supports it (the `redactScreenshots: boolean` field exists in the `RedactionPolicy` interface per B2-PS-007)

When OCR integration becomes available, enabling screenshot redaction would move I from 3 → 4 (strong/minor gaps). This is not planned for the current improvement cycle.

---

### 3.6 P3 — Navigate response missing readiness state

**Gap:** `navigate` returns `{success, url, title}` but `title` is empty on fresh navigation and no `readyState` field is returned.

**Evaluation items affected:** A2

**Fix:** Add `readyState: "loading" | "interactive" | "complete"` field to navigate response. Wait for `DOMContentLoaded` before responding (configurable via `waitUntil` param).

**Effort:** 0.5 days  
**Score impact:** A: 4 → 4–5 (marginal; already strong)  
**Requirements:** New — add to `requirements-browser-mcp.md` as MCP-NAV-001  
**Location:** `packages/browser-extension/src/relay/`, navigate action handler

---

### 3.7 P4 — No element actionability states

**Gap:** No `disabled`, `readonly`, `aria-expanded` states in a11y tree or `inspect_element` response.

**Evaluation items affected:** F2 (Actionability state), C2 (A11y tree states)

**Fix:** Add `states` array to a11y tree nodes and `inspect_element` response:
```typescript
states?: Array<"disabled" | "readonly" | "expanded" | "collapsed" | "checked" | "selected" | "required">;
```
Collect from `element.disabled`, `element.readOnly`, `aria-expanded`, `aria-checked`, `aria-selected`, `aria-required`.

> **Bundle note (F6):** This item and §3.10 (form labels) are jointly required for C→5. Implementing §3.7 without §3.10 produces zero score benefit for C. These two items MUST be treated as an atomic "C→5 bundle" — do not implement one without the other.

**Effort:** 1 day  
**Score impact:** F: 4 → 4 (consolidates the F→4 from §3.1), C: 4 → 5 (+1, when combined with §3.10)  
**Multi-category unlock:** Improves both F2 and C2 simultaneously  
**Requirements:** New — add to `requirements-browser-mcp.md` as MCP-A11Y-001  
**Location:** `packages/browser-extension/src/content/semantic-graph-collector.ts`, `element-inspector.ts`

---

### 3.8 P4 — `capture_region` format fixed to JPEG

**Gap:** No `format` parameter; always returns JPEG.

**Evaluation items affected:** E4

**Fix:** Add `format?: "jpeg" | "png"` parameter. WebP deferred (browser support varies in OffscreenCanvas context).

**Effort:** 0.5 days  
**Score impact:** E: already reaches 4 from §3.3; this removes a gap note  
**Requirements:** Extend CR-F-06 or add new MCP-VC-004  
**Location:** `packages/browser-extension/src/content/region-capture.ts`

---

### 3.9 P5 — Snapshot retention window too short

**Gap:** Snapshots from >~15 calls ago return `snapshot-not-found`.

**Evaluation items affected:** G2 (minor)

**Fix:** Already partially addressed by §3.5 I4 (retention control). Additionally, increase default retention from 5 to 10 snapshots.

**Effort:** 0.25 days  
**Score impact:** G: 4 → 4 (no change — minor polish)  
**Requirements:** Modify B2-SV-004 default  
**Location:** `packages/browser-extension/src/content/snapshot-store.ts`

---

### 3.10 P5 — Form fields missing `label` text

**Gap:** `get_semantic_graph` forms output has no `label` text for form fields.

**Evaluation items affected:** C5

**Fix:** In `semantic-graph-collector.ts`, for each form field, look up the associated `<label>` element via `field.labels` property or `aria-label`/`aria-labelledby` attributes. Add `label: string` to form field output.

> **Bundle note (F6):** See §3.7 — this item is part of the atomic "C→5 bundle."

**Effort:** 0.5 days  
**Score impact:** C: 4 → 4–5 (marginal improvement; combined with §3.7, reaches 5)  
**Requirements:** B2-SG-005 already specifies `label` in `FormField` — this is a compliance fix  
**Location:** `packages/browser-extension/src/content/semantic-graph-collector.ts`

---

## 4. Prioritized Execution Sequence

Sequenced by **score-per-effort ratio** (highest impact per day first).

| Phase | Item | Effort | Score Impact | Cumulative |
|---|---|---:|---|---:|
| **Phase 1 — Quick wins** | | | | |
| 1a | §3.1 Fix `interactiveOnly` filter (P1) | 0.5d | F: 3→4 (+1) | 30 |
| 1b | §3.2 Structured errors + retry hints + error taxonomy (P1) | 1.5d | H: 3→4 (+1) | 31 |
| | | **2d** | **+2** | **31** |
| **Phase 2 — Security foundation** | | | | |
| 2a | §3.5/I2 Origin policy | 1.5d | I: 0→1 | 32 |
| 2b | §3.5/I1 Text redaction (incl. fail-closed B2-ER-008) | 2d | I: 1→2 | 33 |
| 2c | §3.5/I3 Audit trail | 1d | I: 2→2–3 | 33–34 |
| | | **4.5d** | **+2–3** | **33–34** |
| **Phase 3 — Visual completeness** | | | | |
| 3a | §3.3 Viewport/full-page screenshot (incl. `redactionWarning`) | 1.5d | E: 3→4 (+1) | 34–35 |
| | | **1.5d** | **+1** | **34–35** |
| **Phase 4 — Polish (C→5 bundle + extras)** | | | | |
| 4a | §3.7 + §3.10 Actionability states + form labels (C→5 bundle) | 1.5d | C: 4→5 (+1) | 35–36 |
| 4b | §3.8 PNG format support | 0.5d | (E polish) | 35–36 |
| 4c | §3.6 Navigate readyState | 0.5d | (A polish) | 35–36 |
| 4d | §3.9 Retention increase | 0.25d | (G polish) | 35–36 |
| 4e | §3.5/I4 Retention control | 0.5d | I: strengthens 3 case | 35–36 |
| | | **3.25d** | **+1–2** | **35–36** |

**Total estimated effort:** ~11.25 days  
**Projected final score:** 34–36/45 (conservative 34, stretch 36)  
**Gate check:** Basic pass (≥30, no category below 2) — PASS ✅; G1 (≥36, no category below 3) — PASS at stretch only

---

## 5. Phase Gate Checks

| After Phase | Total | Min Category | Passes? | Gate |
|---|---:|---|---|---|
| Current | 29 | I=0 | ❌ | — |
| Phase 1 | 31 | I=0 | ❌ (I=0, below minimum floor) | — |
| Phase 2 (conservative) | 33 | I=2 | ✅ (≥30, no cat <2) | Pass threshold |
| Phase 2 (stretch) | 34 | I=3 | ✅ (≥30, no cat <2) | Pass threshold |
| Phase 3 | 34–35 | I=2–3 | ✅ | Pass threshold |
| Phase 4 | 35–36 | I=2–3, all ≥3 (stretch) | ✅ (basic); 🟡 (G1 at stretch) | **G1 contingent on I=3** |

**Key insight:** Phases 1+2 are mandatory for passing. Phase 2 alone clears the minimum floor (I≥2). Phase 3 provides margin. Phase 4 is stretch for G1. G1 (≥36, no category below 3) requires I=3, which depends on evaluator interpretation of the screenshot-redaction gap with `redactionWarning` mitigation.

**Worst-case analysis:** If H stays at 3 (error taxonomy incomplete) and I=2 (screenshot gap caps I1): 29 + 1 (F) + 0 (H) + 2 (I) + 1 (E) = 33. Still passes basic threshold (≥30, no cat <2). G1 is not achievable in worst case.

---

## 6. Multi-Category Unlocks

These items improve scores in multiple categories simultaneously:

| Fix | Categories | Notes |
|---|---|---|
| §3.1 `interactiveOnly` fix | F (+1), G (confidence) | Fixes both the F1 gap and validates G4 filter effectiveness |
| §3.2 Retry hints + error taxonomy | H (+1), also H3, H4 | Addresses H4 error taxonomy (incl. minimum-contract codes), H3 retry/backoff, and H2 structured errors in one change |
| §3.7 + §3.10 C→5 bundle | F (+0, consolidates), C (+1) | Single bundle improves both semantic structure and interaction model |
| §3.5 Security package | I (+2–3) | Three independent sub-items; each is independently valuable |

---

## 7. What We're NOT Doing (and Why)

| Capability | Checklist Item | Reason for Deferral |
|---|---|---|
| Relative geometry helpers | D2 | Low score-per-effort: agents can compute `leftOf`/`above` from bboxes; adding server-side helpers would improve D from 3→4 but costs 2+ days for limited agent benefit |
| Z-order/stacking context | D3 | Requires `elementFromPoint` sampling or CDP `DOM.getBoxModel` — complex, fragile, marginal score impact |
| Intersection ratios | D4 | Binary viewport filter is sufficient for most agent workflows; IntersectionObserver adds complexity |
| Eventability hints | F4 | Touch target sizing and interception detection are niche; no agent has requested this |
| Cross-navigation diff | (was §3.4) | Dropped: contradicts B2-SV-002/005; doesn't move any category score; G already at 4. See §3.4 for full rationale. |
| Full I4 retention with TTL | I4 | Partial coverage (explicit control) is sufficient for I→2–3; time-based TTL adds operational complexity |
| Screenshot redaction (OCR) | I1 (partial) | Hard/later: no OCR integration available; real-time OCR adds 300ms+ latency; false positive/negative rates non-trivial. `redactionWarning` field surfaces the gap explicitly. See §3.5 for future path. |

---

## 8. Requirements Traceability

| Fix | Existing Requirement | New Requirement Needed |
|---|---|---|
| §3.1 interactiveOnly | B2-FI-002 | No — implementation fix only |
| §3.2 Retry hints + structured errors | — | MCP-ER-001..003 |
| §3.2 Error taxonomy (H2) | CR-F-12, `CaptureError` type | No — verify existing codes propagate through MCP handler layer |
| §3.3 Viewport/fullPage | — | MCP-VC-001..003 |
| ~~§3.4 Snapshot ID~~ | ~~B2-SV-002, B2-SV-005~~ | ~~Dropped~~ |
| §3.5 Security (I1-text, I2, I3) | B2-PS-001..007 | Promote from P3; B2-ER-008 (fail-closed) already specified |
| §3.5 Redaction warning | — | MCP-VC-005 (new — `redactionWarning` field on screenshot responses) |
| §3.6 ReadyState | — | MCP-NAV-001 |
| §3.7 Actionability | — | MCP-A11Y-001 |
| §3.8 PNG format | CR-F-06 | MCP-VC-004 |
| §3.9 Retention | B2-SV-004 | Modify default |
| §3.10 Form labels | B2-SG-005 | No — compliance fix |

---

## 9. Reviewer Findings Resolution

| Finding | Severity | Resolution | Section |
|---|---|---|---|
| F1: Security 0→3 path is optimistic | High | Revised I projection to 2 (conservative) / 3 (stretch). Split I1 into I1-text (achievable) and I1-screenshot (hard/later). Added `redactionWarning` mitigation. Updated scorecard, gate checks, and worst-case analysis. | §2, §3.5, §5 |
| F2: H→4 error taxonomy incomplete | Medium | Added H2-error-taxonomy sub-item to §3.2 with explicit list of three missing codes (`element-off-screen`, `image-too-large`, `capture-failed`). Cross-referenced `CaptureError` type and existing tests. | §3.2 |
| F3: Snapshot ID change contradicts requirements | Medium | Dropped §3.4 entirely. B2-SV-002 and B2-SV-005 remain unchanged. G stays at 4/5. | §3.4 |
| F4: Redaction omits fail-closed requirement | Medium | Added B2-ER-008 (fail-closed) to §3.5/I1 scope. Explicitly stated: on redaction engine error, entire response is blocked with `redaction-failed` error — never returned unredacted. Referenced existing B2-ER-008 in `requirements-browser2.0.md`. | §3.5 |
| F5: Phase 1 gate annotation misleading | Low | Reworded "❌ (I<2)" to "❌ (I=0, below minimum floor)" in gate table. | §5 |
| F6: C→5 bundle not atomic | Low | Added bundle notes to §3.7 and §3.10. Merged into single "C→5 bundle" line item in Phase 4 execution sequence. | §3.7, §3.10, §4 |

---

*Plan authored by Architect agent. Revised per reviewer findings F1–F6 from M110-TC-plan-review.md. This is a planning document — no code changes made.*
