# Accordo IDE — Phase 2 Workplan

**Project:** accordo-ide  
**Phase:** 2 — Modalities (Comments, Presentations, Voice, Diagrams)  
**Date:** 2026-03-15  
**Status:** ACTIVE — Session 11 complete (accordo-diagram core ✅, A16/A17 ✅), Session 12 next (TD-CROSS-1 or diag.2)

---

## Current Status

> **As of 2026-03-15 — Session 11 complete. `accordo-diagram` delivers a fully working Mermaid → Excalidraw canvas modality: parser (flowchart), auto-layout (dagre), reconciler, canvas generator, 6 MCP tools (`accordo_diagram_list/get/create/patch/render/style_guide`), Webview panel (A15), Excalidraw webview frontend (A16), extension entry/registry (A17), custom editor for `.mmd` files, `x`/`y`/`clusterStyles` in `accordo_diagram_patch` so agents never write layout files directly, aux files at `<workspace>/.accordo/diagrams/`. VSIX-ready — all 17 diag.1 modules done. 444 diagram tests. 2281 total (Hub: 360, Voice: 269, Bridge: 310, Editor: 172, Comments: 273, SDK: 45, md-viewer: 126, slidev: 149, Script: 133, Diagram: 444). TypeScript clean. Committed and pushed.**

| Phase | Goal | Status |
|------|------|--------|
| Phase 1 | Control Plane MVP (Hub + Bridge + Editor) | ✅ DONE — 797 tests, v0.1.0 |
| Phase 2 | Comments modality (`accordo-comments`) | ✅ DONE — Week 6+7 complete, 1221 tests |
| Phase 3 | Presentations modality (`accordo-slidev`) | ✅ DONE — Session 8B complete, 137 tests |
| Session 9 | Custom Comments Panel (M45 — `accordo-comments` update) | ✅ DONE — 273 comments tests, 1418 total |
| **Session 10** | **Voice modality (`accordo-voice` — 10A core+tools, 10B summary narration, 10C robustness)** | ✅ DONE — 10A: 211; 10B: +25; 10C: hardening + simplification, 261 total voice tests |
| **Session 10D** | **Scripted walkthroughs (`accordo-script` — ScriptRunner, 4 MCP tools, Bridge dual-registration)** | ✅ DONE — 133 tests |
| **Session 11** | **Diagrams modality (`accordo-diagram` — Mermaid + Excalidraw, A1-A17, all diag.1 modules, custom editor + patch enhancements)** | ✅ DONE — 444 tests |
| Session 12+ | Browser agentation (`accordo-browser` + Chrome extension) | 📋 DEFERRED — architecture + requirements written, complex anchoring needs more design |

**Baseline:** 2281 tests green (Hub: 360, Voice: 269, Bridge: 310, Editor: 172, Comments: 273, SDK: 45, md-viewer: 126, slidev: 149, Script: 133, Diagram: 444). v0.1.0 on `main`.  
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
| M60-BT | `@accordo/bridge-types` — add `CssSelectorCoordinates`, `BrowserRelayMessage`, `BrowserTabInfo` | requirements-browser.md §3 | A → F |
| M61-REL | `browser-relay.ts` — local WebSocket server, auth, multi-client routing | requirements-browser.md §4 M61 | A → F |
| M62-CBR | `browser-comments-bridge.ts` — message routing ↔ surface adapter, blockId codec | requirements-browser.md §4 M62 | A → F |
| M64-SEL | `selector-utils.ts` — blockId encode/decode, pure functions | requirements-browser.md §4 M64 | A → F |

**Session 12A gate:** BrowserRelay accepts WebSocket connections with auth. BrowserCommentsBridge routes comment messages to CommentStore. Integration test: mock client → relay → adapter → thread created with `surfaceType: "browser"` and `CssSelectorCoordinates`.

#### Session 12B — VSCode Extension Completion + Chrome Extension Core

