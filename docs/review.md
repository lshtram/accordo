> **STATUS: ARCHIVED — 2026-03-02**
> All 17 findings resolved (15 from prior reviews, 2 from this pass) plus 5 secondary-reviewer items dispositioned.
> This document is retained for traceability only. Architecture is implementation-ready.

---

# Accordo IDE — Consolidated Architecture Review

**Date:** 2026-03-02  
**Status:** CLOSED — All items resolved. Implementation approved.  
**Scope:** Full review of architecture.md, requirements-hub.md, requirements-bridge.md, requirements-editor.md, workplan.md  
**Incorporates:** All open items from prior reviews (openspace-full-review.md, phase1-readiness-review.md, VSCODE-OPENSPACE-ARCHITECTURE.md) plus new findings

---

## Items Raised by Secondary Review (U1–U5) — Dispositioned

> **Status 2026-03-02:** All five items raised by the secondary reviewer have been analysed and dispositioned. Three were invalid or circular; two resulted in minor spec tightening. No implementation blockers remain.

### U1. ~~P0 Security: Workspace credential persistence~~ NOT A BLOCKER

- **Raised:** Tokens in workspace config files (`opencode.json`, `.claude/mcp.json`) are a leakage risk.
- **Disposition:** **By design — not a blocker.** These config files exist *specifically* so CLI agents (OpenCode, Claude Code) can discover and authenticate with the Hub. Without the inline token, agent connectivity is impossible. Existing mitigations: `.gitignore` (CFG-06), session-scoped token rotation on restart (CFG-07), bearer tokens are short-lived. **Hardening applied:** CFG-06 updated to require `0600` permissions on generated config files (requirements-bridge.md). No further change needed.

### U2. ~~P0 Interoperability: Origin policy conflicts with remote flows~~ INVALID

- **Raised:** Hub Origin validation blocks non-localhost origins, breaking remote/Codespaces agents.
- **Disposition:** **Invalid — based on a misunderstanding of Origin semantics.** The `Origin` header is a *browser-only* construct. CLI agents (OpenCode, Claude Code, curl, SDKs) do not send it. The Hub validation already states "return true if absent or localhost" (requirements-hub.md `validateOrigin`). Non-browser agents pass validation because they have no Origin header. The only scenario requiring non-localhost Origin is browser-based WebViews, which are deferred to Phase 2. No change needed.

### U3. ~~P0 Workplan sequencing: destructive tool before confirmation~~ PARTIALLY CIRCULAR (R11)

- **Raised:** `terminal.run` in Week 3, confirmation dialog in Week 4 — insecure window.
- **Disposition:** **Partially circular** — this was already raised as prior item R11 and resolved by moving the security baseline (bearer token, Origin validation) to Week 2. The remaining gap (confirmation *dialog* vs. tool availability) is valid but low-risk during initial development. **Tightening applied:** workplan.md Week 3 Wed now requires `terminal.run` to ship with a hardcoded `destructive` confirmation stub from day one. Full confirmation policy system still in Week 4 Tue.

### U4. ~~P1 Architecture consistency: diagram text~~ VALID — FIXED

- **Raised:** Architecture diagram says `McpStdioServerDefinition` but §4.7 requires `McpHttpServerDefinition`.
- **Disposition:** **Genuine text bug.** The diagram was left over from an earlier draft. **Fixed:** architecture.md §2 diagram now reads `McpHttpServerDefinition`, consistent with §4.7.

### U5. ~~P1 Operability: remote UX readiness~~ CIRCULAR (item 13)

- **Raised:** Manual token extraction and port forwarding for remote setups — promote to Phase 1.
- **Disposition:** **Circular** — this is a re-raise of item 13 (Medium: Remote Topology Usability Gap), which was explicitly scoped to Phase 2 with a clear plan (notification + `asExternalUri()` auto-forwarding). Promoting it would expand Phase 1 scope without architectural justification. The current architecture *correctly describes* remote operation; the UX improvement is a Phase 2 evolution. No change.

