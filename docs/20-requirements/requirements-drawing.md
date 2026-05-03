# accordo-drawing — Requirements Specification

**Package:** `accordo-drawing`  
**Type:** VS Code extension  
**Status:** Phase A draft — authoritative for new module  
**Date:** 2026-05-03  
**Architecture reference:** `docs/10-architecture/drawing-architecture.md`  
**Workplan:** `docs/00-workplan/workplan.md`

---

## 1. Purpose / Scope

`accordo-drawing` provides a collaborative drawing modality for Mermaid-authored spatial diagrams backed by Excalidraw scene files.

The package owns:

1. the file model for Mermaid source + Excalidraw scene persistence
2. merge/reconcile behavior between those two files
3. deterministic placement of newly added managed elements into an existing drawing
4. MCP tools for create / merge / query / patch / render
5. the VS Code custom-editor runtime that lets human and agent work on the same drawing

**Initial implementation scope (first TDD slice):**

- Mermaid `flowchart` only
- one Mermaid source file (`.mmd`) plus one sibling Excalidraw scene file (`.excalidraw`)
- managed nodes and edges
- unmanaged/freeform Excalidraw elements preserved across merges
- deterministic placement for additions into an existing drawing
- PNG/SVG export through the live panel

All other Mermaid diagram types are deferred until this package proves the file model, merge contract, and placement contract on flowcharts.

---

## 2. Goals / Non-Goals

### 2.1 Goals

- Preserve human spatial intent already present in an existing drawing.
- Let the agent change Mermaid topology without regenerating the whole scene.
- Keep the authoritative contract small and explicit: topology in `.mmd`, scene in `.excalidraw`.
- Make merge-time placement deterministic and Accordo-owned.
- Keep public tool behavior stable and testable through real MCP/runtime boundaries.

### 2.2 Non-Goals

- No canonical `layout.json`.
- No full-scene re-import on every merge.
- No dependence on Excalidraw element IDs as stable identities.
- No support in the first slice for non-flowchart Mermaid types.
- No promise that human freehand elements become Mermaid topology automatically.
- No background/headless render path in the first slice; render uses the live panel.

---

## 3. Authoritative File Model

### DRW-R01 — Two-file source-of-truth model

A drawing is exactly two authoritative files:

- `<name>.mmd` — canonical topology/labels/diagram structure
- `<name>.excalidraw` — canonical scene/layout/view-state/unmanaged elements

There is no third canonical persistence file for layout or identity.

### DRW-R02 — `.mmd` ownership

The `.mmd` file is the sole source of truth for:

- supported Mermaid diagram type
- managed node identities
- managed edge identities
- labels and textual topology structure
- cluster/subgraph structure when later added

### DRW-R03 — `.excalidraw` ownership

The `.excalidraw` file is the sole source of truth for:

- element positions and sizes
- user-adjusted visual arrangement
- unmanaged/freeform canvas elements
- per-element managed identity metadata in `customData`
- persisted Excalidraw app/view state that the package elects to keep

### DRW-R04 — No canonical `layout.json`

`accordo-drawing` MUST NOT define, require, or treat `layout.json` as canonical for this module.

If a sibling `layout.json` exists from another workflow, the drawing package ignores it for merge and placement decisions.

### DRW-R05 — Stable identity anchor

Managed identity is not the Excalidraw element ID.  
Managed identity is carried in the `.excalidraw` file via `customData.accordo`.

The stable identity unit is:

- node identity: Mermaid node ID
- edge identity: `"{from}->{to}:{ordinal}"`

---

## 4. Merge Ownership and Placement Requirements

### DRW-R06 — Preserve matched managed geometry

When a managed node or edge still exists in `.mmd` and can be matched to a managed scene element in `.excalidraw`, merge preserves the existing scene geometry and existing human-adjusted placement.

### DRW-R07 — Update matched managed semantics

For matched managed elements, merge updates Mermaid-owned semantics from `.mmd`, including at minimum:

- text/label content
- edge endpoints / identity
- canonical managed metadata in `customData.accordo`

### DRW-R08 — Preserve unmanaged scene elements

Elements in `.excalidraw` without valid `customData.accordo` metadata are unmanaged and MUST be preserved unchanged by merge.

### DRW-R09 — Remove valid managed elements deleted from source

If a managed identity previously existed in `.excalidraw`, is valid, and no longer exists in the merged `.mmd`, merge removes that managed scene element and any managed helper elements bound only to it.

### DRW-R10 — Orphan malformed or ambiguous managed elements

If a scene element claims to be managed but its metadata is malformed, duplicated, or cannot be resolved safely, merge MUST NOT silently delete it.

Instead, it is marked orphaned in `customData.accordo.status = "orphaned"` with an `orphanReason`, ignored for managed placement purposes, and surfaced by `accordo_drawing_query`.

### DRW-R11 — Accordo-owned placement for additions

When new managed elements are inserted into an existing drawing that already contains managed scene elements, placement MUST use Accordo’s deterministic placement algorithm.

This merge-time addition path MUST NOT delegate placement to `@excalidraw/mermaid-to-excalidraw`.

