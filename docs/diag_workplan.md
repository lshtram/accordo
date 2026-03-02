# Accordo — Diagram Modality Implementation Plan

**Status:** DRAFT
**Date:** 2026-03-02
**Depends on:** Phase 1 completion (Hub + Bridge + Editor — Weeks 3–5)
**Architecture:** `docs/diag_arch_v4.1.md`
**Dev process:** `docs/dev-process.md` (TDD cycle A→F)

---

## 1. Integration Model

The diagram modality follows the exact pattern established by `accordo-editor`:

```
┌──────────────────────────────────────────────────────────────────────┐
│  VSCode Extension Host                                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  accordo-diagram  (extensionKind: ["workspace"])               │  │
│  │  • 14 diagram MCP tools                                        │  │
│  │  • Webview panel (Mermaid editor + Excalidraw canvas)          │  │
│  │  • Registers tools via BridgeAPI.registerTools()               │  │
│  │  • Publishes modality state via BridgeAPI.publishState()       │  │
│  └────────────────────┬───────────────────────────────────────────┘  │
│                        │ BridgeAPI (same extension host)              │
│  ┌────────────────────▼───────────────────────────────────────────┐  │
│  │  accordo-bridge                                                │  │
│  └────────────────────┬───────────────────────────────────────────┘  │
└────────────────────────┼──────────────────────────────────────────────┘
                         │ WebSocket
┌────────────────────────▼──────────────────────────────────────────────┐
│  accordo-hub → MCP → Agent                                            │
│                                                                        │
│  Agent calls: accordo.diagram.create, .get, .patch, .move_node, etc.  │
│  Hub routes invoke → Bridge → accordo-diagram handler                  │
│  Handler reads/writes .mmd + .layout.json on disk                      │
│  Handler updates webview if open                                       │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Extension manifest

```json
{
  "name": "accordo-diagram",
  "displayName": "Accordo IDE Diagram Tools",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": [
    "onStartupFinished",
    "onCommand:accordo.diagram.new",
    "onCommand:accordo.diagram.open",
    "workspaceContains:**/*.mmd"
  ],
  "main": "./dist/extension.js",
  "extensionDependencies": ["accordo.accordo-bridge"],
  "contributes": {
    "commands": [
      { "command": "accordo.diagram.new", "title": "Accordo: New Diagram" },
      { "command": "accordo.diagram.open", "title": "Accordo: Open Diagram" },
      { "command": "accordo.diagram.reconcile", "title": "Accordo: Reconcile Diagram" },
      { "command": "accordo.diagram.render", "title": "Accordo: Export Diagram" },
      { "command": "accordo.diagram.resetLayout", "title": "Accordo: Reset Layout" },
      { "command": "accordo.diagram.fitView", "title": "Accordo: Fit Canvas to View" }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "accordo.diagram.open",
          "when": "resourceExtname == .mmd",
          "group": "navigation"
        }
      ]
    },
    "languages": [
      {
        "id": "mermaid",
        "aliases": ["Mermaid"],
        "extensions": [".mmd"],
        "configuration": "./language-configuration.json"
      }
    ]
  }
}
```

### 1.2 Activation contract

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bridge = vscode.extensions.getExtension<BridgeAPI>(
    'accordo.accordo-bridge'
  )?.exports;
  if (!bridge) return; // Bridge not installed — extension is inert

  // Register MCP tools (agent-callable)
  const toolDisposable = bridge.registerTools('accordo-diagram', diagramTools);
  context.subscriptions.push(toolDisposable);

  // Register VSCode commands (human-callable)
  registerCommands(context, bridge);

  // Watch for .mmd file changes on disk (from agent edits)
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.mmd');
  watcher.onDidChange(uri => onMermaidFileChanged(uri));
  watcher.onDidCreate(uri => onMermaidFileChanged(uri));
  context.subscriptions.push(watcher);
}
```

### 1.3 Modality state published to Hub

The diagram extension publishes its state to the Hub via `BridgeAPI.publishState()`. This appears in the system prompt at `GET /instructions`, so agents know the diagram context.

```typescript
bridge.publishState('accordo-diagram', {
  isOpen: true,
  activeDiagram: 'diagrams/arch.mmd',
  diagramType: 'flowchart',
  nodeCount: 12,
  unplacedCount: 0,
  layoutCoverage: '12/12 nodes'
});
```

When no diagram is open:
```typescript
bridge.publishState('accordo-diagram', { isOpen: false });
```

---

## 2. Package Structure