---

## Overall Assessment

The architecture is **solid and implementation-ready**. All issues identified across three review passes have been addressed. The core decisions are correct:

- Hub as an editor-agnostic MCP server — the right abstraction boundary
- Bridge as the only VSCode-specific piece — clean portability
- Streamable HTTP per MCP spec 2025-03-26 — spec-compliant
- Hub-as-server WebSocket topology — robust reconnect model
- Security baseline (loopback, Origin validation, bearer token) — addresses DNS rebinding
- `extensionKind: ["workspace"]` properly declared — correct host assignment
- `handler` never on the wire — architecturally sound
- Phased execution with gate conditions — disciplined scope control

The major issues identified by prior reviews (Gemini 2.5, GPT-5.3, and the original analysis) have been addressed in the current architecture.md. The items below are legacy open points kept for traceability.

---

## Open Items

> **Status 2026-03-02 (updated):** All 17 items have been resolved in the current documentation. They are retained below for traceability. See the **Resolved Items** tables at the bottom for a full summary.

### 1. ~~Critical: Hub Lifecycle — Kill-and-Respawn vs CLI Agent Continuity~~ RESOLVED

- **Resolution:** Added `POST /bridge/reauth` endpoint to Hub (architecture.md §3.3, §3.6; requirements-hub.md §2.6). `accordo.hub.restart` now attempts soft rotation via `/bridge/reauth` first — Hub keeps running and CLI agent sessions are uninterrupted. Kill-and-respawn is retained as the fallback only when Hub is unreachable or Bridge has lost the current secret (Hub was externally replaced). architecture.md §4.3 and requirements-bridge.md LCM-12 updated accordingly.

---

### 2. ~~High: Token File `~/.accordo/token` Permissions~~ RESOLVED

- **Resolution:** Hub now creates `~/.accordo/` with mode `0700` and writes `~/.accordo/token` and `~/.accordo/hub.pid` with mode `0600`. Documented in architecture.md §3.2 and requirements-hub.md §4.2.

---

### 3. ~~High: Tool Call Cancellation Message Missing from Protocol~~ RESOLVED

- **Resolution:** `CancelMessage` (Hub→Bridge) and `CancelledMessage` (Bridge→Hub) added to the WebSocket protocol in architecture.md §4.4, requirements-hub.md §3.1/§3.2, requirements-bridge.md §5.2. Cancel handling flow defined in Bridge message routing.

---

### 4. ~~High: Concurrent Tool Invocation Contract Undefined~~ RESOLVED

- **Resolution:** Full concurrency contract added to architecture.md §8.4 and requirements-hub.md §9. Hub-wide limit: 16 in-flight invocations; queue depth: 64; queue-full error code: `-32004`. Configurable via `ACCORDO_MAX_CONCURRENT_INVOCATIONS`. Bridge processes concurrently (no serialisation). Explicitly supports swarm-of-agents patterns with multiple parallel sessions.

---

### 5. ~~High: Tool Registration Race Condition~~ RESOLVED

- **Resolution:** REG-03 in requirements-bridge.md updated to require a 100ms debounce on `toolRegistry` sends. Multiple registrations within the window coalesce into a single combined message.

---

### 6. ~~High: `openEditors` Populated from Wrong Event~~ RESOLVED

- **Resolution:** requirements-bridge.md §6.1 updated. `openEditors` is now derived from `vscode.window.tabGroups.all` (tab API) rather than `workspace.onDidOpenTextDocument`. Events `tabGroups.onDidChangeTabGroups` and `tabGroups.onDidChangeTabs` trigger re-enumeration.

---

### 7. ~~Medium: Terminal `processId` as Identifier is Unreliable~~ RESOLVED

- **Resolution:** requirements-editor.md §4.9/§4.10 updated. Terminals are now identified by a sequential stable string ID (`accordo-terminal-<n>`) maintained in an internal map. `processId` is never used as an external identifier. Terminal map lifecycle defined in §5.3.

