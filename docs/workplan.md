# Accordo IDE — Phase 1 Workplan

**Project:** accordo-ide  
**Phase:** 1 — Control Plane MVP (Hub + Bridge + Editor Tools)  
**Date:** 2026-03-02  
**Status:** APPROVED — In Progress

---

## Current Status

> **As of 2026-03-02 — Week 3 in progress. Module 15 done. End-to-end stack verified. Requirements expanded to 24 tools (was 16). Starting module 16.**

| Week | Goal | Status |
|------|------|--------|
| Week 1 | Hub core modules + shared types | ✅ DONE — 156 tests passing, pushed to `main` |
| Week 2 | MCP protocol + Bridge foundation | ✅ DONE — 353 tests passing, pushed to `main` |
| Week 3 | State system + Editor tools | 🔄 IN PROGRESS — 445 tests, module 15 ✅, infra ✅, start module 16 |
| Week 4 | Agent integration + Confirmation flow | ⬜ Not started |
| Week 5 | Stabilisation + Documentation | ⬜ Not started |

**Completed packages:** `@accordo/bridge-types`, `accordo-hub` (14 modules incl. `/state` endpoint), `accordo-bridge` (6 modules incl. `extension.ts`)  
**Tests:** 445 total (Hub: 220, Bridge: 225). End-to-end stack verified: Bridge connects, state flows, `/instructions` and `/state` serve live IDE state.  
**Next module (Week 3, #16):** Editor view tools — `open`, `close`, `scroll`, `reveal`, `focus`, `split` (requirements-editor.md §4.1–§4.3, §4.6–§4.8)  
**Repo:** https://github.com/lshtram/accordo (`main` branch)

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
| 16 | Editor view tools: `open`, `close`, `scroll`, `reveal`, `focus`, `split` | requirements-editor.md §4.1–§4.3, §4.6–§4.8 | A→A2→B→B2→C→D→E→F |
| 17 | Editor decoration + save: `highlight`, `clearHighlights`, `save`, `saveAll`, `format` | requirements-editor.md §4.4–§4.5, §4.17–§4.19 | A→A2→B→B2→C→D→E→F |
| 18 | Terminal tools: `open`, `run`, `focus`, `list`, `close` + Terminal ID Map | requirements-editor.md §4.9–§4.11, §4.21–§4.22, §5.3 | A→A2→B→B2→C→D→E→F |
| 19 | Workspace tools: `getTree`, `search`; Diagnostics: `list` | requirements-editor.md §4.12–§4.13, §4.20 | A→A2→B→B2→C→D→E→F |
| 20 | Layout tools: `panel.toggle`, `zen`, `fullscreen`, `joinGroups`, `evenGroups` | requirements-editor.md §4.14–§4.16, §4.23–§4.24 | A→A2→B→B2→C→D→E→F |

**Note:** Module 18 (`terminal.run`) MUST include a confirmation dialog stub (hardcoded `destructive` danger level) — full confirmation policy moves to Week 4 but the guard must exist from first availability.

**Note:** Tool set expanded from 16 to 24 tools (added: `editor.save`, `editor.saveAll`, `editor.format`, `diagnostics.list`, `terminal.list`, `terminal.close`, `layout.joinGroups`, `layout.evenGroups`) — all specified in requirements-editor.md §4.17–§4.24.

**Week 3 gate:** 24 tools registered, callable through MCP, returning correct results. State updates flow continuously. `/instructions` reflects real workspace state.

---

### Week 4 — Agent Integration, Confirmation Flow & Polish

**Goal:** Agents auto-discover the Hub. Destructive tools are protected by confirmation dialogs. Reconnect is battle-tested.

**TDD execution order:**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 21 | MCP session management | requirements-hub.md §2.1 (session), §5.5 | A→A2→B→B2→C→D→E→F |
| 22 | Protocol version negotiation | requirements-hub.md §5.4, requirements-bridge.md WS-10 | A→A2→B→B2→C→D→E→F |
| 23 | Tool confirmation flow | requirements-bridge.md §5.2 (steps 4a-4b), architecture.md §7.3 | A→A2→B→B2→C→D→E→F |
| 24 | Audit log + rotation | requirements-hub.md §7 | A→A2→B→B2→C→D→E→F |
| 25 | Concurrency control | requirements-hub.md §9 (CONC-01 to CONC-07) | A→A2→B→B2→C→D→E→F |
| 26 | Agent config generation | requirements-bridge.md §8.2–§8.5 | A→A2→B→B2→C→D→E→F |
| 27 | Native MCP registration | requirements-bridge.md §8.1 | A→A2→B→B2→C→D→E→F |
| 28 | Reconnect hardening + state hold | requirements-bridge.md §5.1 (WS-06/07), architecture.md §8 | A→A2→B→B2→C→D→E→F |
| 29 | PID file lifecycle | requirements-hub.md §8 | A→A2→B→B2→C→D→E→F |
| 30 | Credential rotation (`/bridge/reauth`) | requirements-hub.md §2.6, requirements-bridge.md LCM-12 | A→A2→B→B2→C→D→E→F |

**Week 4 gate:** Full integration active. Confirmation dialogs gate destructive tools. At least one real agent (Claude Code, OpenCode, or Copilot) connects and successfully uses tools. Reconnect after Bridge reload is seamless.

---

### Week 5 — Stabilization & Documentation

**Goal:** Release-quality code. Comprehensive docs. All edge cases handled.

| Day | Task | Output |
|---|---|---|
| Mon | Edge case handling: tool timeout retry (idempotent), concurrent invocations, large workspace tree | Edge cases covered |
| Mon | Remote development smoke test: SSH, devcontainer, Codespaces (at least SSH tested locally) | Remote works |
| Tue | Error recovery: Hub crash → Bridge restart, WS message flood protection, malformed message handling | Resilience verified |
| Tue | Performance validation: state update < 200ms, tool call overhead < 10ms, prompt render < 50ms | Performance targets met |
| Wed | README for each package: installation, usage, configuration, troubleshooting | 4 README files |
| Wed | Update architecture.md with any changes discovered during implementation | Architecture final |
| Thu | CHANGELOG.md, LICENSE, CONTRIBUTING.md at repo root | Repo boilerplate done |
| Thu | CI setup: lint + type-check + unit tests + integration tests in GitHub Actions | CI green |
| Fri | Final review pass: code quality, remaining TODOs, version bumps | v0.1.0 tagged |
| Fri | Phase 1 retrospective document: what worked, what needs revision for Phase 2 | Retro written |

**Week 5 gate:** All tests pass in CI. READMEs complete. v0.1.0 ready for Phase 2 planning.

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
│       │   │   ├── workspace.ts
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
