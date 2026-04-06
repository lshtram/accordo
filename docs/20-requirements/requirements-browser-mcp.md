# Browser MCP Tool Surface — Requirements Specification

**Scope:** `accordo_browser_*` MCP tools — the agent-facing page understanding, interaction, and visual capture surface  
**Type:** Consolidated requirements for the MCP-visible browser tool surface  
**Version:** 0.2.0  
**Date:** 2026-04-04 (revised)  
**Evaluation checklist:** [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md)  
**Evaluation results:** [`docs/50-reviews/M110-TC-browser-tools-evaluation.md`](../50-reviews/M110-TC-browser-tools-evaluation.md)  
**Improvement plan:** [`docs/50-reviews/M110-TC-improvement-plan.md`](../50-reviews/M110-TC-improvement-plan.md)

---

## 1. Purpose

This document defines requirements for the `accordo_browser_*` MCP tool surface — the set of tools agents use to understand, interact with, and capture browser pages. It consolidates requirements that affect the agent-visible MCP interface, regardless of which internal package implements them.

**Relationship to other requirements docs:**
- [`requirements-browser-extension.md`](requirements-browser-extension.md) — Chrome extension internals, content scripts, comment UI, relay infrastructure. The MCP tools defined here are *built on top of* this infrastructure.
- [`requirements-browser2.0.md`](requirements-browser2.0.md) — Snapshot versioning, diff engine, filtering, privacy, text extraction, semantic graph. Many of those requirements define the *internal* capabilities that this document's MCP tools expose. Where a B2-* requirement already fully specifies the MCP-visible behavior, this document references it rather than duplicating.
- [`requirements-browser.md`](requirements-browser.md) — **ARCHIVED.** Superseded by `requirements-browser-extension.md`.

**What this document adds:**
- New requirements identified by the M110-TC evaluation that don't exist in any other doc
- A single place to find the MCP-visible contract for all browser tools
- Traceability from evaluation checklist categories to requirements

---

## 2. Requirement ID Convention

All requirement IDs follow the pattern `MCP-{category}-{number}`:

| Category | Prefix | Scope |
|---|---|---|
| Visual Capture | MCP-VC | Viewport/full-page/region screenshots |
| Error Handling | MCP-ER | Error enrichment, retry hints |
| Navigation | MCP-NAV | Navigate response enrichment |
| Accessibility | MCP-A11Y | Actionability states, a11y tree enrichment |
| Security | MCP-SEC | Origin policy, PII redaction, audit trail |

Requirements in other categories (snapshot versioning, filtering, diff, security, text extraction, semantic graph) are fully specified in [`requirements-browser2.0.md`](requirements-browser2.0.md) and referenced here by ID.

---

## 3. MCP Tool Inventory

The evaluated `accordo_browser_*` surface consists of these tools:

| Tool | Purpose | Eval Category | Key Req Source |
|---|---|---|---|
| `browser_list_pages` | List all open tabs with tabId/url/title | A (Session) | PU-F-50..57 |
| `browser_select_page` | Activate a tab by tabId | A (Session) | PU-F-50..57 |
| `browser_get_page_map` | Structured DOM tree with filters | C, D, F, G | B2-FI-*, PU-F-01..06 |
| `browser_inspect_element` | Deep element inspection | C, D, F | PU-F-10..15 |
| `browser_get_dom_excerpt` | Sanitized HTML fragment | C | PU-F-30..33 |
| `browser_get_text_map` | Visible text with reading order | B | B2-TX-001..010 |
| `browser_get_semantic_graph` | A11y tree + landmarks + outline + forms | C | B2-SG-001..015 |
| `browser_capture_region` | Element/region screenshot | E | CR-F-01..12 |
| `browser_diff_snapshots` | DOM change tracking | G | B2-DE-001..007 |
| `browser_wait_for` | Wait for text/selector/stable layout | H | B2-WA-001..007 |
| `browser_navigate` | URL navigation + back/forward/reload | A | (implicit) |
| `browser_click` | Click an element | F | (implicit) |
| `browser_type` | Type text into an element | F | (implicit) |
| `browser_press_key` | Press keyboard key/combo | F | (implicit) |

---

## 4. New Requirements

### 4.1 Visual Capture Extensions (MCP-VC)

