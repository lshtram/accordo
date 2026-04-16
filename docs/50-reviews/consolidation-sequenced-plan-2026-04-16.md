# Consolidation Sequenced Execution Plan (2026-04-16)

**Author:** Architect  
**Input:** `docs/reviews/full-modularity-preconsolidation-review-2026-04-16.md`  
**Scope:** Comment Store Unification (Priority P) + Navigation Dispatch Consolidation (Priority Q/R)

---

## 1. Architect's Sign-Off on Review Findings

### Agreed — all three findings confirmed

**F1 (browser focus-thread command missing):** Confirmed. `DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD` (`accordo_browser_focusThread`) is dispatched by `navigation-router.ts:176` but no `registerCommand` exists in `packages/browser/` or `packages/browser-extension/`. The catch block shows a graceful "not connected" message, so this is a silent no-op today — not a crash, but navigation is broken for browser-surface comments.

**F2 (Marp focus command ID divergence):** Confirmed. The dotted command `accordo.presentation.internal.focusThread` (registered at `packages/marp/src/extension.ts:179`) and the underscore constant `accordo_presentation_internal_focusThread` (in `DEFERRED_COMMANDS` at `packages/capabilities/src/index.ts:61`) are different strings. The adapter path (line 83–88 in `extension.ts`) calls the dotted form and works. The deferred fallback path (line 153, 164 in `navigation-router.ts`) calls the underscore form and silently fails. This explains Priority R: user-left comments route through the deferred path, agent-left comments route through the adapter path.

**F3 (browser extension local store silo):** Confirmed. `relay-comment-handlers.ts` imports 8 direct mutation functions from `store.ts`. The `VscodeRelayAdapter` and `LocalStorageAdapter` are complete stubs. `selectAdapter()` throws. There is no path today where browser-extension comment CRUD flows through the VS Code comment store.

### One nuance added

The review's dispatch map (§5) marks `slide (adapter path)` as ✅ and `slide (fallback path)` as ❌. This is correct but understates the risk: the adapter path only works when `sharedRegistry` is populated, which requires Marp to have activated. If Marp hasn't activated yet (e.g., comments panel loads before Marp), the router falls through to the deferred path — which uses the wrong command ID. So the adapter path is conditionally correct, not unconditionally correct.

---

## 2. Move 1 — Comment Store Unification (Priority P)

### Architecture Decision

**VS Code comment store is authoritative.** The browser extension routes CRUD through the relay to VS Code's `accordo-comment-store` when connected. When disconnected (offline), the browser extension queues mutations locally and replays them on reconnect.

**Why this direction (not the reverse):**
- VS Code store already handles all non-browser surfaces (text, slide, diagram, markdown-preview). Making it authoritative means one store serves all surfaces.
- The comment MCP tools (`comment_create`, `comment_list`, etc.) already operate on the VS Code store. Agents see a single consistent view.
- The browser extension is a satellite — it may be disconnected, running in a different process, or absent entirely. Satellites should not be authoritative.

### Precondition Tasks

#### P-1: Implement `VscodeRelayAdapter` (browser-extension)

**Packages:** `packages/browser-extension/`  
**Files:** `src/adapters/comment-backend.ts`  
**Scope:** ~150 LOC implementation

Implement all 6 methods of `VscodeRelayAdapter` by forwarding each operation through `RelayBridgeClient` to the corresponding comment tool action:

| Adapter method | Relay action | VS Code tool invoked |
|---|---|---|
| `listThreads(url)` | `get_comments` | `comment_list` (filtered by scope.url) |
| `createThread(params)` | `create_comment` | `comment_create` |
| `reply(params)` | `reply_comment` | `comment_reply` |
| `resolve(threadId)` | `resolve_thread` | `comment_resolve` |
| `reopen(threadId)` | `reopen_thread` | `comment_reopen` |
| `delete(threadId, commentId?)` | `delete_comment` / `delete_thread` | `comment_delete` |

The relay actions already exist in `relay-comment-handlers.ts` — but today they write to local store. The adapter instead sends them over the relay WebSocket to VS Code.

**Key design point:** The adapter does NOT call the local store mutation functions. It sends a relay message and waits for the response. The VS Code side (in `packages/browser/src/comment-sync.ts` or a new handler) receives the relay message and calls the comment tools.

#### P-2: Implement `LocalStorageAdapter` (browser-extension)

**Packages:** `packages/browser-extension/`  
**Files:** `src/adapters/comment-backend.ts`  
**Scope:** ~100 LOC implementation

