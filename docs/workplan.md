# Accordo IDE — Phase 2 Workplan

**Project:** accordo-ide  
**Phase:** 2 — Modalities (Comments, Presentations, Voice, Diagrams)  
**Date:** 2026-03-07  
**Status:** ACTIVE — Session 9 complete (M45 Custom Comments Panel ✅), Session 10 next (Voice modality)

---

## Current Status

> **As of 2026-03-07 — Session 9 complete. Custom Comments Panel (M45-TP/NR/CMD/FLT/EXT) fully delivered: 76 new tests. Manual testing round completed — fixed command-ID mismatches, `.deck.md` activation event, `comments:focus` webview handler, slide-sync race, and inline reply UX. 1418 tests total (Hub: 346, Bridge: 307, Editor: 172, Comments: 273, SDK: 45, md-viewer: 126, slidev: 149). TypeScript clean. Committed and pushed. Session 10 next: Voice modality (`accordo-voice`).**

| Phase | Goal | Status |
|------|------|--------|
| Phase 1 | Control Plane MVP (Hub + Bridge + Editor) | ✅ DONE — 797 tests, v0.1.0 |
| Phase 2 | Comments modality (`accordo-comments`) | ✅ DONE — Week 6+7 complete, 1221 tests |
| Phase 3 | Presentations modality (`accordo-slidev`) | ✅ DONE — Session 8B complete, 137 tests |
| Session 9 | Custom Comments Panel (M45 — `accordo-comments` update) | ✅ DONE — 273 comments tests, 1418 total |
| **Session 10** | **Voice modality (`accordo-voice` — port + Bridge registration)** | 🔜 **NEXT** — existing code in theia-openspace |
| Session 11 | Diagrams modality (`accordo-diagram` — Mermaid + Excalidraw) | ⏳ Pending Session 10 — architecture + workplan ready |
| Session 12+ | Browser agentation (`accordo-browser` + Chrome extension) | 📋 DEFERRED — architecture + requirements written, complex anchoring needs more design |

**Baseline:** 1418 tests green (Hub: 346, Bridge: 307, Editor: 172, Comments: 273, SDK: 45, md-viewer: 126, slidev: 149). v0.1.0 on `main`.  
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
| 42 | Hub prompt engine update — include open comment threads in system prompt | requirements-hub.md §2.3 (M42) | ✅ done (6 tests) |
| 43 | Hub `/state` response — include `commentThreads: CommentThread[]` | requirements-hub.md §2.7 (M43) | ✅ done (6 tests) |

**Week 7 gate:** ✅ Comment SDK implemented. `accordo-md-viewer` renders `.md` files with interactive comment pins. Hub prompt includes open comment count and thread summaries. Hub `/state` exposes full thread data. Phase 2 exit criteria met.

---

## 7. Upcoming Phases (outline)

### Phase 3 — Presentations (`accordo-slidev`)

**Goal:** Agent can open, navigate, and comment on a Slidev presentation running in a VS Code webview. Per-slide narration text generation included. Voice playback deferred to Phase 4.

**Architecture:** [`docs/presentation-architecture.md`](presentation-architecture.md) v1.1  
**Requirements:** [`docs/requirements-slidev.md`](requirements-slidev.md) + [`docs/requirements-comments.md`](requirements-comments.md) (M40-EXT-11)

**Tools delivered:** `accordo.presentation.discover`, `accordo.presentation.open`, `accordo.presentation.close`, `accordo.presentation.listSlides`, `accordo.presentation.getCurrent`, `accordo.presentation.goto`, `accordo.presentation.next`, `accordo.presentation.prev`, `accordo.presentation.generateNarration`

**New packages:** `packages/slidev` (`accordo-slidev` VSCode extension)

**Implementation is split into two sessions**:

#### Week 8A — Comments Generalization (accordo-comments update)

**Goal:** Add `accordo.comments.internal.getSurfaceAdapter` to `accordo-comments` so any surface modality can attach comments without knowing the markdown anchor shape. This is required before Session 8B.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 40-EXT-11 | `extension.ts` — add `getSurfaceAdapter` command + `SurfaceCommentAdapter` interface | requirements-comments.md §5.2 (M40-EXT-11) | ✅ done (11 tests) |

**Session 8A gate:** ✅ `accordo.comments.internal.getSurfaceAdapter` command registered and tested. `accordo-comments` tests remain green (197 total).

#### Week 8B — Slidev Package (full `accordo-slidev`)