```
packages/diagram/
├── package.json
├── tsconfig.json
├── language-configuration.json     # Mermaid .mmd language support
│
├── src/
│   ├── extension.ts                # Activation, tool + command registration
│   ├── types.ts                    # All internal types (ParsedDiagram, LayoutStore, etc.)
│   │
│   ├── parser/
│   │   ├── adapter.ts              # Stable ParsedDiagram interface + validate()
│   │   ├── adapter.test.ts         # Comprehensive per-shape/edge/cluster tests
│   │   ├── flowchart.ts            # Flowchart db extraction
│   │   ├── flowchart.test.ts
│   │   ├── class-diagram.ts        # Phase B
│   │   ├── state-diagram.ts        # Phase B
│   │   ├── er-diagram.ts           # Phase B
│   │   └── mindmap.ts              # Phase B
│   │
│   ├── reconciler/
│   │   ├── reconciler.ts           # Core reconciliation (§7.1, §7.2)
│   │   ├── reconciler.test.ts
│   │   ├── edge-identity.ts        # Edge matching logic (§4.4)
│   │   ├── edge-identity.test.ts
│   │   ├── placement.ts            # Unplaced node placement + collision avoidance
│   │   └── placement.test.ts
│   │
│   ├── layout/
│   │   ├── layout-store.ts         # Read/write/patch layout.json
│   │   ├── layout-store.test.ts
│   │   ├── auto-layout.ts          # Dagre wrapper for initial layout
│   │   └── auto-layout.test.ts
│   │
│   ├── canvas/
│   │   ├── canvas-generator.ts     # (Parsed + Layout) → Excalidraw elements
│   │   ├── canvas-generator.test.ts
│   │   ├── shape-map.ts            # Mermaid shape → Excalidraw element mapping
│   │   ├── shape-map.test.ts
│   │   └── edge-router.ts          # Edge path computation between node boundaries
│   │
│   ├── tools/
│   │   ├── diagram-tools.ts        # All 14 MCP tool definitions + handlers
│   │   └── diagram-tools.test.ts
│   │
│   ├── render/
│   │   ├── kroki.ts                # Kroki API client
│   │   ├── kroki.test.ts
│   │   ├── export.ts               # Canvas export coordination
│   │   └── export.test.ts
│   │
│   └── webview/
│       ├── panel.ts                # VSCode webview panel management
│       ├── panel.test.ts
│       ├── protocol.ts             # Message types between host ↔ webview
│       ├── webview.html            # Webview HTML shell
│       └── webview.ts              # Webview-side: Excalidraw + Monaco + messaging
│
└── media/
    └── excalidraw-bundle.js        # Pre-built Excalidraw for webview
```

### 2.1 Dependencies

```json
{
  "dependencies": {
    "mermaid": "11.4.1",
    "dagre": "^0.8.5"
  },
  "devDependencies": {
    "@accordo/bridge-types": "workspace:*",
    "@types/vscode": "^1.100.0",
    "@types/dagre": "^0.7.52",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

**Excalidraw** is bundled into the webview separately (pre-built JS loaded via `<script>` in webview.html), not a Node.js dependency. It runs only in the webview's browser context.

**Kroki** is an HTTP API — no npm dependency needed. Just `fetch()`.

---

## 3. Data Flow Diagrams

### 3.1 Agent creates a diagram

```
Agent                    Hub          Bridge       accordo-diagram        Disk
  │                       │             │                │                  │
  │ tools/call:           │             │                │                  │
  │  diagram.create       │             │                │                  │
  │  {path, content}      │             │                │                  │
  │──────────────────────►│             │                │                  │
  │                       │ invoke      │                │                  │
  │                       │────────────►│                │                  │
  │                       │             │ handler call   │                  │
  │                       │             │───────────────►│                  │
  │                       │             │                │ write .mmd       │
  │                       │             │                │─────────────────►│
  │                       │             │                │                  │
  │                       │             │                │ parse mermaid    │
  │                       │             │                │ (adapter.ts)     │
  │                       │             │                │                  │
  │                       │             │                │ run dagre layout │
  │                       │             │                │ (auto-layout.ts) │
  │                       │             │                │                  │
  │                       │             │                │ write layout.json│
  │                       │             │                │─────────────────►│
  │                       │             │                │                  │
  │                       │             │                │ if webview open: │
  │                       │             │                │ regenerate scene │
  │                       │             │                │ postMessage      │
  │                       │             │                │                  │
  │                       │             │ result         │                  │
  │                       │             │◄───────────────│                  │
  │                       │ result      │                │                  │
  │                       │◄────────────│                │                  │
  │ result:               │             │                │                  │
  │  {created, type,      │             │                │                  │
  │   node_count, ...}    │             │                │                  │
  │◄──────────────────────│             │                │                  │
