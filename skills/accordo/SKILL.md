---
id: accordo
version: 1.0.0
tags: [accordo, mcp, editor, layout, terminal, comments, voice, vscode]
---

# Skill: Accordo MCP Tools

## When to Use

Load this skill for general Accordo IDE work: editor, layout, terminals,
comments, voice, and the generic VS Code command gateway.

This is the standard SKILL.md entry point that mirrors the runtime MCP resource
`accordo://skills/accordo`. MCP clients should read that resource through
`resources/read`; SKILL.md-based agents should load this file.

## Default Workflow

1. Start with `accordo_layout_state` to understand open editors, panels,
   comments, and modality state.
2. Prefer first-class `accordo_*` tools when one matches the task.
3. Use `comment_list` / `comment_get` for comment details; `layout_state` only
   gives a bounded summary.
4. Use `accordo_vscode_command_*` only for long-tail VS Code commands that do
   not have a first-class Accordo tool.

## Editor And Layout

- Open files with `accordo_editor_open({ path, line?, column? })`.
- Highlight visible text or already-open Accordo Markdown Preview with
  `accordo_editor_highlight`.
- Clear highlights with `accordo_editor_clearHighlights`; omit `decorationId`
  for clear-all.
- Open/close panels explicitly with `accordo_layout_panel`; avoid toggle-style
  workflows when deterministic state matters.

### Markdown Highlight Guidance

- Markdown preview and Markdown text editor highlights are separate VS Code
  surfaces. If both need to show the same callout, apply the highlight once per
  surface: switch to preview and highlight, then switch to text and highlight the
  same range again.
- If both preview and text tabs are open for the same Markdown file,
  `accordo_editor_highlight` may prefer the visible text editor path. Use
  `accordo_markdown_setSurface` to make the intended surface active before
  highlighting.
- For Markdown text headings, avoid single-line ranges because they may be hard
  to see in some VS Code decoration states. Highlight the heading plus the
  following line instead, for example `startLine: 270, endLine: 271`.
- For walkthroughs or reviews, prefer highlighting a whole subsection range,
  such as `4.1` from its heading through the line before `4.2`, rather than a
  one-line heading.

## Terminal

- Use `accordo_terminal_open` to create a stable terminal ID.
- Use `accordo_terminal_run` for commands; set `observeMaxLines` for a bounded
  inline preview.
- Use `accordo_terminal_read` for follow-up reads. Reuse cursors only with the
  same terminal.
- Terminal output is bounded and redacted, but commands can still expose
  secrets; avoid printing credentials.

## Comments

- Use `comment_list` to discover threads and `comment_get` for full thread
  context.
- Use `comment_reply`, `comment_resolve`, and `comment_delete` for mutations.
- `comment_list({})` is the unfiltered listing path; it returns open and
  resolved threads. Use `status: "all"` when you need to be explicit.
- To start a clean comment session, use `comment_delete({ all: true })` and
  then verify with `comment_sync_version`.
- Use `comment_delete({ deleteScope: { modality, all: true } })` only when
  cleaning one modality.
- Browser comment context should be resolved with
  `accordo_browser_resolve_comment_context` when available.

## Browser Tools

- Use `accordo_browser_health` when browser connection state or privacy posture
  is uncertain.
- Browser tools operate through the paired Accordo browser extension in the
  user's active Chrome profile. Accordo does not expose MCP controls for
  fresh-profile, incognito, or per-task browser isolation.
- For isolated browser work, launch a separate Chrome profile or Incognito
  window outside Accordo, pair the extension there, then target that tab with
  `accordo_browser_list_pages`, `accordo_browser_select_page`, or explicit
  `tabId` arguments.
- Prefer structured page tools over screenshots when text/DOM data is enough.
- `accordo_browser_capture_region` screenshot redaction is DOM-text-overlay
  based and not OCR-complete; image-only PII may remain even when `redactPII`
  is enabled.

## Generic VS Code Command Gateway

Use the gateway only after checking for a first-class Accordo tool.

### Discover Commands

```json
{ "tool": "accordo_vscode_command_list", "arguments": { "query": "splitEditor", "limit": 50 } }
```

### Execute Allow-Policy Commands

```json
{ "tool": "accordo_vscode_command_execute", "arguments": { "command": "workbench.action.splitEditorRight" } }
```

### Execute Confirm-Policy Commands

```json
{
  "tool": "accordo_vscode_command_execute",
  "arguments": {
    "command": "workbench.action.files.save",
    "confirmation": {
      "confirmed": true,
      "command": "workbench.action.files.save",
      "reason": "save active editor"
    }
  }
}
```

### Common Gateway Recipes

- Reveal file in Explorer: `accordo_vscode_command_execute({ command:
  "revealInExplorer", args: ["/absolute/path"] })`.
- Format a file: first `accordo_editor_open({ path })`, then execute
  `editor.action.formatDocument` with confirmation.
- Save a file: first `accordo_editor_open({ path })`, then execute
  `workbench.action.files.save` with confirmation.
- Scroll active editor: execute `editorScroll` with args like
  `[{ "to": "down", "by": "page", "value": 1, "revealCursor": false }]`.
