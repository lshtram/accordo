# Phase A — Multi-Tab tabId Routing Design

**Date:** 2026-04-01  
**Author:** Architect agent  
**Scope:** B2-CTX-002..005 — System-wide multi-tab routing for all browser tools  

---

## 1. Problem Statement

Agents can specify `tabId` on browser tool calls (e.g. `get_page_map({ tabId: 42 })`), but only a subset of tools actually route the request to the correct tab. Two tools — `capture_region` and `diff_snapshots` — silently ignore `tabId` and always operate on the active tab. This breaks multi-tab workflows where the agent inspects or captures a background tab.

---

## 2. Tool-by-Tool tabId Routing Analysis

### Legend

- **Hub Args**: Does the Hub-side TypeScript interface include `tabId?: number`?
- **Hub Passes**: Does the Hub handler include `tabId` when forwarding to the relay?
- **Ext Resolves**: Does the extension-side handler call `resolveTargetTabId(payload)` to extract and use `tabId`?

### Status Table

| Tool | Hub Args? | Hub Passes? | Ext Resolves? | Status |
|---|---|---|---|---|
| `get_page_map` | ✅ `GetPageMapArgs.tabId` | ✅ transparent pass-through | ✅ `handlePageUnderstandingAction` → `resolveTargetTabId` | ✅ **WORKING** |
| `inspect_element` | ✅ `InspectElementArgs.tabId` | ✅ transparent pass-through | ✅ same path as get_page_map | ✅ **WORKING** |
| `get_dom_excerpt` | ✅ `GetDomExcerptArgs.tabId` | ✅ transparent pass-through | ✅ same path | ✅ **WORKING** |
| `get_text_map` | ✅ `GetTextMapArgs.tabId` | ✅ transparent pass-through | ✅ same path | ✅ **WORKING** |
| `get_semantic_graph` | ✅ `GetSemanticGraphArgs.tabId` | ✅ explicit payload construction (line 288–294 of `page-tool-handlers-impl.ts`) | ✅ same path | ✅ **WORKING** |
| `wait_for` | ✅ `WaitForArgs.tabId` | ✅ transparent pass-through | ✅ `handleWaitFor` → `resolveTargetTabId` | ✅ **WORKING** |
| `capture_region` | ✅ `CaptureRegionArgs.tabId` | ✅ transparent pass-through | ❌ `resolvePaddedBounds` queries active tab; `captureVisibleTab` is active-only | ⚠️ **HUB FIXED — extension pending Phase C** |
| `diff_snapshots` | ✅ `DiffSnapshotsArgs.tabId` | ❌ `resolveFreshSnapshot` passes `{}` | ❌ no tab routing at all | ⚠️ **HUB FIXED — handler pending Phase C** |
| `navigate` | ✅ `NavigateArgs.tabId` | ✅ explicit payload construction | ✅ `handleNavigate` → own `resolveTargetTabId` | ✅ **WORKING** |
| `click` | ✅ `ClickArgs.tabId` | ✅ explicit | ✅ same | ✅ **WORKING** |
| `type` | ✅ `TypeArgs.tabId` | ✅ explicit | ✅ same | ✅ **WORKING** |
| `press_key` | ✅ `PressKeyArgs.tabId` | ✅ explicit | ✅ same | ✅ **WORKING** |
| `list_pages` | ✅ (unused) | N/A | N/A (queries all tabs) | ✅ **WORKING** |
| `select_page` | ✅ (required) | ✅ | ✅ | ✅ **WORKING** |

### Summary: 2 tools partially fixed (Hub args + MCP schema ✅, extension routing pending Phase C), 12 tools fully working.

---

## 3. Data Flow Diagram — tabId Propagation

### Working tools (get_page_map, inspect_element, etc.)

```
Agent call: get_page_map({ tabId: 42 })
  │
  ▼
Hub handler (page-tool-handlers-impl.ts)
  passes args as Record<string,unknown> → relay.request("get_page_map", { tabId: 42, ... })
  │
  ▼
Bridge relay layer → WebSocket → Extension service worker
  │
  ▼
relay-actions.ts dispatch → "get_page_map" → handlePageUnderstandingAction()
  │
  ▼
relay-page-handlers.ts:
  resolveTargetTabId(request.payload) → reads payload.tabId → returns 42
  forwardToContentScript(42, "get_page_map", payload)
  │
  ▼
chrome.tabs.sendMessage(42, { type: "PAGE_UNDERSTANDING_ACTION", ... })
  │
  ▼
Content script in tab 42 processes request ✅
```

