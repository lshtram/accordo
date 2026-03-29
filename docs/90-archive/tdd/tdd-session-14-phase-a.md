# Session 14 — Phase A: Unified Comments Contract

**Date:** 2026-03-23
**Status:** Phase A complete — awaiting review checkpoint
**Modules:** M84-TOOLS, M85-PANEL, M86-MIGRATE
**Architecture ref:** `docs/comments-architecture.md` v1.1
**Requirements refs:** `docs/requirements-comments.md` M38/M40 updates; `docs/requirements-browser-extension.md` §3.13

---

## 1. Summary

Session 14 unifies browser comments with the existing `accordo_comment_*` tool contract, registers browser threads in the shared Accordo Comments Panel, and provides a bulk browser cleanup action. The goal is to eliminate the separate `accordo_browser_*` public tool namespace and give agents a single, modality-scoped comment API.

**Three modules:**

| Module | Package | Purpose |
|---|---|---|
| M84-TOOLS | `packages/comments` | Extend the unified 7-tool contract with `scope.modality`, `accordo_comment_reopen`, and `deleteScope` |
| M85-PANEL | `packages/comments` | Browser threads appear in shared panel; add `deleteAllBrowserComments` command |
| M86-MIGRATE | `packages/browser` | Temporary `accordo_browser_*` aliases (existing); remove after parity validated |

---

## 2. Design Questions & Answers

### Q1: Modality filtering strategy

**How does `scope.modality` map to the internal data model?**

`scope.modality` is a tool-level routing directive. The mapping to internal store fields:

| Modality value | Store filter |
|---|---|
| `"text"` | `anchorKind: "text"` |
| `"browser"` | `anchorKind: "surface"` + `surfaceType: "browser"` |
| `"diagram"` | `anchorKind: "surface"` + `surfaceType: "diagram"` |
| `"slide"` | `anchorKind: "surface"` + `surfaceType: "slide"` |
| `"markdown-preview"` | `anchorKind: "surface"` + `surfaceType: "markdown-preview"` |
| `"image"` | `anchorKind: "surface"` + `surfaceType: "image"` |
| `"pdf"` | `anchorKind: "surface"` + `surfaceType: "pdf"` |

The `list` and `create` tools accept `scope.modality`. The `get`, `reply`, `resolve`, `reopen`, and `delete` tools operate on `threadId` which is already modality-agnostic.

### Q2: Browser thread ingestion path

**How do browser comments get into the shared CommentStore?**

Browser comments originate in the Chrome extension and flow to Accordo via the relay in `packages/browser`. Two integration paths exist:

1. **Through unified tools:** Agent calls `accordo_comment_create` with `scope.modality = "browser"`. The comment is created directly in `CommentStore` with a surface anchor (`surfaceType: "browser"`). The relay forwards the operation to Chrome for live UI update.

2. **Through relay ingestion:** The relay mirrors Chrome-origin comments into `CommentStore` when the Chrome extension connects or pushes changes. This handles comments created directly in the browser UI (not through MCP tools).

For Session 14, path (1) is the primary design — unified tools create threads directly in CommentStore. Path (2) (relay mirroring) is a future enhancement that requires the browser relay to call `CommentStore` via the `SurfaceCommentAdapter` internal command. This is NOT blocked — the adapter already exists (M40-EXT-11).

### Q3: Reopen permission model

**Who can reopen a resolved thread?**

Architecture v1.1 §4 state machine: **"user or agent" can reopen**. The previous implementation restricted reopen to users only (`if (author.kind === "agent") throw new Error("Agents cannot reopen threads")`). This was inconsistent with the architecture and has been corrected.

### Q4: deleteScope backend

**How does bulk browser deletion work?**

`CommentStore.deleteAllByModality(surfaceType: string)` iterates all threads, selects those where `anchor.kind === "surface" && surfaceType matches`, deletes them, persists, and emits `onChanged` for each affected URI. Returns the count of deleted threads.

The MCP tool uses `deleteScope: { modality: "browser", all: true }` in the `accordo_comment_delete` schema. The `all: true` guard prevents accidental bulk deletion.

### Q5: Alias delegation strategy (M86-MIGRATE)

**How do browser-specific tools transition to unified tools?**

The existing `accordo_browser_*` tools (8 tools in `packages/browser/src/browser-tools.ts`) continue to work via the relay during the migration period. They are not yet deprecated in Session 14 Phase A — they remain fully functional.

