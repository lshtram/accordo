> STATUS: ARCHIVED — 2026-03-03
> Phase 1 complete. All 34 modules done. 797 tests. v0.1.0 tagged. Active work continues in docs/workplan.md (Phase 2).

# Accordo IDE — Phase 1 Workplan

**Project:** accordo-ide  
**Phase:** 1 — Control Plane MVP (Hub + Bridge + Editor Tools)  
**Date:** 2026-03-03  
**Status:** APPROVED — In Progress

---

## Current Status

> **As of 2026-03-03 — Week 5 complete. 797 tests passing. v0.1.0 tagged. Phase 1 done.**

| Week | Goal | Status |
|------|------|--------|
| Week 1 | Hub core modules + shared types | ✅ DONE — 156 tests passing, pushed to `main` |
| Week 2 | MCP protocol + Bridge foundation | ✅ DONE — 353 tests passing, pushed to `main` |
| Week 3 | State system + Editor tools | ✅ DONE — 665 tests passing, pushed to `main` |
| Week 4 | Agent integration + Confirmation flow | ✅ DONE — 780 tests passing, pushed to `main` |
| Week 5 | Stabilisation + Documentation | ✅ DONE — 797 tests, docs, CI, v0.1.0 tagged |

**Completed packages:** `@accordo/bridge-types`, `accordo-hub` (full MCP stack + audit log + concurrency + stabilisation, 329 passing), `accordo-bridge` (agent configs + credential rotation + PID lifecycle, 296 passing), `accordo-editor` (21 tools, 172 passing)  
**Tests:** 797 total green (Hub: 329, Bridge: 296, Editor: 172). All modules M1–M34 implemented and green. Pre-push hook active.  
**Docs:** README (root + 4 packages), CHANGELOG, LICENSE, CONTRIBUTING, architecture, retrospective  
**CI:** GitHub Actions workflow (build + test + typecheck)  
**Repo:** https://github.com/lshtram/accordo (`main` branch, v0.1.0)

---

> **Development process:** All module implementation in this project follows the TDD cycle defined in [`docs/dev-process.md`](dev-process.md). When a task says "TDD", that document is mandatory and normative. See also [`AGENTS.md`](../AGENTS.md) for mode-selection rules.

---

## 2. Phase 1 Goal

Deliver a working system where an MCP-capable AI agent can connect to a running VSCode instance, see IDE state in real time, and execute 16 editor/terminal/workspace tools. The human developer and agent share one workspace with zero custom chat UI.

**Exit criteria:**
- Agent (Claude Code, OpenCode, or Copilot) connects via MCP
- Agent sees active file, open editors, workspace folders in system prompt
- Agent can open files, run terminal commands, search workspace through tools
- State updates flow in < 200ms from VSCode event to system prompt
- All communication is authenticated and loopback-only
- Reconnect after VSCode reload works without data loss

---

## 3. Deliverables

| # | Deliverable | Package | Description |
|---|---|---|---|
| D1 | `@accordo/bridge-types` | npm | TypeScript type definitions: IDEState, ToolRegistration, BridgeAPI, ExtensionToolDefinition, WS messages |
| D2 | `accordo-hub` | npm | Standalone MCP server with WS bridge, state cache, prompt engine |
| D3 | `accordo-bridge` | vsix | VSCode extension: Hub lifecycle, WS client, BridgeAPI, state publisher |
| D4 | `accordo-editor` | vsix | VSCode extension: 16 editor/terminal/workspace tools |
| D5 | Documentation | — | Architecture doc, requirements per module, README per package |
| D6 | Integration tests | — | Full stack: agent → Hub → Bridge → Editor → result |

---

## 4. Package Dependency Graph

```
@accordo/bridge-types       (no dependencies)
        ▲
        │
   ┌────┴─────┐
   │           │
accordo-hub  accordo-bridge  (both depend on bridge-types)
                    ▲
                    │
              accordo-editor  (depends on bridge at runtime via extensionDependencies)
```

**Build order:** `bridge-types` → `hub` + `bridge` (parallel) → `editor`

---

## 5. Weekly Plan

> **Important:** Every task within each week follows the TDD cycle defined in §1. The "Output" column describes the Phase D deliverable (green tests + clean code). Phases A2, B2, D2, and E checkpoints apply to each logical module.
>
> Weeks 1 and 2 are complete. See the **DONE** section at the bottom of this file for the full records.

### Week 3 — State System & Editor Tools

**Goal:** Real IDE state flows. Editor tools are implemented and callable.

**TDD execution order:**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 15 | `state-publisher.ts` (Bridge) | requirements-bridge.md §6 | ✅ DONE — 89 tests |
| — | `BridgeServer` WS handler (Hub) | requirements-hub.md §2.5, §3 | ✅ DONE — fully wired, e2e verified |
| — | `extension.ts` entry point (Bridge) | requirements-bridge.md §1, §7 | ✅ DONE — all 5 modules wired |
| — | Hub infra: token/PID file, `/state` endpoint | requirements-hub.md §4.2, §2.3 | ✅ DONE — deployed |
| 16 | Editor view tools: `open`, `close`, `scroll`, `reveal`, `focus`, `split` | requirements-editor.md §4.1–§4.3, §4.6–§4.8 | ✅ DONE |
| 17 | Editor decoration + save: `highlight`, `clearHighlights`, `save`, `saveAll`, `format` | requirements-editor.md §4.4–§4.5, §4.17–§4.19 | ✅ DONE |
| 18 | Terminal tools: `open`, `run`, `focus`, `list`, `close` + Terminal ID Map | requirements-editor.md §4.9–§4.11, §4.21–§4.22, §5.3 | ✅ DONE |
| 19 | ~~Workspace tools: `getTree`, `search`; Diagnostics: `list`~~ | ~~requirements-editor.md §4.12–§4.13, §4.20~~ | ❌ REMOVED — redundant with agent bash tools |
| 20 | Layout tools: `panel.toggle`, `zen`, `fullscreen`, `joinGroups`, `evenGroups` | requirements-editor.md §4.14–§4.16, §4.23–§4.24 | ✅ DONE |

**Note:** Module 18 (`terminal.run`) confirmation dialog guard was prototyped then removed — `showWarningMessage` blocked the async handler waiting for human click. Full confirmation policy moves to Week 4 (Module 23).

**Note:** Tool set expanded from 16 to 21 tools. Module 19 workspace tools (`getTree`, `search`, `diagnostics.list`) were removed after live MCP testing — those operations are redundant with agent bash tools. Final set: 11 `editor.*` + 5 `terminal.*` + 5 `layout/panel.*`.

**Week 3 gate:** ✅ PASSED — 21 tools registered and callable through MCP. 665 tests green (editor: 172, bridge: 232, hub: 261). Strategy A e2e suite (28 tests) added. Pre-push hook active.

---

### Week 4 — Agent Integration, Confirmation Flow & Polish

**Goal:** Agents auto-discover the Hub. Destructive tools are protected by confirmation dialogs. Reconnect is battle-tested.

**TDD execution order:**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 21 | MCP session management | requirements-hub.md §2.1 (session), §5.5 | ✅ DONE |
| 22 | Protocol version negotiation | requirements-hub.md §5.4, requirements-bridge.md WS-10 | ✅ DONE |
| 23 | Tool confirmation flow | requirements-bridge.md §5.2 (steps 4a-4b), architecture.md §7.3 | ✅ DONE |
| 24 | Audit log + rotation | requirements-hub.md §7 | ✅ DONE |
| 25 | Concurrency control | requirements-hub.md §9 (CONC-01 to CONC-07) | ✅ DONE |
| 26 | Agent config generation | requirements-bridge.md §8.2–§8.5 | ✅ DONE |
| 27 | Native MCP registration | requirements-bridge.md §8.1 | ✅ DONE |
| 28 | Reconnect hardening + state hold | requirements-bridge.md §5.1 (WS-06/07), architecture.md §8 | ✅ DONE — core WS reconnect; grace-window timer (M31) is Week 5 |
| 29 | PID file lifecycle | requirements-hub.md §8 | ✅ DONE |
| 30 | Credential rotation (`/bridge/reauth`) | requirements-hub.md §2.6, requirements-bridge.md LCM-12 | ✅ DONE |

**Week 4 gate:** ✅ PASSED — All 10 modules delivered and manually verified. 780 tests green (Hub: 312, Bridge: 296, Editor: 172). Agent config files written on Hub ready. Audit log correctly classifies soft errors. PID file written from parent process. Each config write is fault-isolated.

---

### Week 5 — Stabilization & Documentation

**Goal:** Release-quality code. Comprehensive docs. All edge cases handled.

**TDD stubs already written (RED — implement to make green):**

| # | Module | Requirements Source | Status |
|---|---|---|---|
| 31 | State hold grace window (`graceWindowMs`, `onGraceExpired`, `handleConnect`) | architecture.md §3.6, requirements-hub.md §9 | ✅ DONE — 6 tests in `bridge-server.test.ts` |
| 32 | Idempotent retry on timeout (`idempotent` flag, single retry in McpHandler) | architecture.md §8.3 | ✅ DONE — 5 tests in `mcp-handler.test.ts` |
| 33 | WS flood protection (`maxMessagesPerSecond`, rate gate in `handleMessage`) | requirements-hub.md §9 | ✅ DONE — 4 tests in `bridge-server.test.ts` |
| 34 | WS message size limit (`maxPayload` passed to WebSocketServer constructor) | requirements-hub.md §9 | ✅ DONE — 2 tests in `bridge-server-m34.test.ts` |

| Day | Task | Output |
|---|---|---|
| Mon | ✅ Implement M31–M34 (grace window, idempotent retry, flood protection, max payload) | 17 RED tests → green (797 total) |
| Mon | ✅ Remote development smoke test: SSH, devcontainer, Codespaces (at least SSH tested locally) | Remote works |
| Tue | ✅ Performance validation: state update < 200ms, tool call overhead < 10ms, prompt render < 50ms | Performance targets met |
| Wed | ✅ README for each package: installation, usage, configuration, troubleshooting | 5 README files (root + 4 packages) |
| Wed | ✅ Update architecture.md with M31–M34 implementation details | Architecture final |
| Thu | ✅ CHANGELOG.md, LICENSE, CONTRIBUTING.md at repo root | Repo boilerplate done |
| Thu | ✅ CI setup: lint + type-check + unit tests in GitHub Actions | CI config committed |
| Fri | ✅ Final review pass: code quality, remaining TODOs, version bumps | v0.1.0 tagged |
| Fri | ✅ Phase 1 retrospective document: what worked, what needs revision for Phase 2 | `docs/retrospective.md` |

**Week 5 gate:** ✅ PASSED. All tests pass (797). READMEs complete. CI workflow committed. Architecture updated. Retrospective written. v0.1.0 tagged.

---

## 6. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| MCP Streamable HTTP spec ambiguity in edge cases | Medium | Fall back to stdio as primary transport. HTTP is bonus. |
| `vscode.lm` API not yet stable | Low | Feature-flag the native MCP registration. Manual config works. |
| `findTextInFiles` API missing in older VSCode | Low | Target VSCode >=1.100.0. API is stable at that version. |
| Hub process orphaned after VSCode crash | Medium | PID file at `~/.accordo/hub.pid`. Bridge checks on startup. |
| Tool handler blocks extension host | High | All handlers MUST be async. Add 5s watchdog per handler. |
| Large workspace overwhelms getTree | Medium | Strict 1000-node cap with truncation. Depth default of 3. |

---

---

## DONE

### Week 1 — Foundations & Hub Core Modules (completed 2026-03-02)

**Goal:** Shared types locked down. Hub core modules implemented with full TDD coverage.

**Actual result:** 156 tests passing + 2 `it.todo` for Week 2 continuation. Zero TypeScript errors. Clean `pnpm build`. All 13 commits pushed to `main` at https://github.com/lshtram/accordo.

| # | Module | Requirements Source | Tests | Status |
|---|---|---|---|---|
| 1 | Monorepo scaffold + `@accordo/bridge-types` | architecture.md §2–3, requirements-hub.md §3.3–3.4 | type compilation | ✅ |
| 2 | `security.ts` | requirements-hub.md §2.1, §5.6 | 25 | ✅ |
| 3 | `state-cache.ts` | requirements-hub.md §5.2 | 19 | ✅ |
| 4 | `tool-registry.ts` | requirements-hub.md §5.1 | 16 | ✅ |
| 5 | `prompt-engine.ts` | requirements-hub.md §2.3, §5.3 | 19 | ✅ |
| 6 | `bridge-server.ts` | requirements-hub.md §2.5, §5.4 | 20 | ✅ |
| 7 | `mcp-handler.ts` | requirements-hub.md §2.1, §5.5 | 18 + 2 todo | ✅ |
| 8 | `server.ts` | requirements-hub.md §2.4, §3.3 | 17 | ✅ |
| 9 | `index.ts` | requirements-hub.md §4.1, §4.2 | 22 | ✅ |
| 10 | `errors.ts` (JsonRpcError) | coding-guidelines.md §1.4 | via bridge-server tests | ✅ |

**Week 1 gate verdict:** ✅ Pass. Hub builds and all unit tests green. HTTP listener and WebSocket bridge are stubs; fully wired in Week 2.

**Spec gaps discovered and resolved during implementation:**
- `ACCORDO_HUB_PORT` env var was under-specified → requirements-hub.md §4.2 (resolveConfig) clarified; test added
- Prompt engine uses "always-compact mode" (deterministic, not progressive) → JSDoc documents intent; progressive fallback deferred to Week 2
- Queue-full check must precede connection check for unit testability → bridge-server.ts check order, verified in CONC-04 test

**Review archived:** `docs/week1-review-report.md` — 8 findings raised, all resolved and verified.

---

### Week 2 — MCP Protocol & Bridge Foundation (completed 2026-03-02)

**Goal:** Hub speaks MCP. Bridge connects and manages Hub lifecycle.

**Actual result:** 353 tests passing across two packages (Hub: 220, Bridge: 133). Zero TypeScript errors in all source files. Clean `pnpm build`. Live HTTP + stdio smoke-tested via `curl` and automated integration tests. 8 module commits + 1 hub-cli commit pushed to `main`.

| # | Module | Requirements Source | Tests | Status |
|---|---|---|---|---|
| 8 | `mcp-handler.ts` — tools/call dispatch | requirements-hub.md §2.1, §5.5, §6 | 29 | ✅ |
| 9 | `stdio-transport.ts` — MCP over stdin/stdout | requirements-hub.md §2.2 | 18 | ✅ |
| 10 | `server.ts` — HTTP routing, security, start/stop | requirements-hub.md §2.1, §2.3, §2.4, §2.6, §5.6 | 39 | ✅ |
| — | `index.ts` — CLI main() HTTP + stdio entrypoint | requirements-hub.md §4.1, §4.2 | 22 + 13 smoke | ✅ |
| 11 | `hub-manager.ts` (Bridge) — Hub process lifecycle | requirements-bridge.md §1 (LCM-01..12) | 36 | ✅ |
| 12 | `ws-client.ts` (Bridge) — WebSocket client | requirements-bridge.md §2 (WS-01..10) | 50 | ✅ |
| 13 | `extension-registry.ts` (Bridge) — tool registration | requirements-bridge.md §7 (REG-01..06) | 23 | ✅ |
| 14 | `command-router.ts` (Bridge) — invoke/cancel routing | requirements-bridge.md §4 (CMD-01..08) | 24 | ✅ |

**Week 2 gate verdict:** ✅ Pass. Hub HTTP server running on configurable port. MCP initialize, tools/list, tools/call, ping work over HTTP and stdio. Bearer auth + Origin validation active on all authenticated endpoints. Bridge WsClient connects with exponential backoff. ExtensionRegistry debounces tool sends. CommandRouter dispatches invoke/cancel to extension handlers.

**Spec gaps discovered and resolved during implementation:**
- Hub `/mcp` returned 404 for wrong HTTP method → added 405 with `Allow: POST` header; test added in smoke suite
- `stdio-transport.ts` buffer needed to handle multi-chunk inputs → buffer accumulation implemented
- `server.ts start()` test was minimal (Promise only) — real implementation wired HTTP + WS in one call; test still passes

---

### Week 3 — State System & Editor Tools (completed 2026-03-02)

**Goal:** Real IDE state flows. Editor tools are implemented and callable.

**Actual result:** 665 tests passing across three packages (Hub: 261, Bridge: 232, Editor: 172). 21 tools registered and callable through MCP. Module 19 workspace tools removed after live MCP testing (redundant with agent bash tools). `terminal.run` blocking dialog removed (was preventing async response). Strategy A e2e test suite added (28 tests, `bridge-e2e.test.ts`). Pre-push git hook wired.