### BROKEN: capture_region

```
Agent call: capture_region({ tabId: 42, anchorKey: "btn_1" })
  │
  ▼
Hub handler (page-tool-handlers-impl.ts)
  passes args as Record<string,unknown> → relay.request("capture_region", { tabId: 42, ... })
  BUT: CaptureRegionArgs has NO tabId field → schema validation issue
  │
  ▼
Extension service worker: handleCaptureRegion(request)
  │
  ▼
relay-type-guards.ts: toCapturePayload(request.payload)
  ❌ Does NOT extract tabId — only anchorKey, nodeRef, rect, padding, quality
  │
  ▼
relay-capture-handler.ts: executeCaptureRegion(capturePayload)
  │
  ├─► resolvePaddedBounds(payload, padding)
  │     ❌ Line 109: chrome.tabs.query({ active: true, currentWindow: true })
  │     ❌ IGNORES tabId — always sends RESOLVE_ANCHOR_BOUNDS to the active tab
  │
  ├─► captureVisibleTab(quality)
  │     ❌ Line 139: chrome.tabs.captureVisibleTab()
  │     ❌ Chrome API only captures the ACTIVE/VISIBLE tab
  │
  └─► buildCaptureSuccess() → requestContentScriptEnvelope("visual")
        ❌ Line 56: chrome.tabs.query({ active: true, currentWindow: true })
        ❌ Always gets envelope from the active tab
```

### BROKEN: diff_snapshots

```
Agent call: diff_snapshots({ tabId: 42 })
  │
  ▼
Hub handler (diff-tool.ts)
  DiffSnapshotsArgs has NO tabId field → tabId never enters the pipeline
  │
  ▼
resolveFreshSnapshot(relay):
  ❌ Line 219: relay.request("get_page_map", {}, ...) — empty payload, NO tabId
  │
  ▼
resolveFromSnapshot(relay, toSnapshotId):
  ❌ Line 259: relay.request("get_page_map", {}, ...) — empty payload, NO tabId
  │
  ▼
ALL implicit page_map captures go to the active tab regardless of intent
```

---

## 4. Root Cause Analysis — capture_region

There are **4 distinct breaks** in the capture_region pipeline:

### Break 1: Hub-side — `CaptureRegionArgs` missing `tabId`

**File:** `packages/browser/src/page-tool-types.ts`, lines 100–111  
**Issue:** `CaptureRegionArgs` interface does not have a `tabId` field.  
**Fix:** Add `tabId?: number` with B2-CTX-001 doc comment.

### Break 2: Extension-side — `CapturePayload` missing `tabId`

**File:** `packages/browser-extension/src/relay-definitions.ts`, lines 78–84  
**Issue:** `CapturePayload` type does not include `tabId`.  
**Fix:** Add `tabId?: number` to `CapturePayload`.

### Break 3: Extension-side — `toCapturePayload` doesn't extract `tabId`

**File:** `packages/browser-extension/src/relay-type-guards.ts`, lines 86–107  
**Issue:** `toCapturePayload()` validates/extracts `anchorKey`, `nodeRef`, `rect`, `padding`, `quality` but NOT `tabId`.  
**Fix:** Add `tabId: readOptionalNumber(payload, "tabId")` to the return object.

### Break 4: Extension-side — `resolvePaddedBounds` ignores `tabId`

**File:** `packages/browser-extension/src/relay-capture-handler.ts`, lines 100–135  
**Issue:** `resolvePaddedBounds()` hardcodes `chrome.tabs.query({ active: true, currentWindow: true })` on line 109 instead of using a resolved tabId.  
**Fix:** Accept `tabId: number` as a parameter and use it directly for `chrome.tabs.sendMessage(tabId, ...)`.

### Break 5: Extension-side — `requestContentScriptEnvelope` ignores `tabId`

**File:** `packages/browser-extension/src/relay-forwarder.ts`, lines 54–71  
**Issue:** `requestContentScriptEnvelope()` hardcodes active tab query on line 56 instead of accepting a tabId parameter.  
**Fix:** Add optional `tabId?: number` parameter. If provided, use it directly; otherwise fall back to active tab query.

