# Accordo IDE — Phase 2 Workplan

**Project:** accordo-ide  
**Phase:** 2 — Modalities (Comments, Presentations, Voice, Diagrams)  
**Date:** 2026-03-27  
**Status:** ACTIVE — Backlog bug #6 (comments store durability) ✅ DONE (2026-03-27); next: #8 Bridge status bar or Browser 2.0 P1 (M100-SNAP)

---

## Current Status

> **As of 2026-03-27 — Backlog bug #6 done: `CommentStore._persist()` now uses atomic write (write to `.tmp` then `fs.rename`) — original `comments.json` is never partially overwritten on crash. 7 new tests (2 unit + 5 real-fs integration). E2E validated live via MCP: create→reply→delete cycle confirmed `.tmp` never left on disk. Comments package: 354 tests (+7). Full monorepo: 2,977 tests green. Next: #8 Bridge status bar or Browser 2.0 P1 (M100-SNAP).**

| Phase | Goal | Status |
|------|------|--------|
| Phase 1 | Control Plane MVP (Hub + Bridge + Editor) | ✅ DONE — 797 tests, v0.1.0 |
| Phase 2 | Comments modality (`accordo-comments`) | ✅ DONE — Week 6+7 complete, 1221 tests |
| Phase 3 | Presentations modality (`accordo-slidev`) | ✅ DONE — Session 8B complete, 137 tests |
| Session 9 | Custom Comments Panel (M45 — `accordo-comments` update) | ✅ DONE — 273 comments tests, 1418 total |
| **Session 10** | **Voice modality (`accordo-voice` — 10A core+tools, 10B summary narration, 10C robustness)** | ✅ DONE — 10A: 211; 10B: +25; 10C: hardening + simplification, 261 total voice tests |
| **Session 10D** | **Scripted walkthroughs (`accordo-script` — ScriptRunner, 4 MCP tools, Bridge dual-registration)** | ✅ DONE — 133 tests |
| **Session 11** | **Diagrams modality (`accordo-diagram` — Mermaid + Excalidraw, A1-A17, all diag.1 modules, custom editor + patch enhancements)** | ✅ DONE — 444 tests |
| **Session 11b** | **A18 Diagram Comments Bridge — host bridge + panel wiring + webview (SDK init, idMap, Alt+click overlay, pin re-render on scroll/zoom)** | ✅ DONE — 463 tests; D3 manual checklist pending |
| **TD-CROSS-1** | **`openTabs` capture + `accordo_layout_state` tool + Open Tabs prompt section** | ✅ DONE — 2321 tests (Hub: 376, Bridge: 310+) |
| **Session 12** | **Browser Extension v1 (`packages/browser-extension` — standalone Chrome extension, 12 modules M80-xxx)** | ✅ DONE — 165 tests; MVP shipped with store, pins, popover, export, screenshot |
| **Session 13** | **Browser Extension v2a (`packages/browser` relay + SDK convergence + agent list/get/create/reply/resolve/reopen/delete)** | ✅ DONE — 176 tests (browser-ext: 165 + browser: 11); manual validation confirmed |
| **Session 14** | **Unified comments contract (`comment_*` scoped by modality) + browser comments in shared panel + bulk browser cleanup action** | ✅ DONE — Phase A→F complete; 2,636 tests |
| **Session 15** | **Page Understanding + Region Capture (M90/M91/M92 — 4 MCP tools, enhanced anchors, DOM inspection, targeted screenshots)** | ✅ DONE — Phase A→D→D2→D3 complete; 313 new tests (browser-ext: 343, browser: 115); 2,949 total |
| **Session 15b** | **Browser hardening pass — pin placement/rehydration stability + anchor precision + docs reconciliation** | ✅ DONE — live E2E validated; package baselines now browser-ext: 357, browser: 117, comment-sdk: 47, comments: 347 |

**Baseline:** 2,977 tests green (Hub: 376, Bridge: 325, Comments: 354, Voice: 272, Marp: 226, Editor: 182, Script: 133, Diagram: 463, md-viewer: 126, browser-ext: 357, browser: 117, comment-sdk: 47). Backlog bugs #6, #12–#19 done 2026-03-27.  
**Repo:** https://github.com/lshtram/accordo (`main` branch)  
**Phase 1 archive:** [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md)

---

## Cross-Cutting Technical Debt

Registered 2026-03-15. These affect more than one package.

| ID | Severity | Description | Effort | Blocking |
|---|---|---|---|---|
| TD-CROSS-1 | 🟠 MEDIUM | **Agent IDE state coverage gap** — `IDEState.openEditors` only captures text-file tabs. Webview panels (diagram canvas, presentations, browser, script runner) are invisible to the agent mid-session. Architecture: `docs/layout-state-architecture.md`. Requirements: `requirements-bridge.md §6.5 (M74-OT)`, `requirements-editor.md §4.25 (M74-LS)`, `requirements-hub.md §2.3 (M74-PE)`. Two modules: (A) `openTabs` capture in Bridge + bridge-types; (B) `accordo_layout_state` tool in `accordo-editor` + Hub prompt section. | 1 session (~2 modules) | none, but limits diagram + all modality usefulness |
| TD-CROSS-2 | 🟡 LOW | **Uniform logging** — all VS Code packages use a hand-rolled `appendLine` wrapper; Hub has no structured logging. VS Code 1.74+ ships `LogOutputChannel` (`createOutputChannel(name, { log: true })`) with built-in `trace/debug/info/warn/error` levels and a per-channel level picker in the Output panel — no extra deps. Hub should use `pino` (structured JSON, `LOG_LEVEL` env var). Migration plan: (1) add `Logger` interface to `@accordo/bridge-types` with `{ trace, debug, info, warn, error }`; (2) switch each VS Code extension to `LogOutputChannel`; (3) switch Hub to `pino`; (4) update all test mocks. Immediate workaround: per-module `PANEL_FILE_DEBUG`-style boolean constants gate noisy file I/O. | 1 session | none |

---

> **Development process:** All module implementation in this project follows the global TDD cycle defined in `~/.config/opencode/dev-process.md`. When a task says "TDD", that document is mandatory and normative. See also [`AGENTS.md`](../AGENTS.md) for project-specific mode-selection rules.

---