> **Context:** The M110-TC evaluation scored Visual Capture at 3/5. E1 (viewport) and E2 (full-page) screenshots are missing from the `accordo_browser_*` surface. Only region capture exists.

**MCP-VC-001: Viewport screenshot mode**  
`browser_capture_region` MUST accept an optional `mode` parameter with value `"viewport"`. When `mode: "viewport"`, the tool captures the currently visible browser viewport without requiring a bounding box or element target. The `rect`, `anchorKey`, and `nodeRef` parameters are ignored in this mode.  
**Acceptance:** `capture_region(mode: "viewport")` returns a JPEG/PNG data URL of the full visible viewport with `width` and `height` matching `viewport.width` and `viewport.height`.

**MCP-VC-002: Full-page screenshot mode**  
`browser_capture_region` MUST accept `mode: "fullPage"`. When `mode: "fullPage"`, the tool captures the entire scrollable page area. Implementation may use CDP `Page.captureScreenshot` with `captureBeyondViewport: true` via the relay's existing connection.  
**Acceptance:** `capture_region(mode: "fullPage")` returns a data URL with height exceeding the viewport height on a scrollable page. Max output dimension limits (CR-F-09) still apply.

**MCP-VC-003: Default mode is region (backward-compatible)**  
When `mode` is omitted, `browser_capture_region` MUST behave exactly as today — requiring `rect`, `anchorKey`, or `nodeRef`. This is equivalent to `mode: "region"`.  
**Acceptance:** All existing tests pass without modification. Existing callers that omit `mode` see no behavior change.

**MCP-VC-004: PNG format support**  
`browser_capture_region` MUST accept an optional `format` parameter: `"jpeg"` (default) or `"png"`. When `format: "png"`, the output data URL uses `image/png` encoding. Quality parameter is ignored for PNG (lossless). WebP is deferred.  
**Acceptance:** `capture_region(format: "png")` returns a `data:image/png;base64,...` data URL.

**MCP-VC-005: Redaction warning on screenshot responses**  
When a `RedactionPolicy` is configured (i.e., `redactPatterns` is non-empty), ALL screenshot responses from `browser_capture_region` (in any `mode`: region, viewport, or fullPage) MUST include a `redactionWarning` field with value `"screenshots-not-subject-to-redaction-policy"`. This makes explicit that screenshot content has not been redacted, even though text-producing tools apply redaction. When no `RedactionPolicy` is configured, the field is omitted.  
**Acceptance:** With a `RedactionPolicy` containing at least one pattern, `capture_region(mode: "viewport")` response includes `redactionWarning: "screenshots-not-subject-to-redaction-policy"`. Without a policy, the field is absent.  
**Cross-reference:** B2-PS-007 (screenshot redaction deferred), B2-PS-004 (text redaction).

### 4.2 Error Handling Enrichment (MCP-ER)

> **Context:** The M110-TC evaluation scored Robustness at 3/5. H3 (retry/backoff hints) is missing entirely. H4 (error taxonomy) is partial — error responses are bare strings, not structured objects.

**MCP-ER-001: Structured error objects**  
All `accordo_browser_*` tool error responses MUST return a structured error object instead of a bare string. Shape: `{ success: false, error: string, retryable: boolean, retryAfterMs?: number, details?: string | { reason: string, ... } }`.  
**Acceptance:** Every error response from every browser tool matches this shape. Bare string errors are eliminated.

**MCP-ER-001a: snapshot-not-found includes eviction hint (Feature 3)**  
For `browser_diff_snapshots`, when `snapshot-not-found` is returned and the local `SnapshotRetentionStore` has snapshots for the same `pageId`, the response MUST include structured `details.eviction` with:
- `requestedSnapshotId`: the ID the agent requested
- `retentionWindow`: the FIFO window size (number of retained snapshots)
- `wasEvicted`: `true` when the store is at capacity and the missing version is older than the oldest retained snapshot
- `suggestedAction`: a human-readable next action for the agent

This makes eviction actionable — the agent knows to re-capture rather than retry with the same ID.  
**Acceptance:** After filling the retention store with snapshots and requesting an evicted snapshot ID, the error response includes `details.eviction` with `wasEvicted: true` and a non-empty `suggestedAction`.

**MCP-ER-002: Retry hints for transient errors**  
The following error codes MUST include `retryable: true` and a `retryAfterMs` value:
- `"browser-not-connected"` → `retryable: true, retryAfterMs: 2000`
- `"timeout"` → `retryable: true, retryAfterMs: 1000`
- `"Bridge reconnecting"` → `retryable: true, retryAfterMs: 3000`