### Break 6: Chrome API constraint — `captureVisibleTab`

**File:** `packages/browser-extension/src/relay-capture-handler.ts`, line 138–140  
**Issue:** `chrome.tabs.captureVisibleTab()` is a Chrome API that ONLY captures the currently visible tab. There is NO Chrome extension API to screenshot a background tab.  
**Decision required:** See §7 (DEC-008).

---

## 5. Root Cause Analysis — diff_snapshots

There are **2 distinct breaks** in the diff_snapshots pipeline:

### Break 1: Hub-side — `DiffSnapshotsArgs` missing `tabId`

**File:** `packages/browser/src/diff-tool.ts`, lines 30–35  
**Issue:** `DiffSnapshotsArgs` does not include `tabId`.  
**Fix:** Add `tabId?: number` with B2-CTX-001 doc comment.

### Break 2: Hub-side — `resolveFreshSnapshot` passes empty payload

**File:** `packages/browser/src/diff-tool.ts`, lines 214–235  
**Issue:** `resolveFreshSnapshot()` calls `relay.request("get_page_map", {}, ...)` — the payload is `{}`, so no tabId is forwarded even if the caller wanted to target a specific tab.  
**Fix:** Accept `tabId?: number` parameter and pass it through: `relay.request("get_page_map", tabId ? { tabId } : {}, ...)`.

### Break 3: Hub-side — `resolveFromSnapshot` passes empty payload

**File:** `packages/browser/src/diff-tool.ts`, lines 250–282  
**Issue:** Same as Break 2 — `resolveFromSnapshot()` calls `relay.request("get_page_map", {}, ...)` on line 259.  
**Fix:** Same pattern — accept and forward `tabId`.

### Note: Snapshot store pageId collision

**File:** `packages/browser-extension/src/snapshot-versioning.ts`, lines 240–246  
**Observation:** All tabs share `DEFAULT_PAGE_ID = "page"`. However, SnapshotManager runs per-content-script (each tab gets its own content script instance with its own SnapshotManager). The service-worker-side `defaultStore` (SnapshotStore in `relay-definitions.ts`, line 95) is a single shared instance. Snapshots from different tabs stored via `defaultStore.save(pageId, ...)` use the same pageId and WILL collide.  
**Scope:** This is an existing design limitation that predates multi-tab routing. The `diff_snapshots` handler on the extension side (`handleDiffSnapshots` in `relay-capture-handler.ts`, lines 277–301) retrieves snapshots by snapshotId from this store. With multi-tab captures, two different tabs could produce `page:0` and `page:1` respectively, making the second tab's snapshots overwrite/interleave with the first's.  
**Decision:** This is a **scope extension** beyond B2-CTX-002..005. The current ticket is about routing `tabId` correctly; the snapshot namespace collision is logged as a follow-up issue. For now, `diff_snapshots` with `tabId` will correctly route the implicit `get_page_map` to the right tab, but the resulting snapshots in the SW-side store may collide with snapshots from other tabs. This is acceptable for Phase 1 because the agent typically diffs snapshots within a single tab session.

---

## 6. Additional Code Smell — Duplicate `resolveTargetTabId`

Two independent implementations of `resolveTargetTabId` exist:

1. **`relay-forwarder.ts`**, line 83 — returns `number | undefined`, uses `readOptionalNumber(payload, "tabId")`
2. **`relay-control-handlers.ts`**, line 36 — returns `number`, uses `typeof payload.tabId === "number"`, falls back to `1`

**Issue:** Duplicate logic, slightly different semantics (undefined vs hardcoded 1 fallback).  
**Fix:** All handlers should import from `relay-forwarder.ts`. The control handlers' private copy should be removed and replaced with an import. The fallback-to-1 behavior in the control handler version is fragile — it should fall back to `undefined` and let the caller decide. However, changing control handler semantics is out of scope for this ticket (they work correctly). **Recommendation:** Consolidate in a follow-up refactor.

---

## 7. Architecture Decision — capture_region for non-active tabs (DEC-010)

