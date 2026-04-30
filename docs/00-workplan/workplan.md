# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-24
**Status:** Tool-by-tool live validation is active. Terminal control tools (`open/run/focus/list/close`) are working. Priority 0 is now **partially completed**: `comment_list` reliability and markdown comment navigation fixes landed on 2026-04-23 (`93526dc`, `bd60d14`); remaining Priority 0 items stay open below.  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### Priority 0 — Layout State Payload Slimming + Comment List Reliability (Highest Priority)

**Status:** In progress from live validation (2026-04-23). Partial fixes completed (2026-04-23); remaining items pending.

**Problem:** `accordo_layout_state` currently embeds detailed comment thread payloads. At realistic workspace scale (many open files + dozens of comments), this can consume large token budgets and degrade agent efficiency. In parallel, `comment_list` failed to return expected open threads in live checks even though threads were present (`comment_sync_version`/`layout_state` confirmed data).

**Additional live bug (2026-04-23):** After deleting comments from the store (thread count reached 0), at least one inline comment artifact remained visible in the editor surface. This indicates a UI/store synchronization gap (stale decoration/thread widget not cleared).

**Update (2026-04-23):** Primary store→VS Code teardown sync fix landed in `93526dc` (bulk delete ID propagation + native widget disposal). Keep this item open until revalidated for all surfaces/entry paths.

**Additional live bug (2026-04-23):** ~~Using "travel-to-comment" on Markdown comments opens the `.md` file in plain text editor instead of Markdown preview.~~ **Resolved in `bd60d14`** with panel/router + controller regression coverage.

**Additional live bug (2026-04-23):** ~~Opening Markdown files from comment/navigation flows does not consistently default to Markdown preview (falls back to text editor in some paths).~~ **Resolved for comments navigation paths in `bd60d14`;** non-comments open-path behavior remains tracked separately where applicable.

**Additional UX gap (2026-04-23):** There is no explicit MCP control to switch an already-open Markdown file between preview and text-editor surfaces on demand. Agents need deterministic surface switching for workflows like format/edit (text) vs review/read (preview).

**Additional live bug (2026-04-23):** `accordo_layout_panel` open actions work, but close actions fail due to a schema/runtime contract mismatch. Runtime requires omitting `view` for `action:"close"`, while tool-call path sends/retains `view`, causing close requests to be rejected.

**Additional live bug (2026-04-23):** `accordo_panel_toggle` command invocation succeeds but observed behavior may be open-only/no-op rather than true toggle. Current response payload does not expose resulting state, making verification ambiguous.

**Additional live bug (2026-04-23):** `accordo_voice_readAloud` failed in live MCP call with `ExternalTtsAdapter: HTTP 500 — Internal Server Error` on a minimal payload. Voice/TTS path needs reliability hardening and error-path diagnostics.

**Additional live bug (2026-04-23):** `accordo_presentation_open` returned an empty payload on success (no explicit `{ opened: true, ... }` acknowledgment). Functionality works (verified via `accordo_presentation_getCurrent`), but the open response contract is ambiguous and harder to validate programmatically.

**Additional live bug (2026-04-23):** Slide comments are present in comment store metadata but not visible in Marp view. Replying to those slide threads via `comment_reply` fails with `Webview is disposed` even after reopening the deck, indicating a Marp comment-surface lifecycle/attachment mismatch.

**Additional live bug (2026-04-23):** Marp comment visibility is inconsistent by author/source: user comments (and at least one existing reply) became visible, while agent-created slide comments remained non-visible in Marp despite existing in comment store metadata. Indicates projection/render filtering mismatch rather than pure store persistence issue.

**Additional UX/runtime gap (2026-04-23):** `accordo_webview_capture` default output path writes into the deck directory. For autonomous agents this is risky/noisy (repo pollution) because agents may omit `output_path` and not realize artifacts should be temporary.

**Additional live bug (2026-04-23):** `accordo_webview_capture` returned a very small SVG artifact (~534 bytes) that did not contain usable slide content in live testing. Capture path reports success but output fidelity is incorrect/unreliable.

**Additional live bug (2026-04-23):** Deleting a comment removes it from store and Markdown preview, but stale inline UI remains in the text editor for the same file; the text-editor delete button then no-ops. This is a cross-surface synchronization + command wiring failure.

