# MCP Tools — What Each One Returns

**Date:** 2026-03-29  
**Purpose:** document what each MCP tool actually returns, and flag the layout_state bloat issue.

---

## MCP Tools Overview

The Hub exposes the standard MCP protocol over HTTP+SSE. Agents call these via JSON-RPC `tools/call`.

### `initialize`
Returns server info + full system prompt (instructions).

**Returns:**
```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": { "name": "accordo", "version": "0.1.0" },
  "capabilities": { "tools": { "listChanged": true } },
  "instructions": "## Voice narration directive...\n## Open Comment Threads...\n<live IDE state summary>...\n<tool list>"
}
```

The `instructions` field is the rendered system prompt — it includes a live summary of open comment threads (truncated, ~5 threads), voice state, diagram state, and the full tool list. This is what drives agent awareness.

**Size:** small (~5–20 KB typically)

---

### `tools/list`
Returns the registry of all available tools from all connected extensions.

**Returns:**
```json
{ "tools": [ { "name": "comment_list", "description": "...", "inputSchema": {...} }, ... ] }
```

**Size:** small. Number of tools varies by installed extensions (typically 20–40 tools).

---

### `tools/call`
Generic tool invocation. Routes to Bridge → extension handler.

**Params:** `{ "name": "tool-name", "arguments": { ... } }`

**Returns (success):**
```json
{
  "content": [{ "type": "text", "text": "{\"key\":\"value\",...}" }]
}
```
Tool results are JSON-stringified inside the text content block.

**Returns (error):**
```json
{ "content": [{ "type": "text", "text": "error message" }], "isError": true }
```

---

### `ping`
Always returns `{}`. Used to check if the server is alive.

---

## HTTP Endpoints (not MCP JSON-RPC, but agent-accessible)

### `GET /mcp`
SSE stream for server-initiated notifications (e.g. `notifications/tools/list_changed` when bridge reconnects).

### `GET /instructions`
Returns the rendered system prompt (same text as `initialize` instructions field).

**Returns:** raw markdown text.

---

### `GET /state`
**THIS IS WHERE THE BLOAT LIVES.**

Returns the full IDE state snapshot including **all modality state**.

```json
{
  "activeFile": "/path/to/file.ts",
  "activeFileLine": 42,
  "activeFileColumn": 8,
  "openEditors": ["/path/to/file.ts"],
  "openTabs": [{ "label": "file.ts", "type": "text", "path": "...", ... }],
  "visibleEditors": [],
  "workspaceFolders": ["/data/projects/accordo-browser2.0"],
  "activeTerminal": "zsh",
  "workspaceName": "accordo-browser2.0",
  "remoteAuthority": null,
  "modalities": {
    "accordo-comments": {
      "isOpen": true,
      "openThreadCount": 364,
      "resolvedThreadCount": 38,
      "summary": [ { "threadId": "...", "uri": "...", "preview": "..." }, ... ],
      "tools": "Review-thread tools: comment_list | comment_get ...",
      "threads": [ /* FULL THREAD OBJECTS — ~290 KB */ ]
    },
    "accordo-voice": { "session": "idle", "audio": "idle", ... },
    "accordo-marp": { "isOpen": false, ... },
    "accordo-diagram": { "isOpen": false, ... }
  },
  "commentThreads": [ /* SAME FULL ARRAY — hoisted at top level */ ]
}
```

**Size:** ~297 KB in current workspace (99.5% from `accordo-comments.threads`).

---

### `GET /health`
Unauthenticated liveness check.

```json
{ "status": "ok", "uptime": 12345 }
```

---

## The Bloat Problem

### Root cause

In `packages/comments/src/state-contribution.ts`, `buildCommentSummary()` publishes **the complete thread list** into modality state:

```ts
// state-contribution.ts line 79
threads: allThreads,  // ← full thread objects, not summaries
```

This is intentional for the `/state` debug endpoint (M43 hoists it to top-level), but it makes `layout_state` catastrophically heavy.

### Why it matters

`layout_state` is supposed to answer: *"what panes/tabs/terminals are open right now?"* It should be a few KB at most.

Instead it carries ~290 KB of comment thread data because the comments modality unconditionally publishes its full state into the shared `IDEState.modalities` blob.

### The fix is straightforward

1. **`state-contribution.ts`:** Remove `threads: allThreads` from the summary. The `summary` array (5 most recent threads, truncated preview) is sufficient for the system prompt.

2. **`hub/src/server.ts` `handleState`:** Remove the `commentThreads` hoist from `modalities`.

3. **Dedicated tools** already exist for comment data:
   - `comment_list` — paginated, filterable thread list
   - `comment_get` — single thread with all comments
   - `comment_create`, `comment_reply`, `comment_resolve`, `comment_delete`, `comment_reopen`

4. **If a debug endpoint needs full threads:** create a separate `GET /state/comments` that fetches just that data on demand.

### After fix, `layout_state` would look like

```json
{
  "activeFile": "/path/to/file.ts",
  "activeFileLine": 42,
  "activeFileColumn": 8,
  "openEditors": ["/path/to/file.ts"],
  "openTabs": [{ "label": "file.ts", "type": "text", "path": "...", ... }],
  "visibleEditors": [],
  "workspaceFolders": ["/data/projects/accordo-browser2.0"],
  "activeTerminal": "zsh",
  "workspaceName": "accordo-browser2.0",
  "remoteAuthority": null,
  "modalities": {
    "accordo-comments": {
      "isOpen": true,
      "openThreadCount": 364,
      "resolvedThreadCount": 38,
      "summary": [ { "threadId": "...", "preview": "..." }, ... ],
      "tools": "Review-thread tools: comment_list | ..."
    },
    "accordo-voice": { "session": "idle", ... },
    "accordo-marp": { "isOpen": false, ... },
    "accordo-diagram": { "isOpen": false, ... }
  }
}
```

**Size:** ~5–15 KB. Modality data stays summary-only.

---

## Summary Table

| Tool / Endpoint | Purpose | Typical Size |
|---|---|---|
| `initialize` | Server info + system prompt + tool list | ~5–20 KB |
| `tools/list` | All registered tool definitions | ~3–10 KB |
| `tools/call` | Invoke any tool, returns tool result | tool-dependent |
| `ping` | Liveness check | ~20 bytes |
| `GET /mcp` (SSE) | Server → agent notifications | event-driven |
| `GET /instructions` | Raw system prompt text | ~5–20 KB |
| **`GET /state`** | **Full IDE state + all modality data** | **~300 KB (problem)** |
| `GET /health` | Liveness | ~50 bytes |
