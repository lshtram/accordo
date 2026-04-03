---
id: accordo-diagrams
version: 1.0.1
author: Accordo IDE
tags: [diagram, mermaid, flowchart, architecture, visual, Excalidraw]
knowledge:
  - knowledge/diagram-types.md
  - knowledge/styling-guide.md
---

# Skill: Create & Edit Accordo Diagrams

## When to Use This Skill

Load this skill when:
- User says "diagram", "flowchart", "create a chart", "show as a diagram"
- User asks to explain architecture visually
- You need to document a process, system, or flow
- User wants to visualize relationships or data

**This skill loads the full styling guide inline below.**

---

## Accordo Diagram Tools

| Tool | Purpose |
|------|---------|
| `accordo_diagram_list` | List all `.mmd` diagram files in workspace |
| `accordo_diagram_get` | Get parsed diagram structure (nodes, edges, layout) |
| `accordo_diagram_create` | Create new `.mmd` diagram file |
| `accordo_diagram_patch` | Update existing diagram (content, styles, positions) |
| `accordo_diagram_render` | Export diagram to SVG or PNG |
| `accordo_editor_open` | Open a diagram file (renders in diagram panel) |
| `accordo_diagram_style_guide` | Returns this guide (light MCP tool) |

---

## Critical: How Styling Works

**Mermaid `classDef` and `style` directives are IGNORED by Accordo.**

All visual styling must be applied via `accordo_diagram_patch` using `nodeStyles` and `edgeStyles` arguments.

### Style Fields (nodeStyles)

| Field | Type | Description |
|-------|------|-------------|
| `backgroundColor` | hex | Fill color, e.g. `"#4A90D9"` |
| `strokeColor` | hex | Border color |
| `strokeWidth` | number | Border thickness in px |
| `strokeStyle` | string | `"solid"` \| `"dashed"` \| `"dotted"` |
| `fillStyle` | string | `"hachure"` \| `"cross-hatch"` \| `"solid"` \| `"zigzag"` \| `"dots"` |
| `opacity` | number | 0–1 |
| `fontColor` | hex | **ALWAYS dark on light backgrounds** |
| `fontSize` | number | px |
| `fontFamily` | string | `"Excalifont"` \| `"Nunito"` \| `"Comic Shanns"` |
| `fontWeight` | string | `"normal"` \| `"bold"` |
| `width` | number | Override node width in px |
| `height` | number | Override node height in px |

### Style Fields (edgeStyles)

| Field | Type | Description |
|-------|------|-------------|
| `strokeColor` | hex | Edge line color |
| `strokeWidth` | number | Line thickness in px |
| `strokeStyle` | string | `"solid"` \| `"dashed"` \| `"dotted"` |
| `routing` | string | `"auto"` \| `"orthogonal"` \| `"direct"` \| `"curved"` |

### Node ID Key Format for edgeStyles

Format: `"sourceNodeId->targetNodeId:ordinal"`

Example: `"AI->Hub:0"` means the first edge from AI to Hub.

---

## Font Color Rule

> **ALWAYS use dark font color on light backgrounds.**
> Excalidraw renders white text by default, which is invisible on light fills.

| Background | Use fontColor |
|------------|---------------|
| Light colors (`#D4E8F5`, `#D5F5E3`, `#FEF9E7`, `#EAECEE`, `#E8E0F0`) | Dark variant of the color |
| Dark colors (`#1a1a2e`, `#16213e`) | `#ffffff` (white) |

### Dark Color Mapping

| Background | fontColor |
|------------|----------|
| `#E8E0F0` (purple) | `#4A3080` |
| `#D4E8F5` (light blue) | `#1A5276` |
| `#D5F5E3` (light green) | `#1E8449` |
| `#FEF9E7` (light yellow) | `#B7950B` |
| `#EAECEE` (light gray) | `#566573` |
| `#FDEDEC` (light red) | `#922B21` |

---

## Colour Palette

| Name | Hex | Use |
|------|-----|-----|
| `primary` | `#4A90D9` | Primary blue |
| `secondary` | `#7B68EE` | Purple accent |
| `success` | `#27AE60` | Green/success |
| `warning` | `#F39C12` | Yellow/warning |
| `danger` | `#E74C3C` | Red/danger |
| `neutral` | `#95A5A6` | Gray/neutral |
| `background` | `#FAFAFA` | Light background |
| `border` | `#BDC3C7` | Border gray |

---

## Procedure: Create a New Diagram

### Step 1 — Plan the diagram

Ask:
- What is the main subject?
- What are the components?
- What are the relationships?

### Step 2 — Create the .mmd file

```javascript
accordo_diagram_create({
  path: "my-diagram.mmd",
  content: "flowchart TD\n  A[Node A]\n  A --> B[Node B]",
  force: false
})
```

### Step 3 — Open the diagram

```javascript
accordo_editor_open({ path: "my-diagram.mmd" })
```

Wait 1-2 seconds for rendering.

### Step 4 — Apply styling

```javascript
accordo_diagram_patch({
  path: "my-diagram.mmd",
  content: "flowchart TD\n  A[Node A]\n  A --> B[Node B]",
  nodeStyles: {
    "A": { backgroundColor: "#1a1a2e", strokeColor: "#e94560", strokeWidth: 3, fillStyle: "solid", fontColor: "#ffffff", fontWeight: "bold" },
    "B": { backgroundColor: "#D5F5E3", strokeColor: "#1E8449", strokeWidth: 2, fillStyle: "hachure", fontColor: "#1E8449" }
  },
  edgeStyles: {
    "A->B:0": { strokeColor: "#e94560", strokeWidth: 2 }
  }
})
```

### Step 5 — Verify

```javascript
accordo_diagram_get({ path: "my-diagram.mmd" })
```

---

## Procedure: Delete a Diagram

Always delete both files:

```bash
rm /path/to/diagram.mmd
rm /path/to/.accordo/diagrams/diagram.layout.json
```

---

## Mermaid Syntax Reference

### Node Shapes

```
A[Rectangle]           Box/rectangle
B(Rounded)             Rounded rectangle
C([Stadium])           Pill shape
D[[Subroutine]]        Document shape
E[(Cylinder)]          Database/cylinder
F((Circle))            Circle
G{Diamond}             Decision diamond
H>Hexagon]             Hexagon
I[/Trapezoid/]         Parallelogram
J[\"Trapezoid back\]   Reverse parallelogram
```

### Edge Types

```
A --> B        Arrow (directed)
A --- B        Line (no arrow)
A <--> B       Bidirectional arrow
A -.-> B       Dashed arrow (dependency)
A ==› B        Thick arrow
A --o B        Circle end
A --* B        Diamond end
```

### Labels on Edges

```
A -->|label| B
```

---

## Common Patterns

### Architecture Diagram

```
flowchart TD
  User["User"] --> App["Application"]
  App --> API["API Layer"]
  API --> DB["Database"]
  API --> Cache["Cache"]
  Cache -.-> DB
```

### Process Flow

```
flowchart LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Action 1]
  B -->|No| D[Action 2]
  C --> E[End]
  D --> E
```

---

## Anti-Patterns

| Anti-Pattern | Why | Correct |
|--------------|-----|---------|
| Using Mermaid classDef for styles | Accordo ignores these | Use `accordo_diagram_patch` with `nodeStyles` |
| White font on light background | Invisible text | Always use dark `fontColor` on light fills |
| Editing `.layout.json` directly | Changes overwritten | Always use `accordo_diagram_patch` |
| Creating diagram without styling | Unstyled nodes | Apply `nodeStyles` after creation |