Wraps the existing `store.ts` functions (`createThread`, `addComment`, `resolveThread`, etc.) behind the `CommentBackendAdapter` interface. This is the offline fallback — same local store, but accessed through the adapter abstraction.

#### P-3: Implement `selectAdapter()` factory

**Packages:** `packages/browser-extension/`  
**Files:** `src/adapters/comment-backend.ts`  
**Scope:** ~15 LOC

```
if relay.isConnected() → return VscodeRelayAdapter(relay)
else → return LocalStorageAdapter()
```

#### P-4: Define offline queue contract

**Packages:** `packages/browser-extension/`  
**New file:** `src/adapters/offline-queue.ts`  
**Scope:** ~120 LOC (interface + implementation)

When the relay disconnects mid-session, mutations must not be lost. Define:

- `OfflineQueue` interface: `enqueue(op: QueuedMutation)`, `drain(): QueuedMutation[]`, `clear()`
- `QueuedMutation` type: `{ id: string; timestamp: string; action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'; params: Record<string, unknown> }`
- Storage: `chrome.storage.local` under key `"offline_queue"`
- Idempotency: each mutation carries a UUID; the VS Code side deduplicates by ID
- Replay order: FIFO by timestamp
- Conflict rule: if a thread was deleted on VS Code side while queued locally, the delete wins (tombstone precedence)

#### P-5: Wire relay comment handlers through adapter

**Packages:** `packages/browser-extension/`  
**Files:** `src/relay-comment-handlers.ts`, `src/sw-router.ts`  
**Scope:** ~80 LOC changed (replace direct store imports with adapter calls)

This is the critical refactor: `handleCreateComment`, `handleReplyComment`, etc. stop importing from `store.ts` directly and instead call `selectAdapter().createThread(...)`, etc.

**Order matters:** P-1 through P-3 must be done before P-5. P-4 can be done in parallel with P-1–P-3.

#### P-6: Add VS Code–side relay handler for browser comment CRUD

**Packages:** `packages/browser/`  
**Files:** `src/comment-sync.ts` (extend) or new `src/browser-comment-relay-handler.ts`  
**Scope:** ~100 LOC

Today `comment-sync.ts` does periodic polling sync. For the unified model, the VS Code side also needs to handle inbound CRUD requests from the browser extension relay (forwarded by `VscodeRelayAdapter`). Each inbound request calls the corresponding `comment_*` tool via `vscode.commands.executeCommand`.

### The Consolidation Step

Once P-1 through P-6 are complete:

1. **Online path:** Browser extension → `selectAdapter()` → `VscodeRelayAdapter` → relay WebSocket → `packages/browser/` handler → `comment_*` tools → VS Code comment store. Single source of truth.
2. **Offline path:** Browser extension → `selectAdapter()` → `LocalStorageAdapter` → `chrome.storage.local`. On reconnect, `OfflineQueue.drain()` replays mutations through `VscodeRelayAdapter`.
3. **Periodic sync becomes reconciliation only:** The existing `comment-sync.ts` polling loop shifts from "full bidirectional sync" to "reconciliation check" — it verifies local cache matches VS Code store and corrects drift, but is no longer the primary write path.

### Post-Move Validation

1. **Unit tests:** Each adapter method has tests (mock relay, mock chrome.storage)
2. **Integration test:** Create a comment via browser extension relay → verify it appears in VS Code comment store → verify `comment_list` MCP tool returns it
3. **Offline test:** Disconnect relay → create comment locally → reconnect → verify replay → verify comment appears in VS Code store
4. **Conflict test:** Create comment locally while disconnected → delete same thread on VS Code side → reconnect → verify tombstone wins
5. **Regression:** All existing `browser-extension` tests (1194) must pass; all `browser` tests (985) must pass

---

## 3. Move 2 — Navigation Dispatch Consolidation (Priority Q/R)

### Architecture Decision

**Registry-first dispatch for all non-text surfaces.** The navigation router delegates to `NavigationAdapterRegistry.get(surfaceType)` for every non-text surface. The `DEFERRED_COMMANDS` fallback path is removed entirely — if no adapter is registered, the router falls back to opening the file (generic), not to calling a surface-specific command that may not exist.

**Command ID unification:** Marp registers its focus command under the underscore form (`accordo_presentation_internal_focusThread`) to match `DEFERRED_COMMANDS`. But since we're removing the deferred path, the command ID only needs to be consistent within the adapter — the router never calls it directly.

