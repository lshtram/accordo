# Accordo — Drawing Modality Architecture

**Status:** Phase A draft  
**Date:** 2026-05-03  
**Scope:** `accordo-drawing` architecture for Mermaid + Excalidraw collaborative drawings

---

## 1. Architectural Intent

`accordo-drawing` exists to solve the problem that the existing diagram pipeline does not solve well enough for collaborative incremental layout:

- a human has already arranged a drawing in Excalidraw
- an agent changes Mermaid topology
- the package must merge those changes into the existing drawing without regenerating the scene

The hard rule is:

> **Create/bootstrap may seed from `@excalidraw/mermaid-to-excalidraw`; merge-time insertion into an existing managed drawing must use Accordo placement logic.**

That rule is the package’s defining boundary.

---

## 2. Component Boundaries

## 2.1 Core layer (pure, deterministic, no VS Code, no DOM)

The core layer owns all behavior that must be unit-testable and deterministic:

- Mermaid source parsing/normalization for supported types
- scene indexing from `.excalidraw` JSON
- managed identity matching
- orphan detection
- merge planning
- placement of newly added managed elements
- merge report generation

**Constraints**
- no `vscode` imports
- no webview APIs
- no random numbers
- no filesystem access
- no direct dependency on the Excalidraw React runtime

**Suggested module seams**
- `src/core/types.ts`
- `src/core/source-graph.ts`
- `src/core/scene-index.ts`
- `src/core/identity.ts`
- `src/core/merge-plan.ts`
- `src/core/placement-engine.ts`
- `src/core/orphan-policy.ts`

## 2.2 Host layer (VS Code extension / runtime adapter)

The host layer owns runtime concerns:

- tool handlers
- file IO for `.mmd` and `.excalidraw`
- custom editor registration
- panel registry
- calling bootstrap adapter when allowed
- persisting merged scene output
- invoking render/export through the live panel

**Suggested seams**
- `src/host/file-repository.ts`
- `src/host/tool-handlers.ts`
- `src/host/panel-registry.ts`
- `src/host/bootstrap-adapter.ts`
- `src/host/runtime-errors.ts`

## 2.3 Webview layer (Excalidraw runtime)

The webview layer owns only live-canvas behavior:

- load scene into Excalidraw
- accept human drag/move/edit operations
- emit scene save payloads back to host
- perform export to PNG/SVG
- preserve managed `customData` on round-trip

**Suggested seams**
- `src/webview/protocol.ts`
- `src/webview/panel.ts`
- `src/webview/excalidraw-bridge.ts`
- `src/webview/export-adapter.ts`

---

## 3. Canonical Data Contracts

## 3.1 File pair

A drawing consists of:

- `foo.mmd`
- `foo.excalidraw`

No canonical `foo.layout.json` exists in this package.

## 3.2 Managed scene metadata contract

Every managed Excalidraw element must carry a stable metadata block:

```json
{
  "customData": {
    "accordo": {
      "version": 1,
      "entityKind": "node",
      "identity": "auth",
      "sceneRole": "primary",
      "sourcePath": "diagrams/foo.mmd",
      "status": "active"
    }
  }
}
```

### Required `customData.accordo` fields

| Field | Type | Meaning |
|---|---|---|
| `version` | `1` | schema version |
| `entityKind` | `"node" \| "edge" \| "cluster" \| "helper"` | logical entity class |
| `identity` | `string` | Mermaid node ID or edge key |
| `sceneRole` | `"primary" \| "label" \| "container" \| "helper"` | role of this scene element for the logical entity |
| `sourcePath` | `string` | workspace-relative `.mmd` path |
| `status` | `"active" \| "orphaned"` | merge lifecycle state |

### Optional orphan fields

```json
{
  "customData": {
    "accordo": {
      "status": "orphaned",
      "orphanReason": "duplicate-managed-identity"
    }
  }
}
```

### Identity uniqueness rule

For active managed elements, the tuple below must be unique within one `.excalidraw` file:

