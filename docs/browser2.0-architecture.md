# Browser 2.0 — Architecture

**Status:** DRAFT — Design phase  
**Date:** 2026-03-27  
**Scope:** Incremental upgrade of browser page-understanding and comment-anchor infrastructure  
**Depends on:** [`docs/architecture.md`](architecture.md) §14–15, [`docs/browser-extension-architecture.md`](browser-extension-architecture.md), [`docs/comments-architecture.md`](comments-architecture.md)  
**Evaluation framework:** [`docs/mcp-webview-agent-evaluation-checklist.md`](mcp-webview-agent-evaluation-checklist.md)

---

## 1. Vision

Browser 2.0 closes the visibility and efficiency gaps between Accordo's current browser tools and the evaluation checklist target (§7 scorecard ≥ 30/45, no category below 2). The agent should reliably answer: *what the user sees, where it is, what it means, and what changed* — without over-fetching data.

This is **not** a rewrite. It is a backward-compatible upgrade delivered in three phases (P1/P2/P3) that:

1. Adds snapshot versioning and change deltas to existing tools.
2. Extends DOM traversal to cover Shadow DOM, iframes, and occlusion.
3. Introduces privacy/redaction controls and own wait primitives.
4. Prepares the annotation layer (M95-VA) infrastructure.
5. Keeps the architecture **detachable** so the core can run as a standalone MCP server outside Accordo.

### 1.1 Non-Technical Summary

**What problem does it solve?** Today the agent can see the DOM of a web page, but it has blind spots: it cannot see inside iframes or Shadow DOM components (used by most modern web frameworks), it cannot tell if one element is hidden behind another (z-order occlusion), and it has no way to know what changed between two observations. Browser 2.0 fills these gaps.

**What can go wrong?** The main risks are: (a) performance regression on large pages when traversing iframes and shadow roots, (b) Chrome extension permission changes that require user re-approval, and (c) complexity in maintaining backward compatibility with existing tool outputs while adding new fields.

**How do we know it works?** Each capability has measurable acceptance criteria (see requirements doc). We validate against a set of benchmark web pages that exercise each blind spot, and we run the evaluation checklist scorecard before/after.

---

## 2. Incremental Upgrade Strategy

### 2.1 Backward Compatibility Contract

| Principle | Rule |
|---|---|
| **Tool names unchanged** | All existing MCP tool names (`browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_capture_region`) continue to work with identical signatures. |
| **Additive fields only** | New output fields (`snapshotId`, `capturedAt`, `viewport`, `pageId`, `frameId`, `source`) are added to responses. No existing fields are removed or renamed. |
| **New tools are new names** | New capabilities (e.g., `browser_diff_snapshots`, `browser_wait_for`) get new tool names. |
| **Opt-in depth** | Shadow DOM and iframe traversal are controlled by new optional input parameters (`piercesShadow`, `traverseFrames`) that default to `false` in P1 and `true` after P2 stabilizes. See Defaults Progression table below. |
| **Error codes stable** | Existing error codes (`element-not-found`, `element-off-screen`, `no-target`, `image-too-large`, `capture-failed`, `browser-not-connected`, `unauthorized`, `timeout`, `action-failed`) are preserved. `"unauthorized"` is reserved for auth/token failures only; origin policy violations use the new `"origin-blocked"` code (P3). New codes are additive. |

> **Tool naming convention:** The canonical MCP tool prefix is `browser_*` (and `comment_*` for comment tools). The legacy prefix `accordo_browser_*` (and `accordo_comment_*`) was retired in Session 14. All Browser 2.0 documentation and interfaces use the short canonical prefix. If older evaluation checklists or external references use the `accordo_browser_*` form, map them to the canonical `browser_*` names.

#### Defaults Progression (authoritative)

| Parameter | P1 | P2 | P3+ |
|---|---|---|---|
| `piercesShadow` | `false` | `true` | `true` |
| `traverseFrames` | N/A (not available) | `false` | `true` |
| `includeOcclusion` | N/A (not available) | `false` | `false` |

> This table is the single source of truth for parameter defaults. All other references in this document and in `requirements-browser2.0.md` defer to these values.

### 2.2 Phase Boundaries

| Phase | Scope | Prerequisite |
|---|---|---|
| **P1 — Snapshot Versioning + Canonical Model** | Add `snapshotId`, `capturedAt`, `viewport`, `pageId` to all data-producing responses. Add `browser_diff_snapshots` tool. Server-side filtering (`visibleOnly`, `interactiveOnly`, `role`, `textMatch`). | Current baseline green (2,967 tests). |
| **P2 — Visibility Depth** | Shadow DOM piercing. Iframe traversal (same-origin via `all_frames` manifest; cross-origin remains opaque per Same-Origin Policy). Z-order/occlusion detection. Virtualized list detection heuristic. `@accordo/browser-core` extraction (M110-CORE). | P1 tools stable for ≥1 session. |
| **P3 — Privacy, Wait, Annotations** | PII redaction hooks. Origin allow/deny policies. Own wait primitives (`browser_wait_for`). Annotation layer foundation (M95-VA). | P2 tools stable. |

---

## 3. Detachability Architecture

The core page-understanding logic must be usable **outside Accordo** — as a standalone MCP server that any MCP client can connect to.

### 3.1 Core + Adapter + Storage Port Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│  @accordo/browser-core  (zero VS Code imports, zero Hub imports)│
│                                                                 │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ SnapshotEngine │  │ DiffEngine       │  │ RedactionEngine│  │
│  │ (collect, ver- │  │ (compare two     │  │ (PII filter,   │  │
│  │  sion, filter) │  │  snapshots, emit │  │  origin policy)│  │
│  │                │  │  structured diff)│  │                │  │
│  └───────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
│          │                    │                     │           │
│  ┌───────┴────────────────────┴─────────────────────┴────────┐  │
│  │                   ToolDefinitions                         │  │
│  │  (pure data: name, schema, description, dangerLevel)      │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                      Port Interfaces                      │  │
│  │  DomProvider   ScreenshotProvider   SnapshotStore          │  │
│  │  WaitProvider  AuditSink            RedactionPolicy        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
 ┌──────────────┐   ┌─────────────────┐   ┌────────────────────┐
 │ ChromeRelay  │   │ AccordoHub      │   │ StandaloneMcpSrv   │
 │ Adapter      │   │ Adapter         │   │ Adapter            │
 │ (existing    │   │ (BridgeAPI,     │   │ (stdio/SSE MCP,    │
 │  relay path) │   │  registerTools) │   │  CDP direct)       │
 └──────────────┘   └─────────────────┘   └────────────────────┘
```

### 3.2 Port Interfaces

```typescript
/** Provides raw DOM data from a browser page. */
interface DomProvider {
  /** Collect a structured page map. */
  getPageMap(options: PageMapOptions): Promise<PageMapResult>;
  /** Deep-inspect a specific element. */
  inspectElement(options: InspectOptions): Promise<InspectResult>;
  /** Get sanitized DOM excerpt for a subtree. */
  getDomExcerpt(options: DomExcerptOptions): Promise<DomExcerptResult>;
  /** Traverse shadow roots if supported. */
  readonly supportsShadowDom: boolean;
  /** Traverse iframes if supported. */
  readonly supportsIframes: boolean;
}

/** Provides screenshot/visual capture capabilities. */
interface ScreenshotProvider {
  captureViewport(options: CaptureOptions): Promise<CaptureResult>;
  captureRegion(options: RegionCaptureOptions): Promise<CaptureResult>;
}

/** Persists and retrieves snapshot history for diffing. */
interface SnapshotStore {
  save(snapshot: VersionedSnapshot): Promise<void>;
  get(snapshotId: string): Promise<VersionedSnapshot | undefined>;
  getLatest(pageId: string): Promise<VersionedSnapshot | undefined>;
  list(pageId: string, limit?: number): Promise<SnapshotSummary[]>;
  prune(pageId: string, keepCount: number): Promise<number>;
}

/** Wait for a condition on the page. */
interface WaitProvider {
  waitForText(texts: string[], options: WaitOptions): Promise<WaitResult>;
  waitForSelector(selector: string, options: WaitOptions): Promise<WaitResult>;
  waitForStableLayout(stableMs: number, options: WaitOptions): Promise<WaitResult>;
}

/** Receives audit log entries for tool invocations. */
interface AuditSink {
  log(entry: AuditEntry): void;
}

/** Defines PII redaction and origin access rules. */
interface RedactionPolicy {
  /** Origins the agent is allowed to inspect. Empty = all allowed. */
  allowedOrigins: string[];
  /** Origins explicitly blocked. Takes precedence over allowed. */
  blockedOrigins: string[];
  /** PII patterns to redact from text outputs. */
  redactPatterns: RedactPattern[];
  /** Whether to redact PII from screenshots (requires OCR — P3+). */
  redactScreenshots: boolean;
}
```

### 3.3 Detachability Rules

1. **`@accordo/browser-core` has zero imports from `vscode`, `@accordo/hub`, or `@accordo/bridge-types`.**
2. Every external capability is accessed through a port interface.
3. The `AccordoHubAdapter` implements ports using existing `BridgeAPI.registerTools()` + relay transport.
4. The `StandaloneMcpAdapter` implements ports using direct CDP (Chrome DevTools Protocol) over `chrome.debugger` or Puppeteer.
5. Tool definitions are pure data (`ToolRegistration` shape) — handlers are adapter-specific and never serialized.

---

## 4. Canonical Data Model

All data-producing tools emit a response envelope containing canonical metadata.

### 4.1 Snapshot Envelope

```typescript
interface SnapshotEnvelope {
  /** Stable page identifier (matches chrome-devtools page ID). */
  pageId: string;
  /** Frame identifier. Top-level frame = "main". */
  frameId: string;
  /** Monotonically increasing snapshot version (per pageId). */
  snapshotId: string;
  /** ISO 8601 timestamp when snapshot was captured. */
  capturedAt: string;
  /** Viewport state at capture time. */
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  /** Data source type. */
  source: 'dom' | 'a11y' | 'visual' | 'layout' | 'network';
}
```

### 4.2 Snapshot ID Format

`snapshotId` is a string: `{pageId}:{monotonicVersion}` where `monotonicVersion` is an auto-incrementing integer per page, reset on navigation. Example: `page-3:17`.

### 4.3 Node Identity

```typescript
interface NodeIdentity {
  /** Stable within a single snapshot. Format: integer index from DFS traversal. */
  nodeId: number;
  /** Experimental: stable across snapshots for unchanged elements. */
  persistentId?: string;
  /** Parent nodeId (undefined for root). */
  parentId?: number;
  /** Child nodeIds in document order. */
  childIds?: number[];
}
```

`persistentId` stability contract: remains stable across minor DOM updates for ≥90% of unchanged elements. This field is explicitly experimental until P2 validation.

### 4.4 Visibility Model

```typescript
type VisibilityState = 'visible' | 'hidden' | 'occluded' | 'offscreen' | 'clipped';