## 2. Phase 2 Goal

Deliver a spatial commenting system spanning all Accordo surfaces. The human and agent can place comment threads on:
- Lines of code (via VSCode native Comments API)
- Visual surfaces: diagrams, images, slides, markdown previews (via Comment SDK webview library)

The agent can create, reply to, and resolve comments as first-class MCP tools. Comments are the primary human-agent task-dispatch channel.

**Exit criteria:**
- Agent can create a comment on a specific line of code with `comment_create`
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
- **MCP tools:** unified 7-tool contract (`comment_list`, `comment_get`, `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`) with modality scoping.
- **System prompt:** Hub's prompt engine includes count of open threads + anchor summary.
- **State machine:** `open` ↔ `resolved`; agent and user can create/reply/resolve/reopen/delete through the unified contract.

---

## 6. Weekly Plan — Phase 2

> Every task follows the TDD cycle in `~/.config/opencode/dev-process.md`.

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

**Goal:** Port the existing voice infrastructure from `theia-openspace` into the Accordo ecosystem. Give the agent a voice (TTS narration) and an ear (STT dictation). Register MCP tools with Bridge. Summary narration mode enables the agent to auto-narrate a spoken summary of each response via system-prompt directive.

**Architecture:** [`docs/voice-architecture.md`](voice-architecture.md)  
**Requirements:** [`docs/requirements-voice.md`](requirements-voice.md)  
**Source code:** `theia-openspace/openspace-voice-vscode/` + `theia-openspace/extensions/openspace-voice/` + `theia-openspace/packages/voice-core/`

**Technology decisions (resolved):**
- **STT:** Whisper.cpp (local, offline) — more advanced than VS Code Speech API (Azure-dependent). Provider interface allows swap-in of VS Code Speech later.
- **TTS:** Kokoro (local, neural, 82M ONNX) — fully offline, multiple voices. Provider interface allows swap-in of Piper, ElevenLabs, etc.
- **Summary mode:** Agent-driven via system-prompt directive. The agent generates a 2-3 sentence spoken summary inline and calls `readAloud`. No separate LLM call from the voice extension.
- **Voice-core code:** Copied into `packages/voice/src/core/` (no external dependency on `@openspace-ai/voice-core`). Full control.
- **UI:** Port theia-openspace waveform overlay + input widget as a VS Code `WebviewView` panel + status bar.

> **Scripted walkthroughs** (multi-step sequences interleaving speech, IDE commands, delays, and highlighting) are **not part of the voice extension**. They will be implemented in a dedicated scripting module (future session) so they work without voice installed — e.g. with subtitles instead of audio.

**New packages:** `packages/voice/` (`accordo-voice` — VS Code extension)

**Implementation split into two sessions:**

#### Session 10A — Core + Tools + UI

**Goal:** Working STT dictation, TTS read-aloud, MCP tool registration, status bar, voice panel. Deterministic text cleaning (no LLM).

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M50-SP | Provider interfaces (`SttProvider`, `TtsProvider`) | requirements-voice.md §4 M50-SP | A → F |
| M50-WA | `WhisperCppAdapter` — Whisper.cpp STT | requirements-voice.md §4 M50-WA | A → F |
| M50-KA | `KokoroAdapter` — Kokoro TTS | requirements-voice.md §4 M50-KA | A → F |
| M50-FSM | Voice FSMs (`SessionFsm`, `AudioFsm`, `NarrationFsm`) + types | requirements-voice.md §4 M50-FSM | A → F |
| M50-WAV | WAV utility + platform playback | requirements-voice.md §4 M50-WAV | A → F |
| M50-TC | `TextCleaner` — deterministic markdown→speech cleanup | requirements-voice.md §4 M50-TC | A → F |
| M50-SS | `SentenceSplitter` — split for incremental TTS | requirements-voice.md §4 M50-SS | A → F |
| M50-VC | `VoiceVocabulary` — user word replacements | requirements-voice.md §4 M50-VC | A → F |
| M50-DT | `accordo_voice_discover` MCP tool | requirements-voice.md §4 M50-DT | A → F |
| M50-RA | `accordo_voice_readAloud` MCP tool | requirements-voice.md §4 M50-RA | A → F |
| M50-DI | `accordo_voice_dictation` MCP tool | requirements-voice.md §4 M50-DI | A → F |
| M50-POL | `accordo_voice_setPolicy` MCP tool | requirements-voice.md §4 M50-POL | A → F |
| M50-SB | `VoiceStatusBar` — status bar management | requirements-voice.md §4 M50-SB | A → F |
| M50-VP | `VoicePanelProvider` — WebviewView (waveform + controls) | requirements-voice.md §4 M50-VP | A → F |
| M50-EXT | `extension.ts` — activate, wiring, Bridge registration | requirements-voice.md §4 M50-EXT | A → F |

**Session 10A gate:** Agent can call `accordo_voice_readAloud` to speak cleaned text. Agent calls `accordo_voice_dictation` for STT. Voice state appears in system prompt. Status bar + voice panel show recording/playback state. ~198 new tests.

#### Session 10B — Summary Narration + Streaming TTS

**Goal:** Hub system prompt includes a narration directive when summary mode is enabled. Streaming TTS pipeline reduces latency for longer text. No new MCP tools — `readAloud` (from 10A) is the only tool involved.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M51-SN | Hub prompt engine update — narration directive when `narrationMode` is `narrate-summary` or `narrate-everything` | requirements-voice.md §5 M51-SN | ✅ A → F |
| M51-STR | Streaming TTS — sentence-level pipeline (synthesize N+1 while playing N) | requirements-voice.md §5 M51-STR | ✅ A → F |

**Session 10B gate:** When `narrationMode` is `narrate-summary`, the agent's system prompt includes a directive to call `readAloud` with a spoken summary after each response. Streaming TTS plays first sentence while synthesizing next. ~25 new tests.

---

#### Session 10C — Voice Robustness + Hardening (post-integration)

**Goal:** Full-session debugging and hardening of the voice integration stack — from MCP plumbing through to TTS audio output. No new features; stabilise what was built in 10A+10B.

**Fixes delivered (15 commits):**