### DRW-R12 — Deterministic placement

Given the same:

- `.mmd` source
- `.excalidraw` scene
- package version
- placement constants

`accordo_drawing_merge` MUST produce the same placed coordinates for new managed elements.

No randomness, timestamp seeding, or unstable iteration order is allowed.

### DRW-R13 — Anchor-based placement for connected additions

If a newly added component connects to existing preserved managed nodes, placement must anchor to those preserved neighbors first and place relative to them.

### DRW-R14 — Frontier placement for disconnected additions

If a newly added component has no connection to existing preserved managed nodes, placement must use deterministic frontier placement outside the current managed scene bounds according to the global diagram direction.

### DRW-R15 — Collision avoidance

Newly placed managed elements must not overlap existing managed elements or each other after merge, subject to the package’s collision margin constants.

If the ideal slot collides, merge must use deterministic collision resolution and choose the first valid slot in a stable search order.

### DRW-R16 — Bootstrap exception

Create/bootstrap MAY seed a brand-new scene from `@excalidraw/mermaid-to-excalidraw`.

Merge MAY also use bootstrap only when there is no usable existing managed drawing, specifically:

- `.excalidraw` missing, or
- `.excalidraw` contains zero active managed elements

Once an existing managed drawing exists, incremental additions MUST use Accordo placement (DRW-R11).

---

## 5. Merge Policy Matrix

| Case | Policy |
|---|---|
| Managed identity present in `.mmd` and scene | preserve geometry, update Mermaid-owned semantics |
| Managed identity newly added in `.mmd` | place with Accordo placement algorithm |
| Managed identity removed from `.mmd` | remove active managed scene elements for that identity |
| Scene element has no `customData.accordo` | preserve as unmanaged |
| Scene element has malformed/duplicate managed metadata | mark orphaned, preserve, report via query |
| No usable existing managed scene | bootstrap allowed |

---

## 6. Tool Contract Requirements

### 6.1 `accordo_drawing_create`

### DRW-R17 — Create contract

`accordo_drawing_create` creates a new drawing pair and optionally opens it.

**Required inputs**
- `path: string` — target `.mmd` path
- `content: string` — Mermaid source

**Optional inputs**
- `force: boolean` — overwrite existing pair only when `true`
- `open: boolean` — default `true`

**Required behavior**
- writes/overwrites `<name>.mmd`
- creates sibling `<name>.excalidraw`
- validates supported Mermaid type before reporting success
- for first-slice create, bootstrap seed is allowed
- all created managed scene elements must carry valid `customData.accordo`

**Response minimum**
```ts
{
  created: true,
  path: string,
  scenePath: string,
  bootstrapEngine: "mermaid-to-excalidraw" | "empty",
  opened: boolean
}
```

### 6.2 `accordo_drawing_merge`

### DRW-R18 — Merge contract

`accordo_drawing_merge` reconciles Mermaid source and Excalidraw scene and persists the updated scene.

**Required inputs**
- `path: string`

**Optional inputs**
- `content?: string` — if provided, replaces `.mmd` content before merge
- `open?: boolean` — whether to reveal/open the drawing after merge

**Required behavior**
- reads `.mmd` and sibling `.excalidraw`
- if `content` is provided, persists it before merge
- applies preserve/update/remove/orphan policy
- applies Accordo placement for merge-time additions into existing drawings
- returns a deterministic merge report

**Response minimum**
```ts
{
  merged: true,
  path: string,
  scenePath: string,
  placementEngine: "accordo" | "bootstrap",
  counts: {
    preserved: number,
    added: number,
    updated: number,
    removed: number,
    orphaned: number
  }
}
```

### 6.3 `accordo_drawing_query`

### DRW-R19 — Query contract

`accordo_drawing_query` returns non-mutating inspection data for the drawing pair.

**Required inputs**
- `path: string`

**Optional inputs**
- `includeOrphans?: boolean`
- `includeElements?: boolean`

**Required behavior**
- never modifies files
- reports whether source and scene are present and parseable
- reports active managed count, unmanaged count, orphan count
- reports whether the scene requires merge or is already in sync under package rules

**Response minimum**
```ts
{
  path: string,
  scenePath: string,
  sourceType: "flowchart" | "unsupported" | "invalid",
  status: "in-sync" | "needs-merge" | "source-invalid" | "scene-invalid",
  counts: {
    managed: number,
    unmanaged: number,
    orphaned: number
  },
  orphans?: Array<{
    elementId: string,
    orphanReason: string
  }>
}
```

### 6.4 `accordo_drawing_patch`

### DRW-R20 — Patch contract

`accordo_drawing_patch` is the high-level mutation tool for agents.  
In the first slice it is defined as “replace source content, then merge”.

**Required inputs**
- `path: string`
- `content: string`

**Required behavior**
- persists the new `.mmd` content
- invokes the same merge pipeline as `accordo_drawing_merge`
- returns the same merge report shape plus `patched: true`

**Response minimum**
```ts
{
  patched: true,
  merged: true,
  path: string,
  scenePath: string,
  placementEngine: "accordo" | "bootstrap",
  counts: {
    preserved: number,
    added: number,
    updated: number,
    removed: number,
    orphaned: number
  }
}
```

