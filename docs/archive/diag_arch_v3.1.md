# Accordo — Diagram Modality Architecture v3.1 (Implementation-Ready)

## Overview

Accordo’s diagram modality is a **graph-native** collaboration layer inside an IDE. It enables:

- Agents to edit **diagram logic** safely and incrementally (topology).
- Humans to edit **diagram space** freely (layout).
- Deterministic reconciliation so layout is not destroyed by regeneration.
- Multi-format projections for editing, rendering, and automation.

This v3.1 update makes the system implementation-ready by formalizing the **Diagram Intermediate Representation (DIR)** layer (agent-native DSLs like Mermaid/PlantUML/D2) and mapping it to a working open-source toolchain.

---

## 1. Core Philosophy — Logic–Spatial Bridge

Accordo treats diagrams as a dual-state system:

- **Logic (Topology):** nodes, edges, types, relationships, clusters, tags
- **Space (Layout):** coordinates, grouping, visual zones, colors, routing hints

Agents are strongest in **logic**.
Humans are strongest in **space**.

Accordo reconciles both without semantic loss or layout collapse.

---

## 2. Canonical Source of Truth — Unified Graph Model (UGM)

The canonical model is the **Unified Graph Model (UGM)**: a stable internal JSON graph representation.

UGM stores:

- Stable node IDs (UUIDs)
- Stable edge IDs (UUIDs)
- Semantic keys (optional but recommended)
- Labels and types
- Edge relations and optional edge labels
- Cluster / zone membership
- Optional semantic tags and metadata

### 2.1 Minimal UGM Schema (recommended)

```json
{
  "version": "1.0",
  "graph_id": "uuid",
  "nodes": [
    {
      "id": "uuid",
      "key": "svc.auth",
      "label": "Auth Service",
      "type": "service",
      "meta": { "owner": "platform", "tags": ["security"] }
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "from": "uuid",
      "to": "uuid",
      "type": "calls",
      "label": "",
      "meta": {}
    }
  ],
  "clusters": [
    {
      "id": "uuid",
      "label": "Security Zone",
      "members": ["uuid"],
      "meta": { "colorMeaning": "trusted boundary" }
    }
  ]
}
```

**Rules**
- `id` is immutable.
- `key` is a stable semantic identifier (preferred for merges).
- `label` is display text (can change without changing identity).

---

## 3. Diagram Intermediate Representation (DIR)

DIR is the agent-native layer: structured textual DSLs that LLMs generate reliably.

DIR exists because:
- LLMs are better at producing **structured DSL text** than raw canvas JSON.
- DSL diffs are easy to review, version, and validate.
- Deterministic compilers translate DIR into UGM patches.

### 3.1 DIR Formats (initial support)

- **Mermaid (.mmd)**: best default for flow/architecture diagrams.
- **PlantUML (.puml)**: strong for UML/sequence/C4-style outputs.
- **D2 (.d2)**: modern diagram DSL with good readability.

DIR is first-class: it is both a projection of UGM and a semantic interface for agents.

---

## 4. Projection Layers (UGM as the hub)

All external representations are **projections** of UGM.

```
                 Diagram Orchestrator
                          │
             ┌────────────┴────────────┐
             │                         │
      Diagram IR (DIR)            Spatial Projection
  (Mermaid / PlantUML / D2)   (Excalidraw / tldraw)
             │                         │
             └────────────┬────────────┘
                          │
               Unified Graph Model (UGM)
                          │
                  Rendering / Export
               (SVG/PNG, Docs, CI)
```

### 4.1 Why this mirrors “diagram AI” systems

Modern “AI diagram” features do not draw pixels. They typically follow:
**Natural language → DSL (DIR) → structured graph → render/edit**
Accordo generalizes and hardens this pipeline with stable IDs and reconciliation.

---

## 5. Layout State Separation (Sidecar Pattern)

Accordo keeps layout separate from topology for clean diffs and layout preservation.

```
/project-root
  /diagrams
    mcp.arch.mmd                  # DIR (agent-friendly)
    mcp.arch.ugm.json             # Canonical UGM
    mcp.arch.layout.json          # Canvas-agnostic layout projection
    mcp.arch.layout.excal.json    # Excalidraw scene (optional cache)
    mcp.arch.map.json             # Cross-projection ID mapping
    mcp.arch.render.svg           # Preview render cache (optional)
```

### 5.1 Canonical Layout Projection (canvas-agnostic)