**Decision:**
1. Remove detailed comment thread bodies from `accordo_layout_state`.
2. Keep `layout_state` comment data as summary-only metadata (counts + lightweight previews at most).
3. Make `comment_list` the authoritative listing API for comments and fix its live filtering/retrieval reliability.

**Planned module scope:**
1. Redesign `accordo_layout_state` comment payload contract to be lightweight and bounded.
2. Audit and fix `comment_list` filter/path logic so open threads are consistently returned across modalities/file scopes.
3. Add regression tests covering mismatch cases: `threadCount > 0` with empty `comment_list` results must fail.
4. Add payload-budget tests/assertions for `layout_state` response size under large synthetic comment sets.
5. Update docs and tool guidance: use `layout_state` for orientation summary, `comment_list/get` for details.
6. Fix comment UI teardown sync so deleting threads/comments from store reliably removes inline/editor artifacts.
7. Fix comment navigation for Markdown so travel/focus actions open preview surface by default (with correct line focus), not plain text unless explicitly requested.
8. Fix cross-surface deletion propagation so preview/editor representations stay consistent and editor-side delete actions are wired to live thread IDs.
9. Add explicit surface-switch control for Markdown (`preview` ↔ `editor`) so agents can deterministically move between read/review and edit/format flows.
10. Fix `accordo_layout_panel` close contract so area-close works reliably (either make `view` truly optional in schema/runtime or ignore `view` on close).
11. Verify/fix `accordo_panel_toggle` semantics so repeated calls deterministically toggle state (or deprecate in favor of explicit `accordo_layout_panel` once close is fixed).
12. Debug/fix `accordo_voice_readAloud` HTTP 500 path; add diagnostics + fallback behavior so tool failure is actionable and non-silent.
13. Normalize `accordo_presentation_open` success response to include explicit acknowledgement payload for deterministic automation checks.
14. Fix Marp slide comment rendering + lifecycle wiring so stored slide comments are visible in-view and `comment_reply` does not fail with `Webview is disposed` for active deck sessions.
15. Normalize Marp comment projection so visibility is consistent across author kinds/sources (user vs agent-created), with deterministic rendering for all stored slide threads.
16. Change `accordo_webview_capture` default output destination to a safe temp artifacts location (e.g. workspace `tmp/accordo-artifacts/` or user temp dir) and document the retention behavior.
17. Fix `accordo_webview_capture` output fidelity so successful captures contain real slide content at expected size/structure, not tiny placeholder/empty SVGs.

**Completed within Priority 0 (2026-04-23 / 2026-04-24):**
1. `comment_list` filter/path reliability fixes for URI-equivalent forms and untagged-intent visibility (`bd60d14`).
2. Markdown comment navigation routing fixed for panel/native flows with preview-aware behavior and focused-editor fallback (`bd60d14`).
3. Store→VS Code delete synchronization hardened for thread/comment deletion and bulk delete notifications (`93526dc`).
4. Marp slide comment visibility fixed: `comments:load` now sent only after `webview:ready`, eliminating the race condition that dropped the initial push (`e94efb1`, `f6a9f0b`). Items 14 & 15 resolved.
5. `accordo_layout_panel` close with `view` param now silently ignores `view` instead of erroring — agents can pass `view` on close without rejection (`13026b3`). Item 10 resolved.
6. `accordo_presentation_open` success response now returns `{ opened: true, deckUri }` for deterministic automation checks (`1f28f52`). Item 13 resolved.
7. `ExternalTtsAdapter` HTTP error messages now include cause classification (auth/endpoint-not-found/server-error/client-error) and response body excerpt for actionable diagnostics (`d2d7726`). Item 12 partially resolved (diagnostics improved; root cause of HTTP 500 in live setup is external endpoint configuration).