| Fix | Details |
|---|---|
| Dynamic Hub port | Port selection loops from 3000 until a free port is found — no more EADDRINUSE on reload |
| TTS silent failure | `createAsync`/`generateAsync` availability check before branching; proper error propagation |
| WS 1006 disconnect | Strip stale listeners before reconnect; idempotent disconnect path; ghost-disconnect eliminated |
| Sherpa subprocess | Sherpa-onnx-node uses external ArrayBuffers (blocked by Electron). Solution: spawn sherpa-worker.ts in a real system Node.js binary (not Electron). `findSystemNode()` tries `which node`, well-known paths, then falls back to Electron + `ELECTRON_RUN_AS_NODE=1`. |
| readAloud timeout | Handler is now fully fire-and-forget (<5ms). All synthesis + playback runs in background. |
| Hub crash prevention | `process.on('uncaughtException')` + `process.on('unhandledRejection')` guards; wss error handler. |
| Hub stderr noise | All bridge-server diagnostics write to `~/.accordo/bridge-server.log`. `McpDebugLogger` file-only (no stderr echo). Hub terminal is now clean. Added `logError()` helper. |
| WS diagnostic logging | Comprehensive logging on every WS lifecycle path in bridge-server, ws-client, server, extension — feeds `bridge-server.log`. |
| Prompt directive | Strengthened from "after each response" to "MUST call as LAST tool call in EVERY response — including the very first one." |
| readAloud simplification | Removed manual first-sentence split/synthesize/play pattern. `readAloud` handler now delegates the full text to `streamingSpeak`, which handles splitting, overlap, and playback. Eliminates duplicate sentence-splitting. |

**Key finding from log analysis:** The MCP response format was always correct (`result.content` array, `durationMs: 4`). The "TypeError: Cannot read properties of undefined (reading 'invoke')" reported by Copilot is an **internal Copilot MCP client bug** — not an Accordo issue. Confirmed by analysing `~/.accordo/mcp-debug.jsonl`. opencode client worked correctly throughout.

**Session 10C gate:** ✅ 360 Hub + 261 Voice tests green. TTS end-to-end confirmed working with opencode. Hub terminal clean. All WS lifecycle events logged to file for future debugging.

**Deferred from Session 10C:**
- **TTS inter-sentence silence (speech fluency):** A perceptible gap exists between sentences during streaming playback. Hypothesis: Kokoro engine appends trailing silence to each synthesized audio clip. Investigation: read synthesized PCM buffers and check for trailing silence; consider trimming silence at playback boundary or adjusting `maxNumSentences` in worker config. Track in deferred tasks below.

---

### Session 10D — Scripted Walkthroughs (`accordo-script`) ✅ DONE

**Goal:** A scripting runtime that executes multi-step sequences interleaving IDE commands, delays, highlights, and optionally speech (via voice extension if installed) or subtitles (if not). The agent generates a complete script in one shot; the runtime executes it without further MCP round-trips.

**Architecture ref:** [`docs/voice-architecture.md`](voice-architecture.md) ADR-04 (separation rationale)  
**Requirements:** [`docs/requirements-script.md`](requirements-script.md)  
**Testing guide:** [`docs/testing-guide-script-10d.md`](testing-guide-script-10d.md)  
**New package:** `packages/script/` (`accordo-script` VS Code extension)

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M52-RT | `script-runner.ts` — `ScriptRunner`: step executor, cancellation, error policy (skip/abort) | requirements-script.md §4 M52-RT | ✅ A → F |
| M52-SB | `subtitle-bar.ts` — `ScriptSubtitleBar`: status bar subtitle display, voice fallback | requirements-script.md §4 M52-SB | ✅ A → F |
| M52-RUN | `tools/run-script.ts` — `accordo_script_run` MCP tool: receive + validate + execute script | requirements-script.md §4 M52-RUN | ✅ A → F |
| M52-STOP | `tools/stop-script.ts` — `accordo_script_stop` MCP tool: cancel running script | requirements-script.md §4 M52-STOP | ✅ A → F |
| M52-STAT | `tools/script-status.ts` — `accordo_script_status` MCP tool: poll execution progress | requirements-script.md §4 M52-STAT | ✅ A → F |
| M52-DISC | `tools/script-discover.ts` — `accordo_script_discover` MCP tool: full reference card for agents | requirements-script.md §4 M52-DISC | ✅ A → F |
| M52-EXT | `extension.ts` — activate, wires all tools, Bridge registration | requirements-script.md §4 M52-EXT | ✅ A → F |

**Key implementation decisions:**
- `command` steps call `vscode.commands.executeCommand` with any VS Code command ID. Bridge auto-registers every MCP tool as a VS Code command in `registerTools()`, making ALL Accordo tools reachable via `command` steps with zero changes to `accordo-script`.
- Schema uses flat property list + inline example in `description` (not deep `oneOf`) — LLMs generate correct scripts reliably.
- `accordo_script_discover` returns a full reference card: all step types with fields, complete command ID map for all Accordo modalities, VS Code builtins, and a worked example.
- `accordo.voice.speakText` VS Code command added to `accordo-voice` as the `speak` step integration point.
- OpenCode MCP config: `"type": "remote"` is the correct value per OpenCode's JSON schema (not `"http"`).

**Session 10D gate:** ✅ 133 tests green. ScriptRunner executes all step types. Agent can script a full presentation walkthrough with voice, highlights, navigation, and delays in a single MCP call. `accordo_script_discover` provides schema-level self-documentation for agents.

---

### Session 11 — Diagrams (`accordo-diagram`)

**Goal:** Agent and human co-edit Mermaid diagrams in a dual-pane webview (Monaco text editor + Excalidraw interactive canvas). Reconciler preserves layout across topology changes. 15 MCP tools (6 in diag.1, 9 in diag.2) for diagram CRUD, topology edits, visual customization, and aesthetic guidance (`accordo_diagram_style_guide`).

**Architecture:** [`docs/diag_arch_v4.2.md`](diag_arch_v4.2.md) v4.2 — DRAFT, comprehensive  
**Workplan:** [`docs/diag_workplan.md`](diag_workplan.md) — 17 modules (A1–A17), ~295 tests estimated  