- `(entityKind, identity, sceneRole)`

Duplicate active tuples are not silently resolved; they produce orphaning/reporting.

## 3.3 Unmanaged element rule

If `customData.accordo` is absent, the element is unmanaged and is outside Mermaid ownership. Merge preserves it.

---

## 4. Core Runtime Model

## 4.1 Source graph

The core parses `.mmd` into a normalized source graph containing only the package’s stable concepts:

- diagram type
- direction (`TD`, `TB`, `BT`, `LR`, `RL`)
- nodes
- edges
- later: clusters/subgraphs

The placement engine consumes the normalized source graph, not raw Mermaid text.

## 4.2 Scene index

The core parses `.excalidraw` into a scene index containing:

- active managed elements by logical identity
- orphaned managed elements
- unmanaged elements
- scene bounds for active managed elements
- per-identity geometry snapshots used by placement and preserve/update logic

## 4.3 Merge plan

The merge planner outputs:

- `preserved`
- `updated`
- `added`
- `removed`
- `orphaned`
- chosen `placementEngine`
- resulting scene element list
- merge report counts

This is the package’s main deterministic seam.

---

## 5. Deterministic Placement Algorithm Spec

This section is intentionally concrete because the prior Phase A fail called placement underspecified.

## 5.1 Placement constants

These values must become named source-of-truth runtime constants in implementation:

- `GRID_PX = 40`
- `MAIN_GAP_PX = 160`
- `CROSS_GAP_PX = 120`
- `COMPONENT_GAP_PX = 240`
- `COLLISION_MARGIN_PX = 24`
- `SEARCH_MAX_STEPS = 24`

## 5.2 Inputs to placement

The placement engine receives:

- normalized source graph
- existing managed scene index
- set of newly added managed nodes
- set of preserved managed nodes
- global direction (`TD/TB/BT/LR/RL`)
- default node size for nodes without prior geometry
- collision constants

## 5.3 High-level decision gate

1. **If there is no usable existing managed scene**  
   use bootstrap path (`placementEngine = "bootstrap"`).

2. **If there is an existing managed scene**  
   use incremental Accordo placement (`placementEngine = "accordo"`).

“Usable existing managed scene” means at least one active managed element is present and parseable.

## 5.4 Incremental placement step-by-step

### Step 1 — Build added-node components

Build connected components using only newly added managed nodes plus edges between them.

Sort components by stable component key:

- sort the member node identities ascending
- join with `|`
- compare lexicographically

This removes set-iteration nondeterminism.

### Step 2 — Compute preserved anchors per component

For each added component, collect preserved managed neighbor nodes connected to any node in the component.

If preserved anchors exist, score anchor candidates by this tuple:

1. descending number of cross-edges between anchor and component
2. descending same-container match (when cluster/container support exists)
3. ascending anchor identity

Choose the max tuple as the primary anchor.

### Step 3 — Determine main placement direction

Direction is derived deterministically:

- `TD` / `TB`: default main axis is vertical
- `LR` / `RL`: default main axis is horizontal
- `BT` reverses vertical sign
- `RL` reverses horizontal sign

When the component has only inbound or only outbound edges relative to the anchor, the sign follows edge direction; otherwise use the global direction default.

### Step 4 — Assign levels inside the component

Starting from nodes directly connected to preserved anchors:

- assign level `0` to the component roots
- breadth-first assign increasing levels
- when multiple nodes compete for the same level, sort by node identity ascending

If the component has no internal edge order, identity order is the stable fallback.

### Step 5 — Generate ideal slots

For each node at level `L` and lane index `K`:

- start from the anchor edge-facing point
- offset one `MAIN_GAP_PX` step away from the anchor
- then offset `L * MAIN_GAP_PX` on the main axis
- offset by `laneOffset(K) * CROSS_GAP_PX` on the cross axis
- snap the final center to `GRID_PX`

Lane order is deterministic:

- `0, +1, -1, +2, -2, +3, -3, ...`

### Step 6 — Collision test

A candidate slot collides when the candidate node bounds expanded by `COLLISION_MARGIN_PX` intersect:

- any preserved active managed element
- any already-placed added node
- any active orphan retained in-scene
- optionally later: cluster padding bounds

### Step 7 — Collision resolution

If the ideal slot collides, search in this stable order:

1. same level, next lane offsets
2. one extra main-axis step, repeat lane sequence
3. two extra main-axis steps, repeat lane sequence
4. continue until `SEARCH_MAX_STEPS`

The first non-colliding slot wins.

If no slot is found within `SEARCH_MAX_STEPS`, raise `placement-failed`.

### Step 8 — Place edges after node placement

New managed edges do not determine node placement after Step 4.  
They are created/routed after all node coordinates are fixed.

Preserved matched edges keep existing geometry when still valid under package rules; brand-new edges get default routing.

---

## 6. Sparse / Disconnected Fallback

## 6.1 Disconnected component with no preserved anchors

If a component has no preserved anchors, place it on a deterministic frontier outside the current active managed scene bounds.

### Frontier origin

Based on global direction:

- `TD` / `TB`: frontier starts below the current bounds
- `BT`: frontier starts above the current bounds
- `LR`: frontier starts to the right
- `RL`: frontier starts to the left

The origin is offset by `COMPONENT_GAP_PX`.

### Frontier packing

Disconnected components are packed in stable component-key order.

Each component receives a synthetic frontier anchor offset along the cross axis by:

- `componentIndex * COMPONENT_GAP_PX`

Then the component uses the same level/lane placement algorithm as anchored placement.

## 6.2 Sparse existing scene

If the scene contains very few preserved anchors and a lot of empty space, the algorithm still uses anchor-based placement first; it does not try to infer a global “prettier” layout. The package values deterministic local merge over global relayout.

## 6.3 Empty scene

If the scene is empty or has zero active managed elements, bootstrap is allowed. This is not treated as incremental merge.

---

## 7. Merge Pipeline

This pipeline defines exactly where placement logic runs.

1. **Load inputs**
   - read `.mmd`
   - read `.excalidraw` if present

2. **Validate**
   - path / workspace guard
   - file existence
   - Mermaid parse/type support
   - scene parse

3. **Normalize**
   - build source graph
   - build scene index

4. **Classify scene elements**
   - active managed
   - orphaned managed
   - unmanaged

5. **Diff logical identities**
   - matched managed identities
   - added identities
   - removed identities

6. **Apply preserve/update/remove/orphan policy**
   - preserve matched geometry
   - update Mermaid-owned semantics
   - remove valid managed identities absent from source
   - mark malformed/duplicate managed elements orphaned

7. **Choose placement path**
   - bootstrap if no usable managed scene
   - otherwise incremental Accordo placement

8. **Run placement**
   - place only newly added managed elements
   - do not move preserved managed elements as part of this step

9. **Rebuild resulting scene**
   - active managed elements
   - retained orphaned managed elements
   - unmanaged elements
   - updated app metadata if needed

10. **Persist**
   - write `.excalidraw`
   - if merge/patch included new source content, `.mmd` is already written

11. **Notify runtime**
   - if panel open, push scene reload/update
   - render/export remains a separate tool path

**Placement insertion point:** Step 8 only.  
This makes the boundary auditable: placement never decides preserve/remove/orphan policy, and merge policy never silently regenerates the full scene.

---

## 8. Explicit Bootstrap Rule

The package uses two different engines on purpose:

### Allowed bootstrap uses of `@excalidraw/mermaid-to-excalidraw`

- `accordo_drawing_create`
- `accordo_drawing_merge` when the scene file is absent
- `accordo_drawing_merge` when the scene exists but contains zero active managed elements

### Disallowed uses for incremental additions

- adding a new node into an existing managed drawing
- adding a new connected component into an existing managed drawing
- patching Mermaid content where old managed scene elements already exist

