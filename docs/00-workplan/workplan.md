# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-04-30
**Status:** Active workplan has been trimmed to open work only. Completed tasks live in `docs/00-workplan/accomplished-tasks.md`.
**Purpose:** Track pending implementation/validation work only.

---

## 1) Current Operating Priorities

### Comment Surface Anchor Usability

**Status:** Open  
**Scope:** `packages/comments` comment tool input normalization and MCP docs/tool descriptions.

Make `comment_create` more receptive for surface/slide anchors so intuitive
agent calls succeed instead of requiring repeated retries.

Specific live failures that prompted this item:

- **Diagram modality docs gap:** `comment_create` with `anchor.coordinates: {"type":"diagram","x":0.3,"y":0.5}` was accepted but no pin rendered. Only `{"type":"diagram-node","nodeId":"node:A"}` or `{"type":"diagram-node","nodeId":"edge:A->B:0"}` renders a visible pin. The tool description and MCP runtime docs must explain that diagram comments require node/edge anchors — free-floating coordinate pins are not supported.

- In a Marp presentation, the agent tried to create a slide comment with
  intuitive surface-anchor payloads such as `anchorKey: "center"` and top-level
  `x`/`y` variants.
- The tool rejected both with `coordinates are required for surface anchors`.
- A pixel-only payload was accepted but persisted malformed coordinates:
  `anchor: { kind: "surface", surfaceType: "slide", coordinates: { x: 640, y: 360 } }`.
  That caused Marp pins not to render and clicking the comments panel thread to
  throw `buildSlideFocusArgs requires slide coordinates`.
- After canonical coordinates were used, focus still failed for MCP-created
  slide comments because comment tools store deck anchors as `file://...` URIs
  while Marp sessions use filesystem paths. Marp must treat both forms as the
  same deck when loading pins and focusing threads.
- `comment_delete` works, but passing `commentId: ""` caused the tool to attempt
  a comment-level delete and return `invalid-comment-id`; agents need either
  clearer docs or the handler should normalize blank optional strings to absent.

- **Related `comment_list` discovery gap:** during browser-comment sync E2E,
  synced browser threads existed and `comment_sync_version` reported them, but
  repeated `comment_list` calls returned empty because the agent guessed filters
  such as `intent: "question"`, `lastAuthor: "agent"`, or the wrong anchor kind.
  `comment_list` combines all provided filters with AND, but that contract was
  not obvious enough from the tool description/runtime guidance.

  Immediate guidance update: the tool description and Accordo runtime/local skill
  docs must state that all filters are AND-combined, that uncertain filters
  should be omitted, and that first-pass browser discovery should use only
  `scope.modality: "browser"` plus `status: "all"` before narrowing.

  Architect follow-up plan (deferred implementation): keep AND semantics for
  backward compatibility, but make zero-result responses actionable with
  `appliedFilters`, `availableFacets`, `suggestedRelaxations`, and an
  `emptyReason`; add opt-in `discover: true` metadata for non-empty results;
  expose `retention` as an explicit filter/facet; consistently ignore blank
  optional string filters; and add tests proving
  `comment_list({ scope: { modality: "browser" }, status: "all" })` discovers
  browser-imported threads without requiring `intent`, `lastAuthor`, or
  `anchorKind` guesses.

  **Compatibility cleanup scope (approved):** keep diagnostics/facets/discover
  work deferred; only normalize response-shape/discovery flow by making
  `comment_list` summary-only (including `detail: true`) and routing rich thread
  retrieval through `comment_get` hydration where browser relay consumers need
  `data: { threads: CommentThread[] }`.

Root-cause notes:

- `packages/comments/src/comment-tools/anchor.ts` currently passes surface
  `coordinates` through without runtime validation/normalization.
- `packages/comments/src/comment-tools/definitions.ts` must be explicit that
  `comment_list` filters are AND-combined and that broad discovery should omit
  uncertain narrowing filters.
- Future `comment_list` implementation work likely touches
  `packages/comments/src/comment-tools/query-handlers.ts`,
  `packages/comments/src/comment-query-ops.ts`, and comment tool tests to add
  diagnostics/facets/discovery mode.
- Slide anchors require canonical `SlideCoordinates`:
  `{ type: "slide", slideIndex: <zero-based number>, x: <0..1>, y: <0..1> }`.
- `packages/marp/src/presentation-comments-bridge.ts` derives pin block IDs from
  these fields; malformed coordinates become invalid block IDs.
- `packages/marp/src/presentation-comments-bridge.ts` also needs to query both
  filesystem-path and `file://` URI forms when loading slide comment threads.
- `packages/marp/src/extension.ts` `accordo.presentation.internal.focusThread`
  needs to normalize incoming `file://` deck URIs to filesystem paths before
  comparing/opening sessions.
- `packages/comments/src/panel/navigation-contract.ts` correctly rejects
  non-slide coordinates in `buildSlideFocusArgs`, but the bad data should be
  prevented at creation time.

