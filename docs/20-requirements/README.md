# Requirements Directory — Index

**Last updated:** 2026-04-04

This directory contains functional and non-functional requirements specifications for all Accordo IDE packages and modules.

---

## Naming Convention

All files use **lowercase-kebab-case**: `requirements-{component}.md`

---

## Requirements Documents

### Core Platform

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-hub.md](requirements-hub.md) | `accordo-hub` | MCP gateway, tool registry, auth, session management | Active |
| [requirements-bridge.md](requirements-bridge.md) | `accordo-bridge` | VS Code ↔ Hub bridge, tool registration, relay | Active |
| [requirements-editor.md](requirements-editor.md) | `accordo-editor` | 16 editor/terminal/workspace MCP tools | Active |

### Browser

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-browser-mcp.md](requirements-browser-mcp.md) | `packages/browser`, `packages/browser-extension` | Agent-facing `accordo_browser_*` MCP tool surface — page understanding, interaction, visual capture | **Active** — consolidates MCP-visible requirements |
| [requirements-browser-extension.md](requirements-browser-extension.md) | `packages/browser-extension` | Chrome extension internals — content scripts, comment UI, relay infrastructure, storage, anchor strategy | Active — internal implementation |
| [requirements-browser2.0.md](requirements-browser2.0.md) | `packages/browser`, `packages/browser-extension` | Snapshot versioning, diff engine, filtering, text extraction, semantic graph, privacy/security | Active — extends browser-extension |
| [requirements-browser.md](requirements-browser.md) | (archived) | Original relay + comment bridge design (M60–M73) | **Archived** — superseded by `requirements-browser-extension.md` |

**Browser requirements reading guide:**
- Start with `requirements-browser-mcp.md` for the agent-visible MCP tool contract
- Consult `requirements-browser-extension.md` for Chrome extension internals and relay infrastructure
- Consult `requirements-browser2.0.md` for snapshot/diff/filter/security internals
- Ignore `requirements-browser.md` (archived)

### Comments

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-comments.md](requirements-comments.md) | `accordo-bridge` (comments module) | Unified comment model, comment store, thread lifecycle | Active |
| [requirements-comments-sdk.md](requirements-comments-sdk.md) | `@accordo/comment-sdk` | Comment SDK — UI components, adapters, surface abstraction | Active |
| [requirements-comments-panel.md](requirements-comments-panel.md) | `accordo-bridge` (panel module) | VS Code comments panel — filtering, grouping, display | Active |

### Presentations & Documents

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-marp.md](requirements-marp.md) | `accordo-marp` | Marp presentation discovery, navigation, narration | Active |
| [requirements-md-viewer.md](requirements-md-viewer.md) | `accordo-md-viewer` | Markdown preview and viewer tools | Active |

### Diagrams & Visual

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-diagram.md](requirements-diagram.md) | `accordo-diagram` | Mermaid diagram tools — create, patch, style, render | Active |

### Voice & Narration

| Document | Package(s) | Scope | Status |
|---|---|---|---|
| [requirements-voice.md](requirements-voice.md) | `accordo-voice` | TTS read-aloud only, no STT/dictation | Active |

---

## Requirement ID Prefixes

Each document uses a unique prefix to avoid ID collisions:

| Prefix Pattern | Document | Example |
|---|---|---|
| `HUB-*` | requirements-hub | `HUB-F-01` |
| `BR-F-*`, `BR-NF-*` | requirements-bridge | `BR-F-01` |
| `ED-*` | requirements-editor | `ED-F-01` |
| `BR-F-*`, `PU-F-*`, `CR-F-*` | requirements-browser-extension | `PU-F-01`, `CR-F-01` |
| `B2-*` | requirements-browser2.0 | `B2-SV-001`, `B2-TX-001` |
| `MCP-*` | requirements-browser-mcp | `MCP-VC-001`, `MCP-ER-001` |
| `CM-*` | requirements-comments | `CM-F-01` |
| `CS-*` | requirements-comments-sdk | `CS-F-01` |
| `CP-*` | requirements-comments-panel | `CP-F-01` |
| `DG-*` | requirements-diagram | `DG-F-01` |
| `VO-*` | requirements-voice | `VO-F-01` |
| `SC-*` | requirements-script | `SC-F-01` |

---

## Cross-References

- **Architecture:** [`docs/10-architecture/architecture.md`](../10-architecture/architecture.md)
- **Workplan:** [`docs/00-workplan/workplan.md`](../00-workplan/workplan.md)
- **Coding guidelines:** [`docs/30-development/coding-guidelines.md`](../30-development/coding-guidelines.md)
- **Evaluation checklist:** [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md)
- **Current reviews:** [`docs/reviews/`](../../docs/reviews/)
- **Historical review evidence:** [`60-archive/reviews/`](../../60-archive/reviews/)