```

### 3.2 Human edits Mermaid text (webview open)

```
Human (Monaco editor in webview)     Webview         Extension Host        Disk
  │                                    │                  │                  │
  │ types "db[(Database)]"             │                  │                  │
  │───────────────────────────────────►│                  │                  │
  │                                    │ 500ms debounce   │                  │
  │                                    │ ................ │                  │
  │                                    │ postMessage:     │                  │
  │                                    │ mermaid-changed  │                  │
  │                                    │ {source}         │                  │
  │                                    │─────────────────►│                  │
  │                                    │                  │ validate(source) │
  │                                    │                  │ if invalid:      │
  │                                    │                  │   postMessage:   │
  │                                    │ parse-error      │   parse-error    │
  │                                    │◄─────────────────│   {line, msg}    │
  │ red squiggle on error line         │                  │   STOP           │
  │◄───────────────────────────────────│                  │                  │
  │                                    │                  │ if valid:        │
  │                                    │                  │ write .mmd       │
  │                                    │                  │─────────────────►│
  │                                    │                  │ reconcile()      │
  │                                    │                  │ write layout.json│
  │                                    │                  │─────────────────►│
  │                                    │                  │ generateCanvas() │
  │                                    │ load-scene       │                  │
  │                                    │◄─────────────────│                  │
  │ canvas updates with new node       │                  │                  │
  │◄───────────────────────────────────│                  │                  │
```

### 3.3 Human drags a node (webview open)

```
Human (Excalidraw canvas)            Webview         Extension Host        Disk
  │                                    │                  │                  │
  │ drags "auth" node to (200, 300)    │                  │                  │
  │───────────────────────────────────►│                  │                  │
  │                                    │ immediate        │                  │
  │                                    │ postMessage:     │                  │
  │                                    │ node-moved       │                  │
  │                                    │ {excalId, x, y}  │                  │
  │                                    │─────────────────►│                  │
  │                                    │                  │ lookup mermaidId │
  │                                    │                  │ from excalId     │
  │                                    │                  │                  │
  │                                    │                  │ patch layout.json│
  │                                    │                  │ auth: {x:200,    │
  │                                    │                  │        y:300}    │
  │                                    │                  │─────────────────►│
  │                                    │                  │                  │
  │                                    │                  │ mermaid NOT      │
  │                                    │                  │ touched          │
  │                                    │                  │                  │
  │ (Excalidraw already moved it       │                  │                  │
  │  locally — no scene regeneration)  │                  │                  │
```

### 3.4 Agent edits while human has webview open

```
Agent              Hub       Bridge     Extension Host        Webview          Disk
  │                 │          │              │                  │               │
  │ diagram.patch   │          │              │                  │               │
  │ {new mermaid}   │          │              │                  │               │
  │────────────────►│          │              │                  │               │
  │                 │ invoke   │              │                  │               │
  │                 │─────────►│              │                  │               │
  │                 │          │ handler      │                  │               │
  │                 │          │─────────────►│                  │               │
  │                 │          │              │ validate + write │               │
  │                 │          │              │─────────────────────────────────►│
  │                 │          │              │ reconcile        │               │
  │                 │          │              │─────────────────────────────────►│
  │                 │          │              │ generateCanvas() │               │
  │                 │          │              │                  │               │
  │                 │          │              │ postMessage:     │               │
  │                 │          │              │ load-scene +     │               │
  │                 │          │              │ toast "Updated   │               │
  │                 │          │              │ by agent"        │               │
  │                 │          │              │─────────────────►│               │
  │                 │          │              │                  │ canvas reloads│
  │                 │          │ result       │                  │               │
  │                 │          │◄─────────────│                  │               │
  │                 │ result   │              │                  │               │
  │                 │◄─────────│              │                  │               │
  │ {patched, ...}  │          │              │                  │               │
  │◄────────────────│          │              │                  │               │