The migration plan:
1. Session 14: Unified tools gain browser routing. Both tool sets work in parallel.
2. Post-parity validation: Mark `accordo_browser_*` descriptions as deprecated.
3. Future session: Remove `accordo_browser_*` tools entirely (BR-F-136).

No code changes to `browser-tools.ts` are needed in Phase A. The browser tools delegate through the relay (which talks to Chrome extension). The unified tools route through CommentStore directly. Both paths are valid simultaneously.

### Q6: Panel browser thread display

**How do browser threads appear in the Comments Panel?**

The panel infrastructure already supports browser threads:
- `CommentsTreeProvider.getFileTypeIcon()` already maps `browser` → globe icon
- `panel-filters.ts` already includes `"browser"` in the valid `surfaceType` set
- No tree provider code changes needed — browser threads appear automatically once they exist in `CommentStore`

The new addition is `accordo.commentsPanel.deleteAllBrowserComments` — a panel command that calls `store.deleteAllByModality("browser")` after confirmation.

---

## 3. Interface Changes

### 3.1 bridge-types additions

```typescript
// NEW: Retention policy type
export type CommentRetention = "standard" | "volatile-browser";

// UPDATED: CommentThread — added optional retention field
export interface CommentThread {
  // ...existing fields...
  retention?: CommentRetention;  // Optional for backwards compat
}
```

### 3.2 comment-store.ts changes

```typescript
// UPDATED: ListThreadsOptions — added surfaceType filter
export interface ListThreadsOptions {
  // ...existing fields...
  surfaceType?: string;  // Filter by surface type (e.g. "browser")
}

// UPDATED: CreateCommentParams — added retention
export interface CreateCommentParams {
  // ...existing fields...
  retention?: CommentRetention;  // Defaults to "standard"
}

// NEW: Bulk delete method
async deleteAllByModality(surfaceType: string): Promise<number>;

// UPDATED: reopen() — removed agent restriction
async reopen(threadId: string, author: CommentAuthor): Promise<void>;
```

### 3.3 comment-tools.ts changes

7 tools (was 6 — added `accordo_comment_reopen`):

| Tool | Schema Changes |
|---|---|
| `accordo_comment_list` | Added `scope.modality` input for modality filtering |
| `accordo_comment_get` | No changes |
| `accordo_comment_create` | Added `scope.modality`; `uri` no longer required (can use `scope.url`); `anchor.kind` supports `"surface"` and `"browser"`; retention auto-set from modality |
| `accordo_comment_reply` | No changes |
| `accordo_comment_resolve` | No changes |
| `accordo_comment_reopen` | **NEW** — reopen a resolved thread (M38-CT-06) |
| `accordo_comment_delete` | Added `deleteScope` for bulk browser cleanup; `threadId` no longer always required |

### 3.4 panel-commands.ts changes

```typescript
// UPDATED: PanelCommandStore interface — added deleteAllByModality
export interface PanelCommandStore {
  // ...existing methods...
  deleteAllByModality(surfaceType: string): Promise<number>;
}

// NEW: Command registered
"accordo.commentsPanel.deleteAllBrowserComments"
```

---

## 4. Requirement Traceability

| Requirement ID | Source | Interface Element | Status |
|---|---|---|---|
| M38-CT-01 | requirements-comments.md | `accordo_comment_list` + `scope.modality` | ✅ Stub updated |
| M38-CT-02 | requirements-comments.md | `accordo_comment_get` | ✅ Unchanged |
| M38-CT-03 | requirements-comments.md | `accordo_comment_create` + `scope.modality` + surface/browser anchors | ✅ Stub updated |
| M38-CT-04 | requirements-comments.md | `accordo_comment_reply` | ✅ Unchanged |
| M38-CT-05 | requirements-comments.md | `accordo_comment_resolve` | ✅ Unchanged |
| M38-CT-06 | requirements-comments.md | `accordo_comment_reopen` (NEW) | ✅ Stub added |
| M38-CT-07 | requirements-comments.md | `accordo_comment_delete` + `deleteScope` | ✅ Stub updated |
| M38-CT-08 | requirements-comments.md | Structured JSON return on all tools | ✅ In existing stubs |
| M38-CT-09 | requirements-comments.md | Registered via `bridge.registerTools` | ✅ In existing extension.ts |
| M38-CT-10 | requirements-comments.md | `accordo_comments_discover` | ⚠️ Deferred — discover tool not yet added |
| M38-CT-11 | requirements-comments.md | Browser reachable through unified tools | ✅ scope.modality routing |
| M40-EXT-12 | requirements-comments.md | `deleteAllBrowserComments` panel command | ✅ Stub added |
| M40-EXT-13 | requirements-comments.md | Browser threads in panel | ✅ Already supported (tree provider + filters) |
| BR-F-132 | requirements-browser-extension.md | Unified tools with scope.modality | ✅ Stub updated |
| BR-F-133 | requirements-browser-extension.md | Browser comments in panel | ✅ Already supported |
| BR-F-134 | requirements-browser-extension.md | Volatile retention class | ✅ `CommentRetention` type + auto-set |
| BR-F-135 | requirements-browser-extension.md | Bulk browser cleanup | ✅ `deleteAllByModality` + panel command |
| BR-F-136 | requirements-browser-extension.md | Temporary alias period | ✅ Existing browser tools unchanged |

