# Accordo IDE — Phase 1 Workplan

**Project:** accordo-ide  
**Phase:** 1 — Control Plane MVP (Hub + Bridge + Editor Tools)  
**Date:** 2026-03-02  
**Status:** APPROVED — Implementation Ready

---

## 1. TDD Methodology (Mandatory)

Every implementation module in this project follows a strict Test-Driven Development cycle. This section is **normative** — any agent or developer picking up a task MUST follow these steps in order. No exceptions. No shortcuts.

### 1.1 The TDD Cycle

Each module (e.g. `state-cache.ts`, `security.ts`, `tool-registry.ts`) goes through these phases:

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase A — Interfaces & Requirements                            │
│                                                                 │
│  1. Read the requirements for this module from the relevant     │
│     requirements doc (e.g. requirements-hub.md §5.2 for        │
│     state-cache).                                               │
│  2. Write/verify the TypeScript interfaces in                   │
│     @accordo/bridge-types or in the module's own types.         │
│  3. Define all public method signatures with JSDoc.             │
│  4. Verify every requirement has a corresponding interface      │
│     element — if a requirement is vague, clarify it NOW by      │
│     updating the requirements doc before proceeding.            │
│  5. Export stub implementation (empty methods that throw        │
│     "not implemented") so tests can import the module.          │
│                                                                 │
│  Deliverable: Compilable interfaces + stubs.                    │
├─────────────────────────────────────────────────────────────────┤
│  Phase A2 — Explain to Everyone                                 │
│                                                                 │
│  1. STOP. Do not proceed to tests yet.                          │
│  2. Explain the module to TWO audiences:                        │
│                                                                 │
│     A. Product Manager / Non-Technical Stakeholder:             │
│        - What problem does this module solve?                   │
│        - What does it DO in simple English? (no jargon)         │
│        - What can go wrong and what happens when it does?       │
│        - How will we know when it works correctly?              │
│                                                                 │
│     B. Technical Reviewer:                                      │
│        - What interfaces were defined?                          │
│        - Key design decisions and why (class vs functions,      │
│          ownership of types, error strategy)                    │
│        - How do these connect to the rest of the system?        │
│        - Any requirements gaps found and how they were resolved │
│                                                                 │
│  3. Wait for user acknowledgement before continuing.            │
│                                                                 │
│  Deliverable: User (technical or not) understands and approves. │
├─────────────────────────────────────────────────────────────────┤
│  Phase B — Write Failing Tests                                  │
│                                                                 │
│  1. Write test file(s) for the module. Use vitest.              │
│  2. For EVERY requirement in the spec, write at least one       │
│     test. The test name MUST reference the requirement ID       │
│     (e.g. "CONC-01: maintains in-flight counter").              │
│  3. Cover happy path, error cases, and edge cases.              │
│  4. Tests MUST import from the real module (not mocks of it).   │
│  5. Run the tests — they MUST ALL FAIL (red).                   │
│     If any test passes on the stub, the test is wrong.          │
│  6. Tests define the complete functional contract.              │
│     If you can't write a test for a requirement, the            │
│     requirement is incomplete — fix it first.                   │
│                                                                 │
│  Deliverable: Comprehensive failing test suite.                 │
├─────────────────────────────────────────────────────────────────┤
│  Phase B2 — Demonstrate to User                                 │
│                                                                 │
│  1. STOP. Do not write implementation code yet.                 │
│  2. Show the user the test file(s).                             │
│  3. Run the tests and show they all fail (red).                 │
│  4. Walk the user through what each test validates.             │
│  5. Confirm with the user that the test coverage is sufficient. │
│  6. Wait for user acknowledgement before continuing.            │
│                                                                 │
│  Deliverable: User approves the test suite.                     │
├─────────────────────────────────────────────────────────────────┤
│  Phase C — Implement                                            │
│                                                                 │
│  1. Write the implementation code.                              │
│  2. Only write code that makes failing tests pass.              │
│  3. Do not add behaviour that isn't tested.                     │
│  4. Keep the implementation minimal and clean.                  │
│                                                                 │
│  Deliverable: Implementation code.                              │
├─────────────────────────────────────────────────────────────────┤
│  Phase D — Iterate Until Green                                  │
│                                                                 │
│  1. Run the full test suite.                                    │
│  2. Fix any failing tests by correcting the implementation      │
│     (not by weakening the tests).                               │
│  3. If a test is genuinely wrong (testing the wrong thing),     │
│     explain WHY before changing it.                             │
│  4. Repeat until ALL tests pass (green).                        │
│  5. Run linter + type checker — zero errors.                    │
│                                                                 │
│  Deliverable: All tests green, lint clean, types clean.         │
├─────────────────────────────────────────────────────────────────┤
│  Phase D2 — Code Review                                         │
│                                                                 │
│  1. Run the full mandatory checklist from docs/coding-          │
│     guidelines.md §3 (Code Review Checklist).                   │
│  2. Run eslint: zero warnings on new code, zero errors total.   │
│  3. Run typecheck: zero TypeScript errors.                      │
│  4. Search for banned patterns:                                 │
│       grep -r ": any" src/  → must be empty                    │
│       grep -r "console\.log" src/ → must be empty              │
│       grep -r "TODO\|FIXME" src/ → no new ones added           │
│  5. Verify architectural constraints:                           │
│       - No handler functions in wire types                      │
│       - No VSCode imports in Hub packages                       │
│       - Security middleware is first on every endpoint          │
│  6. If ANY check fails → fix the code and return to Phase D     │
│     (run tests again after the fix).                            │
│  7. Only when ALL checks pass → proceed to Phase E.             │
│                                                                 │
│  Deliverable: Code review checklist fully signed off.           │
│               Green tests + clean lint + zero type errors.      │
├─────────────────────────────────────────────────────────────────┤
│  Phase E — User Approval                                        │
│                                                                 │
│  1. STOP. Show the user the final implementation.               │
│  2. Show the green test run.                                    │
│  3. Summarize what was built and how it maps to requirements.   │
│  4. Wait for explicit user approval.                            │
│                                                                 │
│  Deliverable: User approves the implementation.                 │
├─────────────────────────────────────────────────────────────────┤
│  Phase F — Commit & Cleanup                                     │
│                                                                 │
│  1. Stage all changed files.                                    │
│  2. Commit with a conventional commit message:                  │
│     feat(<module>): <what was implemented>                      │
│  3. Remove any temporary files, debug logs, or dead code.       │
│  4. Verify the full test suite still passes after cleanup.      │
│                                                                 │
│  Deliverable: Clean git commit. Ready for next module.          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Batching Rules

