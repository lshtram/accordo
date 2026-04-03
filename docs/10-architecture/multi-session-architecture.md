# Accordo IDE — Multi-Session Architecture (Ephemeral Hub Model)

**Status:** DRAFT — pending user review  
**Date:** 2026-04-02  
**Scope:** Hub lifecycle, multi-session behaviour, token/credential management  
**Supersedes:** architecture.md §§3.2, 4.3, 6.5, 7.1, 9 (lifecycle and credential portions)  
**Companion to:** architecture.md (canonical system architecture — not replaced, only amended)

---

## 1. Executive Summary

### Non-Technical

Accordo IDE places an AI co-pilot layer on top of VSCode. The Hub is the "brain" — it
receives what the editor sees, knows what tools are available, and talks to AI agents.

In the **ephemeral model**, the Hub lives and dies with the VSCode window. When you open
VSCode, a fresh Hub starts. When you close VSCode, the Hub stops. Every AI session
(OpenCode, Claude Code, Copilot) that was using the Hub loses its connection. They must
reconnect when VSCode restarts.

This means:
- **No stale processes.** No orphaned Hubs consuming memory after VSCode crashes.
- **No shared-state confusion.** Each VSCode window has exactly one Hub. No cross-window interference.
- **No persistent token files.** The bearer token exists only in opencode.json (and equivalent agent config files) inside the project folder. Nothing is written to `~/.accordo/token`.

The trade-off is that AI sessions cannot survive a VSCode restart. An OpenCode session that
was mid-conversation when VSCode closes will see its MCP connection fail. It must detect
this and prompt the user or reconnect when the new Hub appears.

### Technical

This document specifies the ephemeral Hub lifecycle model:

1. **Hub lifecycle is bound to Bridge `deactivate()`.** When VSCode shuts down, the Bridge
   kills the Hub process. This reverses the previous LCM-11 ("do NOT kill Hub on deactivate").
2. **No `~/.accordo/` persistence.** No token file, no PID file, no port file. All Hub
   discovery happens through workspace-local config files (opencode.json, .claude/mcp.json,
   .vscode/mcp.json) and VSCode SecretStorage.
3. **Token is ephemeral.** Generated per Hub spawn, stored in VSCode SecretStorage and
   written to workspace config files. Never persisted to the home directory.
4. **Port discovery** uses a Hub-to-Bridge callback via stdout, eliminating the port file.
5. **`/bridge/reauth` is retained** for the `accordo.hub.restart` command (soft rotation
   without killing the Hub), but is no longer needed for cross-session persistence.

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Hub** | The standalone Node.js process running the MCP server and WebSocket server. |
| **Bridge** | The VSCode extension (`accordo-bridge`) that spawns and manages the Hub. |
| **AI session** | A single agent process connected to the Hub via MCP (OpenCode, Claude Code, Copilot chat, etc.). |
| **VSCode session** | One VSCode window. Has exactly one Bridge extension instance. |
| **Workspace** | A VSCode workspace (folder or `.code-workspace` file). Maps to one project root. |
| **Config file** | Workspace-local file written by Bridge: `opencode.json`, `.claude/mcp.json`, `.vscode/mcp.json`. |

---

## 3. Hub Lifecycle — Ephemeral Model

### 3.1 Core Invariant

> **The Hub process exists if and only if its owning VSCode window is open.**

There is no mechanism for the Hub to outlive its Bridge. There is no mechanism for a Hub
to be "adopted" by a different Bridge instance. Each Bridge owns exactly one Hub.

### 3.2 Startup Sequence