**Goal:** State contribution, extension entry point. Chrome extension DOM auto-tagger, selector generator, fingerprint. Content script bootstraps Comment SDK.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M63-STATE | `browser-state.ts` — publishes connected tabs + comment counts to Hub | requirements-browser.md §4 M63 | A → F |
| M65-EXT | `extension.ts` — activation, wiring, token generation, commands | requirements-browser.md §4 M65 | A → F |
| M66-TAG | `dom-tagger.ts` — DOM element tagging with `data-block-id` | requirements-browser.md §5 M66 | A → F |
| M67-CSS | `selector-generator.ts` — minimal unique CSS selector paths | requirements-browser.md §5 M67 | A → F |
| M68-FP | `text-fingerprint.ts` — FNV-1a hash of element text | requirements-browser.md §5 M68 | A → F |

**Session 12B gate:** VSCode extension activates, generates token, starts relay. DOM auto-tagger correctly assigns blockIds in jsdom. Selector generator produces unique selectors. Fingerprint is deterministic.

#### Session 12C — Chrome Extension Completion + Automation Docs

**Goal:** Service worker, content script SDK integration, popup UI, theme CSS. Playwright setup documentation.

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| M69-SW | `service-worker.ts` — WebSocket client, message routing, reconnection | requirements-browser.md §5 M69 | A → F |
| M70-CS | `content-script.ts` — SDK initialization, callback wiring, scroll/resize | requirements-browser.md §5 M70 | A → F |
| M71-POP | `popup.html` + `popup.ts` — configuration UI, connection status | requirements-browser.md §5 M71 | A → F |
| M72-THM | `browser-theme.css` — VS Code CSS variable mappings for browser | requirements-browser.md §5 M72 | A → F |
| M73-AUTO | Browser automation setup docs + optional helper command | requirements-browser.md §6 M73 | A → F |

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
10. **Scripted Walkthroughs (Session 10D)** — Multi-step sequences (speech + IDE commands + delays + highlights) separated from voice extension. Works with subtitles or silent mode. See Session 10D outline in §6.
11. **TTS inter-sentence silence (speech fluency)** — A perceptible gap exists between synthesized sentences during streaming playback. Hypothesis: Kokoro engine appends trailing silence to each audio clip. Investigate: read synthesized PCM, detect silence at end, trim in `streamingSpeak` before playback boundary. Low priority — TTS is functional, gap is cosmetic.

---

### Voice Code Review — Hardening Tasks (from review 2026-03-10)

Identified in a post-session-10C code review. No blocking issues — voice is functional. Address before or during the next session that touches the voice package.

**P1 — Bugs affecting reliability:**

12. **[P1] Bridge reconnect replays stale modality state** — `WsClient.sendStateUpdate()` sends incremental patches but never updates `lastState`. On reconnect, `_scheduleReconnect()` replays the stale snapshot from initial connection time. Voice prompt directives in Hub drift until the next explicit state mutation. Fix: merge each `sendStateUpdate` patch into `lastState` in `ws-client.ts`, or have `sendStateSnapshot` pull from `StatePublisher.currentState`. Evidence: `packages/bridge/src/ws-client.ts` (reconnect path) + `packages/bridge/src/state-publisher.ts` (`publishState`).

13. **[P1] `bridgeUsable = false` is permanent after a single transient error** — In `extension.ts`, any `publishState` or `registerTools` error sets `bridgeUsable = false` and there is no code path that ever resets it. A brief bridge restart or activation race permanently disables voice state publishing and MCP tool availability for the VS Code session lifetime. Fix: retry on next config change / state push, or implement a bridge health re-check path. Evidence: `packages/voice/src/extension.ts` (two `bridgeUsable = false` assignments in `syncUiAndState` and tool registration catch block).

