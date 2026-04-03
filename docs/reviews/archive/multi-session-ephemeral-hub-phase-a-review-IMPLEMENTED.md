# Architecture Review — Multi-Session Ephemeral Hub
## Phase A Review (Design Document)

**Document under review:** `docs/10-architecture/multi-session-architecture.md`  
**Reviewer:** Reviewer Agent  
**Date:** 2026-04-02  
**Review scope:** Correctness, feasibility, codebase cross-reference, decision audit  

---

## 1. Summary

The multi-session architecture document proposes three coupled changes:

1. **Ephemeral Hub lifecycle** — Bridge spawns Hub on activate and kills it on deactivate (reversing LCM-11)
2. **No shared filesystem state** — Remove token, PID, and port files from `~/.accordo/`; replace with in-memory IPC and stderr port discovery
3. **Multi-session token isolation** — Each session gets a unique Bearer token; sessions are disambiguated at the MCP level via a stable `sessionId` written into opencode.json

The design is coherent and the individual pieces are well-reasoned. The core motivation — preventing orphaned Hubs and enabling multi-session agent work — is sound.

**Overall verdict:** **CONDITIONAL PASS** — one blocking issue and four items that need clarification or correction before implementation begins. The design is implementable once these are addressed. The Decision Audit (§6) finds that most decisions are sound; two require revision.

---

## 2. Blocking Issues

### BLOCK-01 — SIGHUP orphan prevention is unreliable on SIGKILL / force-quit

**Document claim (§3.2, DECISION-MS-02):** The Hub's SIGHUP handler and `process.disconnect()` call together ensure the Hub terminates if VSCode is killed without running `deactivate()`.

**Reality:**

- `process.disconnect()` is called at Hub startup (confirmed: `packages/hub/src/index.ts` line 271) to prevent a CPU-spin when the IPC channel goes idle. It does **not** cause the Hub process to exit when the parent dies. It merely detaches the Hub from the IPC channel. Once disconnected, the Hub has no channel to detect parent death through.

- SIGHUP is sent by the OS to a process when its **controlling terminal (PTY)** is closed. VSCode windows are **not PTY processes**. When VSCode is force-quit (SIGKILL via Activity Monitor, OOM killer, or `kill -9`), there is no controlling terminal closure, so **SIGHUP is not delivered to child processes** in typical configurations on macOS/Linux.

- SIGHUP **is** confirmed present in the code (line 278 of `index.ts`) but it fires for a different scenario: when a terminal running the Hub CLI is closed. For the VSCode-spawned case, this is not the delivery vector.

- The architecture doc conflates two mechanisms and treats them as a combined guarantee. They are independent, and neither covers the SIGKILL case.

**Consequence:** An orphaned Hub after a hard VSCode kill is **not prevented by the current design**. The document acknowledges this as "accepted risk" in the notes section, but the framing in DECISION-MS-02 is too confident ("ensures the Hub terminates") without quantifying the failure mode.

**Required fix before implementation:**

Either (a) explicitly document SIGKILL as an unmitigated risk and remove the word "ensures," or (b) add a PR_SET_PDEATHSIG call (Linux) / a keepalive IPC heartbeat loop (cross-platform) to handle parent death. A heartbeat approach: Hub sends a ping over IPC every N seconds; if IPC is disconnected and the Hub receives no pong for M seconds, it exits. This does not depend on signals.

**Recommended wording revision (option a — minimal):**
> "SIGHUP handler covers terminal-close and `SIGHUP`-based kills. Hard kills (SIGKILL of VSCode, OOM kills) are NOT covered and will leave orphans. This is accepted. A future iteration may add an IPC heartbeat."

---

### BLOCK-02 — `killHub()` SIGTERM+2s+SIGKILL logic does not exist yet

**Document claim (§3.3):** "Bridge calls `killHub()`: sends SIGTERM → waits up to 2 s → if still alive sends SIGKILL."