| # | Module | Requirements Source | Tests | Status |
|---|---|---|---|---|
| 15 | `state-publisher.ts` (Bridge) | requirements-bridge.md §6 | 89 | ✅ |
| — | `BridgeServer` WS handler (Hub) | requirements-hub.md §2.5, §3 | via hub suite | ✅ |
| — | `extension.ts` entry point (Bridge) | requirements-bridge.md §1, §7 | via bridge suite | ✅ |
| 16 | Editor view tools: `open`, `close`, `scroll`, `reveal`, `focus`, `split` | requirements-editor.md §4.1–§4.3, §4.6–§4.8 | part of 172 | ✅ |
| 17 | Editor decoration + save: `highlight`, `clearHighlights`, `save`, `saveAll`, `format` | requirements-editor.md §4.4–§4.5, §4.17–§4.19 | part of 172 | ✅ |
| 18 | Terminal tools: `open`, `run`, `focus`, `list`, `close` | requirements-editor.md §4.9–§4.11, §4.21–§4.22, §5.3 | part of 172 | ✅ |
| 19 | ~~Workspace tools: `getTree`, `search`; Diagnostics: `list`~~ | removed | 0 | ❌ removed |
| 20 | Layout tools: `panel.toggle`, `zen`, `fullscreen`, `joinGroups`, `evenGroups` | requirements-editor.md §4.14–§4.16, §4.23–§4.24 | part of 172 | ✅ |
| — | Strategy A e2e suite (`bridge-e2e.test.ts`) | architecture.md | 28 | ✅ |

**Week 3 gate verdict:** ✅ Pass. 21 tools registered, callable, returning correct results. 665 tests green. Pre-push hook active. All stale review docs archived to `docs/archive/`.

**Key decisions and fixes during implementation:**
- `terminal.run` blocking confirmation dialog removed — `showWarningMessage` blocked the async MCP response handler until human clicked OK; full confirmation flow design deferred to Week 4 Module 23
- `terminal.close` extended with name-based fallback — untracked terminals (no ID in map) can now be closed by name
- Module 19 workspace tools removed after live MCP session — `getTree`, `search`, `diagnostics.list` are all reachable by agents via bash; adding them as MCP tools adds noise with no benefit
- `toolCallTimeout` made injectable in `McpHandlerDeps` and `HubServerOptions` — enables sub-second timeouts in unit tests; prevents 30 s waits
- Strategy A e2e model adopted: `StubBridge` (real `ws` client) + `McpSession` (real `fetch` wrapper) — tests full HTTP+WS+JSON-RPC stack without VS Code

**Review archived:** `docs/archive/review.md`, `docs/archive/testing-guide-bridge.md`, `docs/archive/testing-guide-editor.md`, `docs/archive/diag_arch_v3.1.md`, `docs/archive/diag_arch_v4.0.md` — all superseded by current state.

---

### Week 4 — Agent Integration & Confirmation Flow (completed 2026-03-03)

**Goal:** Agents can self-install. Confirmation flow works. Audit log reliable. PID and config files generated correctly at runtime.

**Actual result:** 780 tests passing across three packages (Hub: 312, Bridge: 296, Editor: 172). All 10 modules delivered. Three P1 runtime bugs discovered in manual validation and fixed with tests before close. 17 RED stubs written for Week 5 (M31–M34). Commit `daacf2e` pushed to `main`.

| # | Module | Requirements Source | Tests | Status |
|---|---|---|---|---|
| 21 | `agent-config.ts` — `writeAgentConfigs` opencode + Claude | requirements-bridge.md §8 (CFG-01..10) | 10 | ✅ |
| 22 | `extension-registry.ts` — tool-count metrics + `describe` | requirements-bridge.md §7 (REG-07..09) | part of bridge suite | ✅ |
| 23 | Confirmation flow (`command-router.ts` + `state-publisher`) | requirements-bridge.md §4 CMD-09, requirements-hub.md §2.1 | part of bridge suite | ✅ |
| 24 | Audit log reliability (M24 soft error `data.error` classification) | requirements-hub.md §6 (AUD-01..08) | part of hub suite | ✅ |
| 25 | Tool call queue observability (`queueLength` in `/health`) | requirements-hub.md §5.5 | part of hub suite | ✅ |
| 26 | `writeOpencodeConfig` — writes `opencode.json` to workspace root | requirements-bridge.md §8 | part of bridge suite | ✅ |
| 27 | `writeClaudeConfig` — writes `.claude/mcp.json` to workspace root | requirements-bridge.md §8 | part of bridge suite | ✅ |
| 28 | Reconnect hardening + state hold | requirements-bridge.md §5.1 (WS-06/07), architecture.md §8 | part of bridge suite | ✅ core done; grace-window timer (M31) = Week 5 |
| 29 | Hub PID runtime wiring (`hub-manager.ts` parent writes PID) | requirements-bridge.md §1 (LCM-10) | 2 new tests | ✅ |
| 30 | `audit-log.ts` — append+sync, startup rotation, GZip archive | requirements-hub.md §6 | part of hub suite | ✅ |