```
VSCode opens workspace
  │
  ├── 1. accordo-bridge activates (onStartupFinished)
  │
  ├── 2. Read ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN from SecretStorage
  │      (If absent: generate new ones, persist immediately — LCM-01)
  │
  ├── 3. Check if Hub is already running: GET http://localhost:{port}/health
  │      │
  │      ├── YES, healthy:
  │      │   ├── Attempt WS connect with stored secret
  │      │   │   ├── WS OK → skip to step 6 (session resumes)
  │      │   │   └── WS 4001 (auth fail) → Hub is orphaned/foreign
  │      │   │       ├── Kill process (if PID known) or send SIGTERM
  │      │   │       └── Fall through to step 4
  │      │   └── Health check timeout → fall through to step 4
  │      │
  │      └── NO (connection refused / timeout):
  │          └── Fall through to step 4
  │
  ├── 4. Generate fresh credentials
  │      ├── ACCORDO_BRIDGE_SECRET = crypto.randomUUID()
  │      ├── ACCORDO_TOKEN = crypto.randomBytes(32).toString('hex')
  │      └── Persist both to VSCode SecretStorage
  │
  ├── 5. Spawn Hub
  │      ├── execFile(nodePath, [hubEntry, '--port', port], {
  │      │     env: { ACCORDO_BRIDGE_SECRET, ACCORDO_TOKEN, ACCORDO_HUB_PORT }
  │      │   })
  │      ├── Hub finds free port (tries up to 20 ports from configured base)
  │      ├── Hub prints actual port to stderr: "[hub] Listening on 127.0.0.1:<port>"
  │      ├── Bridge polls GET /health at 500ms intervals (max 10s)
  │      │   ├── Try configured port first
  │      │   ├── If health fails, parse Hub stderr for actual port
  │      │   └── Once healthy, record actual port
  │      └── If timeout → show error notification, abort
  │
  ├── 6. Connect WebSocket: ws://localhost:{actualPort}/bridge
  │      headers: { "x-accordo-secret": secret }
  │
  ├── 7. Send stateSnapshot (full IDEState + protocolVersion)
  │
  ├── 8. Send toolRegistry (all registered tools)
  │
  ├── 9. Register native MCP server (Copilot)
  │
  └── 10. Write agent config files (opencode.json, .claude/mcp.json, .vscode/mcp.json)
          with actual port + token
```

### 3.3 Shutdown Sequence

```
VSCode window closing / deactivate() called
  │
  ├── 1. Close WebSocket connection (graceful close frame)
  │
  ├── 2. Kill Hub child process (killHub())
  │      ├── If Hub is a direct child: process.kill(childPid, 'SIGTERM')
  │      ├── Wait up to 2s for exit (setTimeout + 'exit' event listener)
  │      └── If still alive after 2s: process.kill(childPid, 'SIGKILL')
  │
  └── 3. Clean up config files (OPTIONAL — see DECISION-MS-05)
         ├── Delete opencode.json (credential is now invalid)
         ├── Remove accordo entry from .claude/mcp.json
         └── Remove accordo entry from .vscode/mcp.json
```

**Implementation note:** `deactivate()` must be `async` to await the kill sequence.
VSCode allows up to 5 seconds for `deactivate()` to complete — the 2-second SIGTERM
grace period fits within this budget with margin for the WS close and cleanup steps.

**DECISION-MS-01: Kill Hub on deactivate.**  
This reverses the previous LCM-11 ("Do NOT kill Hub on deactivate; it may serve CLI agents").
In the ephemeral model, there is no expectation that the Hub outlives VSCode. CLI agents
that lose their connection must reconnect when the user reopens VSCode.

**Rationale:**
- Eliminates orphaned Hub processes after VSCode crash/force-quit
- Eliminates stale token files that accumulate in `~/.accordo/`
- Simplifies the lifecycle to a clean ownership model: Bridge owns Hub, period
- The "CLI agent survives VSCode restart" use case is explicitly deprioritised

### 3.4 Crash Recovery

| Scenario | Behaviour |
|---|---|
| Hub process crashes (exit event) | Bridge detects via `child_process` exit event. Generate new credentials, attempt single restart (LCM-10). |
| VSCode graceful quit / crash (no clean deactivate) | Hub receives SIGHUP (terminal/PTY death) or detects IPC disconnect. Hub's SIGHUP handler calls `process.exit(0)`. Hub dies. Next VSCode open starts fresh. |
| VSCode SIGKILL / OOM-killed | SIGHUP is **not delivered** when the parent process is killed via SIGKILL (the PTY is destroyed without a hangup signal). The Hub process becomes an orphan. This is an **accepted risk** — the orphaned Hub is detected and killed at the next VSCode startup via the health check + WS auth failure path (§3.2, step 3: WS 4001 → Hub is orphaned/foreign → kill and respawn). |
| Power failure | Hub dies with the OS. No PID file to go stale. Next boot is clean. |

**DECISION-MS-02: Hub orphan prevention via SIGHUP + IPC disconnect (best-effort).**  
The Hub already disconnects the IPC channel at startup (architecture.md index.ts line 271)
and handles SIGHUP (line 278). These two mechanisms handle the **common** case: when
VSCode exits gracefully or crashes (the PTY closes, SIGHUP fires, Hub terminates). However,
SIGHUP is **not delivered** when the parent process is killed via SIGKILL or OOM-killed —
the kernel destroys the process without closing the PTY cleanly. In this case the Hub
becomes an orphan until the next VSCode startup, when the health check + WS 4001 auth
failure path (§3.2 step 3) detects and kills it. This is an **accepted risk** — no PID
file needed for orphan detection because the startup health-check path handles it.