**Reality:** `packages/bridge/src/hub-process.ts` `killHub()` calls `proc.kill()` with no signal argument (defaults to SIGTERM) and returns immediately with no timeout or SIGKILL escalation (lines ~209-215). The 2-second grace period and SIGKILL fallback are **absent from the current codebase**.

This is not a design flaw — it is a new requirement introduced by this architecture document. But it must be flagged because:

1. It is non-trivial to implement correctly inside the 5-second VSCode `deactivate()` window.
2. If the 2-second wait blocks the `deactivate()` function synchronously, VSCode will terminate the extension before it completes. The wait must be non-blocking or use `setTimeout`.
3. The architecture document does not specify whether `killHub()` should be `async` and awaited, or fire-and-forget.

**Required fix:** Document explicitly whether `killHub()` is awaited in `deactivate()` and how the SIGKILL fallback interacts with VSCode's 5-second deactivation deadline. Add a note that the total Hub-shutdown sequence (SIGTERM + up to 2s + optional SIGKILL) must complete within ~4 seconds to leave margin.

---

## 3. Non-Blocking Issues

### NB-01 — DECISION-MS-08 assumption about opencode token re-read is unvalidated

**Document claim (§11, DECISION-MS-08):** "opencode re-reads `opencode.json` on reconnect rather than caching the token at startup."

**Reality:** There is no opencode source code in this repository. This assumption cannot be validated from the codebase. If opencode caches the token at process start and never re-reads the file, then `update_token` (DECISION-MS-09) becomes the only reliable token-delivery mechanism — but `update_token` requires an active MCP session to send the tool call, creating a bootstrapping problem.

**What to do:** Explicitly label this assumption in the document. Add an acceptance test plan that verifies opencode re-reads `opencode.json` during the integration phase, before the token-rotation feature is considered done.

---

### NB-02 — opencode.json key discrepancy: `mcp.accordo` vs `mcpServers.accordo-hub`

**Reality:** The architecture document (§10.3) correctly shows `mcp.accordo` with `type: "remote"`. The actual implementation in `packages/bridge/src/agent-config.ts` (line 109) also uses `mcp.accordo`. **However,** `docs/20-requirements/requirements-bridge.md` §8.3 still shows the old format using `mcpServers.accordo-hub`. The §13.4 update checklist does not include a line item to fix `requirements-bridge.md §8.3`.

**What to do:** Add `requirements-bridge.md §8.3 — update opencode.json schema example to use mcp.accordo format` to the §13.4 update checklist.

---

### NB-03 — Port file removal creates a one-way migration hazard

**Document claim (§5.2, §13.2):** The port file is removed; port discovery shifts to stderr parsing during `hubProcess.spawn()`.

**Reality:** The current `hub-manager.ts` `_applyPortFile()` method (lines 380-390) reads from `config.portFilePath`. Bridge consumers (e.g., `activate()` in extension.ts) may call `_applyPortFile()` in the current code path. If the port file is removed from Hub but Bridge still tries to read it (race during a version mismatch or partial deploy), Bridge will silently fail to discover the port.

This is a minor concern for development — not production — but can waste significant debugging time. The architecture document does not mention a fallback or a migration period.

**What to do:** Note in the implementation plan that `_applyPortFile()` and `config.portFilePath` must be removed in the same commit as the Hub-side removal (atomic change). The stderr port-parsing must be the only code path before any PR is merged.

---

### NB-04 — §13.4 update checklist is incomplete

The following items are confirmed stale in the current codebase but are missing from the §13.4 update checklist:

| File | Stale content | Missing from §13.4? |
|---|---|---|
| `requirements-hub.md` §2.6 | "Hub rewrites `~/.accordo/token` on re-auth" | Not listed |
| `requirements-hub.md` §4.2 | "Hub writes it to `~/.accordo/token`" | Not listed |
| `requirements-hub.md` §8 | Entire PID file section | Not listed |
| `requirements-bridge.md` LCM-11 | "Do NOT kill Hub process" | Listed (✓) |
| `requirements-bridge.md` §8.3 | opencode.json schema uses `mcpServers.accordo-hub` | Not listed |
| `packages/hub/src/server.ts` line 61 | `tokenFilePath?: string` in `HubServerOptions` | Listed (✓) |