---

### 8. ~~Medium: Audit Log Rotation Not Specified~~ RESOLVED

- **Resolution:** Size-based rotation added to architecture.md §7.4 and requirements-hub.md §7. When `audit.jsonl` exceeds 10 MB it is rotated to `audit.1.jsonl`; max 2 files (~20 MB total). `cancelled` added as a result value.

---

### 9. ~~Medium: Hub PID File Not in Requirements~~ RESOLVED

- **Resolution:** Full PID file spec added as requirements-hub.md §8. Hub writes PID on start (mode `0600`), removes on `SIGTERM`/`SIGINT`. Bridge stale-PID detection via `kill -0` check documented. Referenced in architecture.md §3.2.

---

### 10. ~~Medium: Error Code Ambiguity in MCP Responses~~ RESOLVED

- **Resolution:** requirements-hub.md §6 updated. "Bridge not connected" retains `-32603`. "Tool invocation timed out" now uses `-32001`. "Server busy / queue full" uses `-32004`.

---

### 11. ~~Medium: No Per-Decoration Clear in Editor Highlights~~ RESOLVED

- **Resolution:** requirements-editor.md §4.5 updated. `clearHighlights` now accepts an optional `decorationId` parameter. If provided, only that decoration is cleared. If omitted, all decorations are cleared (existing behaviour preserved).

---

### 12. ~~Medium: `McpHttpServerDefinition` API Stability~~ RESOLVED

- **Resolution:** Already handled by requirements-bridge.md MCP-03 (`if lm API unavailable, skip silently`). This is the correct approach — no further doc change needed. Explicit test coverage for the skip path is tracked in the testing requirements.

---

### 13. ~~Medium: Remote Topology Usability Gap~~ DEFERRED TO PHASE 2

- **Resolution:** Documented as a Phase 2 addition in architecture.md §11. Bridge will detect remote host context and emit a notification with port-forward command and token. `vscode.env.asExternalUri()` auto-forwarding considered.

---

### 14. ~~Low: `opencode.json` Format Validation~~ RESOLVED

- **Resolution:** requirements-bridge.md §8.5 added with CFG-08 through CFG-10: field presence validation before write, backup of unparseable `.claude/mcp.json`, schema version metadata in generated files.

---

### 15. ~~Low: Prompt Engine Token Estimation Accuracy~~ RESOLVED

- **Resolution:** requirements-hub.md §5.3 updated. Effective budget is now 1,350 tokens (10% safety margin applied to the 1,500-token limit). Exact tokenizer (`tiktoken`) is a Phase 2 addition.

---

### 16. ~~Low: Workplan Week 4 — Native MCP Registration Test~~ NO CHANGE NEEDED

- **Resolution:** Workplan already covers full-agent end-to-end test in Week 4. No doc change needed.

---

### 17. ~~Low: No Checkpoint/Rollback Capability~~ DEFERRED TO PHASE 2

- **Resolution:** Documented as a Phase 2 addition in architecture.md §11. Git-stash-based snapshots before destructive tool executions, referencing Cline's model.

---

## Resolved Items

### From Prior Reviews (resolved before this document)