**Goal:** Deliver the full `accordo-slidev` extension: embedded Slidev dev server, WebviewPanel, MCP tools, comments bridge, narration generator, state publisher.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M44-EXT | `extension.ts` — activate, dependency checks, tool registration | requirements-slidev.md §4 M44-EXT | ✅ done (16 tests) |
| M44-PVD | `presentation-provider.ts` — WebviewPanel + Slidev process spawn/kill (port 7788–7888) | requirements-slidev.md §4 M44-PVD | ✅ done (18 tests) |
| M44-RT | `runtime-adapter.ts` + `slidev-adapter.ts` — GET /json polling for getCurrent, navigation | requirements-slidev.md §4 M44-RT | ✅ done (27 tests) |
| M44-CBR | `presentation-comments-bridge.ts` — blockId `"slide:{idx}:{x}:{y}"` ↔ SlideCoordinates | requirements-slidev.md §4 M44-CBR | ✅ done (22 tests) |
| M44-NAR | `narration.ts` — plain-text narration from slide markdown + speaker notes | requirements-slidev.md §4 M44-NAR | ✅ done (16 tests) |
| M44-STATE | `presentation-state.ts` — modality state publisher | requirements-slidev.md §4 M44-STATE | ✅ done (11 tests) |

**Session 8B gate:** ✅ All 137 tests green. Modules M44-NAR/STATE/CBR/RT/PVD/TL/EXT complete. D2 fixes applied. Committed `8d2c3f9`.

---

### Session 9 — Custom Comments Panel (`accordo-comments` update)

**Goal:** Replace the built-in VS Code Comments panel with a fully controlled `vscode.TreeView` sidebar. Cross-surface anchor-aware navigation (text / markdown-preview / slide), full thread actions via context menu (resolve, reopen, reply, delete), and filter state persisted across reloads. Removes the P-12 hard blockers and delivers the canonical navigation router relied on by all future surface phases.

**Architecture:** [`docs/comments-panel-architecture.md`](comments-panel-architecture.md)  
**Requirements:** [`docs/requirements-comments-panel.md`](requirements-comments-panel.md)

**Prerequisite fix (before TDD start):**
- `fix(comment-sdk): badge selector mismatch in updateThread` — change `.accordo-pin-badge` → `.accordo-pin__badge` in `packages/comment-sdk/src/sdk.ts`

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M45-TP | `panel/comments-tree-provider.ts` — `CommentsTreeProvider` + `CommentTreeItem` + anchor label derivation | requirements-comments-panel.md §3 M45-TP | A → F |
| M45-NR | `panel/navigation-router.ts` — anchor-type-aware navigation dispatch, `NavigationEnv` abstraction | requirements-comments-panel.md §3 M45-NR | A → F |
| M45-CMD | `panel/panel-commands.ts` — resolve/reopen/reply/delete/navigate commands + store sync | requirements-comments-panel.md §3 M45-CMD | A → F |
| M45-FLT | `panel/panel-filters.ts` — filter state, quick picks, `workspaceState` persistence | requirements-comments-panel.md §3 M45-FLT | A → F |
| M45-EXT | `extension.ts` additions — wire panel into activate, manifest contributions | requirements-comments-panel.md §3 M45-EXT | A → F |

**Session 9 gate:** ✅ Panel sidebar shows all threads grouped by Open/Resolved. Click on any item navigates to the correct surface (text → text editor, slide → Slidev panel, preview → md-viewer popover). Context menu resolve/reopen/reply/delete works. Filters persist across reload. 273 total comments tests (76 new). 1418 tests green across all packages.

**Post-gate fixes (manual testing round — 2026-03-07):**
- Fixed command-ID mismatches (underscore vs dot format) across slidev + md-viewer
- Added `onCustomEditor:accordo.deckPresentation` activationEvent so `.deck.md` opens in Slidev panel on cold open
- Added `comments:focus` webview message handler in `COMMENT_OVERLAY_JS` so pin popover opens after nav-router slide jump
- Fixed startup slide-sync race: push `slide-index` immediately after `startPolling()` via `getCurrent()`
- Changed `accordo.commentsPanel.reply` to invoke `navigateToThread` (opens inline gutter widget / slide popover) instead of `showInputBox` dialog
- **Technical debt noted:** VS Code `TreeItem` has no native two-line support; comments panel metadata description is one-line beside label. Proper two-line layout requires a custom `WebviewView` (M46, deferred).

---

### Session 10 — Voice (`accordo-voice`)

**Goal:** Port the existing `openspace-voice-vscode` extension (from `theia-openspace`) into the Accordo ecosystem. Register voice capabilities with the Bridge + Hub. Agents can see voice state in the system prompt and invoke TTS for narration.

**Source code:** `/Users/Shared/dev/theia-openspace/openspace-voice-vscode/` — push-to-talk dictation (Whisper STT) + read-aloud (Kokoro TTS) + playback (platform-aware WAV). Depends on `@openspace-ai/voice-core` for FSMs and adapters.