**Key design decisions:**
- Two-file canonical model: `.mmd` (Mermaid topology) + `.layout.json` (positions/styles)
- Mermaid node IDs as stable identity primitives — no UGM intermediary
- Dagre for initial auto-layout; Excalidraw for interactive canvas (pre-built bundle)
- Semantic export (Kroki) always available; canvas export when webview is open
- Reconciler is stateless and deterministic — layout survives topology changes
- Comment SDK integration: diagram nodes are commentable surfaces (follows md-viewer pattern)
- Script compatibility: all MCP tools auto-registered as VS Code commands via Bridge dual-registration
- Implementation phases renamed diag.1/diag.2/diag.3/diag.4 (avoid confusion with TDD phases A–F)
- Draw-on animation and sequential diagram mode deferred from diag.1 to diag.2

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

### Session 12 — Browser Extension v1 (`packages/browser-extension`) [ARCHITECTURE FINALIZED]

**Goal:** A standalone Chrome Manifest V3 extension for spatial commenting on web pages. No VS Code relay in v1 — extension is self-contained. Comments stored in `chrome.storage.local`, exported to clipboard, MCP API shapes stubbed for v2 relay integration.

**Architecture:** [`docs/browser-extension-architecture.md`](browser-extension-architecture.md) v2.0 (supersedes `browser-architecture.md` v1.0)  
**Requirements:** [`docs/requirements-browser-extension.md`](requirements-browser-extension.md) (supersedes `requirements-browser.md`)

**Key simplifications from v1 architecture (vs old 3-session plan):**
- No `accordo-browser` VS Code extension (no relay, no Bridge integration)
- No `@accordo/comment-sdk` dependency (inline comment UI with browser-native styling)
- No CSS selector re-anchoring (simple `{tagName}:{siblingIndex}:{textFingerprint}` anchor keys, session-scoped)
- No changes to any existing Accordo package (Hub, Bridge, Editor, Comments, SDK)

**Single-session implementation (12 modules):**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M80-TYP | Shared types — `BrowserComment`, `BrowserCommentThread`, `PageCommentStore`, `ScreenshotRecord`, MCP types, export types | requirements-browser-extension.md §3.1 | A → F |
| M80-SM | Comments Mode state machine — tab-scoped OFF ↔ ON toggle, context menu lifecycle, badge, icon title | requirements-browser-extension.md §3.2 | A → F |
| M80-STORE | Comment storage manager — CRUD, soft-delete, URL normalization, filtered queries (store-layer filtering) | requirements-browser-extension.md §3.3 | A → F |
| M80-SW | Background service worker — message router, onInstalled, context menu handler, wire-up | requirements-browser-extension.md §3.4 | A → F |
| M80-CS-PINS | Content script: pin rendering — inject/position pins, scroll/resize reposition, MutationObserver, off-screen detection | requirements-browser-extension.md §3.5a | A → F |
| M80-CS-INPUT | Content script: input & popovers — comment form, thread popover, reply/resolve/delete UI | requirements-browser-extension.md §3.5b | A → F |
| M80-CSS | Content styles — `accordo-*` prefixed, `all: initial`, `prefers-color-scheme`, high z-index | requirements-browser-extension.md §3.6 | A → F |
| M80-EXPORT | Export layer — `Exporter` interface, `ClipboardExporter`, Markdown/JSON formatters | requirements-browser-extension.md §3.7 | A → F |
| M80-SCREEN | Screenshot capture — `captureVisibleTab`, one `ScreenshotRecord` per URL, JPEG 0.7, quota warning | requirements-browser-extension.md §3.8 | A → F |
| M80-MCP | MCP handler layer — real handlers reading from storage, typed `get_screenshot` + `get_comments`, stubbed transport | requirements-browser-extension.md §3.9 | A → F |
| M80-POP | Popup UI — thread list, export buttons, mode toggle, off-screen count, user name | requirements-browser-extension.md §3.10 | A → F |
| M80-MANIFEST | Manifest V3 + esbuild — permissions, content scripts, commands, 3 entry points | requirements-browser-extension.md §3.11 | A → F |

**Estimated LOC:** ~1,550 (12 modules)

**Session 12 gate:** Extension side-loads in Chrome. Keyboard shortcut toggles Comments Mode. Right-click adds comment with pin. Threads persist in `chrome.storage.local`. Popup shows threads + export buttons. Clipboard export works (Markdown + JSON). Screenshot captured on export. MCP stubs return stored data. All unit tests green.

**v2 integration path (NOT built in Session 12):**
- Add `packages/browser/` (`accordo-browser` VS Code extension) with WebSocket relay
- MCP handlers already read real data — relay adds transport only (no handler logic changes)
- CSS selector generator for cross-reload anchoring
- `CssSelectorCoordinates` type added to `@accordo/bridge-types`

---

### Session 13 — Browser Extension v2a (`packages/browser` + `packages/browser-extension`) [TDD ACTIVE]

**Goal:** Connect browser comments to Accordo so agents can list/get/create/reply/resolve/reopen/delete comments; converge browser UI on the shared SDK interaction model.

**Architecture update:** [`docs/browser-extension-architecture.md`](browser-extension-architecture.md) §12.1 (Session 13 v2a wiring)  
**Requirements update:** [`docs/requirements-browser-extension.md`](requirements-browser-extension.md) §3.12 (BR-F-117..BR-F-131)

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M81-SDK | SDK convergence adapter in browser-extension (single create/reply/resolve/reopen/delete path + live update broadcast) | requirements-browser-extension.md §3.12 (BR-F-117, BR-F-118, BR-F-119, BR-F-127, BR-F-130) | A → F |
| M82-RELAY | `packages/browser` relay server + auth + request router | requirements-browser-extension.md §3.12 (BR-F-120, BR-F-121, BR-F-123, BR-F-125, BR-F-126, BR-F-128, BR-F-129) | A → F |
| M83-BTOOLS | Browser relay tool registration (`accordo_browser_*`) + end-to-end mutation contract | requirements-browser-extension.md §3.12 (BR-F-122, BR-F-124, BR-F-131) | A → F |

**Phase A/B artifacts:** [`docs/tdd-browser-v2a-phase-a-b.md`](tdd-browser-v2a-phase-a-b.md)

**Current checkpoint:** C/D/D2 completed for v2a slice (relay connectivity + read/create/reply/resolve/reopen/delete + live UI refresh). D3 manual validation in progress.