```json
{
  "version": "1.0",
  "graph_id": "uuid",
  "nodes": {
    "uuid-node": { "x": 120, "y": 340, "w": 180, "h": 80, "group": "uuid-cluster", "style": {} }
  },
  "edges": {
    "uuid-edge": { "routing": "auto", "points": [] }
  }
}
```

This layout is then compiled into specific canvas formats (Excalidraw, later tldraw).

### 5.2 Mapping Index (identity glue)

`*.map.json` links UGM IDs to canvas element IDs and DIR symbols.

```json
{
  "ugm_node_id_to_canvas_element_ids": {
    "uuid-node-1": ["excal-rect-abc", "excal-text-def"]
  },
  "ugm_edge_id_to_canvas_element_id": {
    "uuid-edge-1": "excal-arrow-xyz"
  },
  "dir_symbol_to_ugm_id": {
    "svc_auth": "uuid-node-1"
  }
}
```

---

## 6. Stable Identity Model (Non-negotiable)

Layout preservation requires identity stability across all transformations.

**Identity rules**
1. UGM UUIDs never change for the same semantic entity.
2. Label changes do not imply identity change.
3. Prefer matching by `key`, then explicit IDs, then structural heuristics.
4. Canvas element IDs are treated as implementation detail; the mapping is the stable contract.

**Matching order (DIR → UGM)**
1. Explicit ID annotation (if present in DIR metadata)
2. `key` match
3. Fallback heuristic: normalized label + adjacency fingerprint
4. Otherwise allocate new UUID

---

## 7. Graph Reconciliation Engine (GRE)

GRE applies diffs and reconciles topology and layout without destructive regeneration.

### 7.1 Responsibilities

- Apply semantic diffs to UGM (from DIR or direct UGM patches)
- Preserve layout for unchanged UGM IDs
- Place new nodes into “open space”
- Remove/deprecate nodes safely (optionally keep tombstones)
- Sync cluster membership and semantic tags
- Maintain `map.json`

### 7.2 Event Handling

| Event | Input | Effect | Guarantees |
|------|-------|--------|------------|
| Agent patches DIR | Mermaid/PlantUML diff | UGM patch + reconcile | Existing node layout preserved |
| Agent adds node | DIR diff introduces new symbol | New UUID + layout placement | New nodes placed without moving old nodes |
| User moves node | Canvas change | Layout patch only | UGM topology unchanged |
| User groups nodes | Canvas group/zone | Cluster patch | Semantic zones preserved |
| User deletes node | Canvas delete | Deprecate or remove | No accidental re-ID of remaining nodes |

### 7.3 New node placement (MVP → advanced)

**MVP:** grid-scan “first free coordinate” near anchor nodes.
**Advanced:** local layout engine for the new subgraph, then pack into open space.

---

## 8. End-to-End Pipelines (Working)

Accordo supports multiple flows; all converge on UGM + layout sidecars.

### 8.1 Agent-first (most common)

1. Agent edits DIR (Mermaid)
2. DIR compiler produces UGM patch
3. GRE applies patch and preserves layout
4. Spatial projection updated (Excalidraw/tldraw)
5. Preview render updated (SVG/PNG)

### 8.2 Human-first (canvas editing)

1. User edits canvas layout
2. Layout extractor updates `*.layout.json` and `*.map.json`
3. GRE updates clusters/zones if semantic grouping changed
4. DIR can be regenerated from UGM if needed

### 8.3 Import / migration

1. Legacy diagram → normalize to DIR (Mermaid)
2. DIR → UGM (allocate IDs, set keys)
3. Generate initial layout projection and canvas document

---

## 9. Open-Source Toolchain (Recommended)

This architecture is designed to compose mature OSS “bridges”:

### 9.1 DIR ↔ Canvas (Excalidraw)
- Use `@excalidraw/mermaid-to-excalidraw` to convert Mermaid to an editable Excalidraw scene.
- Accordo then applies its identity + layout rules by merging positions from `*.layout.json`.

### 9.2 Rendering / Preview (SVG/PNG, Docs, CI)
- Use **Kroki** as a universal diagram rendering backend for Mermaid, PlantUML, D2, GraphViz, and more.
- This powers `render_preview` and CI validation (“diagram renders successfully”).

### 9.3 Import / normalization
- Use **convert2mermaid** to convert existing diagram sources (e.g., draw.io / Excalidraw / PlantUML) into Mermaid where practical, as a bootstrap path into UGM.

### 9.4 MCP baseline reference (optional)
- Use “diagram MCP server + Kroki” style projects as references for tool design and operationalization (routing, caching, rate limiting).