**Acceptance criteria:**
1. `accordo_layout_state` no longer includes full comment thread bodies.
2. `comment_list` reliably returns open threads that exist in store for equivalent scope/filter queries.
3. Cross-tool consistency holds: when `comment_sync_version.threadCount > 0`, discoverable thread listings are available via `comment_list` for valid scopes.
4. Token footprint of `layout_state` is significantly reduced and remains bounded as comment volume grows.
5. All affected package tests pass with new contracts.
6. Deleting a thread/comment via API/store leaves no stale comment artifact in open editor/preview surfaces.
7. "Travel-to-comment" for `.md` anchors opens Markdown preview by default and lands on the expected location.
8. Deleting from any surface (preview, editor, comments panel, API) removes the comment from all open surfaces; editor delete controls never no-op against already-deleted threads.
9. Agent can explicitly switch a Markdown file from preview to text editor (and back) via MCP without ambiguous fallback behavior.
10. `accordo_layout_panel` supports both open and close operations for sidebar/panel/rightBar without schema ambiguity or rejected close calls.
11. `accordo_panel_toggle` either (a) truly toggles and reports resulting state, or (b) is deprecated with documented replacement path.
12. `accordo_voice_readAloud` succeeds on baseline payloads in normal dev setup, and failure responses include actionable cause classification.
13. `accordo_presentation_open` success response includes explicit structured confirmation (not empty body) and can be validated without follow-up probe calls.
14. For active Marp sessions, slide comments are visible on target slides and thread replies succeed consistently via `comment_reply`.
15. No author/source-based visibility drift in Marp: agent-created and user-created slide comments render consistently when present in the same store/session.
16. Calling `accordo_webview_capture` without `output_path` never writes into docs/source directories by default; output lands in configured temp artifacts location.
17. `accordo_webview_capture` success outputs pass content-validity checks (non-trivial SVG structure/size and visually correct slide export).

**Partially met acceptance criteria (2026-04-23):** #2, #6, #7.

**Execution note:** Blocker priority — complete before adding more generic control-surface/tool breadth work.

---

### Priority J — Browser MCP Closeout

**Implementation status:** Approved for production agent workflows in the current MCP WebView checklist review.
**Current independent checklist score:** **36/45** based on `docs/50-reviews/browser-mcp-checklist-review-2026-04-29.md`.
**Historical targeted live score:** **44/45** based on `docs/50-reviews/browser-mcp-live-eval-wave8-2026-04-07.md`; that Wave 8 run used a broader targeted evidence matrix and is retained as historical implementation evidence, not the current closeout score.

**Completed closeout hardening (2026-04-28 / 2026-04-30):**
1. Snapshot handle identity hardened so stale snapshot-scoped `uid`/`ref`/`nodeId` cannot silently resolve to the wrong element (`ff1bbcc`).
2. `diff_snapshots` retained-snapshot selection and mismatch errors stabilized (`5da9d79`).
3. Local snapshot management and `manage_snapshots` contract fixed (`a229642`).
4. Browser tool runtime contracts and descriptions hardened (`e73331b`).
5. Redaction now preserves machine identifiers and anchor handles while still redacting text-bearing PII (`0d2c8c2`, `f390181`).
6. Spatial relations now rejects malformed/mixed identity requests with structured `invalid-request` errors before relay (`38bbe5e`).
7. Independent reviewer approved the current browser MCP/WebView surface against `docs/30-development/mcp-webview-agent-evaluation-checklist.md` with all must-haves satisfied and no blocking findings (`docs/50-reviews/browser-mcp-checklist-review-2026-04-29.md`).
8. `get_spatial_relations` live-wrapper ergonomics are covered by schema/description guidance, empty-array acceptance, exact-one validation, and recovery hints (`spatial-tool-contract-valid.test.ts`, `spatial-tool-contract-invalid.test.ts`).
9. Browser redaction false-positive risk reduced for ordinary numeric page text; tests now cover dimensions, coordinates, dates, video IDs, long digit identifiers, and prose-like numbers in both browser and browser-extension redaction paths.
10. CDP viewport/full-page capture dimensions are now derived when Chrome's `Page.captureScreenshot` omits width/height, using the snapshot envelope for viewport captures and `Page.getLayoutMetrics` content size for full-page captures.
11. OCR-assisted screenshot redaction decision documented as deferred/out of current scope; current coverage remains DOM text-map/bounding-box based and does not claim image-only PII redaction.
12. Browser-extension reconnect scheduling is covered for missing-token/unauthorized direct bridge retries, transport duplicate-close/token-refresh reconnect paths, and token-poll close/reconnect races; `RelayTransport.scheduleReconnect()` now deduplicates pending reconnect timers.
13. Added compact live browser closeout checklist covering background-tab reads, control tools, stale snapshot/diff flow, and screenshot capture/list/clear (`docs/40-testing/testing-guide-browser-closeout.md`).
14. Refreshed browser MCP requirements and browser-extension module map to remove stale pre-closeout score language and align docs with the current split capture/page/snapshot modules.

**Remaining improvements:** None currently tracked for Priority J. Reopen this priority only if live closeout smoke testing finds a new browser regression.