**Context:** `chrome.tabs.captureVisibleTab()` can ONLY capture the currently visible/active tab. There is no Chrome extension API to screenshot a background tab directly.

**Decision:** Use a **tab-swap strategy** for non-active tab captures:

1. If `tabId` matches the active tab → proceed normally (no change from today).
2. If `tabId` is a non-active tab:
   a. Save the current active tab ID.
   b. Call `chrome.tabs.update(tabId, { active: true })` to temporarily activate the target tab.
   c. Wait for the tab to be fully visible (small delay or `chrome.tabs.onActivated` listener).
   d. Call `chrome.tabs.captureVisibleTab()` to capture.
   e. Call `chrome.tabs.update(savedTabId, { active: true })` to restore the previous tab.

**Alternatives considered:**

1. *CDP `Page.captureScreenshot`* — Works on any debugger-attached tab, but requires the debugger to be attached (which needs user permission grant per the control tools' permission model). The capture_region tool is a read-only understanding tool — requiring debugger attachment would be a permission escalation. ❌
2. *Return error for non-active tabs* — Simple but defeats the purpose of multi-tab capture. ❌
3. *Require the agent to call `select_page` first* — Works but creates a poor UX; the agent would visibly switch tabs which is disruptive to the user. ❌

**Consequences:**
- (+) No new permissions or APIs required.
- (+) capture_region remains a read-only tool (no debugger attachment).
- (-) Brief visual flicker as tabs swap (~50–100ms).
- (-) Race condition risk if the user manually switches tabs during capture. Mitigated by the short swap window.
- (-) If the tab to capture is in a different window, `captureVisibleTab()` requires the `windowId` parameter. Implementation must detect and handle cross-window captures.

---

## 8. Affected Files — Specific Changes

### Hub side (`packages/browser/src/`)

| File | Change |
|---|---|
| `page-tool-types.ts` | Add `tabId?: number` to `CaptureRegionArgs` (line 100) |
| `diff-tool.ts` | Add `tabId?: number` to `DiffSnapshotsArgs` (line 30); pass `tabId` in `resolveFreshSnapshot()` (line 219) and `resolveFromSnapshot()` (line 259); thread `tabId` from handler args through both functions |
| `page-tool-handlers-impl.ts` | No change needed — `capture_region` handler already passes `args as Record<string,unknown>` to relay, so once `CaptureRegionArgs` includes `tabId`, it flows through. Same for diff: the handler passes args through. |

### Extension side (`packages/browser-extension/src/`)

| File | Change |
|---|---|
| `relay-definitions.ts` | Add `tabId?: number` to `CapturePayload` (line 78) |
| `relay-type-guards.ts` | Add `tabId: readOptionalNumber(payload, "tabId")` in `toCapturePayload()` (line 100) |
| `relay-capture-handler.ts` | (1) `resolvePaddedBounds()`: accept `tabId: number` parameter, use it for `chrome.tabs.sendMessage(tabId, ...)` instead of active tab query. (2) `captureVisibleTab()`: rename to `captureTab()`, accept `tabId: number`, implement tab-swap logic for non-active tabs. (3) `executeCaptureRegion()`: resolve tabId from payload, pass to `resolvePaddedBounds` and `captureTab`. (4) `buildCaptureSuccess()` and `retryCaptureAtReducedQuality()`: pass tabId to `requestContentScriptEnvelope`. |
| `relay-forwarder.ts` | `requestContentScriptEnvelope()`: add optional `tabId?: number` parameter; if provided, use it instead of active tab query. |

---

## 9. Interface Stubs

### 9a. Hub-side stubs (already-existing files, modify interfaces only)

#### `packages/browser/src/page-tool-types.ts` — `CaptureRegionArgs`

```typescript
/** Input for browser_capture_region (M91-CR) */
export interface CaptureRegionArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;                                          // ← NEW
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
}
```

#### `packages/browser/src/diff-tool.ts` — `DiffSnapshotsArgs`

```typescript
export interface DiffSnapshotsArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;                                          // ← NEW
  fromSnapshotId?: string;
  toSnapshotId?: string;
}
```

### 9b. Extension-side stubs

#### `packages/browser-extension/src/relay-definitions.ts` — `CapturePayload`

```typescript
export interface CapturePayload {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;                                          // ← NEW
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
}
```

---

## 10. Stubs for Phase B Tests

The following test stubs should be created in Phase B. Each test references a specific requirement and verifies one behavior.

### File: `packages/browser/src/__tests__/capture-region-tabid.test.ts`

| Test | Requirement | What it verifies |
|---|---|---|
| `capture_region with tabId passes tabId through relay` | B2-CTX-001 | Hub handler includes `tabId` in relay payload |
| `capture_region without tabId omits tabId from relay` | B2-CTX-001 | Backward-compatible — no tabId → relay payload has no tabId |
| `CaptureRegionArgs accepts tabId field` | B2-CTX-001 | Type-level: `{ tabId: 42 }` satisfies `CaptureRegionArgs` |

### File: `packages/browser/src/__tests__/diff-snapshots-tabid.test.ts`

| Test | Requirement | What it verifies |
|---|---|---|
| `diff_snapshots with tabId passes tabId in resolveFreshSnapshot relay call` | B2-CTX-002 | `resolveFreshSnapshot` includes `{ tabId }` in `get_page_map` relay request |
| `diff_snapshots with tabId passes tabId in resolveFromSnapshot relay call` | B2-CTX-002 | `resolveFromSnapshot` includes `{ tabId }` in preflight relay request |
| `diff_snapshots without tabId sends empty payload (backward compat)` | B2-CTX-002 | No tabId → relay receives `{}` as before |
| `DiffSnapshotsArgs accepts tabId field` | B2-CTX-002 | Type-level: `{ tabId: 42 }` satisfies `DiffSnapshotsArgs` |

### File: `packages/browser-extension/src/__tests__/capture-tabid-routing.test.ts`

| Test | Requirement | What it verifies |
|---|---|---|
| `toCapturePayload extracts tabId from payload` | B2-CTX-003 | `toCapturePayload({ tabId: 42 })` → result has `tabId: 42` |
| `toCapturePayload omits tabId when not present` | B2-CTX-003 | `toCapturePayload({})` → result has `tabId: undefined` |
| `resolvePaddedBounds sends RESOLVE_ANCHOR_BOUNDS to specified tabId` | B2-CTX-003 | With `tabId: 42`, `chrome.tabs.sendMessage` receives `42` (not active tab query) |
| `resolvePaddedBounds falls back to active tab when no tabId` | B2-CTX-003 | Without tabId, falls back to `chrome.tabs.query` |
| `captureTab activates target tab before capture when tabId is non-active` | B2-CTX-004 | Tab swap: `chrome.tabs.update(42, { active: true })` called before `captureVisibleTab` |
| `captureTab restores previous active tab after capture` | B2-CTX-004 | After capture, `chrome.tabs.update(prevTabId, { active: true })` called |
| `captureTab skips swap when tabId is already active` | B2-CTX-004 | No `chrome.tabs.update` call when target is already active |
| `requestContentScriptEnvelope uses explicit tabId when provided` | B2-CTX-005 | `requestContentScriptEnvelope("visual", 42)` → `chrome.tabs.sendMessage(42, ...)` |
| `requestContentScriptEnvelope falls back to active tab when tabId omitted` | B2-CTX-005 | Same as current behavior — `chrome.tabs.query` |

---

## 11. Open Questions

1. **Cross-window captures:** If the target tab is in a different Chrome window, `chrome.tabs.captureVisibleTab()` requires the `windowId` parameter. Should Phase C handle this or defer to a follow-up? **Recommendation:** Handle it — query `chrome.tabs.get(tabId)` to get `windowId`, pass it to `captureVisibleTab({ windowId })`.

2. **Snapshot namespace collision:** The `defaultStore` uses `DEFAULT_PAGE_ID = "page"` for all tabs. Multi-tab diff_snapshots could produce snapshot ID collisions. This is noted in §5 and deferred to a follow-up refactor. **Recommendation:** Accept for Phase 1; the agent typically diffs within a single tab.

3. **Duplicate `resolveTargetTabId`:** Two copies exist (relay-forwarder.ts and relay-control-handlers.ts). Should Phase C consolidate? **Recommendation:** Defer to a follow-up refactor — the control handlers work correctly and changing them risks regression.

---

## 12. Two-Audience Explanation

### For Non-Technical Stakeholders

**What problem does this solve?**  
When our AI agent works with multiple browser tabs — for example, comparing a staging site with production — some tools (screenshot capture and page comparison) always look at whichever tab the user currently has open, ignoring the agent's request to look at a specific tab. This means the agent gets wrong screenshots and wrong comparison data.

**What does this change do?**  
We're adding "tab targeting" to the two tools that were missing it. After this change, when the agent says "take a screenshot of tab #42", the system will actually screenshot tab #42, even if the user is looking at a different tab. For screenshot capture specifically, the system will briefly switch to the requested tab, take the screenshot, and switch back — a ~50ms flicker.

**What can go wrong?**  
The brief tab switch during screenshot capture could be mildly distracting. If the user switches tabs at the exact moment of capture, the wrong tab might get captured — but this is a very narrow race window.

**How do we know it works?**  
We'll write specific tests that verify: (1) the tab ID makes it all the way from the agent's request to the Chrome extension, (2) Chrome receives the correct tab ID for each operation, and (3) the system falls back to the active tab when no specific tab is requested (backward compatibility).

### For Technical Team

**Key design decisions:**

1. **Tab-swap strategy for `captureVisibleTab`** (DEC-010): We use `chrome.tabs.update()` to temporarily activate the target tab, capture, then restore. We rejected CDP `Page.captureScreenshot` because it requires debugger attachment — a permission escalation for a read-only tool.

2. **Minimal surface area:** Only 2 tools need fixing (`capture_region` and `diff_snapshots`). The other 12 already route correctly. The fix touches 6 files total (2 Hub, 4 extension).

3. **Deferred scope:** Snapshot namespace collision (`DEFAULT_PAGE_ID = "page"` shared across tabs) is a known pre-existing issue that doesn't block this work. Duplicate `resolveTargetTabId` is a code smell but not a bug.

**How it connects to the system:**  
The `tabId` flows through 4 layers: Hub args → relay payload → extension service worker → `chrome.tabs.sendMessage(tabId, ...)` or `chrome.tabs.update(tabId, ...)`. The extension's `resolveTargetTabId()` in `relay-forwarder.ts` is the canonical resolution point — it reads `tabId` from payload or falls back to active tab. We're extending this pattern to the capture and diff paths that were bypassing it.

**Requirements gaps found and resolved:**  
None — B2-CTX-001 already specifies that all tools should accept `tabId`. The gap was in implementation, not requirements. The only new decision is the tab-swap strategy for `captureVisibleTab`, which is documented as DEC-010.

---

## 13. Clarifications Added Post-Review

### 13a. `diff_snapshots` relay payload — tabId forwarding scope

When `tabId` is present in `DiffSnapshotsArgs`, it is forwarded to the relay **only for implicit snapshot capture** paths:
- `resolveFreshSnapshot()` — captures a fresh `get_page_map` snapshot. When `tabId` is provided, it MUST be included in the relay payload: `relay.request("get_page_map", { tabId }, ...)` so the snapshot is captured from the correct tab.
- `resolveFromSnapshot()` — performs a preflight `get_page_map` to verify relay accessibility. Same rule: include `tabId` in the preflight payload.

The **explicit snapshot ID path** (when both `fromSnapshotId` and `toSnapshotId` are provided by the agent) does **NOT** need `tabId` in the relay's `diff_snapshots` payload. The service-worker-side handler retrieves snapshots from the `SnapshotStore` by snapshotId alone — tab identity is already baked into the stored snapshot data.

### 13b. `retryCaptureAtReducedQuality()` — known tabId limitation

`retryCaptureAtReducedQuality()` in `relay-capture-handler.ts` calls `requestContentScriptEnvelope()` which currently hardcodes the active tab (via `chrome.tabs.query({ active: true, currentWindow: true })`). This is a **known limitation** of the retry path: it uses the originally targeted tab passed via closure context, not an explicit `tabId` parameter. This is acceptable because:
1. The retry path only triggers when the initial capture succeeds but the image exceeds the size limit.
2. At the point of retry, the tab-swap (if any) is still active — the target tab IS the active tab.
3. After the full capture flow completes (including retry), the tab is swapped back.

No structural change is needed. The retry path inherently operates on the currently-active tab, which is correct because the tab-swap strategy ensures the target tab is active during the entire capture sequence.
