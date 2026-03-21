# Accordo IDE

**AI-native development environment — VSCode extension layer**

Accordo IDE is an MCP-based AI co-pilot layer on top of VSCode. An MCP-capable AI agent connects to a running VSCode instance, sees IDE state in real time, and executes editor, terminal, and layout tools. The human developer and agent share one workspace with zero custom chat UI.

## Architecture

```
┌──────────────┐  MCP (HTTP)   ┌──────────────┐  WebSocket  ┌──────────────────┐
│  AI Agent    │ ◄──────────── │  accordo-hub │ ◄────────── │  accordo-bridge  │
│  (Claude,    │               │  (MCP server)│             │  (VSCode ext)    │
│   OpenCode,  │               └──────────────┘             └────────┬─────────┘
│   Copilot)   │                                                     │
└──────────────┘                                            ┌────────┴─────────┐
                                                            │  accordo-editor  │
                                                            │  (21 MCP tools)  │
                                                            └──────────────────┘
```

| Package | Role |
|---|---|
| [`@accordo/bridge-types`](packages/bridge-types/) | Shared TypeScript type definitions (no runtime) |
| [`accordo-hub`](packages/hub/) | Standalone MCP server — agents connect here |
| [`accordo-bridge`](packages/bridge/) | VSCode extension — connects editor to Hub |
| [`accordo-editor`](packages/editor/) | VSCode extension — 21 editor/terminal/layout tools |

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- VSCode >= 1.100.0

> **Windows users:** See [docs/setup-windows.md](docs/setup-windows.md) for a full setup guide covering Slidev, TTS, and STT installation.

### Build & Test

```bash
git clone https://github.com/lshtram/accordo.git
cd accordo
pnpm install
pnpm build
pnpm test          # 797 tests across 3 packages
```

### Run in VSCode

1. Open the `accordo` folder in VSCode
2. Press **F5** to launch the Extension Development Host
3. The Bridge extension activates, spawns the Hub, and connects automatically
4. Configure your MCP agent to connect to `http://localhost:3000`

### Manual Hub Start (standalone)

```bash
ACCORDO_TOKEN=your-token ACCORDO_BRIDGE_SECRET=your-secret \
  node packages/hub/dist/index.js --port 3000
```

## Available Tools (21)

### Editor (11 tools)
| Tool | Description |
|---|---|
| `accordo_editor_open` | Open a file at optional line/column |
| `accordo_editor_close` | Close an editor tab |
| `accordo_editor_scroll` | Scroll active editor to a line |
| `accordo_editor_reveal` | Reveal a range in the active editor |
| `accordo_editor_focus` | Focus a specific editor group |
| `accordo_editor_split` | Split the active editor |
| `accordo_editor_highlight` | Add highlight decorations to ranges |
| `accordo_editor_clearHighlights` | Remove all highlights |
| `accordo_editor_save` | Save the active file |
| `accordo_editor_saveAll` | Save all open files |
| `accordo_editor_format` | Format the active document |

### Terminal (5 tools)
| Tool | Description |
|---|---|
| `accordo_terminal_open` | Create a new terminal |
| `accordo_terminal_run` | Run a command in a terminal |
| `accordo_terminal_focus` | Focus a terminal by ID or name |
| `accordo_terminal_list` | List all active terminals |
| `accordo_terminal_close` | Close a terminal |

### Layout (5 tools)
| Tool | Description |
|---|---|
| `accordo_panel_toggle` | Toggle bottom panel visibility |
| `accordo_layout_zen` | Toggle zen mode |
| `accordo_layout_fullscreen` | Toggle fullscreen |
| `accordo_layout_joinGroups` | Join all editor groups into one |
| `accordo_layout_evenGroups` | Even out editor group widths |

## Documentation

- [Architecture](docs/architecture.md) — System design, protocols, component boundaries
- [Requirements — Hub](docs/requirements-hub.md)
- [Requirements — Bridge](docs/requirements-bridge.md)
- [Requirements — Editor](docs/requirements-editor.md)
- [Development Process](docs/dev-process.md) — TDD cycle, commit conventions
- [Coding Guidelines](docs/coding-guidelines.md)
- [Workplan](docs/workplan.md) — Phase 1 progress and status

## Development

```bash
pnpm build         # Build all packages
pnpm test          # Run all tests
pnpm typecheck     # Type-check without emitting
pnpm clean         # Remove build artifacts
```

Setup git hooks (pre-push runs tests):
```bash
pnpm setup:hooks
```

## License

[MIT](LICENSE)