| # | Prior Finding | Resolution |
|---|---|---|
| R1 | MCP transport stale (HTTP+SSE instead of Streamable HTTP) | architecture.md §3.4: single `POST /mcp` per MCP 2025-03-26 |
| R2 | `handler` on the wire (architecturally impossible) | architecture.md §3.7, requirements-bridge.md §3.2: handler stays local |
| R3 | `extensionKind` not declared | architecture.md §4.2, §5.2: `["workspace"]` on all Phase 1 packages |
| R4 | WebSocket topology (Bridge as server was fragile) | architecture.md §2: Hub is server, Bridge is reconnecting client |
| R5 | Remote development unmodelled | architecture.md §6: full topology matrix with 5 scenarios |
| R6 | Security baseline insufficient (DNS rebinding, SSRF) | architecture.md §7: loopback, Origin validation, bearer token, audit |
| R7 | Reliability contracts missing (heartbeat, timeout, reconnect) | architecture.md §8: heartbeat 5s/15s, timeout taxonomy, backoff |
| R8 | Prompt engine no token budget | architecture.md §3.9: 1,500-token dynamic budget with truncation |
| R9 | Chat extension unnecessary coupling | architecture.md §11: chat explicitly deferred |
| R10 | Native VSCode MCP APIs not used | architecture.md §4.7: McpHttpServerDefinition pointing to running Hub |
| R11 | Security hardening scheduled too late vs destructive tools | workplan.md Week 2 Tue: security enforced before Week 3 tools |
| R12 | `accordo.hub.path` free-form command string RCE risk | requirements-bridge.md: `executablePath` machine-scoped, uses `execFile` |
| R13 | Native MCP stdio spawns second Hub (split state) | architecture.md §4.7: uses `McpHttpServerDefinition`, not stdio |
| R14 | Protocol version handshake missing | requirements-hub.md §5.4, requirements-bridge.md WS-10: 4002 on mismatch |
| R15 | Multi-root workspace path ambiguity | requirements-editor.md §5.1: detailed `resolvePath` with multi-root logic |

### From This Review (resolved in this pass)

| # | Finding | Resolution Location |
|---|---|---|
| 1 | Hub lifecycle: kill-and-respawn disrupts CLI agents | architecture.md §3.3/§3.6/§4.3; requirements-hub.md §2.6; requirements-bridge.md LCM-12 |
| 2 | Token/PID file permissions | architecture.md §3.2; requirements-hub.md §4.2, §8 |
| 3 | Cancel message missing from protocol | architecture.md §4.4; requirements-hub.md §3.1/§3.2; requirements-bridge.md §5.2 |
| 4 | Concurrent invocation contract undefined | architecture.md §8.4; requirements-hub.md §9 |
| 5 | toolRegistry race condition | requirements-bridge.md REG-03 (100ms debounce) |
| 6 | `openEditors` from wrong event | requirements-bridge.md §6.1 (tab groups API) |
| 7 | Terminal processId unreliable | requirements-editor.md §4.9/§4.10/§5.3 |
| 8 | Audit log rotation missing | architecture.md §7.4; requirements-hub.md §7 |
| 9 | Hub PID file not specified | architecture.md §3.2; requirements-hub.md §8 |
| 10 | Timeout error code ambiguity | requirements-hub.md §6 (-32001 for timeout, -32004 for queue full) |
| 11 | No per-decoration clear | requirements-editor.md §4.5 (optional decorationId) |
| 12 | McpHttpServerDefinition stability | No change — MCP-03 already covers skip-silently |
| 13 | Remote topology usability | architecture.md §11 (Phase 2 scope) |
| 14 | Config file format validation | requirements-bridge.md §8.5 (CFG-08 to CFG-10) |
| 15 | Token estimation safety margin | requirements-hub.md §5.3 (1,350 effective token budget) |
| 16 | Workplan native MCP test | No change — already in workplan Week 4 |
| 17 | No checkpoint/rollback | architecture.md §11 (Phase 2 scope) |

---

## Implementation Gate Checklist

All gate conditions are now decided. Implementation can begin.

- [x] Single-Hub runtime model for all MCP clients (McpHttpServerDefinition → shared Hub)
- [x] Deterministic Bridge secret lifecycle and reconnect contract (reauth + kill-and-respawn fallback)
- [x] Safe Hub process launch model (execFile, machine-scoped path, no shell parsing)
- [x] Cancel message protocol defined
- [x] Concurrent invocation limit defined (16 in-flight, 64 queue, configurable)
- [x] openEditors source locked (tab groups API)
- [x] Terminal ID strategy locked (sequential `accordo-terminal-<n>`)