interface VisibilityInfo {
  /** Computed visibility state. */
  state: VisibilityState;
  /** Fraction of element bounding box visible in viewport (0.0–1.0). */
  viewportIntersectionRatio: number;
  /** Whether element is behind another element in stacking context. P2+. */
  isOccluded?: boolean;
  /** ID of the occluding element, if detected. P2+. */
  occludedBy?: number;
}
```

---

## 5. Snapshot Versioning and Diff Engine

### 5.1 Version Tracking

The content script maintains a per-page monotonic counter. Every data-producing relay request increments the counter and includes the `snapshotId` in the response. The `SnapshotStore` retains the last N snapshots (default: 5) for diffing.

### 5.2 Diff Engine

New tool: `browser_diff_snapshots`

**Active-page inference:** The tool does not accept a `pageId` input. Page identity
is encoded in the `snapshotId` format (`{pageId}:{version}`), and when both
`fromSnapshotId` and `toSnapshotId` are omitted the relay targets the currently
active tab. The `DiffResult` response carries `pageId` via `SnapshotEnvelope`
fields, so callers always know which page was diffed.

```typescript
interface DiffRequest {
  /** Earlier snapshot. If omitted, uses the snapshot before `toSnapshotId`. */
  fromSnapshotId?: string;
  /** Later snapshot. If omitted, captures a fresh snapshot and uses it. */
  toSnapshotId?: string;
}

interface DiffResult extends SnapshotEnvelope {
  /** Nodes added since `from`. */
  added: DiffNode[];
  /** Nodes removed since `from`. */
  removed: DiffNode[];
  /** Nodes whose text or attributes changed. */
  changed: DiffChange[];
  /** Summary statistics. */
  summary: {
    addedCount: number;
    removedCount: number;
    changedCount: number;
    textDelta: string; // human-readable summary of text changes
  };
}

interface DiffNode {
  nodeId: number;
  tag: string;
  text?: string;
  role?: string;
}

