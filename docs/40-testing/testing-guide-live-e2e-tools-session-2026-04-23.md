# Live E2E Tool Validation Replay Guide (2026-04-23)

## Purpose

Replay the exact manual MCP validation journey from the 2026-04-23 session after fixes land, and verify regressions are closed.

## Scope

- Included: editor, terminal, layout, comments, diagram, presentation/marp, voice
- Deferred: full browser tool package (separate team in progress)

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

## Pass Criteria (for this replay)

1. No session/auth failures while invoking non-browser tools.
2. Comment store, list, and UI are consistent after create/reply/delete.
3. Diagram exports are valid and usable.
4. No stale artifacts remain after deletion flows.
5. All previously logged Priority 0 failures above are either fixed or reproducibly re-confirmed with clear evidence.