Phases may be **batched across related modules** within the same package to reduce context-switching and user checkpoint overhead. For example, all Hub core modules in Week 1 may complete Phase A + A2 together before moving to Phase B.

**Allowed batches:**
- **Phase A + A2** for all modules in a package (e.g. all Hub modules) — define all interfaces, then explain all of them to the user in one checkpoint.
- **Phase B + B2** for all modules in a package — write all failing tests, then demonstrate all of them in one checkpoint.
- **Phase D2** for all modules in a package — run the code review checklist across the full batch at once.
- **Phase E** for all modules in a package — show all green implementations in one approval round.
- **Phase F** may produce one commit per module or one commit per batch, at the implementer's discretion.

**Not allowed:**
- Batching across phases (e.g. doing Phase A for module X and Phase C for module Y simultaneously). All modules in a batch must be at the same phase.
- Skipping any phase. Batching changes the *grouping*, not the *sequence*.

### 1.3 Rules for Agents

1. **Never skip phases.** Every module goes through A → A2 → B → B2 → C → D → D2 → E → F.
2. **Never write implementation before tests.** Phase C cannot start until Phase B2 is complete.
3. **Every requirement gets a test.** If requirements-hub.md says "reject if Origin present and not localhost", there must be a test named `"validates Origin: rejects non-localhost"`.
4. **Tests reference requirement IDs.** Test descriptions include the requirement ID when one exists (e.g. `CONC-01`, `WS-05`, `CFG-06`).
5. **User checkpoints are blocking.** Phases A2, B2, and E require user response before continuing. Do not proceed silently.
6. **D2 code review is mandatory.** Use the full checklist in `docs/coding-guidelines.md §3`. No user approval without passing D2.
7. **One module at a time.** Complete the full A→F cycle for one module before starting the next. Never have two modules half-implemented.
8. **Fix requirements upstream.** If during testing you discover a requirement is ambiguous or incomplete, update the requirements doc first, then update the test.
9. **Commit per module.** Each module that completes Phase F gets its own git commit. Do not batch multiple modules into one commit.
10. **Run the Phase B Coverage Audit before B2.** Before presenting any test suite to the user, complete every item in §1.5. A missing test for a public API method is a Phase B failure, not a Phase C fix.
11. **Test each file in isolation before moving on.** After writing or editing a test file, run `pnpm vitest run src/__tests__/<file>.test.ts`. Never move to the next file while a transform or syntax error is present.
12. **Step-by-step spec means step-by-step tests.** Any spec that describes a multi-step conditional process (e.g. "if over budget, apply fallbacks in order: step 1 … step 2 …") MUST have one dedicated test per step. Do not combine steps in one assertion.
13. **Scan all secondary behaviors.** In addition to happy-path tests, every module's test file MUST cover: all error paths, all callback/event registration methods, all shutdown/cleanup methods, all "no-op when disconnected" guarantees. Use the public API scan from §1.5 rule 1 to ensure nothing is missed.