interface DiffChange {
  nodeId: number;
  tag: string;
  field: string; // 'textContent' | 'attribute:xxx' | 'visibility' | 'bounds'
  before: string;
  after: string;
}
```

### 5.3 Storage and Retention

- Snapshots are stored in-memory in the content script (Chrome extension context).
- Default retention: 5 snapshots per page. Configurable via `SnapshotStore.prune()`.
- On navigation (URL change or reload), the counter resets and old snapshots are discarded.
- For the standalone MCP adapter, snapshots are stored in the server process memory (not persisted to disk).

---

## 6. Visibility Depth — Shadow DOM, Iframes, Occlusion

### 6.1 Shadow DOM Piercing (P2)

**Problem:** `querySelectorAll('*')` does not traverse shadow roots. Components built with Web Components, Salesforce LWC, Angular, and some React component libraries render inside shadow DOM.

**Approach:**

1. The `PageMapCollector` walks the DOM tree recursively.
2. When a node has a `shadowRoot` property, the collector descends into it.
3. Shadow DOM nodes are tagged with `inShadowRoot: true` and include the host element's `nodeId` as `shadowHostId`.
4. Opt-in via `piercesShadow: true` parameter (default: `false` in P1, `true` in P2+).

**Constraints:**
- Only `open` shadow roots are accessible. `closed` shadow roots are opaque by browser specification — the collector reports `shadowRoot: 'closed'` on the host node but cannot traverse.
- Shadow DOM nodes have their own CSS scope; bounding box coordinates are still in page coordinates.

### 6.2 Iframe Traversal (P2)

**Problem:** Content scripts do not run inside iframes unless explicitly configured. `<iframe>` elements are opaque boxes to the current page map.

**Approach:**

1. Manifest `content_scripts` updated with `"all_frames": true` to inject into same-origin iframes.
2. Cross-origin iframes remain opaque — this is a **hard browser platform security boundary** (Same-Origin Policy) enforced by the browser engine, not a design choice that could be changed in a later phase. Content scripts cannot access cross-origin iframe DOMs regardless of configuration.
3. Chrome DevTools Protocol (`chrome-devtools_*` tools) operates through a separate CDP channel that has cross-origin iframe access. This is a distinct capability path, not a workaround to the Same-Origin Policy restriction on content scripts.
4. The page map response includes an `iframes` array listing each iframe with its `frameId`, `src`, `bounds`, and `sameOrigin` flag.
5. For same-origin iframes, the content script in the child frame responds to relay requests independently, tagged with its `frameId`.

**Opt-in:** `traverseFrames: true` parameter. See §2.1 Defaults Progression table for per-phase default values.

### 6.3 Z-Order Occlusion Detection (P2)

**Problem:** An element can have `display: block; visibility: visible; opacity: 1` and still be completely invisible to the user because another element is stacked on top of it (modal overlay, sticky header, dropdown menu, cookie banner).

**Approach:**

1. For each element in the page map, compute its center point in viewport coordinates.
2. Call `document.elementFromPoint(centerX, centerY)` to get the topmost element at that position.
3. If the topmost element is not the target element (or a descendant of it), mark the target as `occluded` and record the occluder's `nodeId`.
4. This is a **heuristic** — it checks the center point only. A more thorough approach (4-corner sampling) is available as an opt-in (`occlusionSampling: 'corners'`).

**Performance guard:** Occlusion checks are expensive on large pages. They are:
- Disabled by default (opt-in via `includeOcclusion: true`).
- Limited to the first 200 elements by default (`maxOcclusionChecks: 200`).
- Skipped for elements already marked `hidden` or `offscreen`.

### 6.4 Virtualized List Detection (P2)

**Problem:** Infinite scroll / virtualized lists (React Virtualized, TanStack Virtual, etc.) only render a window of items. Items outside the rendered window are invisible to DOM traversal even though users perceive them as "in the list."

**Approach (heuristic):**

1. Detect containers with `overflow: auto|scroll` that contain many same-tag siblings with uniform heights.
2. Mark the container as `virtualizedHint: true` with estimated `totalItemCount` based on scroll height / item height.
3. Report `renderedRange: { start, end }` indicating which items are currently in the DOM.
4. This is explicitly a heuristic — accuracy is not guaranteed. The field name uses "hint" to signal this.

---

## 7. Server-Side Filtering

P1 adds server-side filtering to `browser_get_page_map` to reduce token consumption.

### 7.1 Filter Parameters

```typescript
interface PageMapFilterOptions {
  /** Only return elements visible in the current viewport. */
  visibleOnly?: boolean;
  /** Only return interactive elements (buttons, links, inputs, etc.). */
  interactiveOnly?: boolean;
  /** Filter by ARIA role(s). */
  roles?: string[];
  /** Filter by text content match (substring, case-insensitive). */
  textMatch?: string;
  /** Filter by CSS selector. */
  selector?: string;
  /** Filter by bounding box region (viewport coordinates). */
  regionFilter?: { x: number; y: number; width: number; height: number };
}
```

### 7.2 Efficiency Target

Filtered requests should reduce payload by ≥40% compared to full deep snapshot on a medium-complexity page (~1,000 nodes). This is a measurable acceptance criterion.

---

## 8. Wait Primitives (P3)

### 8.1 Motivation

The current `chrome-devtools_wait_for` tool waits for text appearance only. Agents need:
- Wait for a CSS selector to appear.
- Wait for layout stability (no reflows for N ms).
- Wait with configurable timeout and clear error semantics.

### 8.2 New Tool: `browser_wait_for`

```typescript
interface BrowserWaitOptions {
  /** Wait for any of these text strings to appear. */
  texts?: string[];
  /** Wait for a CSS selector to match at least one element. */
  selector?: string;
  /** Wait for layout stability (no reflow for this many ms). */
  stableLayoutMs?: number;
  /** Maximum wait time in ms. Default: 10000. Max: 30000. */
  timeout?: number;
}