```

---

## 4. Module Breakdown

### 4.1 Dependency graph (build order)

```
types.ts                          # no dependencies — pure type definitions
    │
    ├── parser/adapter.ts         # depends on: types, mermaid
    │       │
    │       └── parser/flowchart.ts
    │
    ├── layout/layout-store.ts    # depends on: types, node:fs
    │
    ├── layout/auto-layout.ts     # depends on: types, dagre
    │
    ├── reconciler/edge-identity.ts  # depends on: types
    │
    ├── reconciler/placement.ts      # depends on: types
    │
    ├── reconciler/reconciler.ts     # depends on: types, adapter, layout-store,
    │                                #   edge-identity, placement
    │
    ├── canvas/shape-map.ts          # depends on: types
    │
    ├── canvas/edge-router.ts        # depends on: types
    │
    ├── canvas/canvas-generator.ts   # depends on: types, shape-map, edge-router
    │
    ├── render/kroki.ts              # depends on: node:https (fetch)
    │
    ├── render/export.ts             # depends on: kroki, webview protocol
    │
    ├── webview/protocol.ts          # depends on: types
    │
    ├── webview/panel.ts             # depends on: vscode, protocol, canvas-generator,
    │                                #   reconciler, layout-store, adapter
    │
    ├── tools/diagram-tools.ts       # depends on: adapter, reconciler, layout-store,
    │                                #   auto-layout, render, panel
    │
    └── extension.ts                 # depends on: tools, panel, BridgeAPI
```

### 4.2 Implementation modules — Phase A (MVP)

Each module follows the TDD cycle from `dev-process.md`.

| # | Module | Source file(s) | Estimated lines | Dependencies | Tests |
|---|---|---|---|---|---|
| A1 | Internal types | `types.ts` | ~120 | none | type compilation |
| A2 | Flowchart parser | `parser/adapter.ts`, `parser/flowchart.ts` | ~300 | mermaid | ~40 |
| A3 | Layout store | `layout/layout-store.ts` | ~150 | types, node:fs | ~25 |
| A4 | Auto-layout (dagre) | `layout/auto-layout.ts` | ~100 | types, dagre | ~15 |
| A5 | Edge identity | `reconciler/edge-identity.ts` | ~80 | types | ~20 |
| A6 | Unplaced placement | `reconciler/placement.ts` | ~120 | types | ~20 |
| A7 | Reconciler | `reconciler/reconciler.ts` | ~250 | A2, A3, A5, A6 | ~35 |
| A8 | Shape map | `canvas/shape-map.ts` | ~100 | types | ~15 |
| A9 | Edge router | `canvas/edge-router.ts` | ~120 | types | ~15 |
| A10 | Canvas generator | `canvas/canvas-generator.ts` | ~250 | A8, A9 | ~25 |
| A11 | Webview protocol | `webview/protocol.ts` | ~60 | types | type compilation |
| A12 | Kroki client | `render/kroki.ts` | ~80 | node:https | ~10 |
| A13 | Export coordinator | `render/export.ts` | ~60 | A12, protocol | ~10 |
| A14 | MCP tool definitions | `tools/diagram-tools.ts` | ~400 | A2–A13 | ~40 |
| A15 | Webview panel | `webview/panel.ts` | ~300 | vscode, protocol, A7, A10 | ~15 |
| A16 | Webview frontend | `webview/webview.html`, `webview/webview.ts` | ~400 | Excalidraw, Monaco | manual test |
| A17 | Extension entry | `extension.ts` | ~60 | A14, A15, BridgeAPI | ~10 |

**Total Phase A estimate:** ~2950 lines of implementation, ~295 unit tests.

---

## 5. Module Specifications

### A1: Internal types (`types.ts`)

Pure type definitions. No runtime code. Used by all other modules.

```typescript
// Diagram type detection
type DiagramType =
  | "flowchart" | "block-beta" | "classDiagram"
  | "stateDiagram-v2" | "erDiagram" | "mindmap"
  | "sequenceDiagram" | "gantt" | "gitGraph"
  | "timeline" | "quadrantChart";

type SpatialDiagramType =
  | "flowchart" | "block-beta" | "classDiagram"
  | "stateDiagram-v2" | "erDiagram" | "mindmap";

type SequentialDiagramType =
  | "sequenceDiagram" | "gantt" | "gitGraph"
  | "timeline" | "quadrantChart";

// Parser output
interface ParsedDiagram { ... }  // see diag_arch_v4.1.md §6.2
interface ParsedNode { ... }
interface ParsedEdge { ... }
interface ParsedCluster { ... }

type ParseResult =
  | { valid: true; diagram: ParsedDiagram }
  | { valid: false; error: { line: number; message: string } };

// Node shapes (Mermaid)
type NodeShape =
  | "rectangle" | "rounded" | "diamond" | "circle"
  | "stadium" | "subroutine" | "cylinder" | "hex"
  | "parallelogram" | "trapezoid";

// Edge types
type EdgeType = "arrow" | "dotted" | "thick" | "invisible";

