# Page Understanding — Phase Plan

**Status:** Phase A complete — stubs + interfaces + architecture delivered  
**Date:** 2026-03-26  
**Design doc:** [`page-understanding-architecture.md`](page-understanding-architecture.md)  
**Requirements:** [`requirements-browser-extension.md`](../requirements-browser-extension.md) §3.15, §4.7

---

## 1. Module Execution Order

Page understanding spans two packages: `packages/browser-extension` (content script logic) and `packages/browser` (MCP tool registration + relay forwarding). The recommended TDD execution order minimizes forward dependencies.

### Batch 1 — Content Script Foundations (browser-extension)

| Module | File | Deps | Phase A Status |
|---|---|---|---|
| M90-ANC | `src/content/enhanced-anchor.ts` | content-anchor.ts | ✅ Stubs complete |
| M90-MAP | `src/content/page-map-collector.ts` | DOM APIs | ✅ Stubs complete |
| M90-INS | `src/content/element-inspector.ts` | M90-ANC, M90-MAP (getElementByRef) | ✅ Stubs complete |

**Rationale:** These are pure DOM functions with no relay/WebSocket dependency. They can be tested with jsdom or happy-dom mocks. M90-ANC comes first because M90-INS needs `generateAnchorKey()`.

### Batch 2 — Relay + Adapter Integration (browser-extension)

| Module | File | Deps | Phase A Status |
|---|---|---|---|
| M90-ACT | `src/relay-actions.ts` (extend) | M90-MAP, M90-INS, M90-ANC | ✅ Action stubs added |
| M90-ADP | `src/adapters/comment-backend.ts` | relay-bridge.ts, store.ts | ✅ Stubs complete |

**Rationale:** M90-ACT wires content script functions into the relay dispatch. M90-ADP abstracts the comment backend. Both depend on Batch 1 being implemented.

### Batch 3 — MCP Tool Registration (browser)

| Module | File | Deps | Phase A Status |
|---|---|---|---|
| M91-PU | `src/page-understanding-tools.ts` | relay, BridgeAPI types | ✅ Stubs complete |
| M91-EXT | `src/extension.ts` (modify) | M91-PU | ⏳ No code changes yet (Phase C) |

**Rationale:** MCP tool registration depends on the relay actions being wirable. M91-EXT is the final wiring step — it registers the tools with Bridge and connects them to the relay.

---

## 2. Phase B — Test Specifications

For each module, the test file and key test areas:

### M90-ANC — Enhanced Anchor Tests

**File:** `packages/browser-extension/src/__tests__/enhanced-anchor.test.ts`

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `generateAnchorKey()` — element with id | PU-F-20 | Returns `id:xxx`, strategy `"id"`, confidence `"high"` |
| `generateAnchorKey()` — element with data-testid | PU-F-20 | Returns `data-testid:xxx`, strategy `"data-testid"`, confidence `"high"` |
| `generateAnchorKey()` — element with aria-label + role | PU-F-20 | Returns `aria:label/role`, strategy `"aria"`, confidence `"medium"` |
| `generateAnchorKey()` — fallback to css-path | PU-F-20 | Returns `css:path`, strategy `"css-path"`, confidence `"medium"` |
| `generateAnchorKey()` — fallback to tag-sibling | PU-F-20 | Returns `tag:...`, strategy `"tag-sibling"`, confidence `"low"` |
| `resolveAnchorKey()` — id strategy | PU-F-23 | Uses `getElementById()` |
| `resolveAnchorKey()` — data-testid strategy | PU-F-24 | Uses `querySelector('[data-testid="..."]')` |
| `resolveAnchorKey()` — fallback hierarchy | PU-F-25 | Falls back when primary strategy fails |
| `resolveAnchorKey()` — backward compatibility | PU-F-26 | Unprefixed keys go through `findAnchorElementByKey()` |
| `parseEnhancedAnchorKey()` — parse all formats | PU-F-21 | Correctly parses all strategy prefixes |
| `isEnhancedAnchorKey()` — detection | PU-F-22 | Returns true for prefixed, false for legacy |

### M90-MAP — Page Map Collector Tests

**File:** `packages/browser-extension/src/__tests__/page-map-collector.test.ts`

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `collectPageMap()` — basic tree | PU-F-01 | Returns PageMapResult with nodes |
| `collectPageMap()` — respects maxDepth | PU-F-02 | Tree truncated at depth limit |
| `collectPageMap()` — respects maxNodes | PU-F-03 | Node count capped |
| `collectPageMap()` — excludes hidden elements | PU-F-04 | Script, style, hidden elements excluded |
| `collectPageMap()` — viewportOnly filter | PU-F-05 | Only viewport-visible elements included |
| `collectPageMap()` — includeBounds option | PU-F-06 | Bounding boxes present when requested |
| Ref index — `getElementByRef()` | PU-F-01 | Ref maps to DOM element after collection |
| Constants — EXCLUDED_TAGS | - | Correct tags excluded |
| Edge case — empty page | - | Returns empty nodes array |

### M90-INS — Element Inspector Tests

**File:** `packages/browser-extension/src/__tests__/element-inspector.test.ts`

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `inspectElement()` — by ref | PU-F-10 | Finds element via ref index |
| `inspectElement()` — by selector | PU-F-11 | Finds element via CSS selector |
| `inspectElement()` — element not found | PU-F-12 | Returns `{ found: false }` |
| `inspectElement()` — anchor generation | PU-F-13 | Returns anchorKey + strategy + confidence |
| `inspectElement()` — context (parent chain, siblings) | PU-F-14 | Correct parent chain and sibling info |
| `inspectElement()` — all attributes | PU-F-15 | Full attribute map returned |
| `getDomExcerpt()` — sanitized HTML | PU-F-30 | Only safe attributes retained |
| `getDomExcerpt()` — maxDepth | PU-F-31 | Excerpt truncated at depth |
| `getDomExcerpt()` — maxLength | PU-F-31 | HTML truncated at char limit |
| `getDomExcerpt()` — text content | PU-F-32 | Text field populated |
| `getDomExcerpt()` — not found | PU-F-33 | Returns `{ found: false }` |

