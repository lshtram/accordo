# Accordo IDE — Phase 2 Workplan

**Project:** accordo-ide  
**Phase:** 2 — Modalities (Comments, Presentations, Voice, Diagrams)  
**Date:** 2026-03-04  
**Status:** ACTIVE — Phase 2 Week 7 in progress

---

## Current Status

> **As of 2026-03-05 — Week 7 M41a/M41b complete and polished. All 7 sub-modules implemented and reviewed (4 review rounds). 1208 tests green (Hub: 335, Bridge: 298, Editor: 186, Comments: 183, SDK: 45, md-viewer: 123 + smoke: 53). TypeScript clean. UX polish round delivered: stale comment auto-prune + cleanStale command; panel click → webview focus (comments:focus message + openPopover); gutter markers + anchor highlight in webview; CSS form consistency; file-anchor range fix (VS Code panel navigation). M42/M43 (Hub prompt engine + state response updates) not yet started.**

| Phase | Goal | Status |
|------|------|--------|
| Phase 1 | Control Plane MVP (Hub + Bridge + Editor) | ✅ DONE — 797 tests, v0.1.0 |
| Phase 2 | Comments modality (`accordo-comments`) | 🔄 IN PROGRESS — Week 6 done, Week 7 next |
| Phase 3 | Presentations modality (`accordo-slidev`) | ⏳ Pending Phase 2 |
| Phase 4 | Voice modality (`accordo-voice` bridge registration) | ⏳ Pending Phase 3 |
| Phase 5 | Diagrams modality (`accordo-tldraw`) | ⏳ Pending Phase 4 |

**Baseline:** 1208 tests green (Hub: 335, Bridge: 298, Editor: 186, Comments: 183, SDK: 45, md-viewer: 123). v0.1.0 on `main`.  
**Repo:** https://github.com/lshtram/accordo (`main` branch)  
**Phase 1 archive:** [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md)

---

> **Development process:** All module implementation in this project follows the TDD cycle defined in [`docs/dev-process.md`](dev-process.md). When a task says "TDD", that document is mandatory and normative. See also [`AGENTS.md`](../AGENTS.md) for mode-selection rules.

---

## 2. Phase 2 Goal

Deliver a spatial commenting system spanning all Accordo surfaces. The human and agent can place comment threads on:
- Lines of code (via VSCode native Comments API)
- Visual surfaces: diagrams, images, slides, markdown previews (via Comment SDK webview library)

The agent can create, reply to, and resolve comments as first-class MCP tools. Comments are the primary human-agent task-dispatch channel.

**Exit criteria:**
- Agent can create a comment on a specific line of code with `accordo.comment.create`
- Agent can list, reply to, and resolve comment threads
- Human can create comments via the VSCode gutter "+" icon (native Comments API)
- Comment state is visible in the system prompt (open threads + anchors)
- Comments persist across VSCode reload (`.accordo/comments.json`)
- Comment SDK is published as a standalone JS library for future webview consumers
- All communication is through the existing Hub+Bridge infrastructure (no new server)

---

## 3. Deliverables

| # | Deliverable | Package | Description |
|---|---|---|---|
| D1 | `accordo-comments` | vsix | VSCode extension: native Comments API + comment persistence + MCP tools |
| D2 | `@accordo/comment-sdk` | npm | Shared JS library for webview surfaces (pins, click-to-comment, postMessage bridge) |
| D3 | `AccordoCommentThread` state in Hub | Hub update | Hub includes open comment threads in system prompt and `/state` response |
| D4 | Comment MCP tools | via D1 | `comment.list`, `comment.get`, `comment.create`, `comment.reply`, `comment.resolve`, `comment.delete` |
| D5 | `accordo-md-viewer` | vsix | VSCode extension: rich commentable markdown preview using `@accordo/comment-sdk` |

---

## 4. Package Dependency Graph (Phase 2)

```
@accordo/bridge-types  (Phase 1 — add CommentThread + BlockCoordinates types)
        ▲
        │
   ┌────┴─────┐
   │           │
accordo-hub  accordo-bridge  (Phase 1 — no changes)
                    ▲
                    │
              accordo-comments  (Phase 2 — new, D1+D4)
                    │          \
              @accordo/comment-sdk  (Phase 2 — new, D2, used by webview modalities)
                    │
              accordo-md-viewer  (Phase 2 — new, D5, uses comment-sdk + comments internal commands)
```

