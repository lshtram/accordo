---
marp: true
theme: default
paginate: true
backgroundColor: #1a1a2e
color: #e0e0e0
style: |
  section {
    font-family: 'Segoe UI', sans-serif;
  }
  h1 {
    color: #4fc3f7;
  }
  h2 {
    color: #81d4fa;
  }
  code {
    background: #2d2d4a;
    border-radius: 4px;
    padding: 2px 6px;
  }
  table {
    font-size: 0.8em;
  }
  strong {
    color: #ffb74d;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Accordo IDE — Architecture Overview

**AI-native development environment as a VS Code extension layer**

![bg right:40%](https://img.icons8.com/color/96/visual-studio-code-2019.png)

---

## What is Accordo?

> "Agent as co-present collaborator" — not "agent as assistant"

- Built **on top of VSCode** — users keep their existing editor
- AI agent gains **real-time, structured control** through MCP protocol
- Agent sees what human sees, navigates code, runs terminals, controls canvases
- **Editor-agnostic Hub** — swapping VSCode means replacing only the Bridge

---

## The Three Core Packages

| Package | Role | Key Responsibility |
|---|---|---|
| `accordo-hub` | MCP Server + State Engine | Runs standalone; registers tools; generates system prompt |
| `accordo-bridge` | VSCode ↔ Hub bridge | WebSocket client; routes commands; publishes IDE state |
| `accordo-editor` | 16 editor/terminal/workspace tools | Handles VSCode-native operations via Bridge API |

**Plus:** `bridge-types` (shared TypeScript types), `comments`, `voice`, `diagram`, `browser`, `md-viewer`, `marp` (independent extensions)

---

<!-- _class: lead -->

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│  VSCode                                              │
│                                                     │
│  ┌────────── accordo-editor ─────────────────────┐ │
│  │  16 MCP tools (open, split, terminal, etc.)   │ │
│  └──────────────┬──────────────────────────────┘  │
│                 │ BridgeAPI (direct, no wire)      │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  accordo-bridge                             │    │
│  │  WebSocket client → Hub                      │    │
│  │  Routes: Hub ↔ VSCode commands               │    │
│  └──────────────────────┬───────────────────────┘  │
└─────────────────────────┼───────────────────────────┘
                          │ WebSocket (ws://localhost:3000)
┌─────────────────────────▼───────────────────────────┐
│  accordo-hub  (standalone Node.js process)        │
│                                                     │
│  • MCP Streamable HTTP (POST /mcp)                  │
│  • WebSocket server (/bridge path)                   │
│  • Tool registry (runtime registration)              │
│  • State cache (flat JSON snapshot)                  │
│  • Prompt engine (token budget, auto-regenerates)    │
│  • Security: loopback + bearer token auth           │
└─────────────────────────┬───────────────────────────┘
                          │ MCP (HTTP or stdio)
┌─────────────────────────▼───────────────────────────┐
│  AI Agent (any MCP-capable client)                  │
│  • GitHub Copilot → VSCode native MCP auto-register │
│  • Claude Code → .claude/mcp.json                   │
│  • OpenCode → opencode.json (Streamable HTTP)       │
└─────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Hub is the product** | Core MCP server + state engine is editor-agnostic |
| **Bridge is the only VSCode-specific piece** | Swapping editors = replace Bridge only |
| **Extensions are independent** | Each modality separately published and installable |
| **Zero prompt engineering** | New tool registration → system prompt auto-regenerates |
| **Remote-first** | Works locally, SSH, devcontainer, Codespaces without changes |

---

## Security Model

- **Loopback only** — Hub listens on `127.0.0.1` only
- **Origin validation** — must be `http://localhost:*` or `http://127.0.0.1:*`
- **Bearer token** — MCP clients authenticate with `Authorization: Bearer <token>`
- **Bridge secret** — `x-accordo-secret` header for Bridge↔Hub WebSocket auth
- **No VSCode imports in Hub** — Hub remains editor-agnostic

---

## Credential Rotation (Reauth)

Without Hub respawn, Bridge can rotate credentials:

```
POST /bridge/reauth
Headers: x-accordo-secret: <current-secret>
Body: { "newToken": "...", "newSecret": "..." }
```

Hub atomically replaces `ACCORDO_TOKEN` and `ACCORDO_BRIDGE_SECRET` → Bridge reconnects with new credentials.

---

## Tool Registration Flow

1. **Extension loads** → registers tools via `BridgeAPI.registerTools()`
2. **Bridge strips handlers** → sends only `ToolRegistration` (data, not functions) to Hub
3. **Hub registers** → tool added to registry, included in next system prompt
4. **Agent calls tool** → Hub routes call through Bridge → VSCode command
5. **Result returned** → reverse path back to agent

---

## Modalities (Phase 1)

| Extension | Tools | Status |
|---|---|---|
| `accordo-editor` | 16 (open, split, terminal, layout...) | ✅ Live |
| `accordo-voice` | Voice TTS/STT, narration scripts | ✅ Live |
| `accordo-comments` | Review threads, replies, resolve | ✅ Live |
| `accordo-diagram` | Mermaid diagrams, rendering | ✅ Live |
| `accordo-browser` | CDP-based page inspection | ✅ Live |
| `accordo-marp` | Presentation, slide narration | ✅ Live |
| `accordo-md-viewer` | Markdown preview with comments | ✅ Live |

---

## What's Next — Phase 2 Priorities

1. **Tab-scoped targeting** — agent context survives tab switches
2. **diff_snapshots fix** — CDP DOM diff reimplementation
3. **Tool registration verification** — live E2E smoke tests
4. **Bottom panel control** — toggle terminal/output/problems
5. **md-viewer MCP tool** — programmatic preview control

---

<!-- _class: lead -->

# Questions?

**Docs:** `/data/projects/accordo/docs/10-architecture/architecture.md`  
**Workplan:** `/data/projects/accordo/docs/00-workplan/workplan.md`