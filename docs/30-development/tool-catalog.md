# Tool Catalog (Canonical)

**Status:** ACTIVE  
**Owner:** Accordo maintainers  
**Last reviewed:** 2026-04-21  
**Canonical for:** top-level tool family ownership and public/internal boundaries

---

## Tool families by owner

| Family prefix / area | Owning package | Public/Internal | Notes |
|---|---|---|---|
| `accordo_editor_*` | `accordo-editor` | Public MCP | Editor/terminal/layout/workspace tool surface |
| `accordo_markdown_*` | `accordo-editor` | Public MCP | Deterministic Markdown surface control |
| `accordo_browser_*` | `accordo-browser` (+ browser-extension runtime) | Public MCP | Browser understanding + interaction + control tools |
| `comment_*` | `accordo-comments` | Public MCP | Unified comment tools across modalities |
| `accordo_diagram_*` | `accordo-diagram` | Public MCP | Diagram list/get/create/patch/render/style-guide |
| `accordo_presentation_*` (reduced) | `accordo-marp` | Public MCP | Presentation tools — open, close, getCurrent, goto, generateNarration (discover/listSlides/next/prev removed from public surface) |
| `accordo_voice_readAloud` | `accordo-voice` | Public MCP | Voice playback tool |
| `accordo_*_internal_*` and capability commands | package-specific via `@accordo/capabilities` | Internal command contracts | Inter-extension command boundaries |

## Current active public MCP counts (reference snapshot)

| Package | Count |
|---|---:|
| `accordo-editor` | 24 |
| `accordo-browser` | 20 |
| `accordo-comments` | 8 |
| `accordo-diagram` | 6 |
| `accordo-marp` | 5 |
| `accordo-voice` | 1 |

> Count source is maintained documentation and package tool definitions. When package tool surfaces change, update this catalog and the corresponding requirements doc together.

## Recent browser addition

`accordo_browser_resolve_comment_context` is a public MCP helper in `accordo-browser` for browser-comment investigation.
It resolves a stored comment thread through `comment_get`, recovers browser anchor metadata, and returns both `inspect_element` and `get_dom_excerpt` context in one call.
Structured failures include `thread-not-found`, `comment-not-found`, `browser-anchor-missing`, `comment-get-failed`, `context-resolution-failed`, and `context-mismatch`.
When reading its result:
- top-level `metadata`, `anchorKey`, and `creationSnapshotId` are the recovered stored browser-comment anchor metadata
- top-level `storedFrameId` is the stored frame identity from comment metadata; top-level `resolvedFrameId` is the frame actually used for the successful rerun
- nested `inspect` / `excerpt` `anchorStrategy`, `anchorConfidence`, `resolvedTier`, and `snapshotDrift` describe the actual re-resolution of that recovered anchor
- nested `inspect` / `excerpt` `canonicalAnchor*` fields describe the best current canonical anchor for the found element