**Key evidence:**
- Current checklist review: `docs/50-reviews/browser-mcp-checklist-review-2026-04-29.md`
- Plan: `docs/50-reviews/M110-TC-45-45-plan.md`
- Wave 6 review: `docs/50-reviews/browser-mcp-wave6-eval-2026-04-06.md`
- Wave 7 live eval: `docs/50-reviews/browser-mcp-live-eval-wave7-2026-04-07.md`
- Wave 8 live eval: `docs/50-reviews/browser-mcp-live-eval-wave8-2026-04-07.md`

---

### Priority W — Generic VS Code Command Gateway (`accordo_vscode_command_*`)

**Status:** Completed (2026-04-25) — gateway implemented, first migration wave removed, skill/playbook added.

**Phase A design notes (2026-04-25):**
1. The first removal wave is confirmed for `accordo_editor_reveal`, `accordo_editor_split`, `accordo_layout_evenGroups`, `accordo_layout_joinGroups`, `accordo_editor_save`, `accordo_editor_saveAll`, `accordo_editor_format`, `accordo_layout_zen`, `accordo_layout_fullscreen`, `accordo_diagram_list`, `accordo_diagram_get`, and `accordo_diagram_style_guide`.
2. Only command-backed scenarios move to `accordo_vscode_command_execute`. Diagram list/get/style-guide are explicitly **not** command-backed and migrate to file/skill/script workflows instead.
3. `revealInExplorer` needs a narrow path→`vscode.Uri` hydration layer inside the gateway runtime; save/format with a target path require an explicit `accordo_editor_open` focus step before command execution.
4. Runtime-visible docs remain canonical: playbook content must be mirrored into tool descriptions / MCP docs resources / server instructions, not left only in repo-local skills.

**Problem:** Long-tail VS Code functionality is large and changes over time (core + extension-contributed commands). Maintaining one dedicated MCP wrapper per low-value command does not scale.

**Intent:** Keep strongly-typed first-class MCP tools for common/high-signal workflows, and add a guarded generic command gateway for non-essential/long-tail capabilities.

**Planned module scope:**
1. Add `accordo_vscode_command_list` to discover available command IDs (public + optional internal).
2. Add `accordo_vscode_command_execute` to run a command ID with arguments through `vscode.commands.executeCommand`.
3. Add safety policy layer (allow/deny/risk classes + confirmation requirements for destructive commands).
4. Add structured audit logging for command ID, args shape, caller context, outcome/error.
5. Add docs for reliability caveats (internal command instability, interactive command limitations).

**Adoption/migration note:**
- Use this gateway for non-essential capabilities first.
- The first migration wave has **two categories**:
  1. **Command-backed wrappers replaced by the gateway:** `accordo_editor_reveal`, `accordo_editor_split`, `accordo_layout_evenGroups`, `accordo_layout_joinGroups`, `accordo_editor_save`, `accordo_editor_saveAll`, `accordo_editor_format`, `accordo_layout_zen`, `accordo_layout_fullscreen`.
  2. **Diagram helper removals replaced by non-command fallbacks:** `accordo_diagram_list`, `accordo_diagram_get`, `accordo_diagram_style_guide`.
- Provide an agent-facing usage skill/playbook with practical examples mapping common intentions to command IDs + arg shapes ("back door" guidance for long-tail commands).
- In that skill/playbook, highlight the command-backed migrated examples (reveal/split/even/join/save/saveAll/format/zen/fullscreen) with expected argument shapes, sequencing, and fallback behaviors.
- Document the diagram helper removals separately as file/script/skill/runtime-doc workflows, not as gateway command examples.
- For diagram metadata extraction currently covered by `accordo_diagram_get`, provide a script-based fallback/standard path in the generic workflow (read `.mmd` + parse/inspect via script) and document expected output shape.
- Do not keep separate "documentation pointer" MCP tools. Guidance/skill references must live in runtime tool documentation (tool descriptions + MCP docs resources + server instructions) instead of dedicated helper tools.
- Explore and document how to reliably read mode state (e.g., fullscreen/zen on/off) after command execution; if no native signal exists, define an explicit state-probe strategy.

**Acceptance criteria:**
1. Agent can discover commands and execute approved ones without adding a bespoke MCP tool.
2. High-risk commands are blocked or require explicit confirmation by policy.
3. Failures are debuggable via audit trail (command ID + normalized args + error).
4. Existing essential first-class tools remain supported and are not regressed.

