# Accordo — Diagram Modality Implementation Plan

**Status:** IN PROGRESS
**Date:** 2026-03-15
**Depends on:** Session 10D complete (1837 tests green)
**Architecture:** `docs/diag_arch_v4.2.md`
**Dev process:** `docs/dev-process.md` (TDD cycle A→F)

## Current Status (as of 2026-03-15)

| Module | State | Commit | Tests |
|---|---|---|---|
| A1 Internal types | ✅ DONE | `9b0200f` | 36 pass |
| A2 Flowchart parser | ✅ DONE | `2d439e5` + `429c53d` | 67 pass |
| A3 Layout store | ✅ DONE | `15a4369` | 54 pass |
| A4 Auto-layout (dispatch) | ✅ DONE | `f49bb9e` + `391abf2` | 36 pass |
| A5 Edge identity | ✅ DONE | — | 22 pass |
| A6 Placement | ✅ DONE | — | 24 pass (PL-01..PL-24; PL-21..24 backfill†) |
| A7 Reconciler | ✅ DONE | `bef728f` | 36 pass (RC-01..RC-36) |
| A8 Shape map | ✅ DONE | — | 15 pass |
| A9 Edge router | ✅ DONE | — | 15 pass |
| A10 Canvas generator | ✅ DONE | `bef728f` | 33 pass (CG-01..CG-33; CG-28..33 backfill†) |
| A11 Protocol types | ✅ DONE | — | type-only |
| A14 MCP tool definitions | ✅ DONE | — | 52 pass (DT-01..DT-52; DT-49..52 backfill†) |
| A15 Webview panel | ✅ DONE | `aa7d8ec` | 16 pass (AP-01..AP-15, AP-09b) |
| A16 Webview frontend | ✅ DONE | — | manual test + html.test.ts |
| A17 Extension entry | ✅ DONE | — | 13 pass (EX-01..EX-13) |

**Additional features delivered in Session 11 (committed 2026-03-15):**
- `accordo_diagram_patch` — added `x`/`y` per-node position fields + `clusterStyles` arg (agents no longer need to write `.layout.json` directly)
- Aux files (`.layout.json`, `.excalidraw`) moved from `<source-dir>/` to `<workspace>/.accordo/diagrams/<rel>/` 
- `.mmd` files registered as custom editor (`accordo.diagram` viewType) — double-clicking opens the canvas view

**Total passing (packages/diagram):** 444 tests  
**Next module:** TD-DIAG-1 + TD-DIAG-2 clean-up done (PANEL_FILE_DEBUG switch added). diag.1 complete — next is TD-CROSS-1 or diag.2.

> **LS-ID note:** Requirement IDs `LS-01..LS-12` used in layout-store tests are
> locally derived. A canonical mapping should be established in a future pass.

> **† Backfill-TDD exception (A6-v2, A10-v2, A14-v2):** Three sets of tests
> (PL-21..24, CG-28..33, DT-49..52) were written *after* implementation during
> a TDD catch-up pass (2026-03-14). The exception was agreed by reviewer because
> implementation had already landed untested: PL-21..24 cover the A6-v2
> dagre-first algorithm; CG-28..33 cover A10-v2 per-node canvas styles
> (fillStyle, strokeStyle, roughness, fontFamily); DT-49..52 cover A14-v2
> nodeStyles width/height segregation. All 51 new tests are discriminating (not
> tautological). Phase B2 approval on record.

---

## 0. Technical Debt Register (diagram package)

Registered 2026-03-15. Items are ordered by priority (highest first).