---

## 5. Architecture Reference

The full architecture for the Comments modality is in [`docs/comments-architecture.md`](comments-architecture.md).

**Key design points:**
- **Two-surface strategy:** Code → VSCode native Comments API. Visual surfaces → Comment SDK.
- **Persistence:** `.accordo/comments.json` in workspace root. Extension owns the file. Hub reads it on demand.
- **MCP tools:** 6 tools (`comment.list`, `comment.get`, `comment.create`, `comment.reply`, `comment.resolve`, `comment.delete`).
- **System prompt:** Hub's prompt engine includes count of open threads + anchor summary.
- **State machine:** `open` → `resolved` → `open` (user only). Agent can create/reply/resolve/delete.

---

## 6. Weekly Plan — Phase 2

> Every task follows the TDD cycle in [`docs/dev-process.md`](dev-process.md).

### Week 6 — Comments Core (accordo-comments extension) ✅ DONE

**Goal:** Comment threads on code files work end-to-end: human creates via gutter, agent creates/replies/resolves via MCP tools, state persists.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 35 | `@accordo/bridge-types` — add `CommentThread`, `CommentAnchor`, `AccordoComment` and all comment types | comments-architecture.md §3 | ✅ done |
| 36 | `comment-store.ts` — CRUD + persistence to `.accordo/comments.json`, thread grouping, filtering | comments-architecture.md §3, §5 | ✅ done |
| 37 | `native-comments.ts` — VSCode Comments API adapter (gutter icons, inline threads, panel, staleness) | comments-architecture.md §2.1, §9 | ✅ done |
| 38 | `comment-tools.ts` — 6 MCP tools (`list`, `get`, `create`, `reply`, `resolve`, `delete`) + registration via BridgeAPI | comments-architecture.md §6 | ✅ done |
| 39 | `state-contribution.ts` — publishes comment summary to Hub via `bridge.publishState` | comments-architecture.md §7 | ✅ done |
| 40 | `extension.ts` — activate, wires all modules, registers tools, internal commands API | comments-architecture.md §10 | ✅ done |

**Extras delivered in Week 6:**
- URI normalization in `comment-tools.ts` — accepts `file:///abs`, `/abs`, or repo-relative paths (no agent friction)
- Smart list filters — `updatedSince` (ISO 8601), `lastAuthor` (`user`|`agent`), sort by `lastActivity` desc
- Comments panel right-click context menu — resolve / reopen / delete from panel sidebar (not just inline widget)

**Week 6 gate:** ✅ Agent can create/reply/resolve comments on code files. Human gutter workflow works. Open threads appear in system prompt. Comments survive VSCode reload.

---

### Week 7 — Comment SDK + Markdown Viewer + Prompt Engine Update

**Goal:** `@accordo/comment-sdk` implemented, `accordo-md-viewer` delivering a commentable markdown preview, Hub prompt surfaces comment threads. Phase 2 complete.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 41a | `@accordo/comment-sdk` — `AccordoCommentSDK` class, pin rendering, click-to-comment, postMessage bridge | requirements-comments-sdk.md | ✅ Phase C+D done (37 tests) |
| 41b-BID | `accordo-md-viewer`: `block-id-plugin.ts` — blockIdPlugin + BlockIdResolver | requirements-md-viewer.md §5 M41b-BID | ✅ Phase C+D done (20 tests) |
| 41b-RND | `accordo-md-viewer`: `renderer.ts` — MarkdownRenderer with shiki + KaTeX | requirements-md-viewer.md §5 M41b-RND | ✅ Phase C+D done (18 tests) |
| 41b-IMG | `accordo-md-viewer`: `image-resolver.ts` — ImageResolver | requirements-md-viewer.md §5 M41b-IMG | ✅ Phase C+D done (9 tests) |
| 41b-TPL | `accordo-md-viewer`: `webview-template.ts` — buildWebviewHtml | requirements-md-viewer.md §5 M41b-TPL | ✅ Phase C+D done (18 tests) |
| 41b-PBR | `accordo-md-viewer`: `preview-bridge.ts` — PreviewBridge + toSdkThread | requirements-md-viewer.md §5 M41b-PBR | ✅ Phase C+D done (21 tests) |
| 41b-CPE | `accordo-md-viewer`: `commentable-preview.ts` — CustomTextEditorProvider | requirements-md-viewer.md §5 M41b-CPE | ✅ Phase C+D done (17 tests) |
| 41b-EXT | `accordo-md-viewer`: `extension.ts` — activate, register provider + commands | requirements-md-viewer.md §5 M41b-EXT | ✅ Phase C done (10 tests) |
| 42 | Hub prompt engine update — include open comment threads in system prompt | requirements-hub.md §5.3 | not started |
| 43 | Hub `/state` response — include `commentThreads: CommentThread[]` | requirements-hub.md | not started |