This rule is testable through the merge report field `placementEngine`.

---

## 9. Tool/Runtime Seams

## 9.1 Tool handler seam

Each MCP tool should delegate to a single host use-case function:

- `createDrawing()`
- `mergeDrawing()`
- `queryDrawing()`
- `patchDrawing()`
- `renderDrawing()`

Tool handlers should only validate inputs, map runtime errors, and call these use cases.

## 9.2 File repository seam

All disk IO should pass through a repository abstraction that owns:

- resolve workspace path
- read/write `.mmd`
- read/write `.excalidraw`
- sibling path derivation

This is the package integration seam for file-backed tests.

## 9.3 Bootstrap adapter seam

Bootstrap seeding must be isolated behind one adapter:

- input: Mermaid source
- output: seed scene JSON with valid managed `customData`

This is where `@excalidraw/mermaid-to-excalidraw` is contained.

## 9.4 Panel registry seam

Render/export and live-scene update require a registry that maps drawing path → active panel instance.

`accordo_drawing_render` depends on this seam; that is why real runtime proof is mandatory.

## 9.5 Webview protocol seam

Keep host/webview messages explicit and versioned. Minimum messages:

- `host:load-scene`
- `host:request-export`
- `webview:scene-changed`
- `webview:export-result`
- `webview:error`

## 9.6 Drawing comment bridge seam

Comment parity is a three-part bridge:

1. **comments package** remains the source of truth and exposes `SurfaceCommentAdapter`
2. **drawing host bridge** translates webview comment messages into adapter mutations and pushes store reloads back to the panel
3. **drawing webview overlay** renders pins/popovers against the live Excalidraw scene

This is intentionally the same ownership split as legacy `packages/diagram`, but re-homed onto the Drawing custom-editor runtime.

## 9.7 Anchor compatibility decision

Phase-A compatibility decision:

- keep `surfaceType: "diagram"`
- keep `coordinates.type: "diagram-node"`
- persist prefixed `nodeId` strings: `node:*`, `edge:*`, `cluster:*`

Rationale:

1. existing comment-store data, Comments panel projection, and routing logic already understand this shape
2. shape/edge pins are the real user-visible contract; renaming the anchor taxonomy would create cross-package churn without user value
3. Drawing-managed Excalidraw elements already have the metadata needed to derive stable prefixed IDs from `customData.accordo`

`cluster:*` stays reserved in the contract even though slice 1 only requires node/edge parity.

## 9.8 Focus-command compatibility strategy

Slice-1 strategy: **Drawing produces the legacy command ID `accordo_diagram_focusThread`.**

Why this is the correct short-term design:

- the Comments panel/navigation router already dispatches diagram surface threads to that command
- requiring a simultaneous router + capability + producer rename would enlarge the slice without adding user-visible value
- real-boundary tests can therefore verify the existing production path end-to-end instead of a seam-only alias

Implication for implementation:

- no Comments panel routing change is required in slice 1
- capability docs must describe the command as a legacy compatibility command, not as diagram-package-owned forever
- a future cleanup slice may add a new drawing-native command ID only after all callers migrate

## 9.9 Host/webview comment protocol

**Canonical owner:** `@accordo/comment-sdk` is the single source of truth for
the comment webview protocol (`WebviewMessage`, `HostMessage`, `SdkThread`).

Drawing MUST NOT fork private wire message types for comment SDK traffic.
Drawing may add host-only conversion seams, but once a message crosses the
host/webview boundary it must use the canonical SDK contract.

Drawing source files should therefore import these protocol types from the
public package boundary `@accordo/comment-sdk`, not from local `dist/` files or
private copied protocol definitions.

Minimum additional comment messages:

- webview → host
  - `comment:create`
  - `comment:reply`
  - `comment:resolve`
  - `comment:reopen`
  - `comment:delete`
- host → webview
  - `comments:load`
  - `comments:focus`

Payload ownership is explicit:

- host/store side: `CommentThread[]` from `packages/comments`
- wire/webview side: `SdkThread[]` from `@accordo/comment-sdk`

Therefore the required conversion seam lives in the Drawing host bridge:

1. load raw `CommentThread[]` from the shared store
2. convert them to canonical `SdkThread[]`
3. post canonical `HostMessage` (`comments:load`, `comments:focus`, etc.)

Phase-1 sync policy is **full reload on store change**. This matches the current `SurfaceCommentAdapter` event model and is good enough for parity, but the reload still posts canonical `SdkThread[]` rather than raw store threads.

## 9.10 Webview overlay model

The overlay owns four responsibilities only:

1. build/refresh a managed-target lookup from live Excalidraw elements
2. convert persisted comment threads into SDK/webview pin view-models
3. map managed node/edge targets to screen coordinates using Excalidraw viewport state
4. open/focus the thread popover on host request

Important geometry/runtime rules:

- **nodes** use their managed element bounds
- **edges** use polyline geometry, not width/height boxes
- **pan/zoom** tracking must come from Excalidraw viewport state changes (`scrollX`, `scrollY`, `zoom`), not DOM scroll listeners
- unmanaged elements are never comment targets in the parity slice

## 9.11 Custom-editor lifecycle integration

Each resolved drawing custom editor owns:

- one webview panel
- one panel-registry entry
- one drawing-comment bridge subscription

Lifecycle order matters:

1. resolve custom editor
2. ensure `accordo.accordo-comments` dependency is active
3. acquire comment adapter via `accordo_comments_internal_getSurfaceAdapter`
4. connect host/webview message bridge
5. load scene
6. load comments
7. on dispose, tear down adapter subscription before removing the panel-registry entry

This order is what runtime tests must prove at the package boundary. Package
tests prove provider construction, adapter acquisition, canonical webview
messages, focus forwarding, and bridge disposal through mocked VS Code/webview
objects. They cannot host the actual VS Code webview renderer or human Comments
panel click path; those final visual behaviors are mandatory manual verification
items before Checkpoint E.

---

## 10. First Implementation Slice for TDD

This is the narrow slice that should go through Phase B/C first.

## 10.1 In-scope for slice 1

- flowchart-only source parsing
- create pair: `.mmd` + `.excalidraw`
- scene indexing with managed/unmanaged/orphan split
- merge preserve/update/remove/orphan behavior for nodes and edges
- deterministic placement for new nodes into an existing managed drawing
- query summary contract
- patch = replace source then merge
- render precondition + live export path

## 10.2 Out of slice 1

- non-flowchart Mermaid types
- cluster/subgraph placement
- structured patch ops
- conflict UI
- background/headless export
- sophisticated re-routing heuristics beyond default new-edge generation

## 10.3 Slice-1 stub surfaces

The first code stubs should exist at these seams only:

- core types
- source graph parser interface
- scene index interface
- merge plan interface
- placement engine interface
- file repository interface
- tool handler interfaces
- webview protocol types

No implementation behavior should be hidden in the extension entrypoint.

---

## 11. Risks / Architectural Notes

1. **Managed metadata drift**  
   Solved by making `customData.accordo` the only managed identity contract.

2. **False safety from Excalidraw element IDs**  
   Rejected; Excalidraw IDs are not the stable identity system.

3. **Bootstrap accidentally used for incremental merges**  
   Prevent with explicit gate plus runtime proof on `placementEngine`.

4. **Unit tests passing while runtime export path is broken**  
   Prevent with mandatory real-boundary proofs for create, merge, and render.

5. **Overly broad first slice**  
   Avoided by scoping to flowchart-only incremental merge.

6. **Comment parity visual behavior escapes package tests**  
   Mitigated by automated host/provider/webview-controller tests that verify the
   canonical message boundary and SDK controller callbacks, plus mandatory manual
   Checkpoint E verification in a live VS Code extension host for visible pins,
   popover focus, pan/zoom tracking, and comment lifecycle UI behavior.