// Layout store on-disk schema
interface LayoutStore {
  version: "1.0";
  diagram_type: SpatialDiagramType;
  nodes: Record<string, NodeLayout>;
  edges: Record<string, EdgeLayout>;
  clusters: Record<string, ClusterLayout>;
  unplaced: string[];
}

interface NodeLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  style: Partial<NodeStyle>;
}

interface EdgeLayout {
  routing: "auto" | "manual";
  waypoints: Array<{ x: number; y: number }>;
  style: Partial<EdgeStyle>;
}

interface ClusterLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  style: Partial<ClusterStyle>;
}

interface NodeStyle {
  backgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
  strokeDash: boolean;
  fontSize: number;
  fontColor: string;
  fontWeight: "normal" | "bold";
  opacity: number;
}

// Webview ↔ host message protocol: see A11
```

### A2: Flowchart parser (`parser/adapter.ts`, `parser/flowchart.ts`)

**This is the highest-risk module. It must be built and tested first.**

The adapter exposes a stable `ParsedDiagram` interface. Internally, it accesses the undocumented mermaid `diagram.parser.yy` API. All mermaid internal access is confined to per-diagram-type files (`flowchart.ts`, etc.).

```typescript
// adapter.ts — public API
export function parseMermaid(source: string): ParseResult;
export function detectDiagramType(source: string): DiagramType | null;
export function isSpatialType(type: DiagramType): type is SpatialDiagramType;
export function isSequentialType(type: DiagramType): type is SequentialDiagramType;
```

```typescript
// flowchart.ts — internal, mermaid-version-specific
export function parseFlowchart(db: FlowchartDb): ParsedDiagram;
```

**Test requirements for A2 (parser adapter):**

| Test group | Coverage |
|---|---|
| Type detection | All 11 diagram types detected from first line |
| Node extraction | Rectangle, rounded, diamond, circle, stadium, cylinder, hex shapes |
| Edge extraction | Arrow types (-->, --->, -.->), labels, multi-edges between same pair |
| Cluster extraction | subgraph with ID + label, nested subgraphs, cluster membership |
| Edge ordinals | Multiple edges between same pair get correct ordinal 0, 1, 2... |
| Label extraction | Quoted labels, bracket labels, plain text labels |
| classDef extraction | Classes applied to nodes via `:::className` |
| Direction | TD, LR, RL, BT detection |
| Invalid input | Syntax errors return `{ valid: false, error: { line, message } }` |
| Empty diagram | `flowchart TD` with no nodes returns empty collections |
| Comments | `%%` comments and metadata ignored in parsing |
| Rename annotations | `%% @rename: old -> new` detected and returned for reconciler |

### A3: Layout store (`layout/layout-store.ts`)

Read, write, and patch `*.layout.json` files.

```typescript
export function readLayout(path: string): Promise<LayoutStore | null>;
export function writeLayout(path: string, layout: LayoutStore): Promise<void>;
export function patchNode(
  layout: LayoutStore, nodeId: string, patch: Partial<NodeLayout>
): LayoutStore;
export function patchEdge(
  layout: LayoutStore, edgeKey: string, patch: Partial<EdgeLayout>
): LayoutStore;
export function patchCluster(
  layout: LayoutStore, clusterId: string, patch: Partial<ClusterLayout>
): LayoutStore;
export function removeNode(layout: LayoutStore, nodeId: string): LayoutStore;
export function removeEdge(layout: LayoutStore, edgeKey: string): LayoutStore;
export function addUnplaced(layout: LayoutStore, nodeIds: string[]): LayoutStore;
export function createEmptyLayout(diagramType: SpatialDiagramType): LayoutStore;
export function layoutPathFor(mmdPath: string): string;
```

All mutations return a new `LayoutStore` object (immutable pattern). The caller decides when to persist to disk via `writeLayout`.

### A4: Auto-layout (`layout/auto-layout.ts`)

Dagre wrapper. Produces initial positions for a full `ParsedDiagram` or for a set of unplaced nodes.

```typescript
export function layoutFull(
  parsed: ParsedDiagram,
  options?: { direction?: "TD" | "LR" | "RL" | "BT"; nodeSpacing?: number }
): LayoutStore;

