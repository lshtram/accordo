# Module Map: `@accordo/diagram`

## Purpose
VSCode extension that renders Mermaid diagram files (.mmd) as Excalidraw canvases, with stable layout persistence across edits, comment anchoring on diagram nodes/edges, and 6 MCP tools for AI agents to create, read, update, and delete diagram elements.

## Composition Root
`extension.ts` — `activate()` acquires BridgeAPI, registers the `accordo-diagram.open` and `accordo-diagram.newCanvas` commands, registers a CustomEditorProvider for `.mmd` files, creates a path-keyed panel registry, registers all 6 diagram tools with the Bridge, and publishes diagram state on panel open/close. Also registers the `accordo_diagram_focusThread` command (from `@accordo/capabilities`) for comment thread navigation.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VSCode entry point; owns panel registry, Bridge tool registration, command registration, state publishing | `activate()`, `deactivate()`, `getPanel()` |
| `types.ts` | All pure type definitions for the diagram domain (DiagramType, NodeId, EdgeKey, LayoutStore, ParsedDiagram, ParseResult, ReconcileResult, ExcalidrawElement, CanvasScene) | All domain types |
| `tools/diagram-tools.ts` | Re-exports tool definitions and handlers from `diagram-tool-definitions.ts` and `diagram-tool-handlers.ts` | `createDiagramTools()`, `DiagToolError`, handler functions |
| `tools/diagram-tool-definitions.ts` | Factory for 6 MCP tool definitions | `createDiagramTools()` |
| `tools/diagram-tool-handlers.ts` | Tool handler implementations; `DiagramToolContext` provides `getPanel()` for the active canvas | `listHandler`, `getHandler`, `createHandler`, `patchHandler`, `renderHandler`, `styleGuideHandler` |
| `webview/panel.ts` | VSCode Webview panel hosting the Excalidraw canvas; owns the Mermaid→Excalidraw rendering pipeline | `DiagramPanel` class with factory methods |
| `parser/adapter.ts` | Wraps mermaid.js parser; produces a `ParsedDiagram` (nodes, edges, clusters, direction, renames) | `parseMermaid()` |
| `parser/flowchart.ts` | Flowchart parser (LR/TB/RL/BT directions, subgraphs, edge labels) | `parseFlowchart()` |
| `parser/state-diagram.ts` | stateDiagram-v2 parser (states, pseudostates, composite states, transitions) | `parseStateDiagram()` |
| `parser/class-diagram.ts` | classDiagram parser (classes, namespaces, relationships) | `parseClassDiagram()` |
| `parser/decode-html.ts` | HTML entity decoding for Mermaid node labels | `decodeHtml()` |
| `layout/auto-layout.ts` | Dagre-based auto-layout engine; computes node positions from topology | `computeInitialLayout()` |
| `layout/excalidraw-engine.ts` | Upstream Excalidraw integration for stateDiagram-v2 | `layoutWithExcalidraw()` |
| `layout/upstream-direct.ts` | Direct layout store read/write bypassing mermaid for already-parsed diagrams | `upstreamDirect()` |
| `layout/element-mapper.ts` | Maps parsed nodes/edges to Excalidraw elements; dispatches state-diagram identity to `state-identity.ts` | `mapElements()` |
| `layout/state-identity.ts` | State diagram pseudostate detection and state-specific geometry→identity mapping (diag.2.6 SUP-S) | `matchStatePseudostates()`, `isPseudostateGeometry()`, `mapStateGeometryToLayout()` |
| `layout/layout-debug.ts` | Permanent gated structured logging for the layout pipeline; zero overhead when disabled (SUP-S06) | `layoutDebug()`, `LAYOUT_DEBUG` gate |
| `layout/layout-store.ts` | Reads/writes `.layout.json` files; manages LayoutStore lifecycle | `LayoutStoreManager` class |
| `canvas/canvas-generator.ts` | Generates Excalidraw elements from ParsedDiagram + LayoutStore | `generateCanvas()` |
| `canvas/edge-router.ts` | Dagre-based edge routing with self-loop and waypoint support | `routeEdge()`, `routeAuto()` |
| `canvas/shape-map.ts` | Maps Mermaid shape types to Excalidraw shapes | `getShape()` |
| `reconciler/reconciler.ts` | Reconciles updated Mermaid source against existing LayoutStore; produces structural changes | `reconcile()` |
| `reconciler/placement.ts` | Unplaced node placement with collision avoidance | `placeNewNodes()` |
| `reconciler/edge-identity.ts` | Stable edge identity across source edits | `matchEdge()` |
| `webview/panel-state.ts` | PanelState data type, factory, accessors, cleanup | `createPanelState()`, `assertNotDisposed()`, `cleanupOnDispose()` |
| `webview/panel-core.ts` | Core panel logic (message dispatch, canvas operations) | Panel message handlers |
| `webview/panel-commands.ts` | VSCode command handlers for the webview | Panel command handlers |
| `webview/comment-overlay.ts` | Alt+click comment pin overlay | Comment pin overlay |
| `webview/scene-adapter.ts` | Converts generator output to Excalidraw-compatible scene format | `toExcalidrawScene()` |
| `webview/excalidraw-canvas.ts` | Excalidraw canvas initialization and message handling | Excalidraw canvas |
| `webview/message-handler.ts` | Inbound/outbound message routing for canvas messages | Message handlers |
| `webview/protocol.ts` | Canvas <→ extension wire protocol types | Protocol types |
| `host/panel-setup.ts` | Panel initialization (webview HTML, mermaid warmup) | Panel setup |
| `host/panel-message-router.ts` | Routes inbound webview messages to handlers | Message router |
| `host/panel-scene-loader.ts` | Loads Excalidraw scene from layout store or fresh canvas | Scene loader |
| `host/panel-export.ts` | PNG/SVG export | Export logic |
| `host/host-context.ts` | Shared host context (workspace root, capabilities) | Host context |
| `host/panel-comments-adapter.ts` | Comments bridge adapter for the host layer | Comments adapter |
| `host/panel-layout-patcher.ts` | Layout patching from canvas mutations | Layout patcher |
| `comments/diagram-comments-bridge.ts` | Three-layer comments bridge (panel ↔ host ↔ extension) | `DiagramCommentsBridge` |
| `webview/html.ts` | Webview HTML document | HTML template |
| `tools/diagram-tool-types.ts` | Shared tool result types and error codes | Tool result types |