**What to do:** Add the three missing items to the §13.4 checklist.

---

## 4. Open Questions

### OQ-01 — Behavior when Hub is slow to bind: what is the stderr parse timeout?

§5.2 says Bridge parses stderr to find the port. The Hub prints the port line at the end of `startServer()`. If the Hub is slow (port scan across 20 ports, slow disk, startup lag), how long does Bridge wait before declaring failure? The document does not specify a timeout for stderr parsing, nor what Bridge does if the line never arrives (e.g., Hub crashes before printing).

**Suggested answer:** Specify a timeout (e.g., 10 seconds). On timeout or Hub exit before port line, `activate()` should fail with a user-visible error.

---

### OQ-02 — Can two Bridge instances spawn two Hubs simultaneously on the same port range?

With the persistent model, only one Hub ran at a time (enforced by the PID file check). With the ephemeral model, if two VSCode windows open within milliseconds of each other, both may call `activate()` and both will spawn Hub processes. The Hub tries up to 20 ports from the configured base.

If both start on the same base port, they both call `findFreePort()` — this is racy if they run simultaneously. One will bind port N and the other will bind port N+1 or similar. This is benign for operation (each gets its own port) but:

- Both write to `opencode.json` (or two `opencode.json` paths — which?). Does the second write overwrite the first?
- Which Hub does the shared opencode process connect to?

The document touches on multi-session but does not fully resolve the two-simultaneous-windows scenario.

---

### OQ-03 — `sessionId` stability across Hub restarts

§6.3 says `sessionId` is written into `opencode.json` once and kept stable. But if Hub is killed and the next Hub gets a new `sessionId`, existing opencode agent sessions (which have the old token) can no longer reach the Hub at all — they would need to reconnect from scratch.

This is probably the intended behavior, but the document should explicitly state: "Killing the Hub terminates all AI agent sessions associated with it. Agents must re-establish MCP connections after Hub restart."

---

### OQ-04 — `update_token` tool with multi-session: which session token is updated?

§9 describes `update_token` for rotating tokens mid-session. With multiple concurrent sessions, does `update_token` rotate only the calling session's token, or all tokens? If it rotates only the caller's token, how does `opencode.json` get updated — does Hub call back to Bridge via MCP? The direction of that call is not described.

---

## 5. Recommendations

### REC-01 — Replace "ensures Hub terminates" language with honest risk statement (addresses BLOCK-01)

In DECISION-MS-02, revise:
> "ensures the Hub terminates when the parent VSCode process exits"

to:
> "covers terminal-close (SIGHUP) and normal VSCode shutdown (deactivate kills Hub). Hard kill (SIGKILL) of VSCode leaves the Hub orphaned. This is accepted risk; a future IPC heartbeat may address it."

---

### REC-02 — Specify `killHub()` async contract and deactivation timing (addresses BLOCK-02)

Add a subsection to §3.3 specifying:
- `killHub()` is `async` and returns a `Promise<void>` that resolves when the Hub process has exited (or after SIGKILL)
- `deactivate()` in `extension.ts` awaits `killHub()` with a timeout of 4 seconds
- If `killHub()` does not resolve within 4 seconds, `deactivate()` returns anyway and accepts the Hub may not have exited cleanly

---

### REC-03 — Add an integration smoke test for the orphan scenario to Phase D3

The SIGHUP/SIGKILL behavior cannot be unit-tested. Add a manual test step to the Phase D3 guide:
1. Open a VSCode window and verify Hub is running (check `ps aux | grep accordo`)
2. Force-quit VSCode (Activity Monitor → Force Quit / `kill -9 <pid>`)
3. Wait 5 seconds and verify Hub is still running (it will be — orphan confirmed)
4. Re-open VSCode — verify a fresh Hub spawns on a different port
5. Document the orphan as known behavior