**Rationale:**
- Hub's existing `process.disconnect()` at startup prevents the 100% CPU spin on dead IPC fd
- SIGHUP fires when the controlling terminal (VSCode's PTY) closes — covers graceful quit and most crash scenarios
- SIGKILL/OOM orphan case is mitigated at next startup via health check + WS auth failure
- Together, these cover all scenarios without any `~/.accordo/` state, though SIGKILL orphans persist until next VSCode activation

---

## 4. Credential and Token Design

### 4.1 Token Lifecycle

```
Bridge generates token
       │
       ├── Stored in VSCode SecretStorage (key: "accordo.hubToken")
       │   └── Survives VSCode reload within same window
       │   └── Does NOT survive VSCode window close + reopen (new token generated)
       │
       ├── Passed to Hub via ACCORDO_TOKEN env var at spawn
       │   └── Hub holds in memory only
       │   └── Hub does NOT write token to ~/.accordo/token
       │
       └── Written to workspace config files by Bridge
           ├── opencode.json        → mcp.accordo.headers.Authorization
           ├── .claude/mcp.json     → mcpServers.accordo.headers.Authorization
           └── .vscode/mcp.json     → servers.accordo.headers.Authorization
```

**DECISION-MS-03: Token lives only in SecretStorage + config files. No `~/.accordo/token`.**  
The token is an ephemeral secret. It is valid only for the lifetime of the current Hub
process. Writing it to `~/.accordo/token` creates a stale credential after Hub death and
provides a misleading discovery mechanism for agents.

**Rationale:**
- Eliminates stale token files (the #1 source of "why won't my agent connect?" confusion)
- Token in opencode.json is sufficient — that's where agents read it
- Remote topologies (SSH, devcontainer) need separate treatment anyway (§7)
- Reduces the attack surface — no world-readable token file in a predictable location

### 4.2 Two-Credential Architecture (Unchanged)

The two-credential model is retained from the current architecture:

| Credential | Purpose | Generated by | Stored in |
|---|---|---|---|
| `ACCORDO_BRIDGE_SECRET` | WebSocket auth (Bridge ↔ Hub) | Bridge | SecretStorage + env var |
| `ACCORDO_TOKEN` | HTTP bearer auth (Agent → Hub) | Bridge | SecretStorage + env var + config files |

These are separate because they protect different attack surfaces:
- `ACCORDO_BRIDGE_SECRET` authenticates the single privileged WebSocket client (Bridge)
- `ACCORDO_TOKEN` authenticates MCP HTTP requests from any agent

### 4.3 Token Rotation (Soft Restart)

The `accordo.hub.restart` command performs a soft rotation without killing the Hub:

```
User triggers "Accordo: Restart Hub"
  │
  ├── 1. Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN
  │
  ├── 2. POST /bridge/reauth (with current secret)
  │      Body: { "newSecret": "<new-secret>", "newToken": "<new-token>" }
  │      └── Hub atomically updates both credentials in memory
  │
  ├── 3. Persist new credentials to SecretStorage
  │
  ├── 4. Close and reconnect WS with new secret
  │
  └── 5. Rewrite agent config files with new token
```

**DECISION-MS-04: Retain `/bridge/reauth` for soft restart.**  
Even though the Hub is ephemeral, the soft restart is valuable:
- Agents don't lose their MCP session when the user restarts the Hub
- The Hub process stays alive — no startup latency
- Only the credentials rotate

The reauth endpoint no longer writes to `~/.accordo/token` (no file to update).

---

## 5. Port Discovery

### 5.1 Problem

The Hub may not bind to the configured port (another process holds it). The Hub tries up
to 20 consecutive ports. The Bridge needs to know the actual port to:
1. Connect WebSocket
2. Write agent config files with the correct URL

### 5.2 Solution: Health Poll with stderr Fallback

```
Bridge spawns Hub with --port <configured>
  │
  ├── Hub calls findFreePort(configured, host) — tries up to 20 ports
  │
  ├── Hub prints to stderr: "[hub] Listening on 127.0.0.1:<actualPort>"
  │   └── Also: "[hub] Port <configured> in use — using <actualPort>" if different
  │
  ├── Bridge polls GET /health on configured port (500ms intervals)
  │   │
  │   ├── If responds → actual port = configured port
  │   │
  │   └── If no response after 3 attempts:
  │       ├── Parse Hub's stderr output for actual port
  │       ├── Poll GET /health on parsed port
  │       └── If responds → actual port = parsed port
  │
  └── Bridge stores actual port in memory (not on disk)
```

**DECISION-MS-06: No `~/.accordo/hub.port` file. Use stderr parsing + health poll.**  
The port file was part of the `~/.accordo/` persistence model which is being removed.
The Bridge spawns the Hub as a child process and has direct access to its stderr stream.
Parsing the port from stderr is simpler and more reliable than a file race.

**Alternative considered:** Hub writes port to stdout as structured JSON (e.g.
`{"event":"listening","port":3001}`). This would be cleaner but conflicts with stdio mode
where stdout is reserved for JSON-RPC. Using stderr avoids any ambiguity.

---

## 6. Multi-Session Scenarios

### Scenario A: Multiple AI Sessions, Same VSCode Window

```
┌────────────────────────────────────────────────────┐
│  VSCode Window                                      │
│  ┌──────────────┐                                   │
│  │ accordo-bridge│──WS──┐                            │
│  └──────────────┘       │                            │
└─────────────────────────┼────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │     accordo-hub       │
              │   (single process)    │
              ├───────────────────────┤
              │  POST /mcp            │
              │  GET /instructions    │
              │  WS /bridge           │
              └───┬────────┬────────┬─┘
                  │        │        │
          ┌───────▼──┐ ┌───▼────┐ ┌─▼──────────┐
          │ OpenCode │ │ Claude │ │ Copilot    │
          │ Session  │ │ Code   │ │ (native    │
          │          │ │        │ │  MCP)      │
          └──────────┘ └────────┘ └────────────┘
```

**Behaviour:**
- All agents share the same Hub, same state, same tools, same token
- Each agent has an independent MCP session (session ID)
- Tool calls from different agents are subject to the shared concurrency limit (16 in-flight)
- When VSCode closes, all agents lose connection simultaneously
- On next VSCode open: new Hub, new token, new config files → agents must reconnect

**No changes from current architecture.** This scenario works identically.

### Scenario B: Multiple VSCode Windows (Multi-Project)

```
┌──────────────────────┐          ┌──────────────────────┐
│  VSCode Window 1     │          │  VSCode Window 2     │
│  Project: foo/       │          │  Project: bar/       │
│  ┌──────────────┐    │          │  ┌──────────────┐    │
│  │ Bridge #1    │    │          │  │ Bridge #2    │    │
│  └──────┬───────┘    │          │  └──────┬───────┘    │
└─────────┼────────────┘          └─────────┼────────────┘
          │                                 │
  ┌───────▼───────┐                 ┌───────▼───────┐
  │  Hub #1       │                 │  Hub #2       │
  │  port: 3000   │                 │  port: 3001   │
  │  token: aaa   │                 │  token: bbb   │
  └───────────────┘                 └───────────────┘
          │                                 │
    foo/opencode.json                 bar/opencode.json
    token: aaa, port: 3000            token: bbb, port: 3001
```

**Behaviour:**
- Each VSCode window spawns its own Hub on a different port
- Dynamic port selection (`findFreePort`) handles port conflicts automatically
- Each workspace gets its own opencode.json with the correct port + token
- Agent sessions are fully isolated between projects
- Closing Window 1 kills Hub #1 but leaves Hub #2 and Window 2 unaffected

**Port range:** The Hub tries 20 consecutive ports starting from the configured base (default 3000).
With 2-3 VSCode windows, this is more than sufficient. For power users with many windows,
the range can be increased via configuration.

**DECISION-MS-07: Each VSCode window gets an independent Hub. No Hub sharing across windows.**  
This is a simplification over the previous model where a single Hub could theoretically
serve multiple VSCode windows. The ephemeral model makes sharing impractical:
- Each Bridge generates its own credentials
- Each Bridge kills its Hub on deactivate
- Cross-window Hub sharing would require a separate lifecycle manager outside VSCode

### Scenario C: OpenCode Session Lifecycle (VSCode Restart)

```
Timeline:
  t0  ─── VSCode open ─── Hub started (port 3000, token aaa)
  t1  ─── opencode.json written (port 3000, token aaa)
  t2  ─── OpenCode starts, reads opencode.json, connects to Hub
  t3  ─── OpenCode is mid-conversation, actively using tools
  t4  ─── User closes VSCode
  t5  ─── Bridge.deactivate() kills Hub
  t6  ─── OpenCode's next MCP request gets ECONNREFUSED
  t7  ─── OpenCode detects connection failure
          ├── Option A: OpenCode shows error, user must manually restart
          ├── Option B: OpenCode polls until Hub reappears (reconnect loop)
          ├── Option C: OpenCode exits session, user starts new one
  t8  ─── User reopens VSCode
  t9  ─── New Hub started (port 3000, token bbb)
  t10 ─── New opencode.json written (port 3000, token bbb)
  t11 ─── OpenCode reads new opencode.json, reconnects with new token
          (if Option B, this happens automatically)
```

**DECISION-MS-08: OpenCode reconnection strategy is "fail-and-reload".**  
When the Hub dies, OpenCode's MCP connection fails. The recommended behaviour is:

1. OpenCode detects ECONNREFUSED on its next MCP request
2. OpenCode logs an error and marks the MCP server as disconnected
3. When the user starts a new OpenCode session (or the existing session re-initializes),
   it re-reads opencode.json, which now has the new token and port
4. The new MCP connection succeeds

This is **Option A + partial Option B**: OpenCode's built-in MCP reconnection handles the
basic case. The key requirement is that OpenCode re-reads `opencode.json` on reconnect
rather than caching the token from the initial read.

**Why not a persistent Hub for this case?** The persistent Hub model required:
- PID files for orphan detection
- Token files for out-of-band credential sharing
- `~/.accordo/` directory management
- LCM-11's "don't kill Hub" exception

All of this complexity existed primarily to support the "OpenCode survives VSCode restart"
scenario. The ephemeral model trades this scenario for operational simplicity.

---

## 7. Remote Topology Implications

### 7.1 Token Discovery Without `~/.accordo/token`

In the previous model, remote agents (running on a different host than the Hub) could read
`~/.accordo/token` to get the bearer token. In the ephemeral model, this file doesn't exist.

**Remote topology token discovery:**

| Topology | Agent runs on | Hub runs on | Token source |
|---|---|---|---|
| Local | Developer machine | Developer machine | `opencode.json` in workspace root |
| SSH Remote | Developer machine (local terminal) | Remote host | Read `opencode.json` from remote workspace via SSH, or copy token manually |
| Dev Container | Host machine | Container | Read `opencode.json` from container workspace, or copy token via `docker exec` |
| Codespaces | Browser / local VSCode | Codespace VM | Read `opencode.json` from Codespace workspace via Codespace CLI |
| All remote | Remote host | Remote host | `opencode.json` in workspace root (same as Local) |

**DECISION-MS-09: Remote topology agents read token from workspace config files, not `~/.accordo/`.**  
For SSH Remote: `ssh user@host cat /path/to/project/opencode.json | jq '.mcp.accordo.headers.Authorization'`
This is slightly less convenient than the old `~/.accordo/token` (which was at a fixed path),
but it's more correct (the token is workspace-specific) and doesn't leak stale credentials.

### 7.2 Port Forwarding

Port forwarding requirements are unchanged from architecture.md §6.5. The agent must forward
the Hub's port to localhost:
- SSH: `ssh -L 3000:localhost:3000 user@host`
- Docker: `-p 3000:3000`
- Codespaces: automatic port forwarding

The port number is now always discoverable from the workspace config file rather than
`~/.accordo/hub.port`.

---

## 8. What Gets Removed from `~/.accordo/`

| File | Previous Purpose | Ephemeral Model Status |
|---|---|---|
| `~/.accordo/token` | Bearer token for out-of-band agent access | **REMOVED.** Token lives in workspace config files only. |
| `~/.accordo/hub.pid` | Orphan detection by Bridge on startup | **REMOVED.** Bridge detects orphans via health check + SIGHUP ensures Hub self-terminates. |
| `~/.accordo/hub.port` | Port discovery when Hub binds to a different port | **REMOVED.** Port discovered via stderr parsing + health poll. |
| `~/.accordo/audit.jsonl` | Audit log of tool invocations | **RETAINED.** Audit logging is valuable and non-credential. |
| `~/.accordo/logs/` | Hub log files | **RETAINED.** Log files are operational, not credential-related. |

**DECISION-MS-10: Retain `~/.accordo/` for logs and audit only.**  
The directory still exists for operational files (audit log, log files). Only credential
and lifecycle files (token, PID, port) are removed. The directory creation (`mode 0700`)
moves from Hub startup to audit/log initialization.

---

## 9. `/bridge/reauth` Endpoint Status

**RETAINED** with reduced scope.

| Aspect | Previous Model | Ephemeral Model |
|---|---|---|
| Primary use | Credential rotation without killing Hub | Same — for `accordo.hub.restart` command |
| Token file update | Hub writes new token to `~/.accordo/token` | Hub updates token in memory only |
| Cross-session persistence | Allows CLI agents to survive token rotation | Not applicable — Hub is ephemeral |
| Bridge config file rewrite | Bridge rewrites agent configs with new token | Same — config files updated after reauth |

The `updateToken()` method in `server.ts` is simplified: it updates the in-memory token
but no longer writes to `~/.accordo/token` (the `tokenFilePath` option is removed).

---

## 10. Config File Lifecycle

### 10.1 Write Timing

Config files are written:
1. On initial Hub startup (after health check passes) — step 10 in §3.2
2. On soft restart (`accordo.hub.restart`) — after `/bridge/reauth` succeeds
3. On Hub crash + auto-restart — after new Hub is healthy

### 10.2 Staleness Problem

When VSCode closes and the Hub dies, the workspace config files contain a dead token and
possibly a wrong port. The next VSCode open overwrites them with fresh values.

**Window of staleness:** Between VSCode close and next VSCode open, the config files are stale.
If an agent reads them during this window, it will get ECONNREFUSED (Hub not running) or
401 (wrong token). This is acceptable — the agent can't do anything useful without a running
Hub anyway.

**DECISION-MS-05: Do NOT delete config files on deactivate.**  
Deleting config files on VSCode shutdown is problematic:
- `deactivate()` has a 5-second timeout in VSCode — file I/O may not complete
- Agent processes may be reading the files at the moment of deletion (race condition)
- The files will be overwritten on next activation anyway
- Stale files with a dead Hub are harmless — all requests fail with connection refused

### 10.3 opencode.json Schema

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "accordo": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}
```

Note: `instructions_url` was removed in a previous revision because opencode's strict
JSON schema validation rejects unknown keys. The Hub instructions are loaded via the
`instructions` array if needed.

---

## 11. Changes from Previous Architecture

### Summary of Reversals

| Previous (Persistent Hub) | New (Ephemeral Hub) | Affected Docs |
|---|---|---|
| LCM-11: "Do NOT kill Hub on deactivate" | Kill Hub on deactivate (DECISION-MS-01) | requirements-bridge.md §4.1 |
| Hub writes `~/.accordo/token` | No token file (DECISION-MS-03) | requirements-hub.md §4.2, architecture.md §3.2, §7.1 |
| Hub writes `~/.accordo/hub.pid` | No PID file (DECISION-MS-02) | requirements-hub.md §8, architecture.md §3.2 |
| Hub writes `~/.accordo/hub.port` | No port file (DECISION-MS-06) | architecture.md §3.2 |
| `/bridge/reauth` writes token to disk | `/bridge/reauth` updates memory only (DECISION-MS-04) | requirements-hub.md §2.6 |
| Hub serves CLI agents across VSCode restarts | CLI agents die with Hub (DECISION-MS-01) | architecture.md §7.1 auth note |
| `HubServerOptions.tokenFilePath` | Removed — no file writes | server.ts |
| Bridge reads PID file on activation | Bridge uses health check only (DECISION-MS-02) | requirements-bridge.md §4.1 |
| `~/.accordo/` created at Hub startup with token/PID/port | `~/.accordo/` created only if audit/logs are configured | index.ts |

### What Stays the Same

- Two-credential architecture (bridge secret + bearer token)
- WebSocket protocol (messages, reconnect, heartbeat)
- MCP transport (Streamable HTTP + stdio)
- Tool registry, state cache, prompt engine
- Agent config file formats (opencode.json, .claude/mcp.json, .vscode/mcp.json)
- Security model (loopback binding, Origin validation, bearer auth)
- Concurrency model (16 in-flight, 64 queue, simple FIFO — no per-session scheduling)
- Dynamic port selection (`findFreePort`)

---

## 12. Decision Record

### DECISION-MS-01 — Kill Hub on deactivate

**Date:** 2026-04-02  
**Context:** Previous LCM-11 preserved Hub across VSCode restarts for CLI agent continuity.
This required PID files, token files, and orphan detection — complexity that caused bugs
(stale PID, stale token, orphaned Hub at 100% CPU after crash).  
**Decision:** Bridge kills Hub in `deactivate()`. SIGTERM with 2s grace, then SIGKILL.  
**Consequence:** CLI agents lose connection when VSCode closes. Acceptable trade-off for
operational simplicity.

### DECISION-MS-02 — No PID file; use SIGHUP + IPC disconnect for orphan prevention

**Date:** 2026-04-02  
**Context:** PID files were used for orphan detection (Bridge reads PID on activation, checks
if process exists). With ephemeral Hub, the Hub self-terminates via SIGHUP and IPC disconnect
when its parent dies.  
**Decision:** Remove `~/.accordo/hub.pid`. Hub's existing SIGHUP handler and IPC disconnect
are sufficient for orphan prevention.  
**Consequence:** No PID file to go stale. Bridge's startup path is simpler (no PID check).

### DECISION-MS-03 — No `~/.accordo/token` file

**Date:** 2026-04-02  
**Context:** Token file existed for out-of-band agent access (CLI agents not managed by Bridge).
In ephemeral model, token lifetime matches Hub lifetime — no point persisting it to a
known location.  
**Decision:** Token lives in VSCode SecretStorage and workspace config files only. Hub does
not write to `~/.accordo/token`.  
**Consequence:** Remote topology agents must read token from workspace config file (§7.1).
Slightly less convenient but more correct (workspace-specific, no stale credential).

### DECISION-MS-04 — Retain `/bridge/reauth` for soft restart

**Date:** 2026-04-02  
**Context:** `/bridge/reauth` allows credential rotation without killing the Hub. Still useful
for `accordo.hub.restart` (soft restart that preserves in-flight agent sessions).  
**Decision:** Keep the endpoint but remove the token-file-write behaviour. Hub updates
credentials in memory only.  
**Consequence:** Soft restart still works. No file I/O on reauth.

### DECISION-MS-05 — Do not delete config files on deactivate

**Date:** 2026-04-02  
**Context:** Stale config files (dead token, wrong port) exist between VSCode close and next
open. Deleting them in `deactivate()` is unreliable (5s timeout, file I/O race).  
**Decision:** Leave config files in place. They are overwritten on next activation.  
**Consequence:** Brief staleness window is harmless — Hub is not running, so all requests
fail with ECONNREFUSED regardless of token validity.

### DECISION-MS-06 — No port file; use stderr + health poll

**Date:** 2026-04-02  
**Context:** `~/.accordo/hub.port` was written by Hub and read by Bridge to discover the
actual bound port. In ephemeral model, Bridge spawns Hub as a child process and can read
its stderr directly.  
**Decision:** Hub prints actual port to stderr. Bridge parses stderr + polls health.  
**Consequence:** Eliminates port file race conditions (Bridge reading before Hub writes).
Bridge has direct access to child process stderr — more reliable than file-based IPC.

### DECISION-MS-07 — No cross-window Hub sharing

**Date:** 2026-04-02  
**Context:** Each VSCode window spawns and owns its Hub. No mechanism for Hub sharing.  
**Decision:** One Hub per VSCode window. Independent ports, tokens, credentials.  
**Consequence:** Clean isolation. No cross-window interference. Small memory overhead
(~50MB per additional Hub) is acceptable for the typical 2-3 window case.

### DECISION-MS-08 — Agent reconnection: fail-and-reload

**Date:** 2026-04-02  
**Context:** When Hub dies, agent MCP connections fail. Agent must recover.  
**Decision:** Agents detect ECONNREFUSED, mark MCP server as disconnected. On next session
start, re-read config file (which now has new token/port). No persistent connection attempt.  
**Consequence:** Agent sessions do not survive VSCode restart. Users must start a new
agent session (or the agent must re-initialize MCP). This matches the "ephemeral Hub"
contract: the Hub is temporary, so the MCP session is temporary.

### DECISION-MS-09 — Remote token discovery via workspace config files

**Date:** 2026-04-02  
**Context:** Without `~/.accordo/token`, remote agents need another way to get the token.  
**Decision:** Read from workspace config files (e.g., `opencode.json`) via SSH/docker.  
**Consequence:** Token path is workspace-specific (not at a fixed location). Slightly less
convenient but more correct (no stale tokens, no cross-project token confusion).

### DECISION-MS-10 — Retain `~/.accordo/` for audit and logs

**Date:** 2026-04-02  
**Context:** `~/.accordo/audit.jsonl` and `~/.accordo/logs/` are operational files, not
credential files.  
**Decision:** Keep audit and log files in `~/.accordo/`. Remove only credential/lifecycle
files (token, PID, port).  
**Consequence:** `~/.accordo/` directory is still created when audit logging is active.
File permission model (0700 dir, 0600 files) still applies to audit/log files.

---

## 13. Implementation Impact

### 13.1 Hub Changes (`packages/hub/src/index.ts`)

1. **Remove:** File writes for token, PID, and port (`fs.writeFileSync` calls, lines 226-229)
2. **Remove:** SIGTERM handler's file cleanup (lines 237-240) — no files to clean up
3. **Remove:** `tokenFilePath` from `HubServerOptions` construction (line 219)
4. **Keep:** `findFreePort()`, stderr port announcement, SIGHUP handler, IPC disconnect
5. **Keep:** `~/.accordo/` directory creation — but only when audit log is configured

### 13.2 Hub Changes (`packages/hub/src/server.ts`)

1. **Remove:** `tokenFilePath` from `HubServerOptions` interface
2. **Remove:** Token file write in `updateToken()` method
3. **Keep:** In-memory token update in `updateToken()`

### 13.3 Bridge Changes (`packages/bridge/src/hub-manager.ts`)

1. **Remove:** `_applyPortFile()` — port file reading
2. **Remove:** PID file reading and `kill -0` check on activation
3. **Add:** Hub process kill in `deactivate()` (SIGTERM, 2s grace, SIGKILL fallback)
   - `killHub()` must implement `setTimeout` + `proc.kill('SIGKILL')` fallback as explicit implementation requirement
4. **Add:** `deactivate()` signature change from `sync` to `async` (to await killHub())
5. **Add:** stderr parsing for actual port discovery
6. **Keep:** Health polling, WS connection, credential generation, SecretStorage

### 13.4 Requirements Doc Updates Needed

| Document | Section | Change |
|---|---|---|
| `requirements-bridge.md` | LCM-11 | Reverse: "Kill Hub on deactivate" |
| `requirements-hub.md` | §4.2 (env vars) | Remove "Hub writes to `~/.accordo/token`" |
| `requirements-hub.md` | §4.2 (file perms) | Remove token/PID/port file references |
| `requirements-hub.md` | §8 (PID file) | Remove entire section |
| `requirements-hub.md` | §2.6 (/bridge/reauth) | Remove "rewrites `~/.accordo/token`" |
| `architecture.md` | §3.2 (Runtime) | Remove PID file, token file references |
| `architecture.md` | §4.3 (Lifecycle Manager) | Update to ephemeral model |
| `architecture.md` | §6.5 (Topology Matrix) | Update auth note — no `~/.accordo/token` |
| `architecture.md` | §7.1 (HTTP Security) | Remove "writes to `~/.accordo/token` as fallback" |
| `architecture.md` | §9 (Startup Sequence) | Update to match §3.2 of this document |

---

## 14. Security Implications

### 14.1 Improvements

| Aspect | Previous | Ephemeral |
|---|---|---|
| Token persistence | Written to `~/.accordo/token` — survives indefinitely | In-memory + SecretStorage only — dies with Hub |
| Stale credentials | Accumulate in `~/.accordo/token` across restarts | Impossible — no persistent token file |
| Credential file permissions | `0600` on `~/.accordo/token` | Not applicable — file doesn't exist |
| Config file permissions | `0600` on workspace config files | Unchanged |
| Orphan Hub processes | Required PID file + `kill -0` detection | Self-terminate via SIGHUP + IPC disconnect |

### 14.2 Trade-offs

| Aspect | Impact |
|---|---|
| Config file staleness window | Between VSCode close and next open, config files contain a dead token. Low risk — Hub is not running, so the token is useless. |
| Config files in workspace | Contain bearer token. Must be in `.gitignore` (CFG-06, already implemented). |
| No central token store | Each workspace has its own token. No way to enumerate all active Hub tokens. This is a feature, not a bug — reduces blast radius. |

---

## 15. Migration Path

For users upgrading from the persistent Hub model:

1. **No breaking changes for agents.** opencode.json, .claude/mcp.json, and .vscode/mcp.json
   formats are unchanged. Agents don't need reconfiguration.
2. **`~/.accordo/token`, `~/.accordo/hub.pid`, `~/.accordo/hub.port`** can be manually
   deleted. They will not be recreated.
3. **`~/.accordo/audit.jsonl`** and **`~/.accordo/logs/`** are retained and continue to
   accumulate normally.
4. **Hub processes from the old model** may still be running. The new Bridge's startup
   health check will detect them, fail WS auth (different secret), and kill-and-respawn
   as per the existing LCM-04 flow.

---

## 16. Open Questions

| ID | Question | Context |
|---|---|---|
| OQ-01 | **Stderr parse timeout / failure handling.** What happens if Bridge cannot parse the port from Hub's stderr within a reasonable time? What is the timeout value, and what is the fallback — retry spawn, surface an error to the user, or both? | §3.2 startup sequence relies on stderr parsing. A hung Hub process that never prints the port line would block Bridge indefinitely without a timeout. |
| OQ-02 | **Two-simultaneous-VSCode-windows race on same workspace.** If two VSCode windows open the same workspace folder, both Bridges attempt to write `opencode.json` (and other config files). What are the race semantics — last-writer-wins, file locking, or should the second window detect a running Hub and connect to it instead of spawning a new one? | §3.1 states one Hub per VSCode window. Two windows on the same workspace would produce two Hubs writing the same config files with different ports/tokens. |
| OQ-04 | **`update_token` multi-session semantics during `/bridge/reauth`.** When Bridge calls `/bridge/reauth`, the Hub generates a new token and all existing MCP sessions hold the old token. How does the token rotation propagate — do existing sessions get disconnected and must reconnect, does the Hub maintain a grace period accepting both old and new tokens, or does `/bridge/reauth` broadcast the new token to connected sessions? | §2.6 reauth behaviour currently says "updates in memory only" but does not specify the impact on already-authenticated MCP sessions. |