---

### Session 14 — Unified Comments Contract (`packages/comments` + browser integration) [✅ DONE]

**Goal:** Replace modality-specific browser comment tools with unified `comment_*` tools using modality scope, and register browser comments into the shared Accordo Comments Panel with bulk browser cleanup UX.

**Architecture update:** [`docs/comments-architecture.md`](comments-architecture.md) v1.1 (unified tool contract + volatile-browser retention)  
**Requirements update:** [`docs/requirements-comments.md`](requirements-comments.md) M38/M40 updates; [`docs/requirements-browser-extension.md`](requirements-browser-extension.md) §3.13 (BR-F-132..BR-F-136)  
**Phase A doc:** [`docs/tdd-session-14-phase-a.md`](tdd-session-14-phase-a.md)  
**Testing guide:** [`docs/testing-guide-session-14.md`](testing-guide-session-14.md)

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M84-TOOLS | Unified comment tool schemas (`scope.modality`) + add `comment_reopen` + scoped delete for browser bulk cleanup | requirements-comments.md M38-CT-01..11 | ✅ A → F |
| M85-PANEL | Browser threads in shared comments panel + new panel command `accordo.commentsPanel.deleteAllBrowserComments` | requirements-comments.md M40-EXT-12; requirements-browser-extension.md BR-F-133..BR-F-135 | ✅ A → F |
| M86-MIGRATE | Bridge/browser migration off public `accordo_browser_*` tools (temporary alias period, then remove) | requirements-browser-extension.md BR-F-132, BR-F-136 | ✅ A → F |

**Key changes:**
- MCP server renamed `accordo-hub` → `accordo`; all tools shortened: `accordo_comment_*` → `comment_*`, `accordo_browser_*` → `browser_*`
- `accordo_browser_*` tools NOT registered as MCP tools; Chrome events route through `onRelayRequest` interceptor to unified `comment_*` tools
- `BridgeAPI.invokeTool()` enables VS Code CommentStore updates from Chrome relay events
- Bidirectional relay: `RelayBridgeClient.send()` with pending request map for Chrome → accordo-browser → VS Code flow

---

### Session 15 — Page Understanding + Region Capture (`packages/browser-extension` + `packages/browser`) [✅ DONE]

**Goal:** Give AI agents the ability to inspect live browser pages (structured DOM summary, element inspection, HTML excerpts) and capture targeted screenshots of specific elements or regions — avoiding full-viewport screenshots that bloat agent context windows.

**Architecture:** [`docs/design/page-understanding-architecture.md`](design/page-understanding-architecture.md); [`docs/architecture.md`](architecture.md) §14.2–§14.7  
**Requirements:** [`docs/requirements-browser-extension.md`](requirements-browser-extension.md) §3.15 (PU-F-01..PU-F-57), §3.18 (CR-F-01..CR-F-12)  
**Testing guide:** [`docs/testing-guide-session-15.md`](testing-guide-session-15.md)

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M90-MAP | Page Map Collector (content script) | requirements-browser-extension.md §3.15 (PU-F-01..PU-F-06) | ✅ A → F |
| M90-INS | Element Inspector (content script) | requirements-browser-extension.md §3.15 (PU-F-10..PU-F-15) | ✅ A → F |
| M90-ANC | Enhanced Anchor | requirements-browser-extension.md §3.15 (PU-F-20..PU-F-26) | ✅ A → F |
| M90-ACT | Relay Actions (page understanding + capture) | requirements-browser-extension.md §3.15 (PU-F-30..PU-F-33) | ✅ A → F |
| M91-PU | Page Understanding MCP Tools (3 tools) | requirements-browser-extension.md §3.15 (PU-F-50..PU-F-55) | ✅ A → F |
| M91-CR | Capture Region MCP Tool | requirements-browser-extension.md §3.18 (CR-F-01..CR-F-12) | ✅ A → F |
| M92-CR | Region Capture (content script + OffscreenCanvas crop) | requirements-browser-extension.md §3.18 (CR-F-02..CR-F-07) | ✅ A → F |

**Key implementation decisions:**
- Content script executes DOM queries (`collectPageMap`, `inspectElement`, etc.); service worker relays via `chrome.tabs.sendMessage`
- `capture_region`: service worker calls `chrome.tabs.captureVisibleTab()` then crops with `OffscreenCanvas` + `createImageBitmap`
- `isEnhancedAnchorKey`: `body:` prefix is enhanced **only** if the key contains `%` (viewport-pct format); `body:0:center` is legacy
- `getDomExcerpt` sanitization: strips `script`/`style`/`iframe`/`object`/`embed`/`noscript`/`template`; removes `javascript:`/`data:` URLs; strips `on*` attributes
- `isHidden()` covers: `display:none`, `visibility:hidden/collapse`, `opacity:0`, `hidden` attribute
- 500 KB retry at lower quality if first capture exceeds limit; error codes: `element-not-found`, `element-off-screen`, `no-target`, `image-too-large`, `capture-failed`

**D2 review cycles:** 5 iterations — DOM globals removed from `packages/browser`, `OffscreenCanvas` crop implemented, anchor key disambiguation fixed, sanitization completed, error propagation fixed.

**Session 15 gate:** ✅ 313 new tests. All 4 MCP tools wired and callable. Agent can call `browser_get_page_map` and receive a structured DOM summary. `browser_inspect_element` returns stable anchor keys. `browser_capture_region` crops to element bounds. 2,949 total tests green.

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
6. ~~**Comments store durability hardening**~~ — ✅ DONE (2026-03-27). `CommentStore._persist()` now writes to `comments.json.tmp` first, then uses `fs.rename()` (atomic at OS level) to replace the final file. Original `comments.json` is never partially overwritten on crash. 7 new tests: 2 unit (mock-level: write-to-tmp path, no-rename-on-throw) + 5 real-fs integration (create/reply/delete cycle, crash safety). E2E validated live via Hub MCP. Commit: see fix(comments) commit.
7. ~~**Custom Accordo Comments TreeView panel**~~ — ✅ Delivered in Session 9. See DONE below.
8. **Bridge status bar item (SB-01/SB-02/SB-03)** — `accordo-bridge` requirements §9 specifies a `$(plug) Accordo: Connected / Disconnected` status bar item with `accordo.bridge.showStatus` command (Hub URL, connection state, tool count, uptime). Never implemented. Add to `packages/bridge/src/extension.ts` in a quick-fix session before Session 10.
9. **Comments panel two-line layout (M46)** — VS Code `TreeItem` supports only one physical line (label + description). Full conversation preview requires a `WebviewView` detail pane. Deferred to M46 (post Session 10).
10. **Scripted Walkthroughs (Session 10D)** — Multi-step sequences (speech + IDE commands + delays + highlights) separated from voice extension. Works with subtitles or silent mode. See Session 10D outline in §6.
11. **TTS inter-sentence silence (speech fluency)** — A perceptible gap exists between synthesized sentences during streaming playback. Hypothesis: Kokoro engine appends trailing silence to each audio clip. Investigate: read synthesized PCM, detect silence at end, trim in `streamingSpeak` before playback boundary. Low priority — TTS is functional, gap is cosmetic.

