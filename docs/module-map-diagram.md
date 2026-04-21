# Module Map: `accordo-diagram`

## Purpose
`accordo-diagram` is a VS Code extension that opens Mermaid `.mmd` files in a custom Excalidraw-backed editor, preserves layout in `.accordo/diagrams/**/*.layout.json`, and exposes diagram MCP tools for agent-driven create/read/patch/render workflows.

## Composition Root
`src/extension.ts` is the composition root. It:
- registers VS Code commands: `accordo-diagram.open`, `accordo-diagram.newCanvas`;
- registers custom editor provider `accordo-diagram.diagramEditor`;
- keeps a path-keyed live panel registry;
- registers MCP diagram tools through Bridge when available;
- publishes diagram modality state;
- registers comment-focus command `accordo_diagram_focusThread`.

## Key Modules

| Area | Files | Responsibility |
|---|---|---|
| Extension entry | `extension.ts` | Activation, bridge/tool wiring, panel registry, state publishing |
| Tool surface | `tools/diagram-tool-definitions.ts`, `tools/diagram-tool-handlers.ts`, `tools/diagram-tools.ts`, `tools/diagram-tool-types.ts` | MCP tool definitions + handlers |
| Parser | `parser/adapter.ts`, `parser/flowchart.ts`, `parser/state-diagram.ts`, `parser/class-diagram.ts`, `parser/decode-html.ts` | Mermaid parsing + normalization to internal graph |
| Layout | `layout/auto-layout.ts`, `layout/layout-store.ts`, `layout/element-mapper.ts`, `layout/excalidraw-engine.ts`, `layout/upstream-direct.ts`, `layout/state-identity.ts`, `layout/layout-debug.ts` | Initial layout, persisted layout I/O, upstream placement integration, diagnostics |
| Canvas generation | `canvas/canvas-generator.ts`, `canvas/edge-router.ts`, `canvas/shape-map.ts` | Excalidraw element generation from parsed graph + layout |
| Reconciliation | `reconciler/reconciler.ts`, `reconciler/placement.ts`, `reconciler/edge-identity.ts` | Source/layout reconciliation and unplaced-node placement |
| Panel host + webview | `webview/panel.ts`, `webview/panel-core.ts`, `webview/panel-state.ts`, `webview/panel-commands.ts`, `webview/html.ts`, `webview/protocol.ts`, `webview/message-handler.ts`, `webview/excalidraw-canvas.ts`, `webview/scene-adapter.ts`, `webview/comment-overlay.ts` | Custom editor runtime, host↔webview protocol, canvas interaction, export |
| Host split modules | `host/*.ts` | Factored host concerns (setup, message routing, scene load, export, comments adapter, layout patching) |
| Comments integration | `comments/diagram-comments-bridge.ts` | Surface comment bridge wiring between diagram panel and comments adapter |
| Shared types | `types.ts` | Diagram domain/runtime type contracts |

## Public Tool/Command Surface

### MCP tools (registered by diagram extension)
- `accordo_diagram_list`
- `accordo_diagram_get`
- `accordo_diagram_create`
- `accordo_diagram_patch`
- `accordo_diagram_render`
- `accordo_diagram_style_guide`

### VS Code commands (contributed)
- `accordo-diagram.open`
- `accordo-diagram.newCanvas`

### Internal/cross-package focus command
- `accordo_diagram_focusThread` (from `@accordo/capabilities` constants)

## Internal Boundaries

- `types.ts` is the foundational domain type module.
- Parser/layout/canvas/reconciler directories are internal implementation layers; callers should use extension/tool entry points rather than deep-linking internals.
- Multiple files legitimately import `vscode` (not just `webview/panel.ts`) across extension, panel host, and command wiring.
- `layout/layout-debug.ts` is permanent gated instrumentation (disabled by default), not temporary debug code.
