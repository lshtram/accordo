# Live E2E Tool Validation Replay Guide (2026-04-23)

## Purpose

Replay the exact manual MCP validation journey from the 2026-04-23 session after fixes land, and verify regressions are closed.

## Scope

- Included: editor, terminal, layout, comments, diagram, presentation/marp, voice
- Included (new): browser comments sync E2E (user ↔ agent flows)

---

## Preconditions

1. Start/restart dev session (`./scripts/start-session.sh` or reload window).
2. Confirm Hub is reachable and bridge connected (`./scripts/dev-health.sh`).
3. Verify MCP tools are registered (expect non-zero `toolCount`).
4. Clean comment store before replay:
   - run `comment_sync_version`
   - if `threadCount > 0`, delete all test threads first

---

## Replay Steps

## 1) Baseline

1. Call `accordo_layout_state`.
2. Verify state is returned (`ok: true`).

Expected:
- no session/auth errors
- state snapshot available

---

## 2) Terminal tools

1. `accordo_terminal_list`
2. `accordo_terminal_open` (named test terminal)
3. `accordo_terminal_run` (`pwd`, `ls`)
4. `accordo_terminal_focus`
5. `accordo_terminal_close`
6. `accordo_terminal_list` again

Expected:
- open/run/focus/close all succeed
- tracked terminal appears/disappears correctly

Known limitation observed:
- `terminal_run` acknowledges dispatch but does not return stdout/stderr payload

---

## 3) Editor + layout tools

1. `accordo_editor_open` on `.md` with `line`/`column` (preview surface)
2. `accordo_editor_open` on text file (`.json`) with `line`/`column`
3. `accordo_editor_close`
4. `accordo_editor_highlight` on text file; `accordo_editor_clearHighlights`
5. `accordo_editor_reveal`
6. `accordo_editor_split` + `accordo_editor_focus`
7. `accordo_layout_evenGroups` + `accordo_layout_joinGroups`
8. `accordo_layout_panel` open and close
9. `accordo_panel_toggle` twice on same panel
10. `accordo_layout_fullscreen` toggle on/off

Expected:
- no contract mismatch
- open/close/toggle semantics deterministic

Historical failures to re-check:
- `editor_scroll` fails on markdown preview (`No active editor`)
- `layout_panel` close rejected due to `view` mismatch
- `panel_toggle` may behave open-only and not expose resulting state
- fullscreen/zen state not reliably readable from MCP state

---

## 4) Comments tools (core)

1. Create comment on text file via `comment_create`
2. Verify via `comment_list`, `comment_get`, `comment_sync_version`
3. Reply via `comment_reply`
4. Delete via `comment_delete`
5. Verify zero threads

Expected:
- store/list/get/sync consistent
- no stale UI artifacts after delete

Historical failures to re-check:
- `comment_list` returned empty while store had threads
- stale comment remained in text editor after delete
- editor-side delete button no-op against stale artifact

---

## 5) Diagram tools (basic UX flow)

1. `accordo_diagram_create` (new temp `.mmd`)
2. `accordo_diagram_patch` (topology + styles)
3. `accordo_editor_open` on `.mmd` (diagram surface)
4. `accordo_diagram_render` to SVG
5. Add/reply/delete diagram surface comments (node + edge)

Expected:
- create/patch/render work
- comments work on node and edge anchors

Important precondition:
- `diagram_render` requires diagram panel open; otherwise `PANEL_NOT_OPEN`

---

## 6) Voice tool

1. `accordo_voice_readAloud` with short text

Expected:
- `spoken: true`
- no `ExternalTtsAdapter HTTP 500`

---

## 7) Presentation/Marp tools

1. `accordo_presentation_open` on known deck
2. `accordo_presentation_getCurrent`
3. `accordo_presentation_goto` to another slide
4. `accordo_presentation_generateNarration`
5. `accordo_presentation_close`

Expected:
- explicit open/close acknowledgements
- correct slide indexing for narration

Historical failures to re-check:
- `presentation_open` returned empty payload
- narration slide index mismatch (off-by-one behavior)
- slide comments present in store but not visible in Marp
- `comment_reply` on slide threads failed with `Webview is disposed`
- user vs agent slide comment visibility mismatch

---

## 8) Browser comments E2E (user ↔ agent)

### Goal

Validate the full production browser-comments sync loop:

1. Browser has source-of-truth full JSON state.
2. Accordo initiates sync (`request_comment_state_sync`).
3. Browser sends full state (`sync_comment_state` payload).
4. Accordo merges and returns merged full state.
5. Browser persists merged state.
6. No recursive second cycle is triggered by completion.

### Preconditions

1. Browser extension connected to relay.
2. Canonical browser sync storage key exists: `accordo:browser-comments-sync:v2`.
3. Test page open in browser (same URL for user and agent checks).
4. Start with known baseline (empty or captured baseline snapshot).

### Flow A — User creates browser comment, agent sees it

1. In browser UI, user creates a new comment on the page.
2. Trigger/observe Accordo-initiated sync cycle.
3. In Accordo comments tools, run `comment_list` and verify the new browser thread/comment appears.

Expected:
- Accordo receives non-empty browser full-state payload.
- New thread/comment is visible to agent via comments tools.
- No duplicate thread/comment IDs created.

### Flow B — Agent replies, user sees it in browser

1. Agent replies via `comment_reply` to the browser-origin thread.
2. Verify wakeup action is `request_comment_state_sync`.
3. Browser sends full state, receives merged state, persists it.
4. Refresh/reopen browser comment UI and verify agent reply appears.

Expected:
- Reply is visible in browser thread after one cycle.
- Browser canonical store contains merged state with both user + agent comments.
- Cycle completes once (no recursive re-initiation).

### Flow C — Resolve/reopen state sync both directions

1. Resolve a thread from Accordo side.
2. Verify resolved status in browser after sync.
3. Reopen from browser side.
4. Verify reopened status in Accordo after sync.

Expected:
- Status transitions are consistent across both surfaces.
- Last update wins according to sync metadata/timestamps.

### Flow D — Delete/tombstone behavior

1. Delete comment/thread from one side.
2. Sync.
3. Verify active views hide deleted items on both sides.
4. Verify tombstone metadata is preserved in underlying sync state (not resurrected on next cycle).

Expected:
- No ghost comments in UI.
- Deleted items do not reappear after subsequent sync cycles.

### Flow E — No-loop / one-cycle guard

1. Trigger a single sync event.
2. Observe relay/action logs.

Expected:
- Exactly one initiating `request_comment_state_sync` for the event.
- Exactly one corresponding `sync_comment_state` exchange for that event.
- No immediate second cycle unless a new mutation occurs.

---

## Pass Criteria (for this replay)

1. No session/auth failures while invoking non-browser tools.
2. Comment store, list, and UI are consistent after create/reply/delete.
3. Diagram exports are valid and usable.
4. No stale artifacts remain after deletion flows.
5. All previously logged Priority 0 failures above are either fixed or reproducibly re-confirmed with clear evidence.
6. Browser comments user↔agent flows (create/reply/resolve/reopen/delete) are consistent across browser UI and Accordo tools.
7. Sync cycles are single-pass and non-recursive under normal operation.