| ID | Severity | Description | File(s) | Blocking |
|---|---|---|---|---|
| TD-DIAG-1 | ✅ CLOSED | `_debugLog` + `appendFileSync` — gated behind `PANEL_FILE_DEBUG = false` constant in `panel.ts`. Set to `true` to re-enable file logging. | `panel.ts` | — |
| TD-DIAG-2 | 🟡 LOW | **Export to `.excalidraw` format** — implement `accordo_diagram_export_excalidraw` (or a VS Code setting `accordo.diagram.writeExcalidrawSnapshot`) that writes the rendered scene as a standard Excalidraw file alongside the layout. Lets users open the diagram in excalidraw.com or the Excalidraw VS Code extension without Accordo. The write logic is already commented out in `panel.ts` `_loadAndPost()` — replace `writeFileSync` with async `writeFile` and gate on the setting. | `panel.ts`, `diagram-tools.ts` | none |
| TD-DIAG-3 | 🟠 MEDIUM | `_patchLayoutSync()` uses `readFileSync`/`writeFileSync`/`mkdirSync` — blocking sync I/O in a `onDidReceiveMessage` callback (every node drag). Should become `_patchLayoutAsync()` with debounce write coalescing. Acceptable for A16 testing but must be resolved before production hardening (post-A17). | `panel.ts` L590-610 | post-A17 |
| TD-DIAG-4 | 🟡 LOW | `.accordo/` not in `.gitignore`. Layout JSON lives at `<workspace>/.accordo/diagrams/`. Decision: layout files should be committed (they are user/agent data); `.excalidraw` snapshots should be gitignored. Once TD-DIAG-2 is resolved (snapshots removed), no `.gitignore` entry needed. Track here until TD-DIAG-2 is closed. | `.gitignore` | none |
| TD-DIAG-5 | ✅ CLOSED | Session 11 work committed + pushed (`4f3d29a`, 2026-03-15). | — | — |
| TD-DIAG-6 | 🟡 LOW | `workspaceFolders[0]` assumption — `_workspaceRoot` falls back to `""` in multi-root workspaces, which corrupts the `.accordo/diagrams/` path derivation. Known single-root limitation. Document explicitly; guard `layoutPathFor` when `workspaceRoot === ""` (throw or use CWD). | `panel.ts`, `layout-store.ts` | none |
| TD-DIAG-7 | 🟡 LOW | LS-ID note — `LS-01..LS-12` requirement IDs in layout-store tests are locally derived; never formally linked to a requirements doc. Establish canonical mapping in a future requirements pass. | `layout-store.test.ts` | none |

---

## 1. Integration Model

The diagram modality follows the exact pattern established by `accordo-editor`:

```
┌──────────────────────────────────────────────────────────────────────┐
│  VSCode Extension Host                                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  accordo-diagram  (extensionKind: ["workspace"])               │  │
│  │  • 15 diagram MCP tools (6 in diag.1, 9 added in diag.2)      │  │
│  │  • Webview panel (Excalidraw canvas, canvas-only)               │  │
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
│  Agent calls: accordo_diagram_create, _get, _patch, _move_node, etc. │
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
│   │   ├── class-diagram.ts        # diag.2
│   │   ├── state-diagram.ts        # diag.2
│   │   ├── er-diagram.ts           # diag.2
│   │   └── mindmap.ts              # diag.2
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
│   │   ├── diagram-tools.ts        # All 15 MCP tool definitions + handlers
│   │   └── diagram-tools.test.ts
│   │
│   ├── comments/
│   │   ├── diagram-comments-bridge.ts  # Wires webview ↔ SurfaceCommentAdapter
│   │   └── diagram-comments-bridge.test.ts
│   │
│   └── webview/
│       ├── panel.ts                # VSCode webview panel management
│       ├── panel.test.ts
│       ├── protocol.ts             # Message types between host ↔ webview
│       ├── webview.html            # Webview HTML shell (loads comment-sdk)
│       └── webview.ts              # Webview-side: Excalidraw canvas + SDK + host messaging
│
└── media/
    └── excalidraw-bundle.js        # Pre-built Excalidraw for webview
```

### 2.1 Dependencies