### 9.5 tldraw (Phase 2)
- tldraw is an excellent canvas SDK, but Mermaid import/export workflows are less standardized than Excalidraw today.
- Recommended: ship Excalidraw projection first, add tldraw later using the same canonical layout projection + mapping.

---

## 10. Diagram Orchestrator (Core Service)

The orchestrator coordinates all transformations. It is the single place where correctness rules live.

### 10.1 Core modules

- **UGM Store**: load/save `*.ugm.json`, enforce schema, apply patches
- **DIR Compiler**: DIR → UGM patch (Mermaid first)
- **DIR Emitter**: UGM → DIR (for regeneration and sync)
- **Layout Store**: load/save `*.layout.json`, apply patches
- **Canvas Projection**: layout + UGM → Excalidraw JSON (and later tldraw)
- **Map Manager**: maintain `*.map.json` across all transformations
- **GRE**: reconcile changes, preserve layout, handle ID stability
- **Renderer**: call Kroki to generate SVG/PNG previews (optional caching)

### 10.2 Integrity checks (fast and automated)

- All UGM edges reference existing nodes
- All nodes have layout entries (or are queued for placement)
- `map.json` coverage metrics (UGM→Canvas mapping completeness)
- DIR compilation determinism tests
- Render sanity (Kroki returns 200 and output parses)

---

## 11. MCP — Accordo Diagram Protocol (Tools)

Accordo exposes diagram reasoning and manipulation via MCP tools so agents never need to parse raw canvas JSON.

### 11.1 Tools

#### `inspect_diagram_state`
Input: diagram base path  
Output:
- UGM summary (nodes/edges/clusters)
- layout coverage and deltas
- DIR/UGM sync status
- quality checks and warnings

#### `patch_dir`
Input: full DIR or diff (Mermaid first)  
Behavior:
- compile DIR → UGM patch
- run GRE (preserve layout)
- update projections + map
Output:
- updated file paths + summary of changes

#### `patch_topology`
Input: UGM patch  
Behavior:
- apply patch
- run GRE
- (optional) regenerate DIR
Output:
- updated topology summary

#### `update_layout`
Input: layout patch  
Behavior:
- update layout projection only
- update canvas projection
Output:
- updated layout stats

#### `render_preview`
Input: {source: DIR|UGM, format: svg|png}  
Behavior:
- call renderer backend (Kroki)
- optionally cache
Output:
- path to rendered asset

#### `generate_vision_summary` (optional)
Behavior:
- render SVG
- use vision only when symbolic understanding is insufficient
Vision is a fallback, not a primary mechanism.

---

## 12. VS Code Integration (Practical UX)

### 12.1 Dual-pane “Logic + Space” editor
- Left: DIR editor (Mermaid)
- Right: Canvas editor (Excalidraw webview)
- Status bar indicators: DIR dirty, layout dirty, mapping coverage

### 12.2 Commands
- “Apply DIR” → patch_dir
- “Capture Layout” → update_layout
- “Reconcile” → run GRE end-to-end
- “Render Preview” → render_preview
- “Validate Diagram” → integrity checks + render sanity

---

## 13. Implementation Roadmap

### Phase 1 — Working MVP (Mermaid + Excalidraw)
- UGM schema + patch engine
- DIR compiler: Mermaid flowchart → UGM
- GRE: preserve layout + grid placement for new nodes
- UGM + layout → Excalidraw projection (via Mermaid-to-Excalidraw import + merge)
- Preview rendering via Kroki
- MCP tools: inspect_diagram_state, patch_dir, update_layout, render_preview
- VS Code extension: dual-pane + commands

### Phase 2 — Incremental diffs + zones as semantics
- Robust ID matching (`key` + adjacency fingerprint)
- Canvas group/zone → UGM cluster semantics
- Conflict detection (DIR vs canvas vs UGM drift)
- Better placement / partial layout for new subgraphs

### Phase 3 — Multi-DIR + multi-canvas
- PlantUML and D2 support
- tldraw projection using the same canonical layout projection
- Cross-modality integrations (docs/code/presentations)

---

## 14. Strategic Outcome

UGM + DIR + GRE establishes a reusable **Visual Knowledge Substrate**:

- Stable semantic identity across edits and projections
- Human layout preserved through agent topology changes
- Multi-format interoperability (render, export, import)
- Agent-friendly symbolic manipulation via MCP
- Diagram-aware IDE workflows without brittle vision parsing

Accordo is not building a diagram editor.
It is building a graph-native collaborative reasoning layer inside an IDE.