**Key ecosystem context:**
- **Microsoft VS Code Speech** (1.2M installs): Azure Speech SDK, local processing, 26 languages. Uses VS Code's built-in `vscode.speech` API (STT + TTS). Already integrated with Copilot Chat.
- **Piper TTS** (1.5K installs): Offline neural TTS. Local processing.
- Our approach uses **Whisper.cpp** (STT, local) + **Kokoro** (TTS, local) — fully offline, no cloud dependency.

**Scope decisions needed (Phase A):**
1. Should `accordo-voice` use the VS Code Speech provider API (`vscode.speech`) as a provider rather than direct Whisper/Kokoro?
2. Bridge registration: register `voice.readAloud`, `voice.dictation`, `voice.narrate` as MCP tools?
3. State contribution: publish voice state (ready/recording/playing/error) to Hub prompt?
4. Narration integration: wire to `accordo-slidev` narration text for TTS playback?

**New packages:** `packages/voice/` (`accordo-voice` — VSCode extension, ported from openspace-voice-vscode)

---

### Session 11 — Diagrams (`accordo-diagram`)

**Goal:** Agent and human co-edit Mermaid diagrams in a dual-pane webview (Monaco text editor + Excalidraw interactive canvas). Reconciler preserves layout across topology changes. 14 MCP tools for diagram CRUD, topology edits, and visual customization.

**Architecture:** [`docs/diag_arch_v4.2.md`](diag_arch_v4.2.md) v4.2 — DRAFT, comprehensive  
**Workplan:** [`docs/diag_workplan.md`](diag_workplan.md) — 17 modules (A1–A17), ~295 tests estimated  

**Key design decisions:**
- Two-file canonical model: `.mmd` (Mermaid topology) + `.layout.json` (positions/styles)
- Mermaid node IDs as stable identity primitives — no UGM intermediary
- Dagre for initial auto-layout; Excalidraw for interactive canvas (pre-built bundle)
- Kroki API for semantic rendering (SVG/PNG export)
- Reconciler is stateless and deterministic — layout survives topology changes

**Key ecosystem context:**
- **Mermaid Chart** (472K installs): Official Mermaid extension, preview + edit
- **Mermaid Editor** (240K installs, 4.5★): Popular community editor
- **Mermaid Graphical Editor** (62K installs, 4.9★): Drag-and-drop visual editing
- **Excalidraw** (426K installs, 4.9★): Standalone whiteboard, `.excalidraw` files
- **tldraw** (102K installs, 5.0★): Standalone whiteboard, `.tldr` files
- **Microsoft vscode-mermAId** (106K installs, 5.0★): AI-powered Mermaid generation via Copilot
- Our differentiator: **bidirectional Mermaid ↔ Excalidraw sync with layout preservation** — no existing extension does this

**New packages:** `packages/diagram/` (`accordo-diagram` — VSCode extension + Excalidraw webview)

---

### Session 12+ — Browser Agentation (`accordo-browser` + Chrome Extension) [DEFERRED]

**Goal:** Human and agent co-browse the web with spatial comment threads anchored to DOM elements on any web page. A Chrome Manifest V3 extension embeds the existing `@accordo/comment-sdk` in the browser. A VSCode extension relays comments to the `CommentStore` via the generalized surface adapter. Browser automation is provided off-the-shelf by `@playwright/mcp` (no Accordo code).

**Architecture:** [`docs/browser-architecture.md`](browser-architecture.md) v1.0
**Requirements:** [`docs/requirements-browser.md`](requirements-browser.md)

**Key design decisions:**
- Browser automation via `@playwright/mcp` (off-the-shelf, zero Accordo code)
- Chrome extension communicates via local WebSocket relay in the VSCode extension (Hub unchanged, Bridge unchanged)
- DOM elements anchored via CSS selector paths + text fingerprint (new `CssSelectorCoordinates` type)
- `@accordo/comment-sdk` reused directly in Chrome content script (callback-driven, framework-free)
- No changes to Hub, Bridge, Comments, or Comment SDK packages

**New packages:**
- `packages/browser/` (`accordo-browser` — VSCode extension: relay server, comments bridge, state contribution)
- `packages/browser-extension/` (Chrome Manifest V3 extension: DOM auto-tagger, Comment SDK overlay, service worker)

**Implementation split across 3 sessions:**

#### Session 12A — Types + VSCode Extension Core

