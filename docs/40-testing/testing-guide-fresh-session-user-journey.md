# Fresh Session Guided User Journey — Accordo End-to-End

This guide is written as a **live script** for a new chat/session.

- The **agent** runs tools and guides the flow.
- The **user** visually confirms UI behavior and performs a few manual actions.

Use this when you want a clean “does Accordo work end-to-end?” pass.

---

## Ground Rules (Agent)

1. Run steps in order.
2. **After every tool call, stop and wait for user visual confirmation before proceeding.** Do not batch or skip ahead — the user must confirm what they see in the VS Code UI.
3. If a step fails, stop and log:
   - tool used
   - exact error
   - expected vs actual
4. Browser steps are optional if browser pairing/control is unavailable.

---

## Phase 0 — Fresh Start

### Agent says
“Let’s start from a fresh baseline. Please reload the VS Code window now and tell me when done.”

### Agent runs
- `accordo_layout_state`
- `comment_sync_version`

### Agent asks user
- “Do you see VS Code fully loaded with no extension activation popups?”

### Pass
- `layout_state.ok === true`
- comments tools respond

---

## Phase 1 — Editor Journey (open → highlight → clear)

### Agent says
“I’ll open a file at a specific line and highlight a block. Please verify what you see.”

### Agent runs
1. `accordo_editor_open({ path, line, column })`
   - Prefer a line range that requires scrolling to bring into view (e.g. lines 118–127) to also verify auto-scroll works.
2. `accordo_editor_highlight({ path, startLine, endLine })`

### Agent asks user
- “Is the document open?”
- “Can you see line `<line>` in view?”
- “Do you see the highlight on lines `<startLine..endLine>`?”

### Agent runs
3. `accordo_editor_clearHighlights(...)`

### Agent asks user
- “Is the highlight gone now?”

---

## Phase 2 — Terminal Journey (open → run → read → close)

### Agent says
“Now I’ll create a terminal, run a command, and read back output.”

### Agent runs
1. `accordo_terminal_open({ name, cwd })`
2. `accordo_terminal_run({ terminalId, command: "pwd", observeMaxLines })`
3. `accordo_terminal_read({ terminalId })`

### Agent asks user
- “Do you see the new terminal tab open?”
- “Does the terminal show the command output?”

### Agent runs
4. `accordo_terminal_list()`
5. `accordo_terminal_close({ terminalId })`

### Agent asks user
- “Did that terminal close from the panel?”

---

## Phase 3 — Comments on Code (full agent + user lifecycle)

### Phase 3a — Agent creates, user confirms, agent replies

### Agent says
“I’ll create a code comment thread, then we run full lifecycle.”

### Agent runs
1. `accordo_editor_open({ path, line, column })` — open the target file at the target line
2. `comment_create` (text/file anchor)

### Agent asks user
- “Do you see the new thread in the comments panel at the gutter?”
- “Can you confirm the line number is correct?”

### Agent runs
3. `comment_reply`

### Agent asks user
- “Do you see my reply under the same thread?”

### Phase 3b — User creates a comment (agent observes and identifies)

### Agent says
“Your turn — please place a comment anywhere in this file. I’ll find it and reply.”

### Agent asks user
- “Did you create the comment? Don’t reply to it yet — just create it.”

### Agent runs
4. `comment_list` (no filter) — identify the new user-created thread by author=“user” / lastAuthor=“user”

### Agent asks user
- “I found your thread. Can you confirm which thread is yours?”

### Phase 3c — User replies (agent observes)

### Agent runs
5. `comment_list` — check for new reply on the user-created thread

### Agent asks user
- “Did you add a reply? Can you see it in the thread?”

### Phase 3d — User resolves (agent observes)

### Agent runs
6. `comment_list` — observe status change to resolved

### Agent asks user
- “Did you resolve the thread? Has it moved to resolved state?”

### Phase 3e — User deletes (agent observes)

### Agent runs
7. `comment_list` — observe thread is gone

### Agent asks user
- “Did you delete your thread? Is it gone from the panel and gutter?”

### Phase 3f — Markdown Preview comments (separate surface)

### Agent says
“Now testing comments on a Markdown file in preview mode.”

### Agent runs
1. `accordo_markdown_setSurface({ path: “docs/40-testing/testing-guide-fresh-session-user-journey.md”, surface: “preview” })`
2. `comment_create` with scope.modality=“markdown-preview” and anchor.kind=“text”