### 1.4 Test File Conventions

| Convention | Rule |
|---|---|
| Location | `packages/<package>/src/__tests__/<module>.test.ts` |
| Framework | vitest |
| Naming | `describe('<module>')` → `it('<REQ-ID>: <human description>')` |
| Mocking | Use vitest mocks. Mock external dependencies (node:http, ws, vscode API), never mock the module under test. |
| Assertions | Use strict equality. No loose `toBeTruthy()` when an exact value is expected. |
| Coverage target | 100% of requirements. Line coverage is a secondary metric — requirement coverage is primary. |

### 1.5 Phase B Mandatory Coverage Audit

Before calling Phase B complete, run this checklist against every test file. No Phase B2 checkpoint may be presented until all items are checked.

**1. Public API scan**
Open the module's source file. For every exported function and every public class method, confirm a test exists that calls it. Write a comment-list at the top of the test file if helpful:
```
// API checklist:
// ✓ validateOrigin — 9 tests
// ✓ validateBearer — 7 tests
// ✓ validateBridgeSecret — 5 tests
// ✓ generateToken — 4 tests
```

**2. Multi-step spec behavior — one test per step**
Any requirement that describes a sequential fallback or multi-step process MUST have one test per step, explicitly numbered:
- e.g. "If over budget: step 1 — omit null fields, step 2 — omit closed modalities, step 3 — truncate tools" → requires three separate `it()` blocks.

**3. Error path completeness**
For every method that can fail, verify ALL failure paths have a test:
- Every `async` method → test both resolved and rejected cases.
- Every "not connected" / "not found" / "invalid input" path → explicit test.
- If a spec says "returns error code -32004 when queue full" → that specific error code must appear in a test.

**4. Contract-first cross-reference for CLI/config modules**
Before writing any test that calls `parseArgs` or `resolveConfig`:
1. Open the actual TypeScript interface definition.
2. List every field explicitly: name, type, default, source (CLI flag vs env var).
3. Cross-reference each field against the test file. No field may be untested.
4. Any field sourced from env vars must have: (a) a test when the env var is set, (b) a test when it's absent (defaults or throws).

**5. Syntax validation per file**
After writing each test file, run it in isolation before moving on:
```
pnpm vitest run src/__tests__/<module>.test.ts
```
Catch syntax/transform errors immediately, not at end-of-batch. A failing test that says "not implemented" is correct. A transform error means fix now.

**6. Post-edit fragment scan**
After any batch edit (multi_replace_string_in_file), visually scan each modified file for:
- Duplicate code blocks (same `it()` or `describe()` appearing twice)
- Orphaned closing braces or unclosed blocks
- Missing blank lines between describe blocks

If anything looks wrong, run the per-file syntax check from item 5 immediately.

### 1.5 Commit Message Format

```
feat(<module>): <summary>

- Implements <list of requirement IDs>
- Tests: <number> passing
- Closes: <any tracked issue>
```

Example:
```
feat(state-cache): implement state cache with patch merging

- Implements requirements-hub §5.2: applyPatch, setSnapshot, getState, clearModalities
- Tests: 14 passing
```

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

### Week 1 — Foundations & Hub Core Modules

**Goal:** Shared types locked down. Hub core modules implemented with full TDD coverage.

**TDD execution order** (each module completes the full A→F cycle before the next begins):

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 1 | Monorepo scaffold + `@accordo/bridge-types` | architecture.md §2–3, requirements-hub.md §3.3–3.4 | A: all shared interfaces → B: type compilation tests → C: no logic, types only → F: commit |
| 2 | `security.ts` | requirements-hub.md §2.1 (auth), §5.6 | A→A2→B→B2→C→D→E→F |
| 3 | `state-cache.ts` | requirements-hub.md §5.2 | A→A2→B→B2→C→D→E→F |
| 4 | `tool-registry.ts` | requirements-hub.md §5.1 | A→A2→B→B2→C→D→E→F |
| 5 | `prompt-engine.ts` | requirements-hub.md §2.3, §5.3 | A→A2→B→B2→C→D→E→F |
| 6 | `bridge-server.ts` | requirements-hub.md §2.5, §5.4 | A→A2→B→B2→C→D→E→F |
| 7 | Hub `server.ts` wiring + `/health` | requirements-hub.md §2.4, §3.3 | A→A2→B→B2→C→D→E→F |