### 6.5 `accordo_drawing_render`

### DRW-R21 — Render contract

`accordo_drawing_render` exports the live drawing panel.

**Required inputs**
- `path: string`
- `format: "png" | "svg"`

**Optional inputs**
- `outputPath?: string`

**Required behavior**
- render is performed from the active/live drawing panel state
- requires the target drawing panel to be open
- writes the export artifact to disk
- does not mutate `.mmd` or `.excalidraw`

**Response minimum**
```ts
{
  rendered: true,
  path: string,
  format: "png" | "svg",
  outputPath: string
}
```

---

## 7. Runtime Preconditions and Error Classes

### DRW-R22 — Shared runtime preconditions

All drawing tools share these preconditions unless a tool-specific rule is stricter:

1. `path` must resolve inside the workspace unless the package explicitly documents external-path support.
2. the target Mermaid file must use a supported drawing type for the current slice.
3. input validation happens before file mutation.
4. error codes are stable and machine-readable.

### DRW-R23 — Tool-specific runtime preconditions

| Tool | Additional preconditions |
|---|---|
| `accordo_drawing_create` | target parent directory exists; target extension is `.mmd` |
| `accordo_drawing_merge` | target `.mmd` exists; sibling `.excalidraw` may be absent only for bootstrap case |
| `accordo_drawing_query` | target `.mmd` exists |
| `accordo_drawing_patch` | target `.mmd` exists |
| `accordo_drawing_render` | target drawing panel is open and bound to the same path |

### DRW-R24 — Stable error vocabulary

Expected operational errors MUST use stable `code` values from this set:

- `invalid-argument`
- `path-outside-workspace`
- `file-not-found`
- `already-exists`
- `unsupported-diagram-type`
- `source-parse-failed`
- `scene-parse-failed`
- `scene-invalid`
- `duplicate-managed-identity`
- `panel-not-open`
- `placement-failed`
- `render-failed`
- `invariant-violation`

### DRW-R25 — Error precedence

Validation/error precedence is:

1. invalid arguments / invalid extension
2. path resolution / workspace guard
3. existence checks
4. Mermaid parse/type validation
5. scene parse/validation
6. merge/placement/runtime operation failures

Tools must not report a later-stage error when an earlier-stage precondition already failed.

### DRW-R26 — Runtime discoverability

Because these are MCP tools, the runtime contract must be discoverable through:

- tool descriptions with immediate preconditions
- MCP-readable skill/resource documentation
- stable runtime error codes

Repo-only requirements text is not sufficient as the only operational guidance.

---

## 8. Proof Surfaces / Traceability

### 8.1 Proof surface legend

- **Unit** — pure core logic
- **Package integration** — package boundary with real file/scene objects but no full MCP stack
- **Runtime/MCP** — real tool registration + tool call across Hub/Bridge/extension boundary
- **UI/E2E** — live panel/custom-editor behavior

### 8.2 Traceability table

| Requirement IDs | Planned proof IDs | Proof surface |
|---|---|---|
| DRW-R01..DRW-R05 | DRW-U01, DRW-I01 | Unit + package integration |
| DRW-R06..DRW-R10 | DRW-U02, DRW-U03, DRW-I02 | Unit + package integration |
| DRW-R11..DRW-R16 | DRW-U04, DRW-U05, DRW-U06, DRW-I03, DRW-RT02 | Unit + package integration + runtime/MCP |
| DRW-R17 | DRW-I04, DRW-RT01 | Package integration + runtime/MCP |
| DRW-R18 | DRW-I05, DRW-RT02 | Package integration + runtime/MCP |
| DRW-R19 | DRW-I06, DRW-RT03 | Package integration + runtime/MCP |
| DRW-R20 | DRW-I07, DRW-RT04 | Package integration + runtime/MCP |
| DRW-R21 | DRW-I08, DRW-RT05, DRW-UI01 | Package integration + runtime/MCP + UI/E2E |
| DRW-R22..DRW-R25 | DRW-U07, DRW-I09, DRW-RT06 | Unit + package integration + runtime/MCP |
| DRW-R26 | DRW-RT07 | Runtime/MCP |

### 8.3 Minimum real-boundary proof requirement

At least these real-boundary proofs are mandatory before Phase D2/E:

1. `accordo_drawing_create` succeeds through the real MCP stack and creates both files.
2. `accordo_drawing_merge` succeeds through the real MCP stack and uses `placementEngine: "accordo"` for additions into an existing drawing.
3. `accordo_drawing_render` fails with `panel-not-open` when the panel is closed, then succeeds after opening the real panel.

These are required because unit-only evidence could pass while the custom-editor registration, panel binding, or runtime export path still fails in real use.

---

## 9. Open Questions Deferred Out of Slice 1

These are explicitly deferred, not ambiguous:

- support for Mermaid types beyond flowchart
- cluster/subgraph placement details beyond the same file-model contract
- background/headless render without open panel
- structured patch operations finer than full-source replacement
- conflict markers / three-way merge UX for simultaneous user text edits