**Execution note:** Completed; details retained in `docs/00-workplan/accomplished-tasks.md`.

**Completion notes (2026-04-25):**
1. Added and validated `accordo_vscode_command_list` + `accordo_vscode_command_execute` with policy and confirmation handling.
2. Removed first migration wave tools from active MCP surface:
   - Command-backed wrappers: `accordo_editor_reveal`, `accordo_editor_split`, `accordo_layout_evenGroups`, `accordo_layout_joinGroups`, `accordo_editor_save`, `accordo_editor_saveAll`, `accordo_editor_format`, `accordo_layout_zen`, `accordo_layout_fullscreen`.
   - Diagram helper removals: `accordo_diagram_list`, `accordo_diagram_get`, `accordo_diagram_style_guide`.
3. Added/updated `skills/vscode-command-gateway/skill.md` with exact replacement mappings, confirmation examples, lookup/pagination guidance, and non-gateway diagram fallback workflow.
4. Updated tests and runtime wiring so removed tools are no longer registered/listed.
5. Added temporary `packages/diagram/src/jsdom-shim.d.ts` to restore full workspace build health.

---

### Priority V — Markdown Preview Highlight Support (`accordo_editor_highlight` parity)

**Status:** Complete (2026-04-29). Implemented, reviewed, live-validated, and documented.

**Problem:** `accordo_editor_highlight` currently works on text editor surfaces but not on Markdown preview surfaces. During live validation, attempts to highlight `.md` content in preview failed, creating inconsistency between editor and preview workflows.

**Intent:** Enable line-range highlighting for Markdown preview so review/navigation workflows are consistent across text and preview modalities.

**Planned module scope:**
1. Define highlight rendering path for preview surface (native preview overlay and/or preview-internal command bridge).
2. Extend `accordo_editor_highlight` routing so `.md` preview tabs receive highlight requests.
3. Ensure `accordo_editor_clearHighlights` can clear preview highlights by `decorationId` and clear-all semantics.
4. Preserve existing text-editor highlight behavior without regression.
5. Document supported surfaces and behavior in requirements and tool docs.

**Acceptance criteria:**
1. Calling `accordo_editor_highlight` on an open `.md` preview succeeds with `highlighted: true`.
2. Highlight appears on the requested line range in preview and remains stable during normal scrolling.
3. `accordo_editor_clearHighlights` removes preview highlights reliably by ID and clear-all.
4. Existing editor-surface highlight tests remain green.
5. Tool docs clearly state both editor and markdown-preview support.

**Execution note:** Completed; details retained in `docs/00-workplan/accomplished-tasks.md`.

**Completion notes (2026-04-29):**
1. Added canonical preview highlight capability commands and object-shaped payload types in `@accordo/capabilities`.
2. Routed `accordo_editor_highlight` to already-open Accordo Markdown Preview surfaces while preserving visible text-editor precedence.
3. Added preview clear-by-ID and clear-all support through stored highlight clear strategies, including mixed text+preview clear-all.
4. Implemented md-viewer block mapping, active highlight replay after webview ready/rerender, overlap-safe clearing, and webview DOM handling.
5. Added D3 testing guide: `docs/40-testing/testing-guide-priority-v-markdown-preview-highlights.md`.
6. Live validation succeeded after VS Code reload: preview highlights applied and cleared on the active Markdown Preview.

---

### Priority L — Diagram Parser/Placement Hardening (Phase 0)

**Status:** Phase A complete (plan + requirements + stubs). Awaiting implementation.

**Problem:** Reviewer findings identified 5 structural weaknesses in the diag.1 engine (568 tests) that will compound during diag.2 feature work: duplicated shape dimensions, uncontained parser exceptions, inconsistent routing contracts, shallow layout validation, and dropped opacity in scene-adapter.

**Plan:** `docs/30-development/diagram-hardening-plan.md` — 10 PRs, 4 parallel chains.  
**Requirements:** `docs/20-requirements/requirements-diagram-hardening.md` — IDs H0-01 through H0-05.

**Open tasks:**
1. PR-01 through PR-03: Shape dimension single-source-of-truth (stub in `shape-map.ts`)
2. PR-04 through PR-05: Parser exception containment
3. PR-06 through PR-07: Orthogonal routing contract normalisation
4. PR-08 through PR-09: Layout-store structural validation
5. PR-10: Scene-adapter opacity passthrough