export function layoutUnplaced(
  parsed: ParsedDiagram,
  existingLayout: LayoutStore,
  unplacedIds: string[]
): Map<string, { x: number; y: number; w: number; h: number }>;
```

`layoutFull` is called on `diagram.create`. `layoutUnplaced` is called by the reconciler for newly added nodes.

### A5: Edge identity (`reconciler/edge-identity.ts`)

Implements the edge matching algorithm from v4.1 §4.4.

```typescript
export function matchEdges(
  oldEdges: readonly ParsedEdge[],
  newEdges: readonly ParsedEdge[],
  oldLayout: Record<string, EdgeLayout>
): {
  preserved: Map<string, { oldKey: string; newKey: string }>;
  added: string[];      // new edge keys needing default routing
  removed: string[];    // old edge keys to remove from layout
};
```

### A6: Placement (`reconciler/placement.ts`)

Placement of unplaced nodes with collision avoidance.

```typescript
export function placeNodes(
  unplacedIds: string[],
  parsed: ParsedDiagram,
  existingLayout: LayoutStore,
  options?: { direction?: "TD" | "LR"; nodeSpacing?: number }
): Map<string, { x: number; y: number; w: number; h: number }>;
```

### A7: Reconciler (`reconciler/reconciler.ts`)

The core reconciliation engine. ~250 lines. Stateless and deterministic.

```typescript
export interface ReconcileResult {
  layout: LayoutStore;                  // updated layout
  mermaidCleaned?: string;              // mermaid with @rename annotations stripped
  changes: {
    nodesAdded: string[];
    nodesRemoved: string[];
    edgesAdded: number;
    edgesRemoved: number;
    clustersChanged: number;
    renamesApplied: string[];           // "old_id -> new_id"
  };
}

export function reconcile(
  oldSource: string,
  newSource: string,
  currentLayout: LayoutStore
): ReconcileResult;
```

The reconciler does NOT read or write files. It takes inputs and returns outputs. The caller (tool handler or webview panel) manages I/O.

### A8–A10: Canvas generator

Converts `(ParsedDiagram + LayoutStore) → ExcalidrawElement[]`.

Phase A supports flowchart shapes only. See v4.1 §9.2 for the shape mapping table.

### A11: Webview protocol (`webview/protocol.ts`)

Typed message definitions for extension host ↔ webview communication. See v4.1 §9.4.

### A12: Kroki client (`render/kroki.ts`)

```typescript
export async function renderMermaid(
  source: string,
  format: "svg" | "png",
  krokiUrl?: string          // default: "https://kroki.io"
): Promise<Buffer>;
```

### A14: MCP tool definitions (`tools/diagram-tools.ts`)

All 14 tools defined as `ExtensionToolDefinition[]` following the `accordo-editor` pattern.

Each tool handler:
1. Validates input (path exists, node_id exists, etc.)
2. Reads .mmd and/or layout.json from disk
3. Calls appropriate internal module (parser, reconciler, layout store, etc.)
4. Writes results to disk
5. If webview is open: triggers canvas refresh
6. Returns structured result to agent

**Phase A tools (MVP):**

| Tool | Handler logic |
|---|---|
| `diagram.list` | `glob('**/*.mmd')` → detect type per file → return metadata |
| `diagram.get` | `parseMermaid(source)` → return semantic graph + raw source |
| `diagram.create` | write .mmd → parse → `layoutFull()` → write layout.json |
| `diagram.patch` | write .mmd → `reconcile(old, new, layout)` → write layout.json |
| `diagram.render` | canvas mode: request from webview. semantic mode: `renderMermaid()` |

**Phase B tools (added later):**

| Tool | Handler logic |
|---|---|
| `diagram.add_node` | Insert into Mermaid AST → reconcile |
| `diagram.remove_node` | Remove from Mermaid → reconcile |
| `diagram.add_edge` | Insert into Mermaid → reconcile |
| `diagram.remove_edge` | Remove from Mermaid → reconcile |
| `diagram.add_cluster` | Insert subgraph into Mermaid → reconcile |
| `diagram.move_node` | Patch layout.json only |
| `diagram.resize_node` | Patch layout.json only |
| `diagram.set_node_style` | Patch layout.json only |
| `diagram.set_edge_routing` | Patch layout.json only |

### A15: Webview panel (`webview/panel.ts`)

VSCode webview panel manager. Creates, shows, and communicates with the dual-pane webview.

```typescript
export class DiagramPanel {
  static create(
    context: vscode.ExtensionContext,
    mmdPath: string
  ): DiagramPanel;

  // Reload canvas from current files
  refresh(): Promise<void>;

  // Send a toast notification to webview
  notify(message: string): void;

  // Request export from webview
  requestExport(format: "svg" | "png"): Promise<Buffer>;