---

### REC-04 — Add stderr parse timeout and error handling to §5.2

Specify: if Hub does not print the port line within N seconds, Bridge throws `HubStartError` and surfaces an error notification in VSCode. This prevents Bridge from hanging indefinitely if Hub crashes early.

---

### REC-05 — Validate the opencode token re-read assumption before Phase E

Add an explicit acceptance criterion: "Verify opencode re-reads `opencode.json` (or queries `update_token`) after an MCP disconnect/reconnect." This must be confirmed in integration before the multi-session token-rotation feature can be considered done.

---

## 6. Decision Audit

### DECISION-MS-01 — Kill Hub on deactivate (reverse LCM-11)
**Verdict: AGREE**

Current code (`hub-manager.ts`, `extension.ts` LCM-11 comment) explicitly does NOT kill Hub on deactivate. This is the persistent-Hub model. The reversal is the correct design choice for an ephemeral model: if Bridge owns the Hub's lifecycle, it must end it. The only concern is the SIGKILL gap (BLOCK-01), which is accepted risk.

---

### DECISION-MS-02 — SIGHUP handler as orphan guard
**Verdict: NEEDS REVISION (see BLOCK-01)**

The handler exists (confirmed: `index.ts` line 278) and is correct for its use case (terminal close). However the document overstates its coverage. SIGHUP does not fire on SIGKILL of a VSCode window. Revise the language to accurately scope when this fires and acknowledge the SIGKILL gap.

---

### DECISION-MS-03 — Remove filesystem token/PID/port files
**Verdict: AGREE**

The three `writeFileSync` calls at `index.ts` lines 226-229 create shared mutable state that breaks multi-session isolation. Removing them is the right call. The document correctly identifies all three call sites. The port file removal has an implementation ordering concern (NB-03) but is not a design flaw.

---

### DECISION-MS-04 — Pass token via IPC at spawn time
**Verdict: AGREE**

This is the cleanest mechanism available. IPC is already used (confirmed via `process.disconnect()` and `ipc` stdio config in `hub-process.ts`). The token never touches the filesystem. The main constraint is that the Hub must receive the IPC message before the first agent connection — the architecture handles this by sending the token before calling `server.start()`.

---

### DECISION-MS-05 — Do NOT delete opencode.json on deactivate
**Verdict: AGREE**

VSCode's 5-second deactivation deadline makes file-write-on-deactivate unreliable. More importantly, leaving the file stale means the next agent connection will fail at Bearer auth (wrong token/URL) rather than at config-missing. This is the correct failure mode — a clear error over a silent missing-config situation.

---

### DECISION-MS-06 — sessionId written to opencode.json for agent session disambiguation
**Verdict: AGREE WITH OPEN QUESTION**

The mechanism is sound: Hub generates a UUID at startup, Bridge writes it to opencode.json, the MCP session includes the sessionId in all requests. The open question (OQ-03) about behavior on Hub restart should be addressed in the document, but does not invalidate the decision.

---

### DECISION-MS-07 — Port range of 20 ports from configured base
**Verdict: AGREE**

Confirmed in `index.ts` line 60 (`maxTries = 20`). This is already implemented. The range is wide enough to accommodate multiple simultaneous VSCode windows on the same machine. OQ-02 flags a race condition for simultaneous spawns, but this is unlikely in practice and the failure mode is benign (both Hubs start, each on different ports).

---

### DECISION-MS-08 — Rely on opencode re-reading opencode.json on reconnect
**Verdict: NEEDS VALIDATION (see NB-01)**

This assumption cannot be verified from the current codebase. If it is wrong, the entire token-rotation mechanism breaks. The decision should not be treated as settled until integration testing confirms it. Mark as "pending validation."

---

### DECISION-MS-09 — `update_token` MCP tool for mid-session token rotation
**Verdict: AGREE IN PRINCIPLE, OQ-04 UNRESOLVED**

