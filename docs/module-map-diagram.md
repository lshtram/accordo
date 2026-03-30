# Module Map: `@accordo/diagram`

## Purpose
VSCode extension that renders Mermaid diagram files (.mmd) as Excalidraw canvases, with stable layout persistence across edits, comment anchoring on diagram nodes/edges, and 6 MCP tools for AI agents to create, read, update, and delete diagram elements.

## Composition Root
`extension.ts` — `activate()` acquires BridgeAPI, registers the `accordo-diagram.open` and `accordo-diagram.newCanvas` commands, registers a CustomEditorProvider for `.mmd` files, creates a path-keyed panel registry, registers all 6 diagram tools with the Bridge, and publishes diagram state on panel open/close.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VSCode entry point; owns panel registry, Bridge tool registration, command registration, state publishing | `activate()`, `deactivate()`, `getPanel()` |
| `types.ts` | All pure type definitions for the diagram domain (DiagramType, NodeId, EdgeKey, LayoutStore, ParsedDiagram, ParseResult, ReconcileResult, ExcalidrawElement, CanvasScene) | All domain types |
| `tools/diagram-tools.ts` | Factory for 6 MCP tool definitions; tool handlers call DiagramPanel operations via DiagramToolContext | `createDiagramTools()` |
| `webview/panel.ts` | VSCode Webview panel hosting the Excalidraw canvas; owns the Mermaid→Excalidraw rendering pipeline | `DiagramPanel` class |
| `parser/adapter.ts` | Wraps mermaid.js parser; produces a `ParsedDiagram` (nodes, edges, clusters, direction, renames) | `parseMermaid()` |
| `parser/types.ts` | Parser-specific types (aligned with `types.ts`) | `ParsedDiagram`, `ParsedNode`, `ParsedEdge`, etc. |
| `parser/reconcile.ts` | Reconciles updated Mermaid source against existing LayoutStore; produces `ReconcileResult` describing structural changes | `reconcile()` |
| `parser/layout.ts` | Dagre-based auto-layout engine; computes node positions from topology | `computeLayout()` |
| `canvas/generator.ts` | Generates Excalidraw elements from ParsedDiagram + LayoutStore | `generateCanvas()` |
| `canvas/scene-adapter.ts` | Converts generator output to Excalidraw-compatible scene format | `toExcalidrawScene()` |
| `layout-store.ts` | Reads/writes `.layout.json` files; manages LayoutStore lifecycle | `LayoutStoreManager` class |
| `layout-store/types.ts` | Layout store file format types | `LayoutStore` JSON schema types |
| `layout-store/v1.ts` | Layout store v1 read/write implementation | `readLayoutStore()`, `writeLayoutStore()` |
| `types.ts` (root) | Internal types for the extension (DiagramPanelLike, BridgeAPI) | `BridgeAPI`, `DiagramPanelLike` |

## Extension Points

- **`DiagramPanelLike`** interface: Abstract interface for diagram panel operations (load, getDiagramType, createNode, updateNode, deleteNode, createEdge, etc.). Allows tool handlers to operate on any panel implementation without depending on VSCode types.
- **`DiagramToolContext`**: Passed to all tool handlers. Provides `getPanel()` returning the most recently opened panel. Allows AI agents to operate on the active canvas.
- **6 MCP tools**: `diagram_create`, `diagram_read`, `diagram_update`, `diagram_delete`, `diagram_rename`, `diagram_list`. Adding a new tool follows the same pattern in `createDiagramTools()`.
- **`parseMermaid()`**: The single parser entry point. Any new Mermaid diagram type support is added by extending the parser adapter.
- **`reconcile()`**: The single reconciler entry point. Changes to reconciliation logic (node identity, rename handling, layout promotion) are made here.

## Internal Boundaries

- **`webview/panel.ts`** imports `vscode` directly and is the only file that should — it owns all VSCode webview and CustomEditorProvider infrastructure.
- **`layout-store/` subdirectory**: Internal persistence layer. External callers use `LayoutStoreManager` from the webview/panel, not direct file I/O.
- **`parser/` subdirectory**: Internal parsing and reconciliation. The public contract is `parseMermaid()` (returns `ParseResult`) and `reconcile()` (returns `ReconcileResult`). These hide mermaid.js internals from the rest of the system.
- **`canvas/` subdirectory**: Internal rendering pipeline. `generateCanvas()` is the entry point — it hides dagre layout algorithm details and Excalidraw API specifics.
- **`types.ts`** at root contains only pure types with **zero runtime code**. Every other module imports from here. It must not import any module that has side effects.
- The **`DiagramPanel`** class is created via `DiagramPanel.create()`, `DiagramPanel.createEmpty()`, or `DiagramPanel.createFromExistingPanel()` — callers must use these factory methods, not the constructor directly.
- **No `vscode` imports outside `webview/panel.ts` and `extension.ts`**: All other modules use the `DiagramPanelLike` interface or direct panel references obtained through the factory methods.
