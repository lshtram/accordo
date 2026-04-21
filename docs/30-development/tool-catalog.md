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
| `accordo_browser_*` | `accordo-browser` (+ browser-extension runtime) | Public MCP | Browser understanding + interaction + control tools |
| `comment_*` | `accordo-comments` | Public MCP | Unified comment tools across modalities |
| `accordo_diagram_*` | `accordo-diagram` | Public MCP | Diagram list/get/create/patch/render/style-guide |
| `accordo_presentation_*`, `accordo_webview_capture` | `accordo-marp` | Public MCP | Presentation navigation + slide capture |
| `accordo_voice_readAloud` | `accordo-voice` | Public MCP | Voice playback tool |
| `accordo_*_internal_*` and capability commands | package-specific via `@accordo/capabilities` | Internal command contracts | Inter-extension command boundaries |

## Current active public MCP counts (reference snapshot)

| Package | Count |
|---|---:|
| `accordo-editor` | 23 |
| `accordo-browser` | 19 |
| `accordo-comments` | 8 |
| `accordo-diagram` | 6 |
| `accordo-marp` | 10 |
| `accordo-voice` | 1 |

> Count source is maintained documentation and package tool definitions. When package tool surfaces change, update this catalog and the corresponding requirements doc together.