## Extension Points

- **`DiagramPanelLike`** interface: Abstract interface for diagram panel operations (load, getDiagramType, createNode, updateNode, deleteNode, createEdge, etc.). Allows tool handlers to operate on any panel implementation without depending on VSCode types.
- **`DiagramToolContext`**: Passed to all tool handlers. Provides `getPanel()` returning the most recently opened panel. Allows AI agents to operate on the active canvas.
- **6 MCP tools**: `diagram_create`, `diagram_read`, `diagram_update`, `diagram_delete`, `diagram_rename`, `diagram_list`. Adding a new tool follows the same pattern in `diagram-tool-definitions.ts`.
- **`parseMermaid()`**: The single parser entry point in `parser/adapter.ts`. Dispatches to `parseFlowchart()`, `parseStateDiagram()`, or `parseClassDiagram()` based on diagram type.
- **`reconcile()`** in `reconciler/reconciler.ts`: Changes to reconciliation logic (node identity, rename handling, layout promotion) are made here.

## Internal Boundaries

- **`webview/panel.ts`** imports `vscode` directly and is the only file that should — it owns all VSCode webview and CustomEditorProvider infrastructure. Several other `webview/` and `host/` subdirectory files additionally import `vscode` for command registration, webview panels, and Disposable types.
- **`layout/` subdirectory**: Internal layout pipeline. External callers use `layoutWithExcalidraw()` from `excalidraw-engine.ts` or `computeInitialLayout()` from `auto-layout.ts`. These entry points hide dagre layout algorithm details and Excalidraw API specifics.
- **`parser/` subdirectory**: Internal parsing. The public contract is `parseMermaid()` in `parser/adapter.ts` (returns `ParseResult`). This hides mermaid.js internals from the rest of the system.
- **`canvas/` subdirectory**: Internal rendering pipeline. `generateCanvas()` in `canvas-generator.ts` is the entry point — it hides edge routing algorithm details and Excalidraw API specifics.
- **`reconciler/` subdirectory**: Internal reconciliation pipeline. `reconcile()` in `reconciler/reconciler.ts` is the entry point — it hides placement and edge identity logic.
- **`types.ts`** at root contains only pure types with **zero runtime code**. Every other module imports from here. It must not import any module that has side effects.
- The **`DiagramPanel`** class is created via `DiagramPanel.create()`, `DiagramPanel.createEmpty()`, or `DiagramPanel.createFromExistingPanel()` — callers must use these factory methods, not the constructor directly.
- **`layout/state-identity.ts`**: Owns all state-diagram-specific identity logic. Generic mapping stays in `element-mapper.ts`; `element-mapper.ts` dispatches to `state-identity.ts` when `parsed.type === "stateDiagram-v2"`.
- **`layout/layout-debug.ts`**: Permanent gated instrumentation (not temporary). Ships with the extension. Any layout module may call `layoutDebug()`.