The following error codes MUST include `retryable: false`:
- `"element-not-found"` → `retryable: false`
- `"element-off-screen"` → `retryable: false`
- `"image-too-large"` → `retryable: false`
- `"capture-failed"` → `retryable: false`
- `"origin-blocked"` → `retryable: false`
- `"snapshot-not-found"` → `retryable: false`
- `"snapshot-stale"` → `retryable: false`
- `"redaction-failed"` → `retryable: false`

**Acceptance:** Each listed error code returns the correct `retryable` and `retryAfterMs` values.

**MCP-ER-004: Minimum-contract capture error codes**  
All error codes defined in the `CaptureError` type (`element-not-found`, `element-off-screen`, `image-too-large`, `capture-failed`, `no-target`) MUST be returned by the MCP handler layer for `browser_capture_region` in the corresponding failure scenarios. These codes are already implemented at the content script level (CR-F-12 in `requirements-browser-extension.md`) and MUST propagate through the relay → MCP handler path as structured error objects (MCP-ER-001).  
**Acceptance:** Each of the five `CaptureError` codes is returned by the MCP-level `browser_capture_region` handler (not just the content script) with the structured error shape. Integration tests verify end-to-end propagation.  
**Cross-reference:** CR-F-11, CR-F-12 in `requirements-browser-extension.md`; `CaptureError` type in `packages/browser/src/page-tool-types.ts`.

**MCP-ER-003: Connection health action**  
The browser relay MUST support a `connection-health` action (not necessarily a public MCP tool) that returns: `{ connected: boolean, tabCount: number, lastMessageAt: string, uptimeMs: number }`.  
**Acceptance:** When the Chrome extension is connected, health check returns `connected: true` with accurate metadata. When disconnected, returns `connected: false`.

### 4.3 Navigation Enrichment (MCP-NAV)

> **Context:** Navigate response returns empty `title` on fresh navigation and no readiness state.

**MCP-NAV-001: Ready state in navigate response**  
`browser_navigate` response MUST include a `readyState` field with value `"loading" | "interactive" | "complete"`, reflecting `document.readyState` at the time the response is sent. The tool SHOULD wait for at least `"interactive"` before responding (i.e., `DOMContentLoaded` fired).  
**Acceptance:** After `navigate(url: "https://example.com")`, response includes `readyState: "interactive"` or `"complete"`, and `title` is non-empty for pages that set `<title>`.

### 4.4 Accessibility Tree Enrichment (MCP-A11Y)

> **Context:** The a11y tree from `get_semantic_graph` and `inspect_element` lacks element state information (disabled, readonly, expanded, etc.).

**MCP-A11Y-001: Element actionability states**  
A11y tree nodes in `browser_get_semantic_graph` and the element object in `browser_inspect_element` MUST include an optional `states` array containing applicable ARIA state indicators. Collected from DOM properties and ARIA attributes.

Supported states:
| State | Source |
|---|---|
| `"disabled"` | `element.disabled` or `aria-disabled="true"` |
| `"readonly"` | `element.readOnly` or `aria-readonly="true"` |
| `"expanded"` | `aria-expanded="true"` |
| `"collapsed"` | `aria-expanded="false"` |
| `"checked"` | `element.checked` or `aria-checked="true"` |
| `"selected"` | `element.selected` or `aria-selected="true"` |
| `"required"` | `element.required` or `aria-required="true"` |
| `"hidden"` | `aria-hidden="true"` |

When no states apply, the `states` field is omitted (not an empty array).

**Acceptance:** A `<button disabled>Submit</button>` produces a node with `states: ["disabled"]`. A `<details open>` produces `states: ["expanded"]`. A `<input type="text">` with no special attributes has no `states` field.

### 4.5 Security Extensions (MCP-SEC)

> **Context:** The M110-TC evaluation scored Security/Privacy at 0/5. These requirements promote B2-PS-001..007 from P3 to active scope and define the MCP-visible interface for origin policy, PII redaction, audit trail, and redaction warnings.