```json
{
  "dependencies": {
    "mermaid": "11.4.1",
    "dagre": "^0.8.5",
    "@accordo/comment-sdk": "workspace:*"
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

### 3.2 Human edits Mermaid source (opens .mmd as text, saves, panel refreshes)

The webview shows Excalidraw only. To edit Mermaid source the human opens the
`.mmd` file as a normal VS Code text editor tab (File Explorer or `Ctrl+P`),
edits it, and saves. The extension's file watcher triggers the refresh.

```
Human (VS Code text editor)     Extension Host             Webview          Disk
  │                                  │                        │               │
  │ opens arch.mmd as text           │                        │               │
  │ (File Explorer / Ctrl+P)         │                        │               │
  │──────────────────────────────────►                        │               │
  │ edits source, saves (⌘S)         │                        │               │
  │─────────────────────────────────►│                        │               │
  │                                  │ file watcher fires     │               │
  │                                  │ onMermaidFileChanged   │               │
  │                                  │                        │               │
  │                                  │ readFile + parseMermaid│               │
  │                                  │──────────────────────────────────────►│
  │                                  │ reconcile()            │               │
  │                                  │──────────────────────────────────────►│
  │                                  │ generateCanvas()       │               │
  │                                  │                        │               │
  │                                  │ postMessage:           │               │
  │                                  │ host:load-scene        │               │
  │                                  │───────────────────────►│               │
  │                                  │                        │ canvas updates│
  │                                  │                        │               │
  │                                  │ (on parse failure:     │               │
  │                                  │ postMessage:           │               │
  │                                  │ host:error-overlay     │               │
  │                                  │ {message}              │               │
  │                                  │───────────────────────►│               │
  │                                  │                        │ error overlay │
  │                                  │                        │ shown; canvas │
  │                                  │                        │ unchanged.    │
  │                                  │                        │ Clears on next│
  │                                  │                        │ load-scene.)  │
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
    ├── webview/protocol.ts          # depends on: types
    │
    ├── webview/panel.ts             # depends on: vscode, protocol, canvas-generator,
    │                                #   reconciler, layout-store, adapter
    │
    ├── tools/diagram-tools.ts       # depends on: adapter, reconciler, layout-store,
    │                                #   auto-layout, panel
    │
    └── extension.ts                 # depends on: tools, panel, BridgeAPI
```

### 4.2 Implementation modules — diag.1 (MVP)

Each module follows the TDD cycle from `dev-process.md`.

| # | Module | Source file(s) | Estimated lines | Dependencies | Tests |
|---|---|---|---|---|---|
| A1 | Internal types | `types.ts` | ~120 | none | type compilation |
| A2 | Flowchart parser | `parser/adapter.ts`, `parser/flowchart.ts` | ~300 | mermaid | ~40 |
| A3 | Layout store | `layout/layout-store.ts` | ~150 | types, node:fs | ~25 |
| A4 | Auto-layout (dispatch) | `layout/auto-layout.ts` | ~120 | types, @dagrejs/dagre | ~20 |
| A5 | Edge identity | `reconciler/edge-identity.ts` | ~80 | types | ~20 |
| A6 | Unplaced placement | `reconciler/placement.ts` | ~120 | types | ~20 |
| A7 | Reconciler | `reconciler/reconciler.ts` | ~250 | A2, A3, A5, A6 | ~35 |
| A8 | Shape map | `canvas/shape-map.ts` | ~100 | types | ~15 |
| A9 | Edge router | `canvas/edge-router.ts` | ~120 | types | ~15 |
| A10 | Canvas generator | `canvas/canvas-generator.ts` | ~250 | A8, A9 | ~25 |
| A11 | Webview protocol | `webview/protocol.ts` | ~60 | types | type compilation |
| A14 | MCP tool definitions | `tools/diagram-tools.ts` | ~450 | A2–A11 | ~45 |
| A15 | Webview panel | `webview/panel.ts` | ~300 | vscode, protocol, A7, A10 | ~15 |
| A16 | Webview frontend | `webview/webview.html`, `webview/webview.ts` | ~300 | Excalidraw | manual test |
| A17 | Extension entry | `extension.ts` | ~60 | A14, A15, BridgeAPI | ~10 |

**Total diag.1 estimate:** ~3000 lines of implementation, ~303 unit tests.

**A14 tool count: 6 diag.1 tools** — `accordo_diagram_list`, `accordo_diagram_get`, `accordo_diagram_create`, `accordo_diagram_patch`, `accordo_diagram_render`, `accordo_diagram_style_guide`.

---

## 5. Module Specifications

### A1: Internal types (`types.ts`)

Pure type definitions. No runtime code. Used by all other modules.

```typescript
// Diagram type detection — spatial only
type DiagramType =
  | "flowchart" | "block-beta" | "classDiagram"
  | "stateDiagram-v2" | "erDiagram" | "mindmap";

