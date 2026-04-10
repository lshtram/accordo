---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Accordo IDE

## The editor where AI is a first-class participant

*Not a chat sidebar. A desk.*

<!-- notes -->
Welcome to Accordo. In the next few minutes we'll cover the problem we're solving, how the system works, and what it looks like in practice. (~30 sec)

---

![bg right:48% brightness:0.7](https://images.unsplash.com/photo-1618609377864-68609b857e90?w=1200&auto=format&fit=crop)

# The Problem

Every AI coding tool gives the agent a **chat box**.

- The agent can read code
- The agent can write code
- But the agent **cannot see, navigate, or control the editor**

> "The cursor is human. The AI is a passenger."

<!-- notes -->
The fundamental limitation: today's AI tools are writers, not participants. They can generate text but have no agency in the environment where the work actually happens. (~45 sec)

---

<!-- _class: invert -->

# <!-- fit --> We gave it a desk.

<!-- notes -->
Short pause for impact. This is the core thesis. (~15 sec)

---

# How It Works

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5rem;margin-top:1.5rem;text-align:center">
<div>

### Hub
MCP server — the control plane

Runs standalone, editor-agnostic

Exposes all tools via MCP Streamable HTTP

</div>
<div>

### Bridge
VS Code extension

Connects Hub ↔ Editor via WebSocket

Routes tool calls → VS Code API

</div>
<div>

### Extensions
Independent tool packs

16 editor/terminal tools out of the box

Register automatically — no config

</div>
</div>

<!-- notes -->
Three-layer architecture. Hub is the brain. Bridge is the nerve. Extensions are the hands. (~1 min)

---

![bg left:42% brightness:0.6](https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&auto=format&fit=crop)

# 64 Tools. One Protocol.

Every tool the agent needs — **unified under MCP**.

- Open, scroll, split, highlight files
- Run terminal commands
- Manage editor layout
- Create diagrams
- Control presentations
- Read browser state

*Any MCP-capable agent connects without modification.*

<!-- notes -->
64 tools across all registered extensions. GitHub Copilot, Cursor, Windsurf — they all speak MCP. No special integration needed. (~1 min)

---

# Zero Configuration

<div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:1.5rem">
<div>

**Before Accordo**

```
1. Install agent tool
2. Configure MCP server URL
3. Write system prompt manually
4. Keep prompt in sync as tools change
5. Repeat per agent
```

</div>
<div>

**With Accordo**

```
1. Install Bridge extension
   → Hub auto-starts
   → System prompt auto-generates
   → Every MCP agent auto-connects
```

</div>
</div>

<!-- notes -->
The system prompt regenerates automatically whenever a new extension registers tools. No manual configuration. (~45 sec)

---

# Live IDE State

The agent always knows what's open.

```json
{
  "openFiles": ["src/server.ts", "src/routes/api.ts"],
  "activeFile": "src/server.ts",
  "cursorLine": 42,
  "terminals": [{ "name": "dev", "cwd": "/project" }],
  "gitBranch": "feat/mcp-tools"
}
```

Bridge pushes a fresh snapshot on every editor event.
Hub exposes it as part of the agent's context.

<!-- notes -->
The agent isn't guessing what's open. It knows — because the Bridge pushes IDE state to the Hub continuously. (~45 sec)

---

<!-- _class: section -->

# In Practice

Three real examples

<!-- notes -->
Let's make this concrete. (~10 sec)

---

# Example 1 — Code Review

The agent opens two files side by side, highlights the changed lines, and explains the diff — **without the human moving the cursor**.

```
accordo_editor_open   → opens src/server.ts in editor group 1
accordo_editor_split  → splits right
accordo_editor_open   → opens src/server.old.ts in group 2
accordo_editor_highlight → marks lines 40-55 in red
```

<!-- notes -->
A code review that shows rather than tells. The agent controls the view — the human watches and responds. (~1 min)

---

# Example 2 — Debugging Session

```
accordo_terminal_open  → creates terminal "debug"
accordo_terminal_run   → runs `npm test -- --watch`
accordo_editor_open    → opens the failing test file
accordo_editor_highlight → marks the assertion line
```

The agent watches the test output, locates the failure, and opens the exact file and line — in one shot.

<!-- notes -->
The agent isn't just reading logs pasted into chat. It's driving the terminal and the editor simultaneously. (~1 min)

---

# Example 3 — This Presentation

This deck was created and narrated by an AI agent using:

```
accordo_presentation_open  → opened the .md file
accordo_presentation_goto  → navigated to each slide
accordo_voice_readAloud    → spoke the narration
```

*The agent created the content, structured the slides, opened the viewer, and presented it — all from a single conversation.*

<!-- notes -->
Meta example — the presentation skill itself. The agent is the presenter. (~45 sec)

---

# By the Numbers

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.5rem;margin-top:2rem;text-align:center">
<div>

## 64
**MCP tools**

</div>
<div>

## 3
**Core packages**

</div>
<div>

## <1ms
**Hub latency**

</div>
<div>

## 0
**Config steps**

</div>
</div>

<!-- notes -->
Quick numbers. 64 tools, 3 packages, sub-millisecond Hub latency, zero manual configuration. (~30 sec)

---

<!-- _class: lead -->

# Get Started

```bash
# Install the Bridge extension in VS Code
# Any MCP agent connects automatically

code --install-extension accordo.accordo-bridge
```

**GitHub:** `accordo/accordo`
**Docs:** `https://accordo.dev`

<!-- notes -->
One install. The rest is automatic. (~30 sec)