**MCP-SEC-001: Per-request origin policy override**  
All data-producing `accordo_browser_*` tools MUST accept optional `allowedOrigins: string[]` and `deniedOrigins: string[]` input parameters. When set, these override the global origin policy for that request. When both are omitted, the global policy applies. The `deniedOrigins` list takes precedence over `allowedOrigins`. If the page's origin is blocked, the tool MUST return `{ success: false, error: "origin-blocked", retryable: false }` before any DOM access occurs.  
**Acceptance:** Calling `get_page_map({ deniedOrigins: ["https://example.com"] })` on a page at `https://example.com` returns `origin-blocked`. Calling without `deniedOrigins` on the same page returns data normally.  
**Cross-reference:** B2-PS-001..003, B2-ER-007.

**MCP-SEC-002: PII redaction parameter**  
All text-producing read tools — `browser_get_text_map`, `browser_get_semantic_graph`, `browser_get_page_map`, `browser_inspect_element`, and `browser_get_dom_excerpt` — MUST accept an optional `redactPII: boolean` parameter. When `true`, the handler scans all text-bearing fields in the response for email addresses, phone numbers, and API key patterns using regex and replaces matches with `[REDACTED]`. The response includes `redactionApplied: true` when any substitution was made.  
**Acceptance:** On a page containing `user@example.com`, calling `get_text_map({ redactPII: true })` returns segments where `user@example.com` is replaced with `[REDACTED]` and `redactionApplied: true` is present. Calling `inspect_element({ selector: ..., redactPII: true })` or `get_dom_excerpt({ selector: ..., redactPII: true })` similarly redacts matching text-bearing fields before the response is returned.  
**Cross-reference:** B2-PS-004..005, I1-text.

**MCP-SEC-003: Fail-closed redaction**  
If the redaction engine encounters an error (e.g., malformed regex pattern, processing timeout), the handler MUST NOT return unredacted content. Instead, it MUST return `{ success: false, error: "redaction-failed", retryable: false }`. This is the fail-closed behavior required by B2-ER-008.  
**Acceptance:** Configuring a malformed regex pattern and calling `get_text_map({ redactPII: true })` returns `redaction-failed`, not the raw page text.  
**Cross-reference:** B2-ER-008.

**MCP-SEC-004: Audit trail with audit ID**  
Every data-producing `accordo_browser_*` tool response MUST include an optional `auditId: string` field (UUIDv4) in the `SnapshotEnvelopeFields`. Each tool invocation is logged to an in-memory audit store with: `auditId`, `timestamp` (ISO 8601), `toolName`, `pageId`, `origin`, `action` (allowed/blocked), `redacted` (boolean), `durationMs`.  
**Acceptance:** After 5 tool invocations, the audit log contains 5 entries with correct metadata, and each response includes a unique `auditId`.  
**Cross-reference:** B2-PS-006, I3-001.

**MCP-SEC-005: Redaction warning on unredacted responses**  
When `redactPII` is `false` or not set on text-producing tools (`get_text_map`, `get_semantic_graph`, `get_page_map`, `inspect_element`, `get_dom_excerpt`), the response MUST include `redactionWarning: "PII may be present in response"`. For `capture_region` responses when a `RedactionPolicy` is configured, the warning is `"screenshots-not-subject-to-redaction-policy"` (per MCP-VC-005). When `redactPII: true` and redaction succeeds, no warning field is present.  
**Acceptance:** Calling `get_text_map()` without `redactPII` returns `redactionWarning: "PII may be present in response"`. Calling with `redactPII: true` and successful redaction has no warning.  
**Cross-reference:** MCP-VC-005.

---

## 5. Referenced Requirements (from other docs)

These requirements are fully specified in other documents and are not duplicated here. They are listed for traceability to the evaluation checklist.

### 5.1 From `requirements-browser2.0.md`

| Eval Category | Requirements | Status |
|---|---|---|
| A (Session) | B2-SV-001..003 (snapshot envelope) | ✅ Implemented |
| B (Text) | B2-TX-001..010 (text map) | ✅ Implemented |
| C (Semantic) | B2-SG-001..015 (semantic graph) | ✅ Implemented (form labels partial — B2-SG-005) |
| D (Layout) | B2-FI-006 (regionFilter), B2-VD-010..013 (occlusion — P2) | 🟡 regionFilter done; occlusion deferred |
| F (Interaction) | B2-FI-002 (interactiveOnly filter) | ⚠️ Bug: depth truncation interaction |
| G (Deltas) | B2-SV-001..007, B2-DE-001..007, B2-FI-001..008 | ✅ Implemented |
| H (Robustness) | B2-WA-001..007, B2-ER-001..008 | ✅ Wait done; error codes partial (see MCP-ER-004) |
| I (Security) | B2-PS-001..007, B2-ER-007..008 | 🟡 Phase A design complete (MCP-SEC-001..005); implementation pending |

