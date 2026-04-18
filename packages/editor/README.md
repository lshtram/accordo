# accordo-editor

VSCode extension providing 19 MCP tools that expose editor, terminal, and layout capabilities to AI agents via the Accordo Bridge.

## Installation

Install from the VSCode Marketplace (search "Accordo IDE Editor Tools") or build from source:

```bash
cd packages/editor
pnpm build
pnpm package       # produces .vsix file
```

**Dependency:** Requires `accordo-bridge` to be installed and active.

## Tools (19)

### Editor Tools (11)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_editor_open` | `path`, `line?`, `column?` | Open a file (`.md` → preview, `.mmd` → diagram, else text). Returns surface type. |
| `accordo_editor_close` | `path?` | Close the active editor or a specific file (`.mmd` falls back to active tab) |
| `accordo_editor_scroll` | `direction`, `by?` | Scroll the active editor up/down by line or page |
| `accordo_editor_split` | `direction` | Split the editor pane right or down |
| `accordo_editor_focus` | `group` | Focus a specific editor group (1-based) |
| `accordo_editor_reveal` | `path` | Reveal a file in the Explorer sidebar without opening it |
| `accordo_editor_highlight` | `path`, `startLine`, `endLine`, `color?` | Apply a colored highlight to a range of lines |
| `accordo_editor_clearHighlights` | `decorationId?` | Remove all highlights, or a specific one |
| `accordo_editor_save` | `path?` | Save the active file or a specific path |
| `accordo_editor_saveAll` | — | Save all open modified files |
| `accordo_editor_format` | `path?` | Format the active document or a specific file |

### Terminal Tools (5)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_terminal_open` | `name?`, `cwd?` | Create a new terminal with optional name and working directory |
| `accordo_terminal_run` | `command`, `terminalId?` | Execute a shell command in a terminal (creates one if needed) |
| `accordo_terminal_focus` | — | Focus the terminal panel |
| `accordo_terminal_list` | — | List all active terminals with their accordo IDs |
| `accordo_terminal_close` | `terminalId?`, `name?` | Close a terminal by ID or name |

### Layout Tools (7)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_panel_toggle` | `panel` | Toggle sidebar or bottom panel visibility |
| `accordo_layout_zen` | — | Toggle Zen Mode |
| `accordo_layout_fullscreen` | — | Toggle fullscreen mode |
| `accordo_layout_joinGroups` | — | Merge all editor groups into one |
| `accordo_layout_evenGroups` | — | Equalise editor group widths and heights |
| `accordo_layout_state` | — | Return the current IDE layout state snapshot |
| `accordo_layout_panel` | `area`, `action`, `view?` | Explicit open/close of sidebar, panel, or right bar |

## How It Works

On activation, the extension:

1. Acquires the `BridgeAPI` from `accordo.accordo-bridge`
2. Registers all 19 tool definitions with the Bridge under extension id `accordo.accordo-editor`
3. The Bridge forwards tool metadata to the Hub
4. When an agent calls a tool via MCP, the Hub sends an `invoke` message to the Bridge
5. The Bridge dispatches to the editor extension's handler
6. The handler executes the corresponding VSCode API call and returns the result

## Development

```bash
pnpm build         # Compile TypeScript
pnpm test          # Run unit tests
pnpm typecheck     # Type-check without emitting
pnpm test:watch    # Watch mode
```

## License

[MIT](../../LICENSE)