### Agent asks user
- “Do you see the thread appear in the Markdown preview panel?”

### Agent runs
3. `comment_reply`
4. `comment_delete`

### Agent asks user
- “Does the reply appear? After delete, is it gone from the preview?”

---

## Phase 4 — Marp Presentation Core (open/goto/current/narration)

Deck: `demo/presentation-skills-demo.deck.md`

### Agent says
“I’ll open the deck and navigate to slide 2.”

### Agent runs (sequentially, not parallel)
1. `accordo_presentation_open({ deckUri })`
2. `accordo_presentation_goto({ index: 2 })`
3. `accordo_presentation_getCurrent()`
4. `accordo_presentation_generateNarration({ slideIndex: 2 })`

### Agent asks user
- “Is the Marp presentation open?”
- “Are you on slide 2?”
- “Does the title match what I reported?”

---

## Phase 5 — Marp Comment Pins (agent + user collaboration)

This is the most important cross-surface check.

### Agent says
“Now I’ll place one slide comment. Then **you** place one comment of your liking on the same slide, and I’ll identify it and reply for demo purposes.”

### Agent runs
1. `comment_create` with canonical slide anchor:
   - `scope.modality: "slide"`
   - `anchor.surfaceType: "slide"`
   - `coordinates: { type: "slide", slideIndex, x, y }`

### Agent asks user
- “Do you see my pin on this slide?”

### User action
- User creates a manual comment pin in the Marp UI.

### Agent says
“Great — I’ll find your new thread and reply to it.”

### Agent runs
2. `comment_list` (unfiltered or minimally filtered)
3. identify user-created thread by body/author/timestamp
4. `comment_reply({ threadId, body })`

### Agent asks user
- “Can you see my reply under your comment thread?”
- “If you click each thread, do both pins focus correctly on the slide?”

---

## Phase 6 — Diagram Journey (create/patch/render/comments)

### Agent says
“Next, diagram flow: create, update, render, then comments.”

### Agent runs
1. `accordo_diagram_create({ path, content })`
2. `accordo_editor_open({ path: "...mmd" })`
3. `accordo_diagram_patch({ path, content })`
4. `accordo_diagram_render({ path, format: "svg" })`

### Agent asks user
- “Is the diagram panel open and showing the updated graph?”
- “Was the render artifact created successfully?”

### Agent runs
5. `comment_create` on diagram surface
6. `comment_reply`
7. `comment_delete`

### Agent asks user
- “Do diagram comments appear and disappear correctly?”

---

## Phase 7 — Browser Journey (optional but recommended)

### Agent says
“Now browser checks. If pairing/control is unavailable, we’ll run read-only checks and mark control path as deferred.”

### Agent runs
1. `accordo_browser_health`
2. `accordo_browser_list_pages`
3. `accordo_browser_select_page({ tabId })` (if needed)
4. `accordo_browser_get_page_map`
5. `accordo_browser_get_text_map`

### Agent asks user
- “Do these results match the tab you expect?”

### If control granted, agent runs
6. one action: `accordo_browser_click` or `accordo_browser_type`
7. verify with `accordo_browser_wait_for` or updated `get_text_map`

### Agent asks user
- “Did the browser UI change as expected after the action?”

---

## Phase 8 — Optional Voice Check

### Agent runs
- `accordo_voice_readAloud({ text: "Quick voice test", cleanMode: "raw" })`

### Agent asks user
- “Did you hear the read-aloud output?”

---

## Phase 9 — Cleanup + Final Report

### Agent runs
1. `comment_delete({ all: true })`
2. `accordo_presentation_close()`
3. `accordo_layout_state`

### Agent asks user
- “Do you want me to also close diagram/browser surfaces before we end?”

### Agent reports
- PASS/FAIL table by module:
  - Editor
  - Terminal
  - Comments (code)
  - Marp core
  - Marp comment pins/focus
  - Diagram
  - Browser (read-only/control)
  - Voice (optional)

---

## Prompt Pack (for new session)

Use this exact sequence as user prompts:

1. “Start fresh-session validation and guide me step by step. Ask me to confirm each UI result.”
2. “For each step, tell me exactly what to look for (example: ‘is the document open? can you see line 315?’).”
3. “In Marp comments step: ask me to place a comment of my liking, then identify it and reply to it.”
4. “At the end, give me a PASS/FAIL summary by module.”
