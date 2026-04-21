# Requirements Index (Authoritative)

**Status:** ACTIVE  
**Owner:** Accordo maintainers  
**Last reviewed:** 2026-04-21  
**Canonical for:** active requirements routing and package ownership mapping

---

## Active requirements documents

| Document | Owning package(s) | Scope |
|---|---|---|
| `requirements-hub.md` | `accordo-hub` | Hub runtime, MCP transport, auth, tool/state core |
| `requirements-bridge.md` | `accordo-bridge` | VS Code bridge lifecycle, routing, registration |
| `requirements-editor.md` | `accordo-editor` | Editor/terminal/layout tool surface |
| `requirements-browser-mcp.md` | `accordo-browser` + `browser-extension` integration | Agent-visible browser MCP contract |
| `requirements-browser-extension.md` | `browser-extension` | Chrome extension internals, relay and UI behaviors |
| `requirements-browser2.0.md` | `accordo-browser` + `browser-extension` | Snapshot/diff/filter/semantic/browser hardening waves |
| `requirements-shared-browser-relay.md` | `accordo-browser` | Shared relay lifecycle and multi-window coordination |
| `requirements-comments.md` | `accordo-comments` | Comment store, tools, internal command contracts |
| `requirements-comments-panel.md` | `accordo-comments` | Custom comments panel behavior |
| `requirements-comments-sdk.md` | `@accordo/comment-sdk` | Webview comment SDK contracts |
| `requirements-md-viewer.md` | `accordo-md-viewer` | Markdown viewer integration |
| `requirements-marp.md` | `accordo-marp` | Presentation/deck tool surface and integration |
| `requirements-diagram.md` | `accordo-diagram` | Diagram parser/layout/tooling contracts |
| `requirements-diagram-hardening.md` | `accordo-diagram` | Diagram hardening wave requirements |
| `requirements-diagram-fidelity.md` | `accordo-diagram` | Flowchart fidelity requirement batches |
| `requirements-voice.md` | `accordo-voice` | TTS voice tool surface (current voice scope) |

## Legacy / historical requirements (non-canonical)

These remain in this folder for historical traceability but are **not** the current active contract source:

- `requirements-browser.md` (superseded by browser MCP + extension + browser2.0 docs)
- `requirements-browser-relay-auth.md` (historical phase-specific requirements)
- `requirements-slidev.md` (legacy presentation track; active package is `accordo-marp`)
- `requirements-script.md` (retired capability)
- `requirements-narration-plugin.md` (historical plugin-specific spec; keep for reference)

## Supporting indexes

- Package ownership matrix: `ownership-matrix.md`
- Cross-module architecture: `../10-architecture/architecture.md`
- Active workplan: `../00-workplan/workplan.md`