interface BrowserWaitResult {
  /** Whether the condition was met before timeout. */
  met: boolean;
  /** Which condition was met (if texts, which text matched). */
  matchedCondition?: string;
  /** How long the wait took in ms. */
  elapsedMs: number;
  /** Error code if not met. */
  error?: 'timeout' | 'navigation-interrupted' | 'page-closed';
}
```

**Implementation:** The content script polls at 100ms intervals (not `MutationObserver` — simpler and more predictable for cross-frame). For `stableLayoutMs`, it compares `document.documentElement.scrollHeight` + `getBoundingClientRect()` of body across intervals.

---

## 9. Comment Anchor v2

### 9.1 Current State

The 6-tier enhanced anchor strategy (`id → data-testid → aria → css-path → tag-sibling → viewport-pct`) provides good re-anchoring across page reloads. Browser 2.0 extends this with:

### 9.2 Snapshot-Linked Anchors

> **Upstream compatibility:** The existing browser anchor schema in `requirements-comments.md` defines `{ kind: "browser"; anchorKey?: string }`. The B2-CA fields (`snapshotId`, `confidence`, `resolvedTier`, `snapshotDrift`) are **additive optional extensions** to this schema — the existing shape is fully preserved, and new fields are ignored by consumers that don't understand them. No breaking changes to the comment system contract. See `requirements-comments.md` §3.5 for the base schema.

Comments created via `comment_create` with `scope.modality = 'browser'` will optionally include the `snapshotId` at creation time. This enables:
- **Stale detection:** If the current snapshot differs significantly from the creation snapshot, the comment can be flagged as `anchorConfidence: 'low'`.
- **Historical context:** The agent can retrieve the snapshot at comment-creation time to understand what the page looked like when the comment was placed.

### 9.3 Anchor Confidence Scoring

```typescript
interface AnchorResolutionResult {
  /** The resolved DOM element, if found. */
  element: Element | null;
  /** Which tier resolved the anchor. */
  resolvedTier: 'id' | 'data-testid' | 'aria' | 'css-path' | 'tag-sibling' | 'viewport-pct';
  /** Confidence score: 'high' (tier 1-2), 'medium' (tier 3-4), 'low' (tier 5-6), 'none' (failed). */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** If the page has changed significantly since comment creation. */
  snapshotDrift: boolean;
}
```

---

## 10. Privacy and Security Controls (P3)

### 10.1 Origin Policy

```typescript
interface OriginPolicy {
  /** If non-empty, only these origins are inspectable. */
  allowList: string[];
  /** Always blocked, even if in allowList. */
  blockList: string[];
  /** Default behavior when origin is not in either list. */
  defaultAction: 'allow' | 'deny';
}
```

Origin policy is enforced in the relay request router (`accordo-browser`). Requests for blocked origins return `{ success: false, error: "origin-blocked" }`.

> **Note:** The `"origin-blocked"` error code is distinct from `"unauthorized"`. `"unauthorized"` is reserved for authentication/token failures. `"origin-blocked"` specifically indicates that the origin policy (allow/block lists or `defaultAction: 'deny'`) rejected the request. See §11 Error Taxonomy.

### 10.2 PII Redaction

```typescript
interface RedactPattern {
  /** Human-readable name (e.g., "email", "phone", "ssn"). */
  name: string;
  /** Regex pattern to match. */
  pattern: RegExp;
  /** Replacement string. Default: "[REDACTED]". */
  replacement?: string;
}
```

Redaction is applied in `@accordo/browser-core` before data leaves the core layer. It applies to:
- `textContent` in page map responses.
- `text` fields in DOM excerpts.
- `textRaw` and `textNormalized` in text model outputs.

Screenshot redaction (P3+) requires OCR and is deferred. The field `redactScreenshots` exists in the policy interface but is not implemented until OCR integration is available.

### 10.3 Audit Trail

Every tool invocation logs to the `AuditSink`:

```typescript
interface AuditEntry {
  timestamp: string;
  toolName: string;
  pageId: string;
  origin: string;
  /** Input parameters (redacted if policy requires). */
  input: Record<string, unknown>;
  /** Whether the request was allowed or blocked. */
  action: 'allowed' | 'blocked';
  /** Redaction applied? */
  redacted: boolean;
}
```

The default `AuditSink` in Accordo logs to the Hub's structured log. The standalone adapter can write to a file or event stream.

---

## 11. Error Taxonomy (Extended)

Existing error codes are preserved. New codes for Browser 2.0:

| Code | Phase | Meaning |
|---|---|---|
| `element-not-found` | — | Existing: anchor/selector/ref could not be resolved. |
| `element-off-screen` | — | Existing: element is outside viewport bounds. |
| `no-target` | — | Existing: no input provided to identify a target. |
| `image-too-large` | — | Existing: captured image exceeds 500 KB cap. |
| `capture-failed` | — | Existing: `captureVisibleTab` failed. |
| `browser-not-connected` | — | Existing: relay WebSocket not connected. |
| `unauthorized` | — | Existing: authentication/token failure only. |
| `timeout` | — | Existing: operation timed out. |
| `action-failed` | — | Existing: generic action failure. |
| `snapshot-not-found` | P1 | Requested `snapshotId` does not exist or was pruned. |
| `snapshot-stale` | P1 | Snapshot is from a previous navigation (page has reloaded). |
| `iframe-cross-origin` | P2 | Cannot traverse cross-origin iframe (browser security). |
| `shadow-root-closed` | P2 | Cannot traverse closed shadow root. |
| `navigation-interrupted` | P3 | Wait aborted because the page navigated. |
| `page-closed` | P3 | Wait aborted because the tab was closed. |
| `origin-blocked` | P3 | Origin is in the block list per privacy policy. |
| `redaction-failed` | P3 | PII redaction engine encountered an error (data not returned). |

---

## 12. Performance and Token Budget Strategy

### 12.1 Token Budget Targets

| Tool | Target token cost | Notes |
|---|---|---|
| `browser_get_page_map` (default) | 200–800 tokens | Existing target, maintained. |
| `browser_get_page_map` (filtered) | 80–400 tokens | ≥40% reduction via server-side filtering. |
| `browser_inspect_element` | 50–150 tokens | Unchanged. |
| `browser_get_dom_excerpt` | 100–500 tokens | Bounded by `maxLength` (default 2000 chars). |
| `browser_capture_region` | 1–5 KB base64 | Unchanged. |
| `browser_diff_snapshots` | 100–600 tokens | Proportional to change volume, not page size. |
| `browser_wait_for` | 30–50 tokens | Minimal: `{ met, matchedCondition, elapsedMs }`. |

### 12.2 Performance Targets

| Metric | Target | Phase |
|---|---|---|
| Page map (medium page, ~1k nodes) | ≤2.5s | P1 |
| Region capture (default quality) | ≤3.0s | — (existing) |
| Diff computation (pure diff engine in service worker) | ≤1.0s | P1 |
| Diff tool relay round-trip (MCP tool-level timeout) | ≤5.0s | P1 |
| Occlusion check (200 elements) | ≤500ms | P2 |
| Shadow DOM traversal overhead | ≤30% over non-shadow | P2 |
| Wait poll interval | 100ms | P3 |

### 12.3 System Prompt Budget

The dynamic browser section of the system prompt remains within the existing 1,500-token envelope. New tools add ~200 tokens to the tool registry. Total prompt cost stays under the current budget.

---

## 13. Migration Plan

### 13.1 P1 Migration (Snapshot Versioning)

1. Add `SnapshotEnvelope` fields to all page-understanding relay responses.
2. Implement `SnapshotStore` (in-memory, content script context).
3. Add `browser_diff_snapshots` tool registration.
4. Add server-side filter parameters to `browser_get_page_map`.
5. All existing tests must pass without modification (additive fields only).
6. New tests validate snapshot ID monotonicity, diff correctness, and filter reduction.

### 13.2 P2 Migration (Visibility Depth)

1. Extract DOM traversal into `@accordo/browser-core` package.
2. Add `piercesShadow` and `traverseFrames` parameters (opt-in, default false).
3. Update manifest `content_scripts` with `"all_frames": true`.
4. Add occlusion detection with `includeOcclusion` opt-in.
5. Add `VisibilityInfo` to page map nodes.
6. New tests for shadow DOM, iframe, and occlusion scenarios.

### 13.3 P3 Migration (Privacy, Wait, Annotations)

1. Implement `RedactionPolicy` in `@accordo/browser-core`.
2. Implement `OriginPolicy` enforcement in relay request router.
3. Implement `browser_wait_for` tool.
4. Wire `AuditSink` to Hub structured log.
5. Foundation for M95-VA annotation layer (port interfaces, overlay container creation).

---

## 14. Current Visibility Coverage Matrix

This matrix explicitly documents where the agent has full visibility, partial visibility, and "black holes" for web technologies.

| Technology | Visibility | Phase | Notes |
|---|---|---|---|
| **Static HTML** | ✅ Full | — | DOM traversal, text extraction, bounding boxes all work. |
| **CSS-styled content** | ✅ Full | — | Computed styles, bounding boxes, visibility checks. |
| **CSS pseudo-elements (`::before`, `::after`)** | 🟡 Partial | — | Text from `content` property is not extracted; visual presence visible via screenshots. |
| **Standard form elements** | ✅ Full | — | Inputs, selects, textareas detected with values. |
| **ARIA roles and labels** | ✅ Full | — | `role`, `aria-label`, `aria-labelledby` extracted. |
| **SVG (inline)** | 🟡 Partial | — | SVG elements appear in DOM; text extracted. Complex paths/shapes only visible via screenshot. |
| **Shadow DOM (open)** | ❌ → ✅ | P2 | Currently invisible. P2 adds traversal. |
| **Shadow DOM (closed)** | ❌ Opaque | — | Browser spec prevents access. Only host element visible. Cannot be fixed. |
| **Iframes (same-origin)** | ❌ → ✅ | P2 | Currently invisible. P2 adds `all_frames` traversal. |
| **Iframes (cross-origin)** | ❌ Opaque | — | Browser security boundary. Only bounding box and `src` visible. Use CDP tools for access. |
| **Canvas 2D** | ❌ Black hole | — | Only `<canvas>` element detected. Rendered pixel content is invisible to DOM traversal. Screenshot is the only option. |
| **WebGL / WebGPU** | ❌ Black hole | — | Same as Canvas. GPU-rendered content has no DOM representation. Screenshot only. |
| **Video / Audio** | ❌ Black hole | — | `<video>` element detected with `src`. Frame content is invisible. Screenshot captures current frame. |
| **PDF (embedded)** | ❌ Black hole | — | `<embed>` or `<iframe>` detected. PDF content is inaccessible to DOM. |
| **React / Vue / Angular (without Shadow DOM)** | ✅ Full | — | These frameworks render to standard DOM. Fully visible. |
| **React / Vue / Angular (with Shadow DOM)** | ❌ → ✅ | P2 | Shadow DOM piercing covers this. |
| **Web Components (open)** | ❌ → ✅ | P2 | Same as Shadow DOM (open). |
| **Salesforce LWC** | ❌ → 🟡 | P2 | LWC uses synthetic shadow by default (pierceable). Real shadow mode is partially pierceable. |
| **Virtualized / infinite scroll lists** | 🟡 Partial | P2 | Only rendered items visible. P2 adds detection heuristic. |
| **Lazy-loaded images** | 🟡 Partial | — | `<img>` with `loading="lazy"` detected. Image may not be loaded if offscreen. |
| **Service Worker-intercepted content** | ✅ Full | — | Content ultimately renders to DOM; service workers are transparent. |
| **Extension-injected content** | 🟡 Partial | — | Other Chrome extensions may inject content; our content script sees it but cannot distinguish it from page content. |
| **`contenteditable` regions** | ✅ Full | — | Detected as editable; content extracted. |
| **Drag-and-drop zones** | 🟡 Partial | — | DOM structure visible; drag semantics not detected. |
| **`<dialog>` / `<details>` / `<summary>`** | ✅ Full | — | Native HTML elements fully traversed. Open/closed state detected. |
| **Toast / notification overlays** | 🟡 Partial | P2 | DOM visible; may need occlusion detection to know they're covering content. |
| **Cookie consent banners** | 🟡 Partial | P2 | DOM visible; occlusion detection reveals they're blocking content. |

### 14.1 Permanent Black Holes (Cannot Fix)

These are fundamental browser or web platform limitations:

1. **Canvas/WebGL/WebGPU rendered content** — No DOM representation exists. Only screenshots can capture visual state.
2. **Closed Shadow DOM** — Browser spec (`mode: 'closed'`) explicitly prevents external traversal.
3. **Cross-origin iframes** — Browser same-origin policy prevents DOM access. CDP has access, but our content script does not.
4. **Embedded PDF content** — PDF rendering is handled by browser internals or plugins, not DOM.
5. **Video frame content** — Individual video frames are not DOM-accessible. Screenshot captures current visible frame.

---

## 15. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **P2 `all_frames` increases permission surface** | Users may be concerned about extension accessing all iframes | Medium | Make iframe traversal opt-in; document clearly in extension description. |
| **Occlusion detection performance on large pages** | Could add >1s latency to page map requests | Medium | Opt-in only; cap at 200 elements by default; skip hidden/offscreen. |
| **Shadow DOM traversal breaks on framework updates** | Some frameworks change shadow DOM structure between versions | Low | Heuristic-based; degrade gracefully (report `shadowRoot: 'inaccessible'`). |
| **Snapshot memory usage with high-frequency captures** | Could consume significant memory in content script context | Medium | Default retention of 5 snapshots; automatic pruning on navigation. |
| **PII redaction false positives** | Over-zealous regex could redact legitimate content | Medium | Ship with conservative default patterns; user-configurable; log redactions to audit trail. |
| **Breaking existing agent workflows during migration** | Agents that parse exact response shapes may break | Low | Additive-only field changes; no removals; integration test suite for backward compatibility. |
| **Standalone MCP adapter lags behind Accordo adapter** | Feature parity drift between two deployment modes | Medium | Core logic in `@accordo/browser-core`; adapters are thin. Test both adapters in CI. |

---

## 16. Architectural Decisions

### ADR-B2-01: Additive-Only Response Schema Changes

**Decision:** All response schema changes are additive — new fields added, no fields removed or renamed.  
**Rationale:** Agents and automation that parse current tool outputs must not break. The MCP protocol does not version individual tool schemas.  
**Consequence:** Some field names may be suboptimal (e.g., keeping `ref` alongside new `nodeId`), but backward compatibility is more valuable.

### ADR-B2-02: In-Memory Snapshot Storage (Not Persisted)

**Decision:** Snapshots are stored in content script memory, not persisted to `chrome.storage.local` or disk.  
**Rationale:** Snapshots are large (potentially MBs per page), ephemeral by nature, and only useful for same-session diffing. Persistence would add storage pressure and GDPR concerns.  
**Consequence:** Snapshots are lost on extension reload, tab close, or page navigation. This is acceptable for the diff use case.

### ADR-B2-03: Center-Point Occlusion Heuristic

**Decision:** Occlusion detection uses a single `elementFromPoint()` call at the element's center, not a full pixel-coverage analysis.  
**Rationale:** Full coverage analysis would require N × M calls for N elements (checking multiple points each), which is O(n²) in the worst case. Center-point is O(n) and catches the most common occlusion patterns (modals, sticky headers, overlays).  
**Consequence:** Small elements partially occluded at their edges but visible at center will be incorrectly reported as visible. The opt-in `occlusionSampling: 'corners'` mode addresses this for agents that need higher accuracy.

### ADR-B2-04: Core Package Has Zero External Dependencies

**Decision:** `@accordo/browser-core` depends only on TypeScript standard library.  
**Rationale:** The core must run in Chrome extension context (no Node.js APIs), standalone Node.js server (no browser APIs), and potentially other environments. Zero dependencies ensures portability.  
**Consequence:** Any platform-specific functionality (file I/O, CDP connection, VSCode integration) must go through port interfaces implemented by adapters.

### ADR-B2-05: Iframe Traversal via Content Script Injection (Not CDP)

**Decision:** Same-origin iframe traversal uses `content_scripts` with `all_frames: true`, not Chrome DevTools Protocol.  
**Rationale:** CDP requires `chrome.debugger` permissions which trigger a visible debugging banner. Content script injection is silent and uses permissions already in the manifest (`activeTab`, `scripting`).  
**Consequence:** Cross-origin iframes remain opaque. Agents needing cross-origin iframe access must use the `chrome-devtools_*` tools which operate at the CDP level.

### ADR-B2-06: Opt-In Defaults for New Capabilities

**Decision:** Shadow DOM piercing, iframe traversal, and occlusion detection default to `false` / opt-in.  
**Rationale:** These features add latency and complexity. Agents that don't need them should not pay the cost. Defaults can be changed to `true` once the features are stable.  
**Consequence:** Agents must explicitly request enhanced visibility features. The system prompt should guide agents to use these when the page uses shadow DOM or iframes.

### ADR-B2-07: Redaction Happens in Core, Not in Adapter

**Decision:** PII redaction is applied in `@accordo/browser-core` before data reaches the adapter layer.  
**Rationale:** If redaction were in the adapter, a misconfigured or missing adapter would leak PII. Defense-in-depth: the core never emits un-redacted data if a policy is active.  
**Consequence:** The core must receive the `RedactionPolicy` at initialization time. Adapters configure the policy; the core enforces it.

### ADR-B2-08: No New Chrome Extension Permissions in P1

**Decision:** P1 (Snapshot Versioning) requires no manifest permission changes. New permissions (`all_frames`) are deferred to P2.  
**Rationale:** Chrome Web Store review is sensitive to permission changes. Keeping P1 permission-neutral enables faster iteration.  
**Consequence:** P1 is limited to top-level frame DOM only. This is acceptable since snapshot versioning and filtering are valuable even without iframe/shadow DOM support.

---

## 17. Component Diagram

```
                    ┌─────────────┐
                    │  MCP Agent  │
                    └──────┬──────┘
                           │ MCP (stdio/SSE)
                    ┌──────┴──────┐
                    │ accordo-hub │
                    │  (MCP srv)  │
                    └──────┬──────┘
                           │ BridgeAPI
                    ┌──────┴──────┐
                    │accordo-     │
                    │bridge       │
                    └──────┬──────┘
                           │ registerTools()
              ┌────────────┴────────────┐
              │                         │
       ┌──────┴──────┐          ┌───────┴───────┐
       │ accordo-    │          │  @accordo/    │
       │ browser     │          │  browser-core │  ← NEW (P2)
       │ (relay srv) │          │  (pure logic) │
       └──────┬──────┘          └───────┬───────┘
              │ WebSocket                │ DomProvider
              │ relay                    │ ScreenshotProvider
       ┌──────┴──────┐                  │ SnapshotStore
       │ Chrome ext  │◄─────────────────┘ (ports)
       │ service     │
       │ worker      │
       └──────┬──────┘
              │ chrome.tabs
       ┌──────┴──────┐
       │ content     │
       │ script      │
       │ ┌─────────┐ │
       │ │Snapshot  │ │  ← NEW (P1)
       │ │VersionMgr│ │
       │ ├─────────┤ │
       │ │PageMap   │ │  (existing)
       │ │Collector │ │
       │ ├─────────┤ │
       │ │Shadow/   │ │  ← NEW (P2)
       │ │IframeMgr │ │
       │ ├─────────┤ │
       │ │Occlusion │ │  ← NEW (P2)
       │ │Detector  │ │
       │ ├─────────┤ │
       │ │Wait      │ │  ← NEW (P3)
       │ │Provider  │ │
       │ └─────────┘ │
       └─────────────┘
              │ DOM access
       ┌──────┴──────┐
       │  Web Page   │
       └─────────────┘
```

---

## 18. Relation to Existing Architecture Sections

| Existing section | Browser 2.0 relationship |
|---|---|
| [`docs/architecture.md`](architecture.md) §14 | Browser 2.0 extends §14 tools with snapshot envelope, filtering, and diff. No §14 content is invalidated. |
| [`docs/architecture.md`](architecture.md) §15 | M95-VA annotation layer is P3 of Browser 2.0. §15 architecture is preserved; Browser 2.0 provides the infrastructure (overlay container, port interfaces) that M95-VA will use. |
| [`docs/browser-extension-architecture.md`](browser-extension-architecture.md) | Browser 2.0 adds new content script modules (SnapshotVersionMgr, ShadowIframeMgr, OcclusionDetector, WaitProvider) alongside existing PageMapCollector and ElementInspector. No existing modules are replaced. |
| [`docs/comments-architecture.md`](comments-architecture.md) | Comment Anchor v2 (§9 above) extends the existing anchor strategy with snapshot-linked confidence scoring. Existing `CommentBackendAdapter` and `EnhancedAnchorStrategy` are preserved. |
