# accordo-editor

VSCode extension providing 21 MCP tools that expose editor, terminal, and layout capabilities to AI agents via the Accordo Bridge.

## Installation

Install from the VSCode Marketplace (search "Accordo IDE Editor Tools") or build from source:

```bash
cd packages/editor
pnpm build
pnpm package       # produces .vsix file
```

**Dependency:** Requires `accordo-bridge` to be installed and active.

## Tools (21)

### Editor Tools (11)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_editor_open` | `filePath`, `line?`, `column?` | Open a file, optionally at a specific position |
| `accordo_editor_close` | `filePath?` | Close the active editor or a specific file |
| `accordo_editor_scroll` | `line` | Scroll the active editor to a line |
| `accordo_editor_reveal` | `startLine`, `endLine` | Reveal a range in the active editor |
| `accordo_editor_focus` | `group` | Focus a specific editor group (1-based) |
| `accordo_editor_split` | `direction?` | Split the active editor (default: right) |
| `accordo_editor_highlight` | `ranges` | Add highlight decorations to specified ranges |
| `accordo_editor_clearHighlights` | — | Remove all highlight decorations |
| `accordo_editor_save` | — | Save the active file |
| `accordo_editor_saveAll` | — | Save all open files |
| `accordo_editor_format` | — | Format the active document |

### Terminal Tools (5)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_terminal_open` | `name?`, `cwd?` | Create a new terminal with optional name and working directory |
| `accordo_terminal_run` | `command`, `terminalId?` | Run a command in a terminal (creates one if needed) |
| `accordo_terminal_focus` | `terminalId?`, `name?` | Focus a terminal by ID or name |
| `accordo_terminal_list` | — | List all active terminals with their IDs and names |
| `accordo_terminal_close` | `terminalId?`, `name?` | Close a terminal by ID or name |

### Layout Tools (5)

| Tool | Parameters | Description |
|---|---|---|
| `accordo_panel_toggle` | — | Toggle the bottom panel visibility |
| `accordo_layout_zen` | — | Toggle zen mode |
| `accordo_layout_fullscreen` | — | Toggle fullscreen mode |
| `accordo_layout_joinGroups` | — | Join all editor groups into one |
| `accordo_layout_evenGroups` | — | Even out editor group widths |

## How It Works

On activation, the extension:

1. Acquires the `BridgeAPI` from `accordo-bridge`
2. Registers all 21 tool definitions with the Bridge
3. The Bridge forwards tool metadata to the Hub
4. When an agent calls a tool via MCP, the Hub sends an `invoke` message to the Bridge
5. The Bridge dispatches to the editor extension's handler
6. The handler executes the corresponding VSCode API call and returns the result

## Development

```bash
pnpm build         # Compile TypeScript
pnpm test          # Run 172 tests
pnpm typecheck     # Type-check without emitting
pnpm test:watch    # Watch mode
```

## Tests

172 unit tests covering:
- All 11 editor tools (open, close, scroll, reveal, focus, split, highlight, clearHighlights, save, saveAll, format)
- All 5 terminal tools (open, run, focus, list, close) including terminal ID mapping
- All 5 layout tools (panel.toggle, zen, fullscreen, joinGroups, evenGroups)
- Utility functions (argument validation, error handling)

Tests use a comprehensive VSCode API mock (`src/__tests__/mocks/vscode.ts`) that simulates the editor, terminal, and workspace APIs.

## License

[MIT](../../LICENSE)