**Goal:** `CssSelectorCoordinates` type in bridge-types. `BrowserRelay` WebSocket server and `BrowserCommentsBridge` in the VSCode extension. End-to-end comment flow from mock Chrome messages → relay → CommentStore.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M50-BT | `@accordo/bridge-types` — add `CssSelectorCoordinates`, `BrowserRelayMessage`, `BrowserTabInfo` | requirements-browser.md §3 | A → F |
| M51-REL | `browser-relay.ts` — local WebSocket server, auth, multi-client routing | requirements-browser.md §4 M51 | A → F |
| M52-CBR | `browser-comments-bridge.ts` — message routing ↔ surface adapter, blockId codec | requirements-browser.md §4 M52 | A → F |
| M54-SEL | `selector-utils.ts` — blockId encode/decode, pure functions | requirements-browser.md §4 M54 | A → F |

**Session 12A gate:** BrowserRelay accepts WebSocket connections with auth. BrowserCommentsBridge routes comment messages to CommentStore. Integration test: mock client → relay → adapter → thread created with `surfaceType: "browser"` and `CssSelectorCoordinates`.

#### Session 12B — VSCode Extension Completion + Chrome Extension Core

**Goal:** State contribution, extension entry point. Chrome extension DOM auto-tagger, selector generator, fingerprint. Content script bootstraps Comment SDK.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M53-STATE | `browser-state.ts` — publishes connected tabs + comment counts to Hub | requirements-browser.md §4 M53 | A → F |
| M55-EXT | `extension.ts` — activation, wiring, token generation, commands | requirements-browser.md §4 M55 | A → F |
| M56-TAG | `dom-tagger.ts` — DOM element tagging with `data-block-id` | requirements-browser.md §5 M56 | A → F |
| M57-CSS | `selector-generator.ts` — minimal unique CSS selector paths | requirements-browser.md §5 M57 | A → F |
| M58-FP | `text-fingerprint.ts` — FNV-1a hash of element text | requirements-browser.md §5 M58 | A → F |

**Session 12B gate:** VSCode extension activates, generates token, starts relay. DOM auto-tagger correctly assigns blockIds in jsdom. Selector generator produces unique selectors. Fingerprint is deterministic.

#### Session 12C — Chrome Extension Completion + Automation Docs

**Goal:** Service worker, content script SDK integration, popup UI, theme CSS. Playwright setup documentation.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M59-SW | `service-worker.ts` — WebSocket client, message routing, reconnection | requirements-browser.md §5 M59 | A → F |
| M60-CS | `content-script.ts` — SDK initialization, callback wiring, scroll/resize | requirements-browser.md §5 M60 | A → F |
| M61-POP | `popup.html` + `popup.ts` — configuration UI, connection status | requirements-browser.md §5 M61 | A → F |
| M62-THM | `browser-theme.css` — VS Code CSS variable mappings for browser | requirements-browser.md §5 M62 | A → F |
| M63-AUTO | Browser automation setup docs + optional helper command | requirements-browser.md §6 M63 | A → F |

**Session 12C gate:** Chrome extension side-loads in Chrome. Content script injects overlay and Comment SDK. Service worker connects to relay. Comments created in Chrome appear in VS Code. Playwright MCP setup documented.

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
7. ~~**Custom Accordo Comments TreeView panel**~~ — ✅ Delivered in Session 9. See DONE below.
8. **Bridge status bar item (SB-01/SB-02/SB-03)** — `accordo-bridge` requirements §9 specifies a `$(plug) Accordo: Connected / Disconnected` status bar item with `accordo.bridge.showStatus` command (Hub URL, connection state, tool count, uptime). Never implemented. Add to `packages/bridge/src/extension.ts` in a quick-fix session before Session 10.
9. **Comments panel two-line layout (M46)** — VS Code `TreeItem` supports only one physical line (label + description). Full conversation preview requires a `WebviewView` detail pane. Deferred to M46 (post Session 10).

---

## DONE

### Session 9 — Custom Comments Panel (completed 2026-03-07)

M45-TP/NR/CMD/FLT/EXT delivered. 76 new tests (273 total in accordo-comments). Panel sidebar replaces built-in VS Code Comments panel. Cross-surface navigation (text → text editor, slide → Slidev, preview → md-viewer). Filter state persisted. Post-gate manual testing round fixed 8 issues (see gate notes above).

---

### Phase 1 — Control Plane MVP (completed 2026-03-03)

Full record in [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md).

**Summary:** 34 modules, 797 tests (Hub: 329, Bridge: 296, Editor: 172), 21 MCP tools, v0.1.0 tagged and pushed.

### Phase 2 Week 6 — accordo-comments core (completed 2026-03-04)

M35–M40 delivered. 177 new tests. Total: 996 (Hub: 335, Bridge: 298, Editor: 186, Comments: 177).
Extras: URI normalization, `updatedSince`/`lastAuthor` smart filters, Comments panel context menus.