The tool-based token update is a good fallback for agents that don't re-read config files. OQ-04 (which session's token is updated) must be resolved before implementation.

---

### DECISION-MS-10 — Single opencode.json per-workspace (not per-session)
**Verdict: AGREE**

Writing a single `opencode.json` per workspace is correct. Multiple simultaneous VSCode windows would overwrite each other's `opencode.json` — but OQ-02 notes that this scenario is unresolved. For the single-window (most common) case, this is correct. The multi-window race is a future concern.

---

## 7. Codebase Cross-Reference Summary

| Architecture claim | File | Line | Status |
|---|---|---|---|
| SIGHUP handler present | `packages/hub/src/index.ts` | 278 | ✅ Confirmed |
| IPC disconnect present | `packages/hub/src/index.ts` | 271 | ✅ Confirmed (but semantics differ — see BLOCK-01) |
| Token file write (to be removed) | `packages/hub/src/index.ts` | 226 | ✅ Confirmed stale |
| PID file write in Hub (to be removed) | `packages/hub/src/index.ts` | 228 | ✅ Confirmed stale |
| Port file write in Hub (to be removed) | `packages/hub/src/index.ts` | 229 | ✅ Confirmed stale |
| PID file write in Bridge (to be removed) | `packages/bridge/src/hub-process.ts` | 180-184 | ✅ Confirmed stale |
| `tokenFilePath` in `HubServerOptions` (to remove) | `packages/hub/src/server.ts` | 61 | ✅ Confirmed stale |
| Hub prints port to stderr | `packages/hub/src/index.ts` | 230 | ✅ Confirmed (format: `[hub] Listening on <host>:<port>`) |
| `deactivate()` does NOT kill Hub currently | `packages/bridge/src/extension.ts` | 210 | ✅ Confirmed (LCM-11 comment present) |
| `killHub()` SIGTERM+2s+SIGKILL | `packages/bridge/src/hub-process.ts` | ~209 | ❌ Not implemented — SIGKILL fallback absent |
| Port file read in Bridge `_applyPortFile()` (to remove) | `packages/bridge/src/hub-manager.ts` | 380-390 | ✅ Confirmed stale |
| `requirements-bridge.md` LCM-11 reversal needed | `docs/20-requirements/requirements-bridge.md` | LCM-11 | ✅ Confirmed stale |
| `requirements-hub.md` §8 PID section removal needed | `docs/20-requirements/requirements-hub.md` | §8 | ✅ Confirmed stale |
| `requirements-hub.md` §2.6 token rewrite removal needed | `docs/20-requirements/requirements-hub.md` | §2.6 | ✅ Confirmed stale |
| opencode.json uses `mcp.accordo` key | `packages/bridge/src/agent-config.ts` | 109 | ✅ Confirmed (matches doc) |
| Port range `maxTries = 20` | `packages/hub/src/index.ts` | 60 | ✅ Confirmed |

---

## Verdict

**CONDITIONAL PASS**

The architecture is sound and implementable. Before the implementation phase begins, the following must be resolved:

**Blocking (must fix in the architecture document before Phase B):**
- [BLOCK-01] Revise DECISION-MS-02 language to accurately scope SIGHUP coverage and acknowledge SIGKILL orphan risk
- [BLOCK-02] Specify `killHub()` async contract and interaction with the 5-second deactivation deadline

**Non-blocking (fix in architecture doc before Phase C):**
- [NB-01] Label DECISION-MS-08 as "pending validation" until integration confirmed
- [NB-02] Add `requirements-bridge.md §8.3` to the §13.4 update checklist
- [NB-03] Note atomic removal requirement for port file (same commit, both sides)
- [NB-04] Add missing items to §13.4 update checklist

**Open questions to resolve during Phase C/D:**
- [OQ-01] Stderr parse timeout value and failure behavior
- [OQ-02] Two simultaneous VSCode windows: opencode.json overwrite race
- [OQ-03] Explicit statement that Hub restart terminates all agent sessions
- [OQ-04] `update_token` multi-session semantics