### 5.2 From `requirements-browser-extension.md`

| Eval Category | Requirements | Status |
|---|---|---|
| A (Session) | PU-F-01..06, PU-F-50..57 (page map, tools) | ✅ Implemented |
| C (Semantic) | PU-F-10..15, PU-F-30..33 (inspect, excerpt) | ✅ Implemented |
| E (Visual) | CR-F-01..12 (region capture) | ✅ Implemented |
| F (Interaction) | PU-F-20..26 (anchor strategy, selectors) | ✅ Implemented |

---

## 6. Evaluation Category → Requirement Traceability

| Eval Category | Score | Target | This Doc | Other Docs | Key Gap |
|---|---:|---:|---|---|---|
| A. Session & Context | 4 | 4–5 | MCP-NAV-001 | B2-SV-003, PU-F-01..06 | readyState on navigate |
| B. Text Extraction | 5 | 5 | — | B2-TX-001..010 | None — production-ready |
| C. Semantic Structure | 4 | 5 | MCP-A11Y-001 | B2-SG-001..015 | Actionability states, form labels |
| D. Layout/Geometry | 3 | 3 | — | B2-FI-006, B2-VD-010..013 | Geometry helpers deferred |
| E. Visual Capture | 3 | 4 | MCP-VC-001..005 | CR-F-01..12 | Viewport/full-page screenshot; redaction warning |
| F. Interaction Model | 3 | 4 | — (bug fix) | B2-FI-002 | `interactiveOnly` depth bug |
| G. Deltas/Efficiency | 4 | 4 | — | B2-SV/DE/FI-* | Cross-nav diff deferred (B2-SV-002/005 unchanged) |
| H. Robustness | 3 | 4 | MCP-ER-001..004 | B2-WA-*, B2-ER-* | Retry hints, structured errors, capture error taxonomy |
| I. Security/Privacy | 0 | 2–3 | MCP-SEC-001..005 | B2-PS-001..007, B2-ER-007..008 | Phase A designed; implementation pending |

---

## 7. Non-Functional Requirements

Browser MCP tools inherit the non-functional requirements from their source documents:
- Performance: B2-PF-001..006, CR-NF-01, PU-NF-01..06
- Security posture: CR-NF-02, PU-NF-06 (loopback + token auth)
- Backward compatibility: B2-CO-001..004
- Tool registration: B2-TX-009, B2-SG-011, B2-DE-001, CR-NF-03

**Additional:**

**MCP-NF-001: MCP tool response consistency**  
All `accordo_browser_*` tools MUST return responses conforming to the `SnapshotEnvelope` (B2-SV-003) for data-producing tools, or the structured error format (MCP-ER-001) for errors. No bare string responses.  
**Acceptance:** Schema validation of all tool responses passes.

---

## 8. Phase Mapping

> **Note:** The improvement plan sequence (in [`M110-TC-improvement-plan.md`](../50-reviews/M110-TC-improvement-plan.md)) is authoritative for execution order. This table groups requirements by phase for traceability.

| Phase | New Requirements | Effort | Score Impact |
|---|---|---:|---|
| Phase 1 (Quick wins) | B2-FI-002 bug fix, MCP-ER-001..004 | 2d | F: 3→4, H: 3→4 |
| Phase 2 (Security) | B2-PS-001..007, B2-ER-007..008, MCP-SEC-001..005 | 4.5d | I: 0→2 (conservative), 0→3 (stretch) |
| Phase 3 (Visual) | MCP-VC-001..003, MCP-VC-005 | 1.5d | E: 3→4 |
| Phase 4 (Polish) | MCP-A11Y-001, MCP-NAV-001, MCP-VC-004 | 3.25d | C: 4→5 |

---

*Requirements authored by Architect agent. Revised 2026-04-04 to add MCP-SEC-001..005 (security), MCP-VC-005, MCP-ER-004, and align phase mapping with improvement plan rev 1. Read-only document — no implementation.*
