# Testing Guide — Multi-Session Ephemeral Hub (Priority I)

**Module:** `multi-session`  
**Scope:** MS-01 Session enrichment, MS-02 InvokeMessage sessionId/agentHint, MS-04 FileActivityTracker, MS-05 AuditEntry agentHint, MS-06 Session TTL reaping  
**Test suite:** `packages/hub/src/__tests__/` (47 tests)  
**Updated:** 2026-04-03

---

## 1. Unit Tests (Agent-Automated)

### 1.1 Run the Full Test Suite

```bash
cd /data/projects/accordo/packages/hub
npx vitest run
```

**Expected result:** 564 tests pass, 26 files, 0 new errors (2 pre-existing unhandled rejections in `invoke-message-session.test.ts` teardown are unrelated).

### 1.2 Run Multi-Session Tests Only

```bash
cd /data/projects/accordo/packages/hub
npx vitest run mcp-session-enriched invoke-message-session bridge-dispatch-fifo file-activity-tracker audit-log-agent-hint mcp-session-ttl
```

**Expected:** 47 tests pass across 6 files.

### 1.3 Per-Module Tests

| Module | Requirement | Test File | Tests |
|---|---|---|---|
| MS-01 | Session enrichment (`agentHint`, `label`, `group`, `metadata`) | `mcp-session-enriched.test.ts` | 11 |
| MS-02 | `InvokeMessage` carries `sessionId` + `agentHint` | `invoke-message-session.test.ts` | 6 |
| MS-04 | FileActivityTracker advisory conflict detection | `file-activity-tracker.test.ts` | 9 |
| MS-05 | AuditEntry denormalized with `agentHint` | `audit-log-agent-hint.test.ts` | 5 |
| MS-06 | Session TTL reaping + idle timeout | `mcp-session-ttl.test.ts` | 9 |
| FIFO | Simple FIFO queue, 16-slot global cap, 64 depth | `bridge-dispatch-fifo.test.ts` | 7 |

### 1.4 Type Check

```bash
cd /data/projects/accordo/packages/hub
pnpm tsc --noEmit
```

**Expected:** 0 errors in source files.

### 1.5 Lint

```bash
cd /data/projects/accordo/packages/hub
pnpm lint
```

**Expected:** 0 errors (5 pre-existing warnings are unrelated to this module).

---

## 2. User Journey — Manual Testing

These scenarios require a live VSCode session with the accordo-bridge extension installed and running.

### 2.1 Multi-Session Connection (Scenario A)

**What it tests:** Multiple AI agents (OpenCode, Claude Code, Copilot) connecting to the same VSCode/Hub simultaneously.

**Setup:**
1. Open VSCode with a workspace project (e.g., `~/projects/accordo`)
2. Open two separate terminal windows
3. In Terminal 1: start OpenCode pointing to this workspace
4. In Terminal 2: start Claude Code pointing to the same workspace

**Steps:**
1. In Terminal 1 (OpenCode): ask "what files are open?" — observe the Hub returns tool listing
2. In Terminal 2 (Claude): ask "what files are open?" — observe the same Hub returns tool listing
3. In Terminal 1: run `accordo_editor_open` on a file
4. In Terminal 2: check IDE state — the file should appear as `activeFile`
5. Close Terminal 1 — the Hub should remain running (serving Terminal 2)
6. Reopen Terminal 1 with a new OpenCode session — it reconnects to the same Hub

**Pass criteria:**
- Both agents connect to the same Hub (same port in their `opencode.json`)
- Both agents receive the same tool registry
- Both agents see the same IDE state
- Closing one agent does not disconnect the other

### 2.2 Session Enrichment (MS-01)

**What it tests:** Sessions carry `agentHint` so tool invocations can be attributed to the calling agent.

**Setup:** Start OpenCode, observe Hub logs (or audit log).

**Steps:**
1. In OpenCode: run a tool (e.g., `accordo_editor_open` or any editor tool)
2. Check the audit log: `~/.accordo/audit.jsonl`
3. The `agentHint` field should show `"opencode"` for calls from this session

