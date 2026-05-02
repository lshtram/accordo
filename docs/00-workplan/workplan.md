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

Root-cause notes:

- `packages/comments/src/comment-tools/anchor.ts` currently passes surface
  `coordinates` through without runtime validation/normalization.
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
- Tests cover canonical coordinates, malformed/pixel-only coordinates, alias
  shapes above, blank optional delete fields, and Marp file URI / filesystem path
  equivalence for pin loading and thread focus.

Latest completed items have been moved to `docs/00-workplan/accomplished-tasks.md`, including Priority 0 voice live-baseline validation.

**Note:** Browser and diagram priorities are intentionally excluded from this workplan. Browser work is owned by a separate team; diagram work is out of current scope.

---

### Marp Slide Index Discrepancy (0-based vs 1-based)

**Status:** Open  
**Observed:** `accordo_presentation_goto({ index: 2 })` navigates to the **3rd** slide (0-indexed internally), but users see and count slides as 1-indexed in the Marp UI. Agents and users are misaligned.

**Fix needed:** `accordo_presentation_goto` tool descriptions and MCP runtime docs must clearly state slides are **0-indexed**. Consider whether a 1-based alias (`slideNumber`) would reduce user/agent misalignment.

---

## 2) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `docs/00-workplan/accomplished-tasks.md`.
- For each new module, attach requirement IDs, test evidence, and review artifact.