---

### Voice Code Review — Hardening Tasks (from review 2026-03-10)

Identified in a post-session-10C code review. No blocking issues — voice is functional. Address before or during the next session that touches the voice package.

**P1 — Bugs affecting reliability:**

12. ~~**[P1] Bridge reconnect replays stale modality state**~~ — ✅ DONE (2026-03-27). `sendStateUpdate()` now shallow-merges patch into `lastState` in `ws-client.ts`. Reconnect (WS-07) replays correct merged state. Regression test added. 325 bridge tests green. Commit `6aa2d54`.

13. ~~**[P1] `bridgeUsable = false` is permanent after a single transient error**~~ — ✅ DONE (2026-03-27). Removed `bridgeUsable` guard from `syncUiAndState` in `packages/voice/src/extension.ts`. Transient `publishVoiceState` / `registerTools` errors are logged but no longer permanently disable bridge integration. Commit `9eb3bb1`. All 269 voice tests green.

14. ~~**[P1] `readAloud` tool-path is fire-and-forget with no session lock**~~ — ✅ DONE (2026-03-27). Added `onSpeakActive` callback dep to `ReadAloudToolDeps`. Each `streamSpeak` invocation creates a `CancellationToken`, cancels any prior token (session lock — no overlapping pipelines), and calls `onSpeakActive(cancelFn)`. `extension.ts` stores the handle in `activeStreamCancel`; `doStopNarration` now calls it so stop/pause commands reach agent-initiated playback. Regression tests M50-RA-13/14/15 added. Commit `0b3e954`. 272 voice tests green.

**P2 — Quality and correctness issues:**

15. ~~**[P2] `sherpa-onnx-node` pinned to `latest`**~~ — ✅ DONE (2026-03-27). Pinned to `1.12.28` (installed known-good version). Commit `0f6a357`.

16. ~~**[P2] Dead config entries `llmEndpoint` / `llmModel`**~~ — ✅ DONE (2026-03-27). Removed `accordo.voice.llmEndpoint` and `accordo.voice.llmModel` from `packages/voice/package.json`. All 269 voice tests green.

17. ~~**[P2] CSP nonce uses `Math.random()` — not cryptographically secure**~~ — ✅ DONE (2026-03-27). Replaced with `randomBytes(16).toString('hex')` from `node:crypto`. Commit `0f6a357`.

18. ~~**[P2] `doSpeakText` is a registered command that throws**~~ — ✅ DONE (pre-existing). M52-VS was implemented in a prior session; `doSpeakText` is fully wired and does not throw. Verified 2026-03-27.

19. ~~**[P2] `doResumeNarration` checks `isPlaying()` instead of FSM state**~~ — ✅ DONE (2026-03-27). Guard changed to `narrationFsm.state !== 'paused'`. `isPlaying()` was fragile because it returns true even when SIGSTOP-paused. Commit `0f6a357`.

**P3 — Informational / low risk:**

20. **[P3] Pre-spawned player only works on Linux** — `createPreSpawnedPlayer()` only pre-spawns a process on Linux (`aplay -`). On macOS (primary dev platform) it falls back to temp-file `playPcmAudio` for every sentence — the streaming latency benefit is largely absent on macOS. Not a bug, but the streaming pipeline docs imply latency benefits that only fully materialise on Linux. No action required unless macOS streaming latency becomes a complaint.

21. **[P3] Sherpa worker does not validate input fields before use** — `sherpa-worker.ts` passes `modelDir` directly from the parent's stdin JSON into file path strings without sanitization. Risk is minimal (stdin is only writable by the extension host process), but worth noting for future threat modelling if the worker IPC boundary widens.

22. **[P3] Vocabulary entry length / content not bounded** — `VoiceVocabulary` persists entries in `workspaceState` with no validation on `from`/`to` length. A very long `from` string causes O(n*m) scanning on every STT transcript. Low practical risk given the feature is user-controlled and single-user.

23. **[P3] `sox` availability cache is not re-checkable within a session** — `recordingAvailableCache` is set once on first dictation and never cleared. If the user installs sox mid-session, they must reload the VS Code window to pick it up. Minor UX friction; no fix required unless reported.

24. **Panel visibility in `IDEState`** — `accordo_layout_state` does not know whether the Output, Debug Console, Problems, or Comments bottom-bar panels are open. VS Code does not expose an `onDidChangeActivePanel` event. Agent can infer a lot from `openTabs` (webview panels) and `activeTerminal`. Full panel visibility would require a dedicated module using VS Code context + command side-effects. Deferred — to revisit if agent panel-awareness becomes a priority.

25. **Missing pane management tools in accordo-editor** — The VS Code pane management commands (`workbench.action.closeSidebar`, `workbench.action.togglePanel`) are not exposed as MCP tools. The editor modality lacks `closeSidebar`, `toggleSidebar`, `togglePanel`, `toggleZen` equivalents. **Fix:** Add 4 new MCP tools to `accordo-editor`: `accordo_panel_closeSidebar`, `accordo_panel_toggleSidebar`, `accordo_panel_togglePanel`, `accordo_panel_isPanelOpen` (read-only query). All map to `workbench.action.*` commands. No new infrastructure needed. ~2–3 tests.