**Pass criteria:** Audit entries contain the `agentHint` field with the agent name.

### 2.3 Ephemeral Hub Lifecycle (VSCode Restart)

**What it tests:** Hub dies with VSCode, agents reconnect to a new Hub after restart.

**Steps:**
1. Start VSCode — Hub spawns, `opencode.json` written with port + token
2. Start OpenCode — it reads `opencode.json`, connects to running Hub
3. Close VSCode — Hub process terminates (check via `ps aux | grep accordo-hub`)
4. Reopen VSCode — new Hub spawns, `opencode.json` updated with new port/token
5. OpenCode: run any tool — it should reconnect to the new Hub and succeed

**Pass criteria:**
- After VSCode restart, `opencode.json` has a potentially different port
- OpenCode reconnects to the new Hub without manual intervention
- No stale `~/.accordo/` files accumulate (no `hub.pid`, no `hub.token`)

### 2.4 Multi-Project (Scenario B)

**What it tests:** Each VSCode window has its own Hub, own port, own token.

**Setup:**
1. Open VSCode Window 1 with project `~/projects/foo`
2. Open VSCode Window 2 with project `~/projects/bar`
3. Both windows have their own accordo-bridge running

**Steps:**
1. In Window 1: open `~/projects/foo/.opencode/opencode.json` — note the Hub port
2. In Window 2: open `~/projects/bar/.opencode/opencode.json` — note the Hub port
3. The ports should be different (e.g., 3000 vs 3001)
4. Start OpenCode for project foo — connects to port 3000
5. Start Claude Code for project bar — connects to port 3001
6. Operations in foo's session do not affect bar's session and vice versa

**Pass criteria:** Each project workspace has its own Hub on its own port.

### 2.5 FileActivityTracker Advisory Warning (MS-04)

**What it tests:** When two sessions edit the same file, a warning is logged but not blocking.

**Note:** This feature requires integration into the tool execution path — the Hub must call `FileActivityTracker.trackEdit()` before each file-modifying tool. Currently this is a standalone class that can be wired into the tool execution pipeline.

**Pass criteria:** The `FileActivityTracker` class correctly:
- Records active edits per URI per session
- Returns a warning when a second session edits the same URI
- Does NOT block — the second session proceeds (last-writer-wins)
- Clears on `releaseEdit()`

### 2.6 Session TTL Reaping (MS-06)

**What it tests:** Abandoned sessions are cleaned up after TTL.

**Setup:** Start OpenCode, note the session registry state.

**Steps:**
1. Start OpenCode — a session is created in the Hub
2. Do nothing — leave the session idle
3. After `sessionTTLMs` (default 24 hours), call `getActiveSessions()` — the idle session should be absent
4. Call `reapStaleSessions()` — returns count of removed sessions

**Pass criteria:** Idle sessions are removed after TTL without requiring manual cleanup.

---

## 3. Scope Notes

**In scope for this module:**
- Session enrichment (MS-01, MS-06)
- InvokeMessage session tracking (MS-02)
- FileActivityTracker (MS-04)
- AuditEntry agentHint (MS-05)
- Ephemeral Hub lifecycle
- Simple FIFO queue (global 16 cap, 64 depth)

**Out of scope (removed):**
- Weighted Fair Queue / round-robin scheduling (MS-03) — rejected as over-engineered
- Port auto-increment for multi-VSCode (Scenario B) — deferred to future work
- Session labels/groups UI — deferred
- Conductor/worker model (Scenario C) — deferred

---

## 4. Debugging

| Symptom | Likely Cause |
|---|---|
| Agent can't connect — ECONNREFUSED | VSCode not open, or Hub not yet healthy when agent reads `opencode.json` |
| Agent gets 401 after VSCode restart | Agent cached old token — needs to re-read `opencode.json` |
| Multiple agents see different tool registries | Each VSCode window has its own Hub — agents must be in the same window |
| `opencode.json` has wrong port after restart | Race: agent read `opencode.json` before Bridge rewrote it — retry or restart agent |
| Stale `~/.accordo/` files | Old Hub from persistent model — safe to delete, new Hub doesn't write them |