### Gap: M38-CT-10 (accordo_comments_discover)

The requirements specify an `accordo_comments_discover` tool that exposes schemas/metadata for the comments tool group. This tool does not yet exist. It is similar in concept to `accordo_script_discover` — a self-documentation tool that helps agents understand available comment operations.

**Decision:** Defer `accordo_comments_discover` to a follow-up session. The 7 tools have adequate `description` fields for agent discoverability. The `discover` tool is a quality-of-life addition, not a blocking requirement for Session 14.

---

## 5. Expected Test Failures

After stub updates, `pnpm test` in `packages/comments` shows **6 expected failures** (267 pass, 6 fail):

| Test | Old Expectation | New Reality | Why |
|---|---|---|---|
| "returns exactly 6 tools" (×2) | Tool count = 6 | Tool count = 7 | Added `accordo_comment_reopen` |
| "all tools have descriptions ≤ 120 chars" | All ≤ 120 | `create` was 277 chars | **Fixed** — shortened to 108 chars |
| "inputSchema requires uri, anchor, body" | Required: `[uri, anchor, body]` | Required: `[body]` | `uri` from scope; anchor has defaults |
| "inputSchema requires threadId" (delete) | Required: `[threadId]` | Required: `[]` | Can use `deleteScope` instead |
| "throws when agent tries to reopen" | Agent reopen throws | Agent reopen succeeds | Architecture §4: "user or agent" can reopen |

All are **intentional schema changes** aligned with Session 14 requirements. Tests will be updated in Phase B.

**Browser package:** 11/11 pass — no changes to browser package.

---

## 6. Coherence Verification

### 6.1 Architecture alignment

| Check | Result |
|---|---|
| `comments-architecture.md` v1.1 defines `CommentRetention` | ✅ Matches `bridge-types` addition |
| Architecture §4 says "user or agent" can reopen | ✅ Store updated to match |
| Architecture §6 defines 7-tool contract | ✅ `comment-tools.ts` now has 7 tools |
| Architecture §10.5 defines `deleteScope` | ✅ Delete tool updated |
| No new components or boundaries introduced | ✅ All changes within existing packages |

### 6.2 Cross-requirements consistency

| Check | Result |
|---|---|
| `requirements-comments.md` M38-CT-06 (reopen tool) | ✅ Implemented |
| `requirements-comments.md` M38-CT-07 (deleteScope) | ✅ Implemented |
| `requirements-comments.md` M40-EXT-12 (panel command) | ✅ Implemented |
| `requirements-browser-extension.md` BR-F-132..136 | ✅ All traceable |
| `workplan.md` Session 14 entry | ✅ Reflects M84/M85/M86 |

### 6.3 No duplicate abstractions

- `CommentRetention` lives solely in `@accordo/bridge-types` — no duplicate.
- `deleteAllByModality` is a single method on `CommentStore` — panel command delegates to it.
- `scope.modality` is handled in the tool layer only — store layer uses primitive filters (`anchorKind`, `surfaceType`).

---

## 7. Files Modified

| File | Change |
|---|---|
| `packages/bridge-types/src/index.ts` | Added `CommentRetention` type; added `retention?: CommentRetention` to `CommentThread` |
| `packages/comments/src/comment-store.ts` | Added `surfaceType` to `ListThreadsOptions`; added `retention` to `CreateCommentParams`; added `deleteAllByModality()`; fixed `reopen()` to allow agents |
| `packages/comments/src/comment-tools.ts` | Added `scope.modality` to list/create; added `accordo_comment_reopen` tool; added `deleteScope` to delete; expanded `buildAnchor()` for surface/browser |
| `packages/comments/src/panel/panel-commands.ts` | Added `deleteAllByModality` to `PanelCommandStore` interface; added `deleteAllBrowserComments` command |

### Compilation status

- `tsc --noEmit` passes for `bridge-types`, `comments`, and `browser` packages ✅
- No import errors in any package ✅

---

## 8. Two-Audience Explanation

### 8A. For the Product Manager / Non-Technical Stakeholder

**What problem does this solve?**

Right now, if an agent wants to work with browser comments (comments pinned to web pages), it has to use a separate set of tools (`accordo_browser_*`) from the tools it uses for code comments (`accordo_comment_*`). This is confusing — the agent has to know which tool family to use depending on where the comment lives. Worse, browser comments don't show up in the main Comments Panel alongside code and diagram comments.

**What does it do?**

Session 14 makes all comments work through one unified set of tools. The agent just says "I want to work with browser comments" by adding `scope.modality = "browser"` to the same tool it already uses for code comments. Browser comments now appear in the shared Comments Panel (with a globe icon), and there's a "Delete All Browser Comments" button for easy cleanup since browser page comments tend to become stale quickly.

**What can go wrong?**

- If the browser relay is not connected, browser-scoped create operations through unified tools won't reach the Chrome extension (comments still get stored locally in the CommentStore but won't appear on the web page). This is expected and not a regression.
- During migration, both the old `accordo_browser_*` tools and the new unified tools work simultaneously. Agents could accidentally create duplicate comments by using both paths. This risk is mitigated by deprecating the old tools and eventually removing them.

**How will we know it works?**

- Agent can list browser comments using `accordo_comment_list` with `scope.modality = "browser"`
- Agent can create, reply, resolve, reopen, and delete browser comments through unified tools
- Browser comments appear in the Comments Panel with a globe icon
- "Delete All Browser Comments" removes all browser threads after confirmation
- All existing text/diagram/slide comment workflows continue to work unchanged

### 8B. For the Technical Reviewer

**Key design decisions:**

1. **Scope-based routing over separate tool families.** Rather than maintaining parallel `accordo_browser_*` and `accordo_comment_*` tools, we use a `scope.modality` discriminator on the unified tools. This keeps the MCP tool surface small (7 tools vs 15+) and avoids schema drift between parallel APIs.

2. **Modality maps to anchor + surfaceType, not a new data model.** Browser comments use `CommentAnchor.kind = "surface"` with `surfaceType = "browser"` — the same mechanism diagrams and slides use. No new anchor kind was invented. The tool layer translates `scope.modality` into the existing filter primitives.

3. **Retention as an optional field for backwards compatibility.** `CommentRetention` was added as an optional field on `CommentThread` so existing persisted data (without `retention`) deserializes correctly. Missing retention is treated as `"standard"`.

4. **Agent reopen unblocked.** Architecture v1.1 §4 explicitly states "user or agent" can reopen. The store had an inconsistent guard. Fixed.

5. **Browser anchor kind = "browser" is sugar for surface anchor.** In the tool schema, `anchor.kind = "browser"` is accepted for ergonomics. `buildAnchor()` translates it to `{ kind: "surface", surfaceType: "browser", coordinates: { type: "normalized", x, y } }`. This keeps the data model clean while making the MCP API intuitive for agents.

**How it connects to the system:**

```
Agent → MCP → Hub → Bridge → accordo_comment_create(scope.modality="browser")
                                       │
                                       ▼
                              CommentStore.createThread(
                                anchor: { kind: "surface", surfaceType: "browser", ... },
                                retention: "volatile-browser"
                              )
                                       │
                                       ▼
                              CommentsTreeProvider (panel) → globe icon
                              NativeComments → surface widget
                              StateContribution → Hub prompt
```

**Requirements gaps found and resolved:**

- **M38-CT-10 (accordo_comments_discover):** Deferred — not blocking for Session 14 core functionality. The 7 tools have adequate descriptions.
- **Agent reopen restriction:** Was inconsistent with architecture. Fixed by removing the `if (author.kind === "agent")` guard in `comment-store.ts`.
- **No `retention` in bridge-types:** Was missing despite being defined in architecture v1.1 §3.3. Added as optional field.
