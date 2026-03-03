# Accordo IDE — Phase 2 Workplan

**Project:** accordo-ide  
**Phase:** 2 — Modalities (Comments, Presentations, Voice, Diagrams)  
**Date:** 2026-03-03  
**Status:** ACTIVE — Phase 2 starting

---

## Current Status

> **As of 2026-03-03 — Phase 1 complete (v0.1.0). Phase 2 starting with Comments modality.**

| Phase | Goal | Status |
|------|------|--------|
| Phase 1 | Control Plane MVP (Hub + Bridge + Editor) | ✅ DONE — 797 tests, v0.1.0 |
| Phase 2 | Comments modality (`accordo-comments`) | 🔄 IN PROGRESS |
| Phase 3 | Presentations modality (`accordo-slidev`) | ⏳ Pending Phase 2 |
| Phase 4 | Voice modality (`accordo-voice` bridge registration) | ⏳ Pending Phase 3 |
| Phase 5 | Diagrams modality (`accordo-tldraw`) | ⏳ Pending Phase 4 |

**Baseline:** 797 tests green (Hub: 329, Bridge: 296, Editor: 172). v0.1.0 on `main`.  
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
| D4 | Comment MCP tools | via D1 | `comment.create`, `comment.reply`, `comment.resolve`, `comment.list`, `comment.delete` |

---

## 4. Package Dependency Graph (Phase 2)

```
@accordo/bridge-types  (Phase 1 — add CommentThread types)
        ▲
        │
   ┌────┴─────┐
   │           │
accordo-hub  accordo-bridge  (Phase 1 — no changes)
                    ▲
                    │
              accordo-comments  (Phase 2 — new)
                    │
              @accordo/comment-sdk  (Phase 2 — new, used by future webview modalities)
```

---

## 5. Architecture Reference

The full architecture for the Comments modality is in [`docs/comments-architecture.md`](comments-architecture.md).

**Key design points:**
- **Two-surface strategy:** Code → VSCode native Comments API. Visual surfaces → Comment SDK.
- **Persistence:** `.accordo/comments.json` in workspace root. Extension owns the file. Hub reads it on demand.
- **MCP tools:** 5 tools (`comment.create`, `comment.reply`, `comment.resolve`, `comment.list`, `comment.delete`).
- **System prompt:** Hub's prompt engine includes count of open threads + anchor summary.
- **State machine:** `open` → `resolved` → `open` (user only). Agent can create/reply/resolve/delete.

---

## 6. Weekly Plan — Phase 2

> Every task follows the TDD cycle in [`docs/dev-process.md`](dev-process.md).

### Week 6 — Comments Core (accordo-comments extension)

**Goal:** Comment threads on code files work end-to-end: human creates via gutter, agent creates/replies/resolves via MCP tools, state persists.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 35 | `comment-store.ts` — CRUD on `.accordo/comments.json`, thread grouping | comments-architecture.md §3, §5 | not started |
| 36 | `native-comments.ts` — VSCode Comments API adapter (gutter icons, inline threads, panel) | comments-architecture.md §2.1, §6 | not started |
| 37 | `comment-tools.ts` — 5 MCP tools + registration via BridgeAPI | comments-architecture.md §7 | not started |
| 38 | `state-contribution.ts` — publishes comment summary to Hub via `bridge.publishState` | comments-architecture.md §8 | not started |
| 39 | `extension.ts` — activate, wires all modules, registers tools | comments-architecture.md §1 | not started |

**Week 6 gate:** Agent can create/reply/resolve comments on code files. Human gutter workflow works. Open threads appear in system prompt. Comments survive VSCode reload.

---

### Week 7 — Comment SDK + Prompt Engine Update

**Goal:** Comment SDK published. Hub prompt engine surfaces comment threads. Phase 2 complete.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 40 | `@accordo/comment-sdk` — pin rendering, click-to-comment, postMessage bridge | comments-architecture.md §2.2, §9 | not started |
| 41 | Hub prompt engine update — include open comment threads in system prompt | comments-architecture.md §8, requirements-hub.md §5.3 | not started |
| 42 | Hub `/state` response — include `commentThreads: CommentThread[]` | comments-architecture.md §8 | not started |
| 43 | `@accordo/bridge-types` — add `CommentThread`, `CommentAnchor`, `AccordoComment` types | comments-architecture.md §3 | not started |

**Week 7 gate:** Comment SDK published. Hub prompt includes open comment count and thread summaries. Bridge-types exports all comment types. Phase 2 exit criteria met.

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

---

## DONE

### Phase 1 — Control Plane MVP (completed 2026-03-03)

Full record in [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md).

**Summary:** 34 modules, 797 tests (Hub: 329, Bridge: 296, Editor: 172), 21 MCP tools, v0.1.0 tagged and pushed.