**Week 4 gate verdict:** ✅ PASSED. All modules delivered. 780 green tests. Manual validation performed; 3 P1 issues found and patched within the same phase. 17 Week 5 RED stubs committed.

**P1 runtime bugs found in manual testing and fixed:**

1. **M24 — Audit log soft error misclassification:** Editor tools catch VS Code exceptions and return `{ success: true, data: { error: "..." } }`. The `mcp-handler.ts` audit path only classified `result.success === false` as "error" — the `data.error` shape always fell through to `audit("success")`. Fix: inspect `result.data` for `{ error: string }` after the success gate; classify as `audit("error")` and return `isError: true` to the MCP client.

2. **M26/M27 — Agent config files not generated:** The `.claude/` directory on the test machine was owned by a different OS user (`opencode`), causing `writeClaudeConfig` to throw. Because `writeAgentConfigs` had no per-call fault isolation, the exception propagated and aborted both writes — `opencode.json` was never written either. Fix: wrap each write independently in try/catch; log warning via outputChannel on failure. Also attempt `chmod 700` on `.claude/` before writing.

3. **M29 — `hub.pid` not written while Hub was running:** `spawn()` relied on the Hub child process writing its own PID inside `main()` — a race with `pollHealth()` and parent-side PID detection. Fix: write `proc.pid` to `pidFilePath` from the parent process immediately after `execFile()` returns (best-effort, fs-sync); unlink on exit handler.

**Key decisions and fixes during implementation:**
- `agent-config.ts` fault isolation: each config write is independently try/caught so one failure never prevents the other
- Week 5 scope clarified: grace-window timer and flood protection (M31/M33) are architectural additions to `bridge-server.ts`; idempotent retry (M32) is a new `McpHandler` flag; max payload (M34) is a `WebSocketServer` constructor option
- 17 RED stubs committed in `bridge-server.test.ts` and `mcp-handler.test.ts` to preserve TDD discipline for Week 5

---

### Week 5 — Stabilisation: M31–M34 (completed 2026-03-03)

**Goal:** Hub hardening — grace window, idempotent retry, flood protection, message size limit.

**Actual result:** 797 tests passing (Hub: 329, Bridge: 296, Editor: 172). All 4 stabilisation modules implemented and committed. TypeScript clean. Remaining Week 5 tasks (docs, CI, README, v0.1.0) are non-blocking for current functionality.

| # | Module | Requirements Source | Tests | Status |
|---|---|---|---|---|
| 31 | State hold grace window | architecture.md §3.6, requirements-hub.md §9 | 6 | ✅ |
| 32 | Idempotent retry on timeout | architecture.md §8.3 | 5 | ✅ |
| 33 | WS flood protection | requirements-hub.md §9 | 4 | ✅ |
| 34 | WS message size limit | requirements-hub.md §9 | 2 | ✅ |

**Week 5 M31–M34 gate verdict:** ✅ PASSED. 797 green tests. TypeScript clean. Commits `1cdde1e`, `f622ae4`, `9f1991c` pushed to `main`.

**Design decisions:**
- `handleConnect(ws)` added as private complement to `handleDisconnect()` — wired via `wss.on("connection")` in `start()`; cancels grace timer on reconnect
- `graceWindowMs=0` fires `onGraceExpired` synchronously, not via `setTimeout(0)`, to be predictable in tests
- M32 retry only triggers on timeout (`code -32000` or message contains "timed out") and only for `idempotent: true` tools; audit log records both original timeout and retry outcome
- M33 uses a simple sliding 1-second window counter (no token bucket); resets on first message after window expires; never closes the WS on flood
- M34 tests isolated in `bridge-server-m34.test.ts` to avoid ESM read-only error when replacing `ws.WebSocketServer` — `vi.mock("ws")` must be hoisted at module scope

