---
title: "Accordo IDE — Architecture Deep Dive"
theme: default
colorSchema: dark
transition: slide-left
layout: cover
background: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920
---

# Accordo IDE

Architecture of an AI-Native Development Environment

<div class="pt-8 text-sm opacity-60">
  Technical Overview · 2025
</div>

<!-- notes -->
Welcome. Accordo IDE is an AI-native layer on top of VS Code that gives agents direct, structured access to the editor through the Model Context Protocol. Let me walk you through the architecture. (~30 sec)

---
transition: fade
---

# Agenda

<div class="w-16 h-1 bg-blue-400 rounded mb-8"></div>

<v-clicks>

1. **Vision** — what Accordo enables
2. **Architecture** — the three-layer design
3. **Packages** — what each one does
4. **MCP tools** — how agents interact
5. **Modalities** — editor, comments, presentations
6. **Roadmap** — what's next

</v-clicks>

<!-- notes -->
Six sections. We'll start with why, then how, then what's coming. (~30 sec)

---
layout: center
---

# The Vision

<div class="text-2xl mt-8 max-w-xl mx-auto text-center leading-relaxed">

> "Give AI agents the same capabilities <br/>
> a human developer has in their IDE."

</div>

<div class="w-16 h-1 bg-blue-400 rounded mx-auto mt-8"></div>

<!-- notes -->
This is the core vision. Today's AI coding assistants can suggest code, but they can't open files, run terminal commands, navigate presentations, or place comments on specific lines. Accordo bridges that gap using MCP — the Model Context Protocol. (~1 min)

---

# Three-Layer Architecture

```mermaid {scale: 0.85}
graph TB
  subgraph Agent["🤖 AI Agent"]
    LLM[Language Model]
  end
  subgraph Hub["📡 Accordo Hub"]
    MCP[MCP Server]
    Auth[Auth Middleware]
    Registry[Tool Registry]
  end
  subgraph VSCode["💻 VS Code"]
    Bridge[Accordo Bridge]
    Editor[Editor Tools]
    Comments[Comment System]
    Slidev[Presentation Tools]
  end
  LLM -->|"MCP protocol"| MCP
  MCP --> Auth --> Registry
  Registry <-->|"WebSocket"| Bridge
  Bridge --> Editor
  Bridge --> Comments
  Bridge --> Slidev
```

<!-- notes -->
Three layers. The Hub is a standalone Node.js server that speaks MCP — it's editor-agnostic. The Bridge is a VS Code extension that connects the editor to the Hub over WebSocket. Below the Bridge sit the tool packages: editor tools, comment system, and presentation tools. An agent connects to the Hub, discovers available tools, and calls them. The Hub routes calls to the Bridge, which executes them in VS Code. (~3 min)

---
layout: two-cols
---

# Packages

::left::

### Core
- 🔵 **bridge-types** — shared TypeScript types
- 📡 **hub** — MCP server, auth, routing
- 🔗 **bridge** — VS Code ↔ Hub connector

### Tools
- ✏️ **editor** — 16 file/terminal/layout tools
- 💬 **comments** — thread-based collaboration

::right::

### Modalities
- 🎬 **slidev** — presentation engine (9 tools)
- 📝 **md-viewer** — markdown rendering
- 💬 **comment-sdk** — browser-side comment UI

### Conventions
- Monorepo with `pnpm` workspaces
- Each package independently testable
- Bridge-types is the only shared dependency

<!-- notes -->
Eight packages, each with a clear responsibility. The key architectural rule: Hub never imports VS Code APIs. It's editor-agnostic. Bridge-types is the contract layer — only data types cross package boundaries, never handler functions. (~2 min)

---

# MCP Tool Categories