Done when:

- `comment_create` validates slide anchors at creation time. It must reject
  malformed slide coordinates with an actionable error instead of storing them.
- `comment_create` accepts intuitive aliases for surface anchors where enough
  context exists, at minimum `anchor.anchorKey: "center"` and top-level
  `anchor.x` / `anchor.y`, normalizing them to canonical `anchor.coordinates`.
  If no slide index can be inferred, the error must say to pass
  `coordinates: { type: "slide", slideIndex, x, y }`.
- `comment_delete` treats blank optional strings (`commentId: ""`, whitespace)
  as omitted, or its error message explicitly says to omit `commentId` when
  deleting a whole thread.
- Error messages mention the accepted canonical and alias shapes.
- Tool descriptions, runtime MCP skill resource, and local skill docs explain
  the canonical shape, aliases, and delete modes.
- `comment_list` guidance explains AND filtering and first-pass browser
  discovery; future implementation adds zero-result diagnostics/facets and a
  `discover: true` mode per the architect follow-up plan above.
- Tests cover canonical coordinates, malformed/pixel-only coordinates, alias
  shapes above, blank optional delete fields, and Marp file URI / filesystem path
  equivalence for pin loading and thread focus.

Latest completed items have been moved to `docs/00-workplan/accomplished-tasks.md`, including Priority 0 voice live-baseline validation.

**Note:** Legacy browser work remains owned by a separate team. Legacy `accordo-diagram` feature expansion remains out of current scope. The new `accordo-drawing` package is now active work and owns the new `.mmd` + `.excalidraw` merge/placement architecture.

---

### Marp Slide Index Discrepancy (0-based vs 1-based)

**Status:** Open  
**Observed:** `accordo_presentation_goto({ index: 2 })` navigates to the **3rd** slide (0-indexed internally), but users see and count slides as 1-indexed in the Marp UI. Agents and users are misaligned.

**Fix needed:** `accordo_presentation_goto` tool descriptions and MCP runtime docs must clearly state slides are **0-indexed**. Consider whether a 1-based alias (`slideNumber`) would reduce user/agent misalignment.

---

### Drawing Package — Phase A Remediation and Activation

**Status:** Open  
**Scope:** New `accordo-drawing` package design and first TDD slice activation.

**Completion roadmap:** `docs/00-workplan/drawing-completion-plan.md` now tracks the full path from the current flowchart-first slice to a rich Drawing feature set with broader Mermaid type support.

**Deferred gap to address (observed in live demo):**

- `accordo_drawing_patch` / merge output currently has major visual quality issues in some flows:
  1. newly added blocks may lose/omit readable labels,
  2. XY placement may appear non-logical relative to existing graph structure,
  3. collisions/overlaps can still occur in the resulting scene,
  4. opening `.excalidraw` often lands in text first and only then in drawing via explicit open command.

**Decision:** defer this placement/label/collision/open-UX remediation to a dedicated Drawing module slice so current demo flow can proceed.

**Done-when for deferred slice:**

- Added/updated managed nodes and edges render with expected labels in Excalidraw.
- Placement follows deterministic, human-sensible anchor/frontier rules and is validated against representative patched graphs.
- Collision avoidance prevents overlaps in normal merge/patch scenarios; failing cases are surfaced explicitly.
- Opening a drawing path uses a deterministic custom-editor-first UX (no confusing text-first behavior during normal workflows).
- Tests cover label retention, anchor-based placement quality, collision cases, and open-command UX behavior.

This work is now active and is **not** part of the completed legacy `accordo-diagram` stream.

**Why active now:**  
Phase A review for the new drawing package failed on four blockers:

1. missing authoritative contract set
2. merge-time placement ownership was ambiguous
3. placement algorithm was underspecified
4. tool/runtime seams and first slice were too vague

**Phase A done when:**

- `docs/20-requirements/requirements-drawing.md` exists and is authoritative
- `docs/10-architecture/drawing-architecture.md` exists and is authoritative
- the docs explicitly state the two-file source of truth: `.mmd` + `.excalidraw`
- the docs explicitly ban canonical `layout.json` for this package
- the docs explicitly require Accordo-owned placement for merge-time additions into existing drawings
- the docs define deterministic placement, collision resolution, and disconnected fallback
- the docs define contracts for:
  - `accordo_drawing_create`
  - `accordo_drawing_merge`
  - `accordo_drawing_query`
  - `accordo_drawing_patch`
  - `accordo_drawing_render`
- the first TDD slice is narrowed to a precise, testable scope

**First execution slice after Phase A approval:**

- flowchart-only
- create/query/merge/patch/render contracts
- managed/unmanaged/orphan scene indexing
- deterministic placement for new managed nodes into existing drawings
- runtime proof for create + merge + render

---

## 2) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `docs/00-workplan/accomplished-tasks.md`.
- For each new module, attach requirement IDs, test evidence, and review artifact.