  // Dispose
  dispose(): void;
}
```

The panel manages:
- Monaco editor instance (Mermaid pane) — synced with .mmd file on disk
- Excalidraw canvas instance — generated from parse + layout
- File watchers for external changes (agent edits)
- Debounced reconciliation on text changes
- Layout.json updates on canvas interactions

### A16: Webview frontend

The webview HTML loads:
- Pre-built Excalidraw bundle (React-based)
- Monaco editor (from VSCode's built-in)
- Custom messaging layer that talks to extension host

This module is tested manually (webview context, not Node.js).

---

## 6. Weekly Schedule

### Week D1 — Parser + Layout foundations

**Goal:** Parse Mermaid flowcharts reliably. Read/write layout.json.

| Day | Module | Output |
|---|---|---|
| Mon | A1: types.ts | Type definitions compile |
| Mon–Tue | A2: parser adapter + flowchart | ~40 tests, all shapes/edges/clusters |
| Wed | A3: layout-store.ts | ~25 tests, read/write/patch |
| Thu | A4: auto-layout.ts (dagre) | ~15 tests, full diagram layout |
| Fri | A5: edge-identity.ts | ~20 tests, all matching scenarios |

**Gate:** Can parse any flowchart Mermaid → `ParsedDiagram`. Can read/write layout.json. Dagre produces positions. Edge matching works.

### Week D2 — Reconciler + Canvas

**Goal:** Reconciler preserves layout across edits. Canvas generator produces Excalidraw elements.

| Day | Module | Output |
|---|---|---|
| Mon | A6: placement.ts | ~20 tests, collision avoidance |
| Mon–Tue | A7: reconciler.ts | ~35 tests, topology + layout reconciliation |
| Wed | A8: shape-map.ts | ~15 tests, all flowchart shapes |
| Wed–Thu | A9: edge-router.ts | ~15 tests, edge path computation |
| Thu–Fri | A10: canvas-generator.ts | ~25 tests, full scene generation |

**Gate:** `reconcile(old, new, layout)` preserves positions for unchanged nodes. `generateCanvas(parsed, layout)` produces valid Excalidraw elements. Layout changes survive topology edits.

### Week D3 — Tools + Rendering + Webview

**Goal:** MCP tools callable by agent. Webview renders diagrams.

| Day | Module | Output |
|---|---|---|
| Mon | A11: webview protocol + A12: kroki.ts | Type definitions + ~10 kroki tests |
| Mon–Tue | A13: export.ts + A14: diagram-tools.ts | ~50 tests, all 5 Phase A tools |
| Wed–Thu | A15: panel.ts | ~15 tests, webview lifecycle |
| Thu–Fri | A16: webview frontend (HTML + TS) | Manual testing, dual-pane rendering |
| Fri | A17: extension.ts | ~10 tests, activation + registration |

**Gate:** Agent can create, read, patch, and render diagrams via MCP tools. Human can open a `.mmd` file in the dual-pane webview. Mermaid edits reconcile and update canvas. Canvas drags update layout.json.

### Week D4 — Integration + Polish

**Goal:** End-to-end flows work. Agent and human can both edit the same diagram without layout loss.

| Day | Task | Output |
|---|---|---|
| Mon | Integration test: agent creates diagram → human opens in webview → agent adds nodes → positions preserved | E2E verified |
| Mon | Integration test: human drags nodes → agent reads diagram → sees updated positions | E2E verified |
| Tue | Sequential diagram support (single-pane Monaco + Kroki preview) | Sequential diagrams render |
| Tue | File watcher: agent edits .mmd on disk → webview refreshes with toast | External edit flow works |
| Wed | Export: canvas SVG/PNG via Excalidraw + semantic SVG/PNG via Kroki | Both export paths work |
| Wed | Error handling: invalid Mermaid states, missing files, Kroki unavailable | Errors handled gracefully |
| Thu | Performance: test with 50-node, 100-node diagrams | Acceptable latency |
| Thu | Modality state: publishState to Hub, visible in /instructions | Agents see diagram context |
| Fri | Documentation: README, tool descriptions, known limitations | Docs complete |

**Gate:** Full Phase A exit criteria met (see §7).

---

## 7. Phase A Exit Criteria

All of these must be true before Phase A is complete:

1. **Parser:** Flowchart Mermaid → ParsedDiagram extraction works for all standard shapes, edges, clusters
2. **Reconciler:** Topology changes preserve existing layout. New nodes are auto-placed without collision.
3. **Canvas:** Excalidraw scene generated correctly from ParsedDiagram + LayoutStore
4. **MCP tools:** `diagram.list`, `.create`, `.get`, `.patch`, `.render` callable by agent via Hub → Bridge → accordo-diagram
5. **Webview:** Dual-pane panel (Mermaid + Excalidraw) renders correctly
6. **Sync:** Mermaid edits → reconcile → canvas refresh (500ms debounce, invalid state handled)
7. **Sync:** Canvas drag/resize → layout.json patch (immediate, no Mermaid change)
8. **Export:** Both canvas (Excalidraw) and semantic (Kroki) exports produce SVG/PNG
9. **External edits:** Agent .mmd edit on disk → webview refreshes with toast notification
10. **Modality state:** Diagram context appears in Hub's /instructions prompt
11. **Tests:** All unit tests pass, zero TypeScript errors
12. **Integration:** At least one real agent (Claude Code) successfully creates and patches a diagram

---

## 8. Phase B Plan (after Phase A gate)

| Module | Description |
|---|---|
| Fine-grained topology tools | `add_node`, `remove_node`, `add_edge`, `remove_edge`, `add_cluster` — each modifies Mermaid AST and reconciles |
| Layout tools | `move_node`, `resize_node`, `set_node_style`, `set_edge_routing` — pure layout.json patches |
| Additional parsers | classDiagram, stateDiagram-v2, erDiagram, mindmap |
| Mindmap path-based identity | Derive IDs from tree path |
| Canvas → Mermaid topology sync | Right-click "Add node" / "Delete node" from canvas |
| Rename annotation | `%% @rename: old -> new` with auto-cleanup |
| Undo/redo | Operation log (50-entry ring buffer), file-level undo |
| Dirty-canvas guard | Merge human layout changes with agent topology changes |
| Full shape fidelity | All Mermaid node shapes in canvas generator |

---

## 9. Risk Register (Implementation-specific)

| Risk | Severity | Mitigation |
|---|---|---|
| Mermaid `db` API breaks on version update | High | Pin to 11.4.1. Adapter tests catch breaks. Isolate in single module. |
| `getDiagramFromText` requires DOM | Medium | Test in Week D1 Day 1. Fallback: minimal JSDOM context. |
| Excalidraw bundle size bloats webview | Medium | Tree-shake. Load async. Measure in Week D3. |
| Canvas generation performance (100+ nodes) | Medium | Partial updates for layout-only changes. Profile in Week D4. |
| Dagre produces poor layout for certain graph shapes | Low | Users can adjust. This is initial placement only. |
| Kroki service unavailable | Low | Cache renders. Graceful error: "Rendering service unavailable." |
| Monaco editor in webview conflicts with Excalidraw keyboard shortcuts | Medium | Keyboard shortcut scoping by pane focus. Test in Week D3. |

---

## 10. What Touches Existing Packages

The diagram extension is a new package. It does NOT modify Hub, Bridge, or Editor code. It only depends on the BridgeAPI contract.

| Existing package | Change needed | Details |
|---|---|---|
| `@accordo/bridge-types` | None | Diagram types are internal to `packages/diagram/src/types.ts`. Only `BridgeAPI`, `ExtensionToolDefinition`, and `ToolRegistration` are used from bridge-types, and they are already sufficient. |
| `accordo-hub` | None | Hub routes tool calls generically. It doesn't know or care about diagram-specific logic. The prompt engine will include diagram modality state automatically via the `modalities` field in IDEState. |
| `accordo-bridge` | None | Bridge routes invocations by tool name. When accordo-diagram registers tools, Bridge sends them to Hub. No code change in Bridge. |
| `pnpm-workspace.yaml` | Add entry | `- 'packages/diagram'` |
| `tsconfig.base.json` | Add reference | `{ "path": "./packages/diagram" }` |
| Root `package.json` | None | Build script `tsc -b` picks up new reference automatically |

---

## 11. Testing Strategy

### Unit tests (Vitest)

All modules tested in isolation with mocks. Same patterns as Hub and Bridge tests.

- Parser: mock `mermaid.mermaidAPI.getDiagramFromText()` to return known `db` objects
- Layout store: test against in-memory objects (no disk I/O in unit tests)
- Reconciler: pure function — test with input/output pairs
- Canvas generator: snapshot tests for element arrays
- Tools: mock `vscode.workspace.fs`, mock webview panel
- Kroki: mock `fetch()`

### Integration tests

Full pipeline tests that exercise the real mermaid parser (no mocks):
- Parse real `.mmd` file → reconcile → generate canvas
- Create diagram → patch → verify layout preserved
- Parse invalid Mermaid → verify error returned

### Manual tests (webview)

- Open .mmd in dual-pane
- Edit Mermaid text → canvas updates
- Drag nodes → layout.json updates
- Agent edits file → webview refreshes with toast
- Export canvas SVG and semantic SVG → verify both produce output