14. **[P1] `readAloud` tool-path is fire-and-forget with no session lock** — Two rapid `accordo_voice_readAloud` tool calls can spawn overlapping `streamSpeak` pipelines that race on `narrationFsm` transitions and produce overlapping audio. Additionally, `doStopNarration()` / `doPauseNarration()` operate on `activeNarrationPlayback` (command path) and cannot cancel tool-initiated `streamSpeak` playback, so the stop command has no effect on agent-narrated text. Fix: introduce a session-level playback lock and store a cancellation handle for the active `streamSpeak` pipeline so stop/pause/resume commands reach it. Evidence: `packages/voice/src/tools/read-aloud.ts` (fire-and-forget `void streamSpeak(...)`) + `packages/voice/src/extension.ts` (`doStopNarration` only touches `activeNarrationPlayback`).

**P2 — Quality and correctness issues:**

15. **[P2] `sherpa-onnx-node` pinned to `latest`** — The native TTS dependency is unprefixed (`"sherpa-onnx-node": "latest"`), making installs non-reproducible across machines and time; a binary ABI change can silently break TTS without a code change. Fix: pin to the current known-good version (e.g. `"1.10.38"`). Evidence: `packages/voice/package.json`.

16. **[P2] Dead config entries `llmEndpoint` / `llmModel`** — `package.json` still contributes `accordo.voice.llmEndpoint` and `accordo.voice.llmModel` to VS Code settings, but voice-architecture.md ADR-03 explicitly says there is no LLM in the voice extension (summary mode is agent-driven). These settings are never read anywhere in the code. They appear in the Settings UI and mislead debugging. Fix: remove both configuration contributions from `packages/voice/package.json`.

17. **[P2] CSP nonce uses `Math.random()` — not cryptographically secure** — `generateNonce()` in `voice-panel.ts` uses `Math.floor(Math.random() * ...)`. CSP nonces must be unpredictable to be effective. Fix: replace with `import { randomBytes } from 'node:crypto'; randomBytes(16).toString('hex')`. Evidence: `packages/voice/src/ui/voice-panel.ts`.

18. **[P2] `doSpeakText` is a registered command that throws** — The `accordo.voice.speakText` command is registered and callable programmatically (despite `"enablement": "false"` in package.json which only hides it from the palette), but its handler `doSpeakText` contains `throw new Error("not implemented")`. Any call from `accordo-script` or another extension will throw an unhandled error. Fix: implement the handler (M52-VS) or replace the throw with a graceful no-op / warning message. Evidence: `packages/voice/src/extension.ts` line ~472.

19. **[P2] `doResumeNarration` checks `isPlaying()` instead of FSM state** — The guard `if (!activeNarrationPlayback?.isPlaying()) return` is fragile: `isPlaying()` returns `true` even when paused via `SIGSTOP` (the flag is only cleared on process close). The semantically correct guard is `narrationFsm.state === 'paused'`. Works by coincidence now, but future platform changes could silently break resume. Evidence: `packages/voice/src/extension.ts` `doResumeNarration`.

**P3 — Informational / low risk:**

20. **[P3] Pre-spawned player only works on Linux** — `createPreSpawnedPlayer()` only pre-spawns a process on Linux (`aplay -`). On macOS (primary dev platform) it falls back to temp-file `playPcmAudio` for every sentence — the streaming latency benefit is largely absent on macOS. Not a bug, but the streaming pipeline docs imply latency benefits that only fully materialise on Linux. No action required unless macOS streaming latency becomes a complaint.

21. **[P3] Sherpa worker does not validate input fields before use** — `sherpa-worker.ts` passes `modelDir` directly from the parent's stdin JSON into file path strings without sanitization. Risk is minimal (stdin is only writable by the extension host process), but worth noting for future threat modelling if the worker IPC boundary widens.

22. **[P3] Vocabulary entry length / content not bounded** — `VoiceVocabulary` persists entries in `workspaceState` with no validation on `from`/`to` length. A very long `from` string causes O(n*m) scanning on every STT transcript. Low practical risk given the feature is user-controlled and single-user.

23. **[P3] `sox` availability cache is not re-checkable within a session** — `recordingAvailableCache` is set once on first dictation and never cleared. If the user installs sox mid-session, they must reload the VS Code window to pick it up. Minor UX friction; no fix required unless reported.

---

## DONE

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