**Browser focus handler lives in `packages/browser/`** (the VS Code extension), not in the browser extension itself. Reason: `focusThread` for browser means "tell the browser extension to scroll to / highlight the anchored element" — this is a relay message sent from VS Code to the browser extension, same as all other browser relay actions.

### Precondition Tasks

#### Q-1: Fix Marp command ID mismatch

**Packages:** `packages/marp/`, `packages/capabilities/`  
**Files:** `packages/marp/src/extension.ts:179`, `packages/capabilities/src/index.ts:61`  
**Scope:** ~5 LOC

Pick the dotted form `accordo.presentation.internal.focusThread` as canonical (it's what Marp already registers). Update `DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD` to match:

```typescript
PRESENTATION_FOCUS_THREAD: "accordo.presentation.internal.focusThread",
```

This immediately fixes Priority R — the deferred fallback path in `navigation-router.ts:153,164` will now call the correct command.

**This is the smallest, highest-value fix. Ship it first.**

#### Q-2: Implement browser focus command

**Packages:** `packages/browser/`  
**New file or extend:** `src/browser-focus.ts` or add to existing relay tool surface  
**Scope:** ~60 LOC

Register `accordo_browser_focusThread` as a VS Code command. Implementation:

1. Receive `threadId` argument
2. Look up the thread in the comment store to get the anchor (URL + anchorKey)
3. Send a relay message to the browser extension: `{ action: "focus_thread", payload: { threadId, url, anchorKey } }`
4. Browser extension content script scrolls to / highlights the anchored element

**Browser extension side:** Add a `focus_thread` action handler in `sw-router.ts` that forwards to the content script, which calls `sdk.focusThread(threadId)` (the SDK already supports `comments:focus` messages).

#### Q-3: Register browser NavigationAdapter

**Packages:** `packages/browser/`  
**Files:** `src/extension.ts` (or new `src/browser-navigation-adapter.ts`)  
**Scope:** ~40 LOC

Register a `NavigationAdapter` with `surfaceType: "browser"` in the shared `NavigationAdapterRegistry`. The adapter's `focusThread` method calls `accordo_browser_focusThread`. The adapter's `navigateToAnchor` method sends a relay `navigate` action to open the URL in the browser.

#### Q-4: Refactor navigation-router to registry-first

**Packages:** `packages/comments/`  
**Files:** `src/panel/navigation-router.ts`  
**Scope:** ~60 LOC changed (simplification — code is removed, not added)

Replace the per-surface `if` chain (lines 110–198) with:

```typescript
if (anchor.kind === "surface") {
  const adapter = registry?.get(anchor.surfaceType);
  if (adapter) {
    const navOk = await adapter.navigateToAnchor(anchor, env);
    if (navOk) {
      await adapter.focusThread(thread.id, anchor, env);
    }
    return;
  }
  // Generic fallback: open the file
  const { Uri } = await import("vscode");
  await env.showTextDocument(Uri.parse(anchor.uri), { preserveFocus: false, preview: false });
  return;
}
```

The `markdown-preview` surface also gets an adapter (it already has `CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD` — just wrap it). The `diagram` surface already works via `CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD` — wrap it too.

This means **every** surface type follows the same code path. Adding a future surface (PDF, image, etc.) requires only registering a `NavigationAdapter` — zero changes to the router.

#### Q-5: Register markdown-preview and diagram NavigationAdapters

**Packages:** `packages/md-viewer/`, `packages/diagram/`  
**Scope:** ~30 LOC each

These surfaces already have working focus commands. Wrap them in `NavigationAdapter` implementations and register them in the shared registry. This allows Q-4 to remove all surface-specific branches from the router.

### The Consolidation Step

Once Q-1 through Q-5 are complete:

1. `navigation-router.ts` is ~40 lines shorter and has zero surface-specific branches
2. Every surface (text, slide, browser, diagram, markdown-preview) navigates through the same adapter pipeline
3. `DEFERRED_COMMANDS` can be deprecated (kept for backward compat but no longer called by the router)
4. Adding a new surface = implement `NavigationAdapter` + register it. No router changes.

### Post-Move Validation

1. **Unit tests:** `navigation-router.test.ts` — test each surface type through the registry path
2. **Adapter contract tests:** Each adapter (slide, browser, diagram, preview) has a test verifying `navigateToAnchor` and `focusThread` return correct values
3. **Integration test:** Create a comment on each surface → click it in the comments panel → verify navigation occurs
4. **Regression:** Priority R scenario — user-left Marp comment → click in panel → verify presentation navigates to correct slide without dismissing
5. **Regression:** Priority Q scenario — browser-surface comment → click in panel → verify browser extension scrolls to element

---

## 4. Shared Foundation Tasks

These serve both moves and should be done early.

#### S-1: Document the surface type registry contract

**Packages:** `packages/capabilities/`  
**Files:** `src/navigation.ts` (add JSDoc) + `docs/10-architecture/architecture.md` (add §14.x)  
**Scope:** Documentation only

Document:
- What a surface type is (string identifier, stable across sessions)
- How to register a `NavigationAdapter`
- The lifecycle: register at activation, dispose at deactivation
- The contract: `navigateToAnchor` opens/focuses the surface, `focusThread` highlights the thread

#### S-2: Establish comment event contract for cross-surface notifications

**Packages:** `packages/bridge-types/`  
**Files:** `src/comment-types.ts` (extend)  
**Scope:** ~20 LOC (type definitions)

Define a `CommentMutationEvent` type that both the browser extension relay and the VS Code comment store can emit:

```typescript
interface CommentMutationEvent {
  kind: 'created' | 'replied' | 'resolved' | 'reopened' | 'deleted';
  threadId: string;
  commentId?: string;
  sourceUri: string;
  surfaceType?: string;
  timestamp: string;
}
```

This enables the offline queue (P-4) and future real-time sync to use a shared vocabulary.

---

## 5. Execution Order — Step by Step

### Phase 0 — Immediate wins (do today)
**Sequential — Q-1 must finish before Q-2 starts**

| Step | Task | Package | Files | LOC | Type |
|------|------|---------|-------|-----|------|
| 0.1 | **Q-1** — Fix Marp command ID | `capabilities` + `marp` | `packages/capabilities/src/index.ts:61`, `packages/marp/src/extension.ts:179` | ~5 | Sequential |
| 0.2 | **S-1** — Document surface type registry contract | `capabilities` | `src/navigation.ts` + `docs/10-architecture/architecture.md` | ~40 | Doc only |
| 0.3 | **S-2** — Define `CommentMutationEvent` type | `bridge-types` | `src/comment-types.ts` (extend) | ~20 | Types only |

> **Phase 0 total: ~1 hour. Q-1 is the highest-value fix in the entire plan.**

---

### Phase 1 — Move 1 foundation (weeks 1–2, parallel tracks)

**Track A — Browser extension adapter layer (P-1, P-2, P-4 run in parallel)**

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 1A.1 | **P-1** — Implement `VscodeRelayAdapter` | `browser-extension` | `src/adapters/comment-backend.ts` | ~150 | S-2 |
| 1A.2 | **P-2** — Implement `LocalStorageAdapter` | `browser-extension` | `src/adapters/comment-backend.ts` | ~100 | S-2 |
| 1A.3 | **P-4** — Implement `OfflineQueue` | `browser-extension` | `src/adapters/offline-queue.ts` (new) | ~120 | S-2 |

**Track B — VS Code side handler (P-6, independent of Track A)**

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 1B.1 | **P-6** — VS Code relay handler for browser CRUD | `browser` | `src/browser-comment-relay-handler.ts` (new) | ~100 | S-2 |

> **Phase 1: Tracks A and B run in parallel. P-1, P-2, P-4 all complete before P-3, P-5.**

---

### Phase 2 — Adapter wiring and factory (week 2, sequential)

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 2.1 | **P-3** — Implement `selectAdapter()` factory | `browser-extension` | `src/adapters/comment-backend.ts` | ~15 | P-1, P-2 |
| 2.2 | **P-5** — Wire `relay-comment-handlers.ts` through adapter | `browser-extension` | `src/relay-comment-handlers.ts`, `src/sw-router.ts` | ~80 | P-1, P-2, P-3, P-4, P-6 |

> **P-5 is the critical refactor. Handlers stop importing `store.ts` directly.**

---

### Phase 3 — Move 2 navigation (weeks 2–3, parallel then sequential)

**Track C — Browser navigation (Q-2, Q-3 run in parallel after Q-1)**

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 3C.1 | **Q-2** — Implement `accordo_browser_focusThread` command | `browser` | `src/browser-focus.ts` (new) or extend | ~60 | Q-1 |
| 3C.2 | **Q-3** — Register browser `NavigationAdapter` | `browser` | `src/extension.ts` or `src/browser-navigation-adapter.ts` (new) | ~40 | Q-2 |

**Track D — Preview and diagram adapters (Q-5, parallel with Track C)**

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 3D.1 | **Q-5** — Register `NavigationAdapter` for markdown-preview | `md-viewer` | `src/extension.ts` | ~30 | Q-1 |
| 3D.2 | **Q-5** — Register `NavigationAdapter` for diagram | `diagram` | `src/host/panel-comments-adapter.ts` or new | ~30 | Q-1 |

> **Tracks C and D run in parallel after Q-1 completes.**

---

### Phase 4 — Router consolidation (week 3, last step)

| Step | Task | Package | Files | LOC | Depends |
|------|------|---------|-------|-----|---------|
| 4.1 | **Q-4** — Refactor `navigation-router.ts` to registry-first | `comments` | `src/panel/navigation-router.ts` | ~−40 (net removal) | Q-3, Q-5 |

> **Q-4 is a simplification. All surface-specific branches are removed. The router becomes ~40 lines shorter.**

---

### Phase 0 Complete: Q-1 Detail

**Q-1 — Fix Marp Command ID Mismatch (5 LOC)**

**Problem:** Two different command IDs are in use for the same operation:
- Marp registers: `"accordo.presentation.internal.focusThread"` (dotted form, correct)
- `DEFERRED_COMMANDS` constant: `"accordo_presentation_internal_focusThread"` (underscore form, wrong)

**Result:** User-left slide comments go through the deferred fallback path (wrong ID → silent no-op). Agent-left comments go through the adapter path (correct ID → works).

**Fix:**

File 1 — `packages/capabilities/src/index.ts:61`:
```typescript
// BEFORE:
PRESENTATION_FOCUS_THREAD: "accordo_presentation_internal_focusThread",

// AFTER:
PRESENTATION_FOCUS_THREAD: "accordo.presentation.internal.focusThread",
```

File 2 — `packages/marp/src/extension.ts:179`:
```typescript
// This line is already correct — confirm it says:
vscode.commands.registerCommand("accordo.presentation.internal.focusThread", async (threadId, anchor) => {
  // ... implementation
});
```

No changes needed to `extension.ts` — it's already using the dotted form. Only the constant in `capabilities` needs updating.

**Verification after fix:**
1. Reload VS Code extension host
2. Open `browser-relay-auth.deck.md` in presentation mode
3. Create a user comment on slide 4 (as user, not agent)
4. Click the comment pin in the presentation → it should NOT dismiss the presentation

**Files to change:**
- `packages/capabilities/src/index.ts` — one string constant change (~1 LOC effective)

---

## 6. What This Enables

Once both moves are complete:

1. **Single comment store for all surfaces.** Agents see every comment (text, slide, diagram, browser, markdown-preview) through `comment_list` / `comment_get`. No more invisible browser-only comments.

2. **Comments panel navigation works for all surfaces.** Clicking any comment in the panel navigates to the correct surface and highlights the thread. No more silent failures for browser or Marp comments.

3. **New surfaces are plug-and-play.** Adding PDF comments, image comments, or any future surface requires: (a) implement `NavigationAdapter`, (b) register it. Zero changes to the router or comment store.

4. **Offline browser commenting.** Users can leave comments on browser pages while disconnected from VS Code. Comments sync when the relay reconnects.

5. **Comment-aware agent workflows across surfaces.** An agent can create a comment on a browser page, then reference it in a code review comment, and both appear in the same store with consistent IDs.

---

## 7. Assumptions Requiring User Validation

1. **Tombstone-wins conflict policy.** The plan assumes that when a thread is deleted on VS Code while queued for creation offline, the delete wins. If the user prefers "last-writer-wins" or "prompt on conflict," the offline queue design (P-4) changes.

2. **Dotted command form is canonical for Marp.** Q-1 proposes keeping `accordo.presentation.internal.focusThread` and updating the constant. If there's a project-wide preference for underscore-only internal commands, the direction reverses (update Marp registration instead).

3. **Browser focus handler in VS Code extension, not browser extension.** Q-2 places the command registration in `packages/browser/` (VS Code side). If the browser extension should handle focus independently (e.g., for standalone mode without VS Code), the architecture changes.

4. **`DEFERRED_COMMANDS` deprecated but not removed.** The plan keeps the constants for backward compatibility but stops using them in the router. If a clean break is preferred, they can be removed in Q-4.