**Success criteria:**
- All 568 existing tests pass after every PR
- Shape dimensions have one source (`shape-map.ts`)
- Parser exceptions never escape `parseMermaid()`
- `readLayout()` rejects structurally invalid JSON
- Routing point-count invariants documented and tested
- Opacity flows through scene-adapter

---

### Priority M — Diagram Flowchart Fidelity (Batch 1)

**Status:** Phase A complete (design + requirements + stubs). Awaiting test-builder (Phase B).

**Problem:** Five user-validated visual defects in flowchart rendering: trapezoid orientation reversed (cases 12/13), circle renders as oval (case 14), missing edge labels (cases 16/17/19/21), cross arrowhead not applied (case 29), HTML entity/emoji text not decoded (case 32).

**Plan:** `docs/30-development/diagram-fidelity-batch1-plan.md`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` — IDs FC-01 through FC-05.  
**Stub:** `packages/diagram/src/parser/decode-html.ts` — `decodeHtmlEntities()` stub.

**Open tasks:**
1. FC-01: Swap trapezoid geometry in `canvas-generator.ts`
2. FC-02: Enforce w===h for circle shape in `canvas-generator.ts`
3. FC-03: Fix edge label extraction in `flowchart.ts`
4. FC-04: Verify cross arrowhead passthrough parser → scene-adapter
5. FC-05: Implement `decodeHtmlEntities()` and apply in `flowchart.ts`

**Success criteria:**
- All 5 defect groups have failing tests (Phase B) then passing implementation (Phase C)
- All 568+ existing tests remain green
- No architecture changes — fixes are within the existing parser → canvas → scene pipeline

---

### Priority N — Diagram Flowchart Fidelity (Batch 2)

**Status:** Phase A complete (design + requirements + stub). Awaiting test-builder (Phase B).

**Problem:** Four user-validated visual defect groups in flowchart edge rendering: curved edges render as straight lines (cases 28/48/49), direction-unaware edge attachment produces reversed arrows (case 33), subgraph-targeted edges silently dropped (cases 35/36), and edge attachment points imprecise for curved paths (cases 48/49).

**Plan:** `docs/30-development/diagram-fidelity-batch2-plan.md`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` — IDs FC-06 through FC-09.  
**Stub:** `routeCurved()` in `packages/diagram/src/canvas/edge-router.ts`.

**Open tasks:**
1. FC-06: Implement `routeCurved()` with Bézier control points; default flowchart edges to curved routing
2. FC-07: Thread `direction` parameter through `routeEdge()` pipeline; direction-biased attachment
3. FC-08: Resolve cluster-targeted edges to cluster bounding boxes instead of dropping them
4. FC-09: Curve-tangent-aware attachment point clamping in `routeCurved()`

**Implementation order:** FC-07 → FC-08 → FC-06 → FC-09 (dependency chain)

**Success criteria:**
- All 4 defect groups have failing tests (Phase B) then passing implementation (Phase C)
- All 568+ existing tests remain green
- No architecture changes — fixes are within the existing layout → canvas → edge-router pipeline
- Each defect group is independently revertable

---

### Priority K — DEC-024 Reload-Reconnect Hardening

**Status:** Implemented and committed in `f12a8f9`.

**What is working now:**
1. Bridge deactivation uses `softDisconnect()` instead of killing the Hub immediately.
2. Hub starts a disconnect grace timer and self-terminates if no Bridge reconnects.
3. Bridge activation probes for a live Hub before spawning a new one.
4. Reloading the VS Code extension host can reconnect to the same Hub process.
5. If the Hub dies after the grace window, the next Bridge activation spawns a fresh Hub.

**Open hardening tasks:**
1. Add broader manual and automated E2E coverage for reload, full VS Code restart, and stale-session recovery.
2. Decide whether CLI MCP clients should have a smoother post-Hub-restart re-auth/session recovery path.
3. Review stale pid/port/token file cleanup edge cases and shutdown behavior under crashes.

**Key evidence:**
- ADR: `docs/10-architecture/adr-reload-reconnect.md`
- Change plan: `docs/10-architecture/reload-reconnect-change-plan.md`
- Test scenarios: `docs/10-architecture/reload-reconnect-test-scenarios.md`
- Reviews: `docs/50-reviews/reload-reconnect-phase-a.md`, `docs/50-reviews/reload-reconnect-phase-b.md`

---


## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
