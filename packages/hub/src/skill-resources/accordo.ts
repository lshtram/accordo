export const accordoSkill = `# Accordo MCP Skill

Use this skill for general Accordo IDE work: editor, layout, terminals, comments, voice, and the generic VS Code command gateway.

## Default Workflow

1. Start with \`accordo_layout_state\` to understand open editors, panels, comments, and modality state.
2. Prefer first-class \`accordo_*\` tools when one matches the task.
3. Use \`comment_list\` / \`comment_get\` for comment details; \`layout_state\` only gives a bounded summary.
4. Use \`accordo_vscode_command_*\` only for long-tail VS Code commands that do not have a first-class Accordo tool.

## Editor And Layout

- Open files with \`accordo_editor_open({ path, line?, column? })\`.
- Highlight visible text or already-open Accordo Markdown Preview with \`accordo_editor_highlight\`.
- Clear highlights with \`accordo_editor_clearHighlights\`; omit \`decorationId\` for clear-all.
- Open/close panels explicitly with \`accordo_layout_panel\`; avoid toggle-style workflows when deterministic state matters.

## Terminal

- Use \`accordo_terminal_open\` to create a stable terminal ID.
- Use \`accordo_terminal_run\` for commands; set \`observeMaxLines\` for a bounded inline preview.
- Use \`accordo_terminal_read\` for follow-up reads. Reuse cursors only with the same terminal.
- Terminal output is bounded and redacted, but commands can still expose secrets; avoid printing credentials.

## Comments

- Use \`comment_list\` to discover threads and \`comment_get\` for full thread context.
- Use \`comment_reply\`, \`comment_resolve\`, and \`comment_delete\` for mutations.
- Browser comment context should be resolved with \`accordo_browser_resolve_comment_context\` when available.

## Generic VS Code Command Gateway

Use the gateway only after checking for a first-class Accordo tool.

### Discover Commands

\`\`\`json
{ "tool": "accordo_vscode_command_list", "arguments": { "query": "splitEditor", "limit": 50 } }
\`\`\`

### Execute Allow-Policy Commands

\`\`\`json
{ "tool": "accordo_vscode_command_execute", "arguments": { "command": "workbench.action.splitEditorRight" } }
\`\`\`

### Execute Confirm-Policy Commands

\`\`\`json
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
\`\`\`

### Common Gateway Recipes

- Reveal file in Explorer: \`accordo_vscode_command_execute({ command: "revealInExplorer", args: ["/absolute/path"] })\`.
- Format a file: first \`accordo_editor_open({ path })\`, then execute \`editor.action.formatDocument\` with confirmation.
- Save a file: first \`accordo_editor_open({ path })\`, then execute \`workbench.action.files.save\` with confirmation.
- Scroll active editor: execute \`editorScroll\` with args like \`[{ "to": "down", "by": "page", "value": 1, "revealCursor": false }]\`.
`;