**Week 7 gate:** Comment SDK implemented. `accordo-md-viewer` renders `.md` files with interactive comment pins. Hub prompt includes open comment count and thread summaries. Phase 2 exit criteria met.

---

## 7. Upcoming Phases (outline)

### Phase 3 — Presentations (`accordo-slidev`)

**Goal:** Agent can control a Slidev presentation running in a VSCode webview. Tools: `slide.goto`, `slide.next`, `slide.prev`, `slide.list`. Comment SDK integrated for per-slide annotations.

**No architecture doc yet.** Architecture phase A task will produce it.

**New packages:** `accordo-slidev` (VSCode extension + Slidev webview integration)

---

### Phase 4 — Voice (`accordo-voice` bridge registration)

**Goal:** The voice extension (already implemented) is registered with the Bridge + Hub. Agents can see voice state in the system prompt.

**Note from architecture.md:** "Already implemented. Needs only bridge registration." This should be a 1-week effort.

**New packages:** None — existing `accordo-voice` gains BridgeAPI registration.

---

### Phase 5 — Diagrams (`accordo-tldraw`)

**Goal:** Agent can read and control a tldraw/Excalidraw canvas in a VSCode webview. Tools: `diagram.createNode`, `diagram.deleteNode`, `diagram.connect`, `diagram.getState`. Comment SDK integrated for per-node annotations.

**No architecture doc yet.** Architecture phase A task will produce it.

**New packages:** `accordo-tldraw` (VSCode extension + tldraw webview)

---

## 8. Phase 2 Readiness Criteria (for Phase 3)

Phase 3 (Presentations) can begin only when:

1. All Phase 2 tests pass (comments core + SDK)
2. Comment SDK is published and usable from a webview in a clean repo
3. `@accordo/bridge-types` exports all comment types without breaking existing consumers
4. Hub prompt engine update is verified with a real agent session
5. Phase 2 retrospective written

---

## 9. Deferred Backlog (from Phase 1)

Carried forward — non-blocking:

1. **M29 PID cleanup race** — Unlink should check file content matches exiting PID before deleting.
2. **ESLint configuration** — Deferred from Phase 1. Add in Phase 2 or 3 cleanup week.
3. **Exact token counting** — `prompt-engine.ts` uses `chars / 4`; `tiktoken` integration deferred.
4. **Remote topology UX** — Port-forward notification for SSH/devcontainer/Codespaces.
5. **Checkpoint/rollback** — Git-stash snapshots before destructive tool executions.
6. **Comments store durability hardening** — Evaluate atomic persistence strategy for `.accordo/comments.json` (temp-file + rename / crash-safe write path). Deferred by product decision during Week 7 comments+SDK alignment.

---

## DONE

### Phase 1 — Control Plane MVP (completed 2026-03-03)

Full record in [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md).

**Summary:** 34 modules, 797 tests (Hub: 329, Bridge: 296, Editor: 172), 21 MCP tools, v0.1.0 tagged and pushed.

### Phase 2 Week 6 — accordo-comments core (completed 2026-03-04)

M35–M40 delivered. 177 new tests. Total: 996 (Hub: 335, Bridge: 298, Editor: 186, Comments: 177).
Extras: URI normalization, `updatedSince`/`lastAuthor` smart filters, Comments panel context menus.