type SpatialDiagramType = DiagramType; // all types are spatial

// Parser output
interface ParsedDiagram { ... }  // see diag_arch_v4.2.md §6.2
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
  aesthetics: AestheticsConfig;  // roughness, animationMode, theme (v4.2 §5)
}

interface AestheticsConfig {
  roughness: number;             // 0 = crisp, 1 = hand-drawn (default: 1)
  animationMode: "draw-on" | "static";  // default: "draw-on"
  theme?: string;
}

interface NodeLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  style: Partial<NodeStyle>;
}

interface EdgeLayout {
  routing: "auto" | "curved" | "orthogonal" | "direct" | string;
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
export function isSpatialType(type: string): type is DiagramType;
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

Dagre dispatch layer. Produces initial positions for a full `ParsedDiagram`. Only the four
dagre-backed spatial types are supported in diag.1; `block-beta` and `mindmap` (and all
sequential types) throw `UnsupportedDiagramTypeError`.

```typescript
export interface LayoutOptions {
  rankdir?: "TB" | "LR" | "RL" | "BT"; // default "TB"
  nodeSpacing?: number;                 // default 60
  rankSpacing?: number;                 // default 80
}

export class UnsupportedDiagramTypeError extends Error { ... }

export function computeInitialLayout(
  parsed: ParsedDiagram,
  options?: LayoutOptions
): LayoutStore;
```

`computeInitialLayout` is called on `accordo_diagram_create`. Placement of unplaced nodes
after a reconcile cycle is handled by A6 (`placeNodes`).

> **Tech debt TD-AL-01**: layout-aware incremental re-layout (pin existing nodes as dagre
> fixed constraints, re-run over changed subgraph only) is deferred to diag.4.

### A5: Edge identity (`reconciler/edge-identity.ts`)

Implements the edge matching algorithm from v4.2 §4.4.

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

diag.1 supports flowchart shapes only. See v4.2 §9.2 for the shape mapping table.

`canvas-generator.ts` reads `layout.aesthetics.roughness` (default `1`) and applies it plus `fontFamily: Excalifont` to every generated element — the hand-drawn aesthetic from day one. Stable seeds (derived from node IDs) are written back to `layout.json` after final render so the diagram looks identical on every subsequent open.

### A11: Webview protocol (`webview/protocol.ts`)

Typed message definitions for extension host ↔ webview communication. See v4.2 §9.4.

### A14: MCP tool definitions (`tools/diagram-tools.ts`)

All 14 tools defined as `ExtensionToolDefinition[]` following the `accordo-editor` pattern.

Each tool handler:
1. Validates input (path exists, node_id exists, etc.)
2. Reads .mmd and/or layout.json from disk
3. Calls appropriate internal module (parser, reconciler, layout store, etc.)
4. Writes results to disk
5. If webview is open: triggers canvas refresh
6. Returns structured result to agent

**diag.1 tools (MVP — 6 tools):**

| Tool | Handler logic |
|---|---|
| `accordo_diagram_list` | `glob('**/*.mmd')` → detect type per file → return metadata |
| `accordo_diagram_get` | `parseMermaid(source)` → return semantic graph + raw source |
| `accordo_diagram_create` | write .mmd (inject standard classDef palette if none present) → parse → `computeInitialLayout()` → write layout.json with `aesthetics: { roughness: 1, animationMode: "draw-on" }` |
| `accordo_diagram_patch` | write .mmd → `reconcile(old, new, layout)` → write layout.json |
| `accordo_diagram_render` | canvas export via Excalidraw API (requires webview open); returns `{ output_path }` |
| `accordo_diagram_style_guide` | returns per-diagram-type palette, node sizing defaults, conventions, and starter template (v4.2 §23) — no disk I/O, pure lookup |

**diag.2 tools (added later):**

| Tool | Handler logic |
|---|---|
| `accordo_diagram_add_node` | Insert into Mermaid AST → reconcile |
| `accordo_diagram_remove_node` | Remove from Mermaid → reconcile |
| `accordo_diagram_add_edge` | Insert into Mermaid → reconcile |
| `accordo_diagram_remove_edge` | Remove from Mermaid → reconcile |
| `accordo_diagram_add_cluster` | Insert subgraph into Mermaid → reconcile |
| `accordo_diagram_move_node` | Patch layout.json only |
| `accordo_diagram_resize_node` | Patch layout.json only |
| `accordo_diagram_set_node_style` | Patch layout.json only |
| `accordo_diagram_set_edge_routing` | Patch layout.json only |

### A15: Webview panel (`webview/panel.ts`)

VSCode webview panel manager. Creates, shows, and communicates with the Excalidraw canvas webview.

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
- Excalidraw canvas instance — generated from parse + layout
- File watcher for `.mmd` changes on disk with 500 ms debounce (coalesces rapid saves, implemented in A15)
- `.layout.json` watcher deferred to diag.2 (agent layout writes go through the synchronous patch mechanism; human text edits to layout.json are not a diag.1 use case)
- Layout.json patch on canvas interactions (drag, resize)

### A16: Webview frontend

The webview HTML loads:
- Pre-built Excalidraw bundle (React-based)
- Custom messaging layer that communicates with the extension host

No in-panel text editor. The `.mmd` source is edited as a normal VS Code text
file. The webview is intentionally canvas-only for a clean whiteboard experience.

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

### Week D3 — Tools + Webview

**Goal:** MCP tools callable by agent. Webview renders diagrams.

| Day | Module | Output |
|---|---|---|
| Mon | A11: webview protocol | Type definitions |
| Mon–Tue | A14: diagram-tools.ts | ~45 tests, all 6 diag.1 tools |
| Wed–Thu | A15: panel.ts | ~15 tests, webview lifecycle |
| Thu–Fri | A16: webview frontend (HTML + TS) | Manual testing, Excalidraw canvas rendering |
| Fri | A17: extension.ts | ~10 tests, activation + registration |

**Gate:** Agent can create, read, patch, and render diagrams via MCP tools. Human can open a `.mmd` file in the Excalidraw canvas webview. Agent or human text-editor saves trigger canvas refresh via debounced (.mmd) file watcher. Canvas drags update layout.json.

### Week D4 — Integration + Polish

**Goal:** End-to-end flows work. Agent and human can both edit the same diagram without layout loss.

| Day | Task | Output |
|---|---|---|
| Mon | Integration test: agent creates diagram → human opens in webview → agent adds nodes → positions preserved | E2E verified |
| Mon | Integration test: human drags nodes → agent reads diagram → sees updated positions | E2E verified |
| Tue | File watcher: agent edits .mmd on disk → webview refreshes with toast | External edit flow works |
| Wed | Export: canvas SVG/PNG via Excalidraw API | Canvas export works |
| Wed | Error handling: invalid Mermaid states, missing files, webview closed on render | Errors handled gracefully |
| Thu | Performance: test with 50-node, 100-node diagrams | Acceptable latency |
| Thu | Modality state: publishState to Hub, visible in /instructions | Agents see diagram context |
| Fri | Documentation: README, tool descriptions, known limitations | Docs complete |

**Gate:** Full diag.1 exit criteria met (see §7).

---

## 7. diag.1 Exit Criteria

All of these must be true before diag.1 is complete:

1. **Parser:** Flowchart Mermaid → ParsedDiagram extraction works for all standard shapes, edges, clusters
2. **Reconciler:** Topology changes preserve existing layout. New nodes are auto-placed without collision.
3. **Canvas:** Excalidraw scene generated correctly from ParsedDiagram + LayoutStore, with `roughness: 1` + `fontFamily: Excalifont` applied to all elements
4. **Aesthetics:** Roughness=1 (hand-drawn) on by default. `aesthetics` field persists per-diagram in `layout.json`. (Draw-on animation deferred to diag.2.)
5. **MCP tools (6):** `accordo_diagram_list`, `_create`, `_get`, `_patch`, `_render`, `_style_guide` callable by agent via Hub → Bridge → accordo-diagram
6. **style_guide:** `accordo_diagram_create` auto-injects the standard classDef color palette. `accordo_diagram_style_guide` returns the full per-type guide including palette, node sizing, conventions, and a starter template.
7. **Webview:** Excalidraw canvas panel renders correctly for spatial diagrams (canvas-only, no in-panel text editor)
8. **Sync:** `.mmd` file save (agent tool or human VS Code text editor) → file watcher (500 ms debounce) → reconcile → canvas refresh
9. **Sync:** Canvas drag/resize → layout.json patch (immediate, no Mermaid change)
10. **Export:** Canvas export (Excalidraw API → SVG/PNG) available when webview is open. Returns actionable error if webview is closed. No fallback path.
11. **External edits:** Agent .mmd edit on disk → webview refreshes with toast notification
12. **Modality state:** Diagram context appears in Hub's /instructions prompt
13. **Script compatibility:** All 6 MCP tools are auto-registered as VS Code commands via Bridge dual-registration, callable as `command` steps in `accordo-script`
14. **Tests:** All unit tests pass, zero TypeScript errors
15. **Integration:** At least one real agent (Claude Code) successfully creates and patches a diagram using `style_guide` first

---

## 7.5 DONE — Session History

### Week D1 (partial) — 2026-03-11 to 2026-03-12

**Completed modules:** A1, A2, A3, A4

| Module | Tests | Commit(s) | Spec gaps resolved |
|---|---|---|---|
| A1 Internal types | 36 | `9b0200f` | — |
| A2 Flowchart parser | 67 | `2d439e5`, `429c53d` | — |
| A3 Layout store | 54 | `15a4369` | `addUnplaced` intra-batch dedup bug found and fixed via richer fixture |
| A4 Auto-layout (dispatch) | 36 | `f49bb9e`, `391abf2` | erDiagram LR default added (arch §15.1); `layoutFull` API renamed to `computeInitialLayout`; workplan stale `layoutFull` refs corrected |

**Actual total:** 264 tests passing (A1 + A2 + A3 + A4 + A5 + A6 + A8 + A9 + A11 + integration)

**Spec gaps found during implementation:**
- A3: `addUnplaced` filter-based dedup missed intra-batch duplicates — fixed with iterative Set; rich 6-node fixture added to expose the bug
- A4: architecture §15.1 specified `erDiagram` default `rankdir: LR`; initial implementation defaulted all types to TB — corrected with `DEFAULT_RANKDIR` per-type map
- A4: workplan A4 section had stale API (`layoutFull` + `layoutUnplaced`) from pre-design era — updated to match final `computeInitialLayout` contract

**Process note:** In this session, Phase F commits landed before Phase E user approval was formally presented. This was caught in review and acknowledged. Root cause: conflated "all tests green" with "Phase E done." Corrective: Phase E STOP must come before any `git commit` with implementation, even when confident.

**Testing guides:** `docs/testing-guide-diagram-A4.md`

---

## 8. diag.2 Plan (after diag.1 gate)

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
| Draw-on animation | Progressive element loading at canvas render time (§22 in arch doc) |
| Animation toggle | Draw-on / static toggle in webview toolbar dropdown |

| Comments integration | Diagram webview loads `@accordo/comment-sdk`, registers `SurfaceCommentAdapter`, pins threads to nodes via canvas-aware hit-testing (§25 in arch doc) |

---

## 9. Risk Register (Implementation-specific)

| Risk | Severity | Mitigation |
|---|---|---|
| Mermaid `db` API breaks on version update | High | Pin to 11.4.1. Adapter tests catch breaks. Isolate in single module. |
| `getDiagramFromText` requires DOM | Medium | Test in Week D1 Day 1. Fallback: minimal JSDOM context. |
| Excalidraw bundle size bloats webview | Medium | Tree-shake. Load async. Measure in Week D3. |
| Canvas generation performance (100+ nodes) | Medium | Partial updates for layout-only changes. Profile in Week D4. |
| Dagre produces poor layout for certain graph shapes | Low | Users can adjust. This is initial placement only. |

| Excalidraw keyboard shortcuts conflict with VS Code global shortcuts | Low | Webview focus traps shortcuts natively. No mitigations needed. |

---

## 10. What Touches Existing Packages

The diagram extension is a new package. It does NOT modify Hub, Bridge, Editor, or Comments code. It consumes the BridgeAPI contract and the SurfaceCommentAdapter from the comments package.

| Existing package | Change needed | Details |
|---|---|---|
| `@accordo/bridge-types` | None | Diagram types are internal to `packages/diagram/src/types.ts`. Only `BridgeAPI`, `ExtensionToolDefinition`, and `ToolRegistration` are used from bridge-types, and they are already sufficient. |
| `@accordo/comment-sdk` | None | Diagram webview loads the SDK bundle. No API changes needed — `SdkInitOptions`, `SdkCallbacks`, and `coordinateToScreen` are sufficient. |
| `accordo-comments` | None | Diagram extension calls `accordo_comments_internal_getSurfaceAdapter` to get a `SurfaceCommentAdapter`. The adapter interface and registration are already in place (M40-EXT-11). |
| `accordo-hub` | None | Hub routes tool calls generically. It doesn't know or care about diagram-specific logic. The prompt engine will include diagram modality state automatically via the `modalities` field in IDEState. |
| `accordo-bridge` | None | Bridge routes invocations by tool name. When accordo-diagram registers tools, Bridge sends them to Hub. No code change in Bridge. Dual-registration of tools as VS Code commands is automatic — diagram tools are callable by `accordo-script` with zero changes. |
| `accordo-script` | None | Command steps call `vscode.commands.executeCommand(toolName, args)`. Diagram tools are auto-registered as commands by Bridge. No script engine changes needed. |
| `pnpm-workspace.yaml` | None | Already uses `packages/*` glob — `packages/diagram` is picked up automatically |
| `tsconfig.base.json` | None | This file defines only `compilerOptions`; individual packages have their own `tsconfig.json` with `extends` and `references`. No change needed. |
| Root `package.json` | None | Build script `pnpm -r run build` picks up new package automatically |

---

## 11. Testing Strategy

### Unit tests (Vitest)

All modules tested in isolation with mocks. Same patterns as Hub and Bridge tests.

- Parser: mock `mermaid.mermaidAPI.getDiagramFromText()` to return known `db` objects
- Layout store: test against in-memory objects (no disk I/O in unit tests)
- Reconciler: pure function — test with input/output pairs
- Canvas generator: snapshot tests for element arrays
- Tools: mock Node.js `fs/promises`, mock webview panel

### Integration tests

Full pipeline tests that exercise the real mermaid parser (no mocks):
- Parse real `.mmd` file → reconcile → generate canvas
- Create diagram → patch → verify layout preserved
- Parse invalid Mermaid → verify error returned

### Manual tests (webview)

- Open .mmd via command → Excalidraw canvas panel appears
- Drag nodes on canvas → layout.json updates
- Open .mmd as text in VS Code, edit and save → canvas refreshes (file watcher)
- Agent patches .mmd via MCP tool → canvas refreshes with "Updated by agent" toast
- Export canvas as SVG/PNG → verify file written to disk