**Week 1 gate:** Hub process starts, `/health` returns OK, `/instructions` returns a prompt, WS accepts a connection. All unit tests green. Every requirement in hub §2–§5 has at least one passing test.

---

### Week 2 — MCP Protocol & Bridge Foundation

**Goal:** Hub speaks MCP. Bridge connects and manages Hub lifecycle.

**TDD execution order:**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 8 | `mcp-handler.ts` | requirements-hub.md §2.1, §5.5 | A→A2→B→B2→C→D→E→F |
| 9 | MCP stdio mode | requirements-hub.md §2.2 | A→A2→B→B2→C→D→E→F |
| 10 | Hub security integration (auth on endpoints) | requirements-hub.md §2.1 (Origin, Bearer on /mcp, /instructions) | A→A2→B→B2→C→D→E→F |
| 11 | `hub-manager.ts` (Bridge) | requirements-bridge.md §4 | A→A2→B→B2→C→D→E→F |
| 12 | `ws-client.ts` (Bridge) | requirements-bridge.md §5 | A→A2→B→B2→C→D→E→F |
| 13 | `extension-registry.ts` (Bridge) | requirements-bridge.md §7 | A→A2→B→B2→C→D→E→F |
| 14 | `command-router.ts` (Bridge) | requirements-bridge.md §5.2 | A→A2→B→B2→C→D→E→F |

**Week 2 gate:** Bridge starts Hub with persisted secrets, connects WS, MCP initialize + tools/list works over authenticated HTTP and stdio. Security baseline (bearer token, Origin validation) is **active** — no unprotected endpoints exist when Week 3 destructive tools arrive.

---

### Week 3 — State System & Editor Tools

**Goal:** Real IDE state flows. Editor tools are implemented and callable.

**TDD execution order:**

| # | Module | Requirements Source | TDD Phases |
|---|---|---|---|
| 15 | `state-publisher.ts` (Bridge) | requirements-bridge.md §6 | A→A2→B→B2→C→D→E→F |
| 16 | Editor tools: `open`, `close`, `scroll`, `reveal`, `focus`, `split` | requirements-editor.md §4.1–§4.8 | A→A2→B→B2→C→D→E→F |
| 17 | Editor tools: `highlight`, `clearHighlights` | requirements-editor.md §4.4–§4.5 | A→A2→B→B2→C→D→E→F |
| 18 | Terminal tools: `open`, `run`, `focus` + Terminal ID Map | requirements-editor.md §4.9–§4.11, §5.3 | A→A2→B→B2→C→D→E→F |
| 19 | Workspace tools: `getTree`, `search` | requirements-editor.md §4.12–§4.13 | A→A2→B→B2→C→D→E→F |
| 20 | Layout tools: `panel.toggle`, `zen`, `fullscreen` | requirements-editor.md §4.14–§4.16 | A→A2→B→B2→C→D→E→F |

**Note:** Module 18 (`terminal.run`) MUST include a confirmation dialog stub (hardcoded `destructive` danger level) — full confirmation policy moves to Week 4 but the guard must exist from first availability.

**Week 3 gate:** 16 tools registered, callable through MCP, returning correct results. State updates flow continuously. `/instructions` reflects real workspace state.

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

Every module is considered done when it has completed the full TDD cycle (§1.1 Phases A→F):

1. **Interfaces defined** — TypeScript types with JSDoc, compilable stubs (Phase A)
2. **User approved interfaces** — User acknowledged the design (Phase A2)
3. **Failing tests written** — Every requirement has at least one test; all tests fail on stubs (Phase B)
4. **User approved tests** — User acknowledged the test coverage (Phase B2)
5. **Implementation complete** — Code compiles with zero TypeScript errors (Phase C)
6. **All tests pass** — No failures, no ESLint warnings/errors (Phase D)
8. **Code review passed** — Full checklist in `docs/coding-guidelines.md §3` signed off; zero `any`, zero `console.log`, all architectural constraints met (Phase D2)
9. **User approved implementation** — User acknowledged the final result (Phase E)
10. **Committed** — Conventional commit, no dead code, test suite still green (Phase F)

Additional per-task checks:
- If interface change: `@accordo/bridge-types` updated first
- If behaviour change: requirements doc updated
- Commit message follows conventional commits (`feat:`, `fix:`, `test:`, `docs:`)