---

## Deferred Backlog (Non-Blocking)

Captured on 2026-03-03 from Week 4 review/testing. These are intentionally deferred and should not block current phase completion unless they become reproducible production failures.

1. **M29 PID cleanup race risk**  
When a Hub child exits, `HubManager` currently unlinks `pidFilePath` unconditionally. If a newer process has already written a new PID, the old process exit may remove the newer PID file.  
Suggested follow-up: unlink only when file content matches the exiting child PID.

2. **Week 4 manual guide — M24 error case clarity**  
The current manual error example can return a soft tool payload depending on workspace/path policy, which may look like a “success” envelope.  
Suggested follow-up: use one deterministic failing call in the guide that always exercises the audit `result: "error"` path.

3. **Week 4 manual guide — M25 queue observability**  
On fast local runs, burst tests may complete before `/health` polling shows `queued > 0`, making the manual check inconclusive.  
Suggested follow-up: add an optional “slow tool / forced delay” variant to make queue growth observable in manual validation.

4. **Claim hygiene in phase summaries**  
When local sandbox constraints (`listen EPERM`) prevent full suite execution, summaries should explicitly separate “verified here” vs “verified previously/in another environment”.  
Suggested follow-up: keep this as a process note for future phase reports.

---

## 7. Phase 2 Readiness Criteria

Phase 2 (Slidev presentation modality) can begin only when:

1. All Phase 1 tests pass
2. At least one agent (Claude Code or OpenCode) has been used for a real coding session
3. BridgeAPI is confirmed stable (no breaking changes needed from editor tool implementation)
4. Architecture.md is updated with final state
5. Reconnect/state recovery is verified in at least two scenarios (reload + restart)
6. Phase 1 retrospective is complete with lessons for Phase 2

---

## 8. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo tool | pnpm workspaces + TypeScript project references | Fast installs, single lockfile, type-checked cross-references |
| Build tool | tsup (esbuild) | Fast builds. Extensions need single-file bundle. |
| Test framework | vitest | Fast, TypeScript-native, good VSCode test support |
| VSCode test runner | `@vscode/test-electron` | Required for integration tests against real VSCode |
| HTTP server | `node:http` (no framework) | Minimal dependencies. MCP Streamable HTTP is simple enough for raw HTTP. |
| WebSocket | `ws` npm package | Standard, fast, well-maintained |
| Linter | ESLint + Prettier | Standard tooling |
| CI | GitHub Actions | Free for open source, good VSCode test support |

---

## 9. Monorepo Structure

```
accordo-ide/
├── packages/
│   ├── bridge-types/          @accordo/bridge-types
│   │   ├── src/
│   │   │   └── index.ts       All shared TypeScript interfaces
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── hub/                   accordo-hub
│   │   ├── src/
│   │   │   ├── index.ts       CLI entry
│   │   │   ├── server.ts      HTTP server
│   │   │   ├── mcp-handler.ts
│   │   │   ├── bridge-server.ts
│   │   │   ├── tool-registry.ts
│   │   │   ├── state-cache.ts
│   │   │   ├── prompt-engine.ts
│   │   │   ├── security.ts
│   │   │   ├── protocol.ts
│   │   │   └── health.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── bridge/                accordo-bridge
│   │   ├── src/
│   │   │   ├── extension.ts
│   │   │   ├── hub-manager.ts
│   │   │   ├── ws-client.ts
│   │   │   ├── command-router.ts
│   │   │   ├── state-publisher.ts
│   │   │   ├── extension-registry.ts
│   │   │   ├── mcp-registration.ts
│   │   │   ├── protocol.ts
│   │   │   └── config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── editor/                accordo-editor
│       ├── src/
│       │   ├── extension.ts
│       │   ├── tools/
│       │   │   ├── editor.ts
│       │   │   ├── terminal.ts
│       │   │   └── layout.ts
│       │   └── util.ts
│       ├── package.json
│       └── tsconfig.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json               root scripts
├── .github/
│   └── workflows/
│       └── ci.yml
├── README.md
├── LICENSE
└── CHANGELOG.md
```

---

## 10. Definition of Done (per module)

See [`docs/dev-process.md §7`](dev-process.md#7-definition-of-done-per-module) for the full checklist (Phases A→F).
