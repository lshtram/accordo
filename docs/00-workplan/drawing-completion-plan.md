# Accordo Drawing — Completion Plan

**Date:** 2026-05-06  
**Status:** Active planning document  
**Owner package:** `packages/drawing`  
**Requirements source:** `docs/20-requirements/requirements-drawing.md`  
**Architecture source:** `docs/10-architecture/drawing-architecture.md`

---

## 1. Target Outcome

Complete `accordo-drawing` as the primary rich diagram/drawing modality for Accordo.

The finished module should let a human and an agent collaborate on the same drawing through:

- a Mermaid `.mmd` topology/source file
- a sibling `.excalidraw` scene file for layout, visual styling, and freeform edits
- a VS Code custom editor for human editing
- MCP tools for create, query, merge, patch, and render
- deterministic merge behavior that preserves human layout instead of regenerating the whole scene
- broad Mermaid diagram-type bootstrap support, with incremental merge support added type-by-type where safe

---

## 2. Core Model To Preserve

Drawing has two different conversion paths, and the distinction is intentional.

### 2.1 Browser Bootstrap Conversion

Used when there is no usable existing managed drawing yet.

This path lets the Excalidraw webview/browser runtime call `@excalidraw/mermaid-to-excalidraw` directly and uses the library's output as the initial scene.

This is the correct path for:

- opening a `.mmd` file that has no sibling `.excalidraw`
- `accordo_drawing_create` when it creates a brand-new pair
- `accordo_drawing_merge` only when the scene is missing or has zero usable managed elements
- future support for Mermaid diagram types where Accordo does not yet have deterministic incremental merge logic

The browser path matters because the official converter depends on browser/SVG behavior that is not safely reproduced in a plain Node/jsdom extension-host environment.

### 2.2 Accordo Incremental Merge

Used when a drawing already has usable managed Excalidraw elements.

This path must not call the official converter to regenerate the whole scene. Instead, it reads `.mmd`, indexes `.excalidraw`, preserves existing managed geometry, preserves unmanaged freeform elements, removes deleted managed elements, marks unsafe managed elements as orphaned, and places newly added managed elements with deterministic Accordo placement.

This is the correct path for:

- agent edits to an established drawing
- merge/patch operations after a human has adjusted layout
- preserving hand-arranged diagrams and freeform Excalidraw annotations

---

## 3. Current Gaps Explained

### 3.1 Align `accordo_drawing_create` With Browser Bootstrap

Current state: right-click `.mmd` open uses the new browser conversion model, but the create tool still needs to be fully aligned with that model.

What this means:

- create should write `.mmd`
- create should create a sibling `.excalidraw` bootstrap placeholder or scene using the same conversion pipeline as the webview open path
- create should not rely on an older hand-built layout path when the official converter is available
- create should return a clear report saying whether it used `mermaid-to-excalidraw` or an empty/bootstrap placeholder

Done when:

- create and right-click open produce equivalent initial scenes for the same Mermaid source
- create validates supported Mermaid content before reporting success
- created managed elements have valid Accordo metadata after conversion
- runtime MCP proof shows create succeeds through the real tool path

### 3.2 Add Stable Accordo Metadata After Conversion

Current state: merge/query logic depends on `customData.accordo`, but official converter output does not automatically know Accordo identities.

What this means:

- after browser conversion, Accordo must annotate generated Excalidraw elements with stable managed identity metadata
- node metadata should map to Mermaid node IDs
- edge metadata should map to stable edge identities such as `A->B:0`
- unmanaged human elements must remain without Accordo metadata
- metadata attachment must not distort the library-generated geometry

Done when:

- query can classify converted scenes as managed rather than unmanaged
- merge can match existing generated nodes/edges to `.mmd` identities
- malformed or duplicated metadata is preserved as orphaned instead of silently deleted
- tests prove metadata survives Excalidraw save/reopen cycles

### 3.3 Improve Query For Real Scenes

Current state: `accordo_drawing_query` exists, but it is most useful when metadata is already correct.

What this means:

- query should be the safe inspection tool agents call before mutating a drawing
- it should report source status, scene status, managed counts, unmanaged counts, orphan counts, and whether merge is needed
- it should explain why a scene is not merge-ready, such as missing metadata, duplicate identity, unsupported diagram type, or scene parse failure

Done when:

- query never mutates files
- query provides actionable diagnostics for missing/partial metadata
- query can inspect library-generated scenes after metadata backfill
- query supports agent-safe discovery before patch/merge/render

### 3.4 Harden Merge And Patch

Current state: merge and patch are implemented, but their usefulness depends on robust scene indexing and metadata.

What this means:

- merge must preserve human-moved nodes and freeform Excalidraw elements
- patch should replace `.mmd` source, then invoke the same merge pipeline
- deleted source nodes/edges should remove only the matching managed elements
- new source nodes/edges should be placed deterministically without overlapping existing content
- unsafe managed elements should be orphaned, not destroyed

Done when:

- merge reports preserved, added, updated, removed, and orphaned counts accurately
- patch and merge share the same reconciliation path
- connected additions are placed near existing neighbors
- disconnected additions are placed at a deterministic frontier
- repeated merges with unchanged inputs are stable/idempotent

### 3.5 Implement Real PNG/SVG Export Validation

Current state: render exists and routes through the open drawing panel, but it needs stronger proof as a real Excalidraw export path.

What this means:

- render should require the target drawing panel to be open
- render should export the current live scene, including unsaved or recently saved human layout state as defined by the panel contract
- render should write a real PNG or SVG artifact to disk
- render should fail with `panel-not-open` when the panel is closed

Done when:

- runtime proof covers closed-panel failure and open-panel success
- exported files are non-empty and valid for their requested format
- SVG/PNG export does not mutate `.mmd` or `.excalidraw`
- error messages are stable and actionable

### 3.6 Expand Beyond Flowchart

Current state: requirements intentionally limited the first slice to Mermaid flowcharts.

What this means:

- broad diagram support should be added in stages
- every supported type can first be supported for browser bootstrap/open/render
- incremental merge should only be enabled for a type after Accordo can parse identities and safely preserve/update/remove/place that type
- types without safe incremental merge can still be useful as create/open/render-only drawings, but patch/merge must clearly report the limitation

Target staged support:

- Stage 1: flowchart complete with incremental merge
- Stage 2: sequence, class, state, ER diagrams with bootstrap/create/render and type-aware query
- Stage 3: deterministic incremental merge for class/state/ER where identity mapping is reliable
- Stage 4: timeline, journey, gantt, pie, mindmap, quadrant, gitGraph, requirement, and other official Mermaid types as bootstrap/render-first support
- Stage 5: richer type-specific editing features where the source model can support them safely

Done when:

- supported diagram types are documented in tool descriptions and runtime skill docs
- unsupported operations fail with stable `unsupported-diagram-type` or `operation-not-supported-for-type` style errors
- users can create/open/render all selected Mermaid types without manual conversion steps
- flowchart remains the first fully merge-safe diagram type until other types get equivalent identity/merge tests

### 3.7 Add Rich Drawing Features

Rich features should build on the two-file model instead of bypassing it.

Candidate features:

- style preservation for colors, fonts, strokes, and roughness
- agent-safe style patching for selected managed identities
- subgraph/container support for flowcharts
- comments/annotations anchored to drawing elements
- query by element identity, label, status, or spatial region
- import existing `.excalidraw` plus `.mmd` and backfill metadata
- conflict diagnostics when `.mmd` and `.excalidraw` drift
- better preview/status UI for sync state and orphaned elements
- export options for transparent background, dark/light theme, and scale

Done when:

- features preserve human layout by default
- agent actions are inspectable through query before mutation
- each feature has requirement IDs, tests, and runtime tool guidance

---

## 4. Recommended Next Item

The next implementation item should be:

**Complete create/bootstrap alignment and metadata backfill for flowcharts.**

Reason:

- create is the front door for tool-based drawings
- merge/query/patch all depend on reliable metadata
- render validation needs a reliable created/opened scene to export
- finishing this first prevents every later feature from depending on hand-built or partially managed scenes

---

## 5. Start-To-Finish Execution Plan

### Phase 0 — Baseline And Contract Refresh

Goal: confirm the current behavior and lock the target contract before editing.

Tasks:

- run the current `accordo-drawing` tests and build
- inspect current create/open/webview conversion paths
- update requirements if create/bootstrap or diagram-type support changes the public contract
- update runtime MCP skill/tool descriptions where operational behavior changes

Exit criteria:

- baseline failures, if any, are documented
- first implementation slice is explicitly flowchart create/bootstrap + metadata backfill

### Phase 1 — Browser Bootstrap For Create

Goal: make `accordo_drawing_create` use the same conversion model as `.mmd` right-click open.

Tasks:

- route create through the placeholder/webview conversion path or an equivalent browser-backed bootstrap path
- preserve Mermaid syntax exactly when embedding source into webview payloads
- persist generated Excalidraw scene after conversion
- return accurate bootstrap metadata in the tool response

Exit criteria:

- create and right-click open produce equivalent scenes
- create works through the registered MCP tool handler
- tests cover arrows and labels such as `A-- text -->B`

### Phase 2 — Metadata Backfill

Goal: make generated scenes merge/query-ready.

Tasks:

- derive a normalized source graph from flowchart Mermaid
- map generated Excalidraw elements back to source nodes and edges
- attach `customData.accordo` without changing geometry
- preserve metadata through save/reopen
- mark ambiguous mappings as actionable errors or orphans, depending on when they are detected

Exit criteria:

- query reports managed elements after create/open conversion
- merge can match existing generated elements to source identities
- duplicate/malformed metadata tests pass

### Phase 3 — Query As Agent Safety Check

Goal: make query the first safe tool before mutation.

Tasks:

- improve scene status classification
- report missing metadata, orphans, unsupported types, and sync drift clearly
- add optional element summaries without exposing unnecessary scene internals by default

Exit criteria:

- query is non-mutating
- query gives enough detail for an agent to decide whether merge/patch/render is safe
- tests cover valid, missing-scene, invalid-source, invalid-scene, orphaned, and needs-merge cases

### Phase 4 — Merge/Patch Completion For Flowcharts

Goal: make flowchart incremental editing safe and deterministic.

Tasks:

- finish scene indexing and identity matching
- preserve matched managed geometry
- update labels and Mermaid-owned semantics
- remove deleted managed elements only
- preserve unmanaged/freeform elements
- implement deterministic placement for connected and disconnected additions
- make patch a thin source-replace plus merge operation

Exit criteria:

- merge is idempotent for unchanged inputs
- patch and merge reports are deterministic
- human-moved nodes stay where the human placed them
- additions avoid collisions under defined placement constants

### Phase 5 — Real Render Proof

Goal: make render dependable for agents and users.

Tasks:

- validate closed-panel `panel-not-open` behavior
- validate open-panel PNG export
- validate open-panel SVG export
- add output path handling and format validation
- confirm render does not mutate source or scene files

Exit criteria:

- PNG and SVG artifacts are valid and non-empty
- real panel/runtime tests pass
- errors use stable codes

### Phase 6 — Runtime Documentation And Tool Guidance

Goal: make behavior discoverable to future agents through MCP-facing surfaces.

Tasks:

- update drawing tool descriptions with supported types, preconditions, and failure modes
- update runtime MCP skill resources for drawing workflows
- update local repo skills if a drawing skill exists or create one if needed
- document recommended agent flow: query, patch/merge, query, render

Exit criteria:

- operational guidance is not only in repo requirements
- agents can discover how to use the tools from runtime descriptions/resources

### Phase 7 — Broader Mermaid Type Bootstrap

Goal: support rich create/open/render coverage beyond flowcharts without pretending all types are merge-safe.

Tasks:

- inventory Mermaid types supported by the official converter
- add type detection and support matrix
- enable create/open/render for selected non-flowchart types through browser bootstrap
- make query report each type and operation capability
- make merge/patch reject unsupported incremental operations clearly

Exit criteria:

- selected non-flowchart types can be created/opened/rendered
- unsupported merge/patch paths fail before mutation
- support matrix is documented and tested

### Phase 8 — Type-Specific Incremental Merge Expansion

Goal: add real merge-safe behavior beyond flowcharts one type at a time.

Tasks:

- pick the next type based on identity stability and user value
- add source parser/normalizer for that type
- define metadata identities for that type
- add preserve/update/remove/orphan policy tests
- add deterministic placement rules only where the type has spatial node-like structure

Recommended order:

- class diagrams
- state diagrams
- ER diagrams
- sequence diagrams only after deciding how lifelines/messages map to editable Excalidraw elements

Exit criteria:

- each promoted type has the same proof standard as flowchart
- no type is marked merge-safe without identity, orphan, and runtime tests

### Phase 9 — Rich Feature Set

Goal: add high-value drawing features after the core workflow is safe.

Tasks:

- style patching by managed identity
- subgraph/container support
- element-level query/filtering
- comments anchored to drawing elements
- import/backfill metadata for existing drawings
- export options for theme, scale, and background
- sync-state UI in the custom editor

Exit criteria:

- features are requirements-backed
- each feature preserves human-owned scene data by default
- runtime docs and tests cover each new agent-facing workflow

---

## 6. Suggested TDD Slices

Use these as independent, reviewable TDD modules:

1. `drawing-create-bootstrap-flowchart`
2. `drawing-managed-metadata-backfill`
3. `drawing-query-diagnostics`
4. `drawing-flowchart-merge-placement`
5. `drawing-render-runtime-proof`
6. `drawing-runtime-docs-and-skills`
7. `drawing-non-flowchart-bootstrap-support`
8. `drawing-class-state-er-merge-support`
9. `drawing-rich-features`

Each slice must include requirement IDs, failing tests before implementation, affected package build/test evidence, and a reviewer checkpoint when run in TDD mode.