### M90-ACT — Relay Action Tests

**File:** `packages/browser-extension/src/__tests__/relay-actions.test.ts` (extend existing)

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `handleRelayAction("get_page_map")` | PU-F-30 | Invokes collectPageMap via content script |
| `handleRelayAction("inspect_element")` | PU-F-31 | Invokes inspectElement via content script |
| `handleRelayAction("get_dom_excerpt")` | PU-F-32 | Invokes getDomExcerpt via content script |

### M90-ADP — Adapter Tests

**File:** `packages/browser-extension/src/__tests__/comment-backend.test.ts`

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `VscodeRelayAdapter.listThreads()` | PU-F-41 | Calls `relay.send("get_comments", ...)` |
| `VscodeRelayAdapter.createThread()` | PU-F-41 | Calls `relay.send("create_comment", ...)` |
| `VscodeRelayAdapter.isConnected()` | PU-F-41 | Delegates to `relay.isConnected()` |
| `LocalStorageAdapter.listThreads()` | PU-F-42 | Reads from chrome.storage.local |
| `LocalStorageAdapter.createThread()` | PU-F-42 | Writes to chrome.storage.local |
| `selectAdapter()` — relay connected | PU-F-43 | Returns VscodeRelayAdapter |
| `selectAdapter()` — relay disconnected | PU-F-43 | Returns LocalStorageAdapter |

### M91-PU — Page Understanding MCP Tool Tests

**File:** `packages/browser/src/__tests__/page-understanding-tools.test.ts`

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `buildPageUnderstandingTools()` | PU-F-50..52 | Returns 3 tool definitions |
| Tool names | PU-F-50..52 | `browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt` |
| `handleGetPageMap()` — relay connected | PU-F-53 | Forwards to relay and returns result |
| `handleGetPageMap()` — relay disconnected | PU-F-54 | Returns `{ error: "browser-not-connected" }` |
| `handleGetPageMap()` — relay timeout | PU-F-55 | Returns `{ error: "timeout" }` |
| `handleInspectElement()` — relay connected | PU-F-53 | Forwards to relay and returns result |
| `handleGetDomExcerpt()` — relay connected | PU-F-53 | Forwards to relay and returns result |

### M91-EXT — Extension Wiring Tests

**File:** `packages/browser/src/__tests__/extension.test.ts` (extend existing)

| Test Area | Req IDs | Key Assertions |
|---|---|---|
| `activate()` — registers page understanding tools | PU-F-56 | `bridge.registerTools()` called with 3 new tools |
| Page understanding relay actions bypass `browserActionToUnifiedTool` | PU-F-56 | Actions not routed through `comment_*` tools |
| Enhanced anchor keys accepted by comment_create | PU-F-57 | `anchorKey: "id:submit-btn"` passes through to CommentStore |

---

## 3. Phase C — Implementation Notes

### Key implementation considerations:

1. **DOM environment in tests:** Content script modules (M90-MAP, M90-INS, M90-ANC) need a DOM environment. Use `happy-dom` or `jsdom` via vitest `environment: "happy-dom"` config. The browser-extension package already has vitest configured.

2. **Ref index lifecycle:** The `refIndex` map in `page-map-collector.ts` is cleared and rebuilt on each `collectPageMap()` call. The ref format should be `ref-${counter}` (monotonically increasing, reset on each call). Refs are ephemeral — they are only valid until the next `collectPageMap()` call.

3. **CSS selector generation:** For the `css-path` anchor strategy, generate a chain of `tagName:nth-child(n)` selectors from the target element to the nearest ancestor with an `id` attribute (or `document.body` as root). Keep the selector as short as possible while remaining unique.

4. **Relay action dispatch to content script:** The `get_page_map`, `inspect_element`, and `get_dom_excerpt` relay actions in the service worker need to forward to the active tab's content script. Use `chrome.tabs.sendMessage()` with the active tab ID. The content script already listens for messages via `chrome.runtime.onMessage`.

5. **MCP tool registration pattern:** Follow the existing pattern in `packages/browser/src/browser-tools.ts` and `packages/browser/src/extension.ts`. The tools are registered via `bridge.registerTools(EXTENSION_ID, tools)` and return structured JSON.

6. **Backward compatibility:** The `resolveAnchorKey()` function must detect whether a key uses the enhanced format (strategy-prefixed) and dispatch accordingly. Unprefixed keys should route through the existing `findAnchorElementByKey()` path.

---

## 4. Estimated Test Count

| Module | Est. Tests |
|---|---|
| M90-ANC | ~15 |
| M90-MAP | ~12 |
| M90-INS | ~14 |
| M90-ACT | ~6 |
| M90-ADP | ~10 |
| M91-PU | ~10 |
| M91-EXT | ~4 |
| **Total** | **~71** |

---

## 5. Risk Items for Phase B/C

1. **happy-dom limitations:** Some DOM APIs (`getBoundingClientRect`, `getComputedStyle`) may not be fully supported in happy-dom. May need custom mocks for bounding box tests.

2. **Content script message forwarding:** The relay action stubs (M90-ACT) throw "not implemented" because the actual Chrome message passing (`chrome.tabs.sendMessage`) requires integration testing. In unit tests, mock the content script call path.

3. **Enhanced anchor backward compatibility:** Must verify that existing tests covering `findAnchorElementByKey()` continue to pass when the new strategy-aware dispatch is added.