26. **Missing markdown preview tool in accordo-editor** — No MCP tool exists to open or switch a markdown file to its rendered preview. `markdown.showPreviewToSide` is not accessible via MCP. Agents cannot request a rendered markdown view programmatically. **Fix:** Add `accordo_editor_openMarkdownPreview` and `accordo_editor_closeMarkdownPreview` tools to `accordo-editor`, mapping to `markdown.showPreview` / `markdown.showPreviewToSide` / `markdown.closePreview` VS Code commands. Also add `accordo_editor_isMarkdownPreviewOpen` query tool. ~2–3 tests.

26b. **Markdown Preview highlighting/annotation** — VS Code's built-in markdown preview (`CustomTextEditorProvider`) cannot receive editor decoration overlays from the agent. Agents cannot highlight specific lines or regions in a rendered markdown preview. Two implementation paths: (1) inject `<mark>` or styled `<span>` decorators into the rendered markdown HTML content itself (content-level, works without M95-VA), or (2) M95-VA overlay layer adapted for CustomTextEditorProvider surfaces. Requires new MCP tool `accordo_mdPreview_highlight` + content-script injection into the preview's DOM. Low effort if reusing existing highlight/anchor infrastructure. ~5–8 tests.

---

### Future Roadmap — Visual Annotation Layer (M95-VA)

> **Status:** FUTURE — Architectural reservation only. Not in current MVP or any active session.

27. **Visual Annotation Layer** — Agent visual marking of page elements during conversation (lines, frames, circles, highlights, callouts). Enables collaborative discussion where the agent can point at, circle, or highlight specific UI elements on a live browser page. Annotations are ephemeral (not persistent like comments) and tab-scoped. **Architecture:** `docs/architecture.md` §15. **Requirements:** `docs/requirements-browser-extension.md` §3.17 (reserved IDs VA-F-01..VA-F-15, VA-NF-01..VA-NF-03). **Module ID:** M95-VA. **Prerequisites:** Page understanding (M90/M91) complete and stable; enhanced anchor strategy (M90-ANC) battle-tested in production. **Estimated effort:** 1 session (~3 modules: overlay renderer, annotation manager, MCP tool registration). **Key design note:** Reuses enhanced anchor infrastructure, relay transport path, and `CommentBackendAdapter` portability pattern — no new transport mechanisms needed. Standalone MCP server compatibility included by design.

---

### Browser 2.0 — Page Understanding Upgrade Initiative

> **Status:** DESIGN COMPLETE — Architecture and requirements written. Ready for TDD execution.  
> **Architecture:** [`docs/browser2.0-architecture.md`](browser2.0-architecture.md)  
> **Requirements:** [`docs/requirements-browser2.0.md`](requirements-browser2.0.md)  
> **Evaluation framework:** [`docs/mcp-webview-agent-evaluation-checklist.md`](mcp-webview-agent-evaluation-checklist.md)

**Goal:** Close visibility and efficiency gaps between Accordo's browser tools and the evaluation checklist target (scorecard ≥30/45, no category below 2). Backward-compatible incremental upgrade in three phases.

**Phase P1 — Snapshot Versioning + Filtering + Diff** (next TDD session)

| Module | Scope | Requirements | Est. tests |
|---|---|---|---|
| M100-SNAP | Snapshot version manager in content script — monotonic IDs, SnapshotEnvelope on all responses, SnapshotStore (in-memory, 5-slot retention) | B2-SV-001..007 | ~30 |
| M101-DIFF | `browser_diff_snapshots` tool — added/removed/changed arrays, summary, implicit from/to, error codes | B2-DE-001..007 | ~25 |
| M102-FILT | Server-side filtering on `browser_get_page_map` — visibleOnly, interactiveOnly, roles, textMatch, selector, regionFilter, AND composition | B2-FI-001..008 | ~30 |
| M103-CANC | Comment anchor v2 — snapshotId in anchor metadata, confidence scoring, drift detection, resolvedTier | B2-CA-001..004 | ~15 |

**Dependencies:** Current baseline green (2,967 tests). No Chrome extension manifest changes required.  
**Success criteria:** All P1 requirements pass. Existing 474 browser/browser-ext tests still green. Evaluation checklist category G (Deltas/Efficiency) scores ≥3. Category H (Robustness) is deferred to P3 success criteria (includes wait primitives).

**Phase P2 — Visibility Depth** (after P1 stabilizes)

| Module | Scope | Requirements | Est. tests |
|---|---|---|---|
| M104-SHADOW | Shadow DOM piercing — open root traversal, host ID, closed root reporting, opt-in default | B2-VD-001..004 | ~20 |
| M105-IFRAME | Iframe traversal — same-origin via all_frames, iframe metadata array, cross-origin opacity, error codes | B2-VD-005..009 | ~20 |
| M106-OCCL | Z-order occlusion detection — center-point and corners modes, element cap, skip hidden, visibility model | B2-VD-010..013 | ~25 |
| M107-VIRT | Virtualized list detection heuristic — container hint, rendered range, total item estimate | B2-VD-014..015 | ~10 |
| M110-CORE | Extract `@accordo/browser-core` package — port interfaces, zero external deps, detachable from Accordo | B2-NF-001 | ~15 |

**Dependencies:** P1 tools stable for ≥1 session. Chrome manifest update (`all_frames: true`) for M105-IFRAME. `@accordo/browser-core` extraction (M110-CORE) enables P2 visibility depth code to land in the detachable package from the start.  
**Success criteria:** All P2 requirements pass. Evaluation checklist categories C (Semantic Structure) and D (Layout/Geometry) score ≥3. `@accordo/browser-core` is importable with zero VSCode/Accordo dependencies.

**Phase P3 — Privacy, Wait, Annotations** (after P2 stabilizes)

| Module | Scope | Requirements | Est. tests |
|---|---|---|---|
| M108-PRIV | Privacy/redaction — origin allow/block lists, PII redaction in text, audit trail, fail-closed semantics | B2-PS-001..007 | ~25 |
| M109-WAIT | `browser_wait_for` tool — text, selector, stable layout, timeout, navigation/close interrupts | B2-WA-001..007 | ~20 |
| M95-VA | Visual Annotation Layer — overlay renderer, annotation manager, MCP tool registration (existing roadmap item) | VA-F-01..VA-F-15 | ~30 |