<div class="grid grid-cols-2 gap-6 mt-6">
  <div class="border border-blue-500/20 rounded-xl p-5 bg-blue-500/5">
    <div class="text-2xl mb-2">✏️</div>
    <h3 class="font-semibold text-blue-300">Editor (16 tools)</h3>
    <p class="text-sm opacity-60 mt-1">Open, close, save, format, highlight, scroll, split, focus, reveal</p>
  </div>
  <div class="border border-emerald-500/20 rounded-xl p-5 bg-emerald-500/5">
    <div class="text-2xl mb-2">💬</div>
    <h3 class="font-semibold text-emerald-300">Comments (6 tools)</h3>
    <p class="text-sm opacity-60 mt-1">Create, reply, resolve, delete, list, discover</p>
  </div>
  <div class="border border-amber-500/20 rounded-xl p-5 bg-amber-500/5">
    <div class="text-2xl mb-2">🎬</div>
    <h3 class="font-semibold text-amber-300">Presentation (9 tools)</h3>
    <p class="text-sm opacity-60 mt-1">Open, close, navigate, list, discover, narrate</p>
  </div>
  <div class="border border-purple-500/20 rounded-xl p-5 bg-purple-500/5">
    <div class="text-2xl mb-2">🖥️</div>
    <h3 class="font-semibold text-purple-300">Terminal & Layout</h3>
    <p class="text-sm opacity-60 mt-1">Open terminal, run commands, manage panels, zen mode</p>
  </div>
</div>

<!-- notes -->
Over 30 MCP tools organized into four categories. Editor tools handle file operations. Comment tools enable threaded collaboration. Presentation tools control Slidev decks. Terminal and layout tools manage the workspace environment. An agent can combine these — for example, open a file, highlight a section, create a comment thread, then present findings in a deck. (~2 min)

---

# How a Tool Call Flows

```mermaid {scale: 0.85}
sequenceDiagram
  participant Agent
  participant Hub
  participant Bridge
  participant VSCode as VS Code

  Agent->>+Hub: MCP tool call
  Hub->>Hub: Auth check
  Hub->>+Bridge: WebSocket forward
  Bridge->>+VSCode: VS Code API
  VSCode-->>-Bridge: Result
  Bridge-->>-Hub: Response
  Hub-->>-Agent: MCP result
```

<!-- notes -->
Here's the complete flow. The agent makes an MCP tool call. The Hub authenticates it, then forwards over WebSocket to the Bridge. The Bridge translates it into VS Code API calls, gets the result, and sends it back up the chain. The entire round-trip is typically under 50ms for local connections. (~1 min)

---

# Key Numbers

<div class="grid grid-cols-3 gap-8 mt-12 text-center">
  <div>
    <div class="text-5xl font-bold text-blue-400">30+</div>
    <div class="text-sm mt-3 opacity-60">MCP Tools</div>
  </div>
  <div>
    <div class="text-5xl font-bold text-emerald-400">8</div>
    <div class="text-sm mt-3 opacity-60">Packages</div>
  </div>
  <div>
    <div class="text-5xl font-bold text-amber-400">&lt;50ms</div>
    <div class="text-sm mt-3 opacity-60">Tool Call Latency</div>
  </div>
</div>

<!-- notes -->
The numbers. Over 30 tools across all packages. Eight independent packages in the monorepo. Sub-50-millisecond latency for local tool calls. (~30 sec)

---

# Roadmap

<v-clicks>

```mermaid
timeline
  title Accordo IDE Roadmap
  Phase 1 : Hub + Bridge
          : Editor Tools
          : Core MCP Server
  Phase 2 : Comment System
          : Comment SDK
          : Thread-based Collaboration
  Phase 3 : Presentations
          : Slidev Integration
          : Narration + Navigation
  Phase 4 : Voice + Diagrams
          : TTS Narration Playback
          : Canvas Annotations
  Phase 5 : Browser + Testing
          : Playwright Integration
          : Automated QA
```

</v-clicks>

<!-- notes -->
The roadmap. Phase 1 established the core: Hub, Bridge, and editor tools. Phase 2 added the comment system for human-agent collaboration. Phase 3, where we are now, added presentation capabilities. Phases 4 and 5 will add voice synthesis, diagram annotations, and browser automation. (~1 min)

---
layout: end
---

# Thank You

<div class="text-sm opacity-60 mt-4">
  Accordo IDE — AI-native development, structured by MCP
</div>
