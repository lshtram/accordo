# Session 14 Phase A Review

**Date:** 2026-03-23
**Reviewer:** project-manager (manual review)
**Phase A document:** `docs/tdd-session-14-phase-a.md`
**Modules reviewed:** M84-TOOLS, M85-PANEL, M86-MIGRATE

---

## Verdict: ✅ PASS — Proceed to Phase B

All interface elements are present and consistent. One minor note documented below — not blocking.

---

## A. Interface Completeness

| Requirement | Source | Interface Element | Status |
|---|---|---|---|
| M38-CT-01 (list with modality) | requirements-comments.md | `accordo_comment_list` + `scope.modality` | ✅ |
| M38-CT-02 (get) | requirements-comments.md | `accordo_comment_get` | ✅ |
| M38-CT-03 (create with modality) | requirements-comments.md | `accordo_comment_create` + scope + surface/browser anchors | ✅ |
| M38-CT-04 (reply) | requirements-comments.md | `accordo_comment_reply` | ✅ |
| M38-CT-05 (resolve) | requirements-comments.md | `accordo_comment_resolve` | ✅ |
| M38-CT-06 (reopen) | requirements-comments.md | `accordo_comment_reopen` (NEW) | ✅ |
| M38-CT-07 (delete with deleteScope) | requirements-comments.md | `accordo_comment_delete` + `deleteScope` | ✅ |
| M38-CT-08 (structured JSON) | requirements-comments.md | All tools return typed JSON | ✅ |
| M38-CT-09 (registerTools) | requirements-comments.md | Extension.ts uses registerTools | ✅ |
| M38-CT-10 (discover) | requirements-comments.md | ⚠️ Deferred — not blocking | Note 1 |
| M38-CT-11 (browser via unified) | requirements-comments.md | scope.modality routing | ✅ |
| M40-EXT-12 (deleteAllBrowserComments) | requirements-comments.md | `accordo.commentsPanel.deleteAllBrowserComments` | ✅ |
| M40-EXT-13 (browser in panel) | requirements-comments.md | Already supported by tree provider | ✅ |
| BR-F-132 (unified tools) | requirements-browser-extension.md | scope.modality routing | ✅ |
| BR-F-133 (browser in panel) | requirements-browser-extension.md | Already supported | ✅ |
| BR-F-134 (volatile retention) | requirements-browser-extension.md | `CommentRetention` type + auto-set | ✅ |
| BR-F-135 (bulk cleanup) | requirements-browser-extension.md | `deleteAllByModality` + panel command | ✅ |
| BR-F-136 (alias period) | requirements-browser-extension.md | Existing tools unchanged; M86 deferred | ✅ |

**All 17 testable requirements have interface coverage. M38-CT-10 deferred — acceptable.**

---

## B. Type Safety

| Check | Finding |
|---|---|
| `CommentRetention` defined as union literal | ✅ `"standard" \| "volatile-browser"` — correct |
| `scope.modality` enum complete | ✅ Covers text, markdown-preview, diagram, slide, image, pdf, browser — matches `SurfaceType` |
| `deleteScope` escape hatch | ✅ `enum: ["browser"]` restricts bulk delete to browser only; `all: true` required |
| `retention` optional on `CommentThread` | ✅ Backwards compatible with existing persisted data |
| Agent reopen restriction removed | ✅ Consistent with architecture §4 ("user or agent") |

---

## C. Architecture Coherence

| Check | Finding |
|---|---|
| `comments-architecture.md` v1.1 §10.4 (unified tool contract) | ✅ All 7 tools defined |
| `comments-architecture.md` v1.1 §10.5 (deleteScope) | ✅ `deleteScope` backed by `deleteAllByModality` |
| Panel architecture (M45) | ✅ `deleteAllBrowserComments` registered as panel command |
| Modality routing maps to store filters correctly | ✅ `scope.modality` → `anchorKind` + `surfaceType` in tool handler |
| Bridge-types: `SurfaceType` already includes "browser" | ✅ Was added in Session 13 — no gap |

---

## D. No Duplicate Abstractions

- `CommentRetention` lives in `@accordo/bridge-types` only
- `deleteAllByModality` is a single method on `CommentStore`; panel command delegates to it
- `scope.modality` handled in tool layer; store uses primitive `anchorKind` + `surfaceType` filters
- No new abstractions introduced

---

## E. Safety Assessment

**`deleteScope` design is safe:**
- Schema: `enum: ["browser"]` + `all: boolean` (must be `true`)
- UX: `accordo.commentsPanel.deleteAllBrowserComments` shows a confirmation dialog (`showWarningMessage`) before executing
- Backend: `store.deleteAllByModality("browser")` only matches `anchor.kind === "surface" && surfaceType === "browser"`
- No path exists to bulk-delete text/slide/diagram threads through this mechanism

**Agent reopen corrected:**
- Previous store implementation blocked agents: `if (author.kind === "agent") throw`
- Architecture v1.1 §4 explicitly says "user or agent" can reopen
- ✅ Corrected — `reopen()` now allows agents

---

## Notes (non-blocking)

### Note 1: M38-CT-10 (`accordo_comments_discover`) deferred
The requirements specify a discover tool that exposes schema metadata for the comment tool group. Not implemented in Phase A. The 7 tool descriptions are adequate for agent discoverability. Similar pattern to `accordo_script_discover` — can be added in a follow-up session. Not blocking for Session 14.

### Note 2: M86-MIGRATE is deferred, not implemented
The Phase A document says "No code changes to browser-tools.ts in Phase A." This means the 8 `accordo_browser_*` tools remain as-is during Session 14. The migration (deprecating and eventually removing them) is tracked as BR-F-136 but not yet started. This is consistent with the "temporary alias period" language in BR-F-136. Acceptable — Session 14 focus is on the unified tool implementation, not the cleanup of old tools.

### Note 3: `createThread` throws if no URI provided
In the `accordo_comment_create` handler, `finalUri` can be empty string if neither `uri` nor `scope.url` is provided, resulting in `throw new Error("Either uri or scope.url is required")`. This is correct behavior — the error message is clear and thrown before any mutation. No change needed.

---

## Files Reviewed

| File | Change |
|---|---|
| `packages/bridge-types/src/index.ts` | `CommentRetention` type + `retention?` on `CommentThread` |
| `packages/comments/src/comment-store.ts` | `surfaceType` filter, `retention` param, `deleteAllByModality()`, agent reopen fix |
| `packages/comments/src/comment-tools.ts` | `scope.modality` routing, `accordo_comment_reopen`, `deleteScope`, `buildAnchor` for surface/browser |
| `packages/comments/src/panel/panel-commands.ts` | `deleteAllByModality` on `PanelCommandStore` interface, `deleteAllBrowserComments` command |
| `docs/tdd-session-14-phase-a.md` | Phase A design document |

---

## Compilation Status

- `tsc --noEmit` passes for `bridge-types`, `comments`, and `browser` packages ✅
- 5 existing tests fail (all intentional schema changes) — expected, will be corrected in Phase B
- `pnpm test --filter accordo-browser`: 11/11 pass ✅