**Dependencies:** P2 tools stable. `@accordo/browser-core` (extracted in P2 M110-CORE) is prerequisite for M95-VA standalone compatibility.  
**Success criteria:** All P3 requirements pass. Evaluation checklist categories H (Robustness) score ≥3 and total score ≥30/45, no category below 2. Standalone MCP server adapter is buildable from `@accordo/browser-core`.

**Immediate next TDD module:** M100-SNAP (Snapshot Version Manager)  
**Estimated effort per phase:** 1 TDD session each (P1: ~4 modules, P2: ~4 modules, P3: ~4 modules)

---

## DONE

### Session 15 — Page Understanding + Region Capture (completed 2026-03-26)

M90-MAP/INS/ANC/ACT + M91-PU/CR + M92-CR delivered. 4 MCP tools: `browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_capture_region`. 6-tier enhanced anchor strategy (id → data-testid → aria → css-path → tag-sibling → viewport-pct). `OffscreenCanvas` region crop with 500 KB retry. Full HTML sanitization in DOM excerpts (script/style/iframe stripped, javascript:/data: URLs removed, on* attributes stripped). 313 new tests (browser-ext: 343 total, browser: 115 total). Full monorepo: 2,949 tests green. Testing guide: [`docs/testing-guide-session-15.md`](testing-guide-session-15.md).

---

### Session 15b — Browser Hardening + Docs Reconciliation (completed 2026-03-27)

Hardening follow-up after Session 15 live validation, focused on browser comment reliability:

- Fixed relay/tooling integration gaps that caused missing page-understanding tool exposure and false-success fallback responses
- Fixed browser thread hydration mismatches (URL/hash normalization) and stale pin render behavior after reload
- Fixed anchor persistence + resolution path for browser comments (`coordinates.type="block"`, robust `anchorKey` recovery)
- Added enhanced right-click anchor generation path for newly created comments (reduced ambiguous legacy `tag:sibling:fingerprint` keys)
- Fixed pin reposition behavior for scroll-heavy pages and nested scroll containers
- Re-ran live E2E user journeys (comment placement, rehydration, region capture, multi-pin behavior) and updated docs accordingly

Updated package baselines: browser-extension 357 tests, browser 117 tests, comments 347 tests, comment-sdk 47 tests. Full monorepo baseline: 2,967 tests.

---

### Session 13 — Browser Extension v2a (completed 2026-03-23)

SDK convergence adapter (M81-SDK), `packages/browser` relay server + auth + request router (M82-RELAY), browser relay tool registration `accordo_browser_*` + end-to-end mutation contract (M83-BTOOLS). All 8 relay tools wired and callable. Live UI refresh on relay/agent mutations. Manual validation confirmed. browser: 11 tests, browser-extension: 165 tests. Total: 2548 tests green. Committed `edfb6a5`.

---

### Session 14 — Unified Comments Contract (completed 2026-03-23)

M84-TOOLS: 7 unified comment tools (`comment_list`, `comment_get`, `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`) with `scope.modality` routing (editor|browser|voice). `deleteScope` on `comment_delete`. Agent reopen restriction removed.

M85-PANEL: Comments Tree Provider with surface-type icons (globe for browser, file for editor), normalized browser coordinates as `(50%, 50%)`, separate browser/editor section headers, `deleteAllByModality()` for bulk cleanup.

M86-MIGRATE: `accordo_browser_*` tools NOT registered as MCP tools. Chrome extension forwards all mutations through relay WebSocket to `accordo-browser` `onRelayRequest` interceptor, which routes to unified `comment_*` tools. `BridgeAPI.invokeTool()` enables VS Code CommentStore updates from Chrome events. `RelayBridgeClient.send()` with pending request map for bidirectional Chrome ↔ accordo-browser communication.

Tool naming: MCP server `accordo-hub` → `accordo`; tools `accordo_comment_*` → `comment_*`; `accordo_browser_*` → `browser_*`.

42 new tests. Total: 2,636 tests green. Committed `505e072`.

---

### Session 12 — Browser Extension v1 (completed 2026-03-22)

Standalone Chrome Manifest V3 extension — 12 modules (M80-TYP/SM/STORE/SW/CS-PINS/CS-INPUT/CSS/EXPORT/SCREEN/MCP/POP/MANIFEST). Comments stored in `chrome.storage.local`, export to clipboard, keyboard shortcut toggle, right-click comment mode, screenshot on export. 165 tests. Committed `62b20bc`.

---

### Marp Migration (completed 2026-03-22)

Presentation engine migrated from Slidev to Marp Core (`packages/marp`). In-process rendering (no dev server, no port management). Full MCP tool surface parity with slidev: discover/open/close/listSlides/getCurrent/goto/next/prev/generateNarration. 226 tests. Committed `5d1dcfc`. See [`docs/workplan-marp.md`](workplan-marp.md).

---

### Session 10C — Voice Robustness + Hardening (completed 2026-03-10)

15 fixes delivered. Dynamic port, WS disconnect, sherpa subprocess (system Node), readAloud fire-and-forget, Hub crash guards, Hub log cleanup, WS diagnostic logging, readAloud simplification. Hub: 360, Voice: 261. 1689 tests total. See Session 10C section above.

---

### Session 9 — Custom Comments Panel (completed 2026-03-07)

M45-TP/NR/CMD/FLT/EXT delivered. 76 new tests (273 total in accordo-comments). Panel sidebar replaces built-in VS Code Comments panel. Cross-surface navigation (text → text editor, slide → Slidev, preview → md-viewer). Filter state persisted. Post-gate manual testing round fixed 8 issues (see gate notes above).

---

### Phase 1 — Control Plane MVP (completed 2026-03-03)

Full record in [`docs/archive/workplan-phase1.md`](archive/workplan-phase1.md).

**Summary:** 34 modules, 797 tests (Hub: 329, Bridge: 296, Editor: 172), 21 MCP tools, v0.1.0 tagged and pushed.

### Phase 2 Week 6 — accordo-comments core (completed 2026-03-04)

M35–M40 delivered. 177 new tests. Total: 996 (Hub: 335, Bridge: 298, Editor: 186, Comments: 177).
Extras: URI normalization, `updatedSince`/`lastAuthor` smart filters, Comments panel context menus.
