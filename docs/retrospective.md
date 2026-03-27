# Accordo IDE — Phase 1 Retrospective

**Date:** 2026-03-03  
**Scope:** Phase 1 Control Plane MVP — Hub + Bridge + Editor Tools  
**Duration:** 5 weeks (2026-02-28 to 2026-03-03)

---

## Summary

Phase 1 delivered a complete MCP-based AI co-pilot layer on top of VSCode:
- 4 packages (`bridge-types`, `hub`, `bridge`, `editor`)
- 34 modules implemented via strict TDD
- 797 tests passing (Hub: 329, Bridge: 296, Editor: 172)
- 21 MCP tools (11 editor, 5 terminal, 5 layout)
- Zero `:any`, zero `console.log` in source
- Full documentation suite (architecture, requirements, testing guides)

---

## What Worked Well

### 1. TDD Discipline
The A→B→B2→C→D→D2→D3→E→F cycle caught design issues early. Writing tests before implementation forced clear thinking about module boundaries and error paths. The Phase B coverage audit (§5 in `~/.config/opencode/dev-process.md`) was particularly valuable — it prevented the common pattern of "write tests that match the implementation" by requiring tests before any code existed.

### 2. Strategy A End-to-End Testing
The `StubBridge` + `McpSession` pattern (real `ws` client + real `fetch` wrapper) enabled full HTTP+WS+JSON-RPC stack testing without VSCode. This caught integration bugs that unit tests missed, particularly around message ordering and timeout coordination.

### 3. Requirements-First Development
Every module traced back to numbered requirements in `requirements-hub.md`, `requirements-bridge.md`, or `requirements-editor.md`. Test names included requirement IDs (e.g., `CONC-01`, `WS-05`, `CFG-06`), making it trivial to verify coverage.

### 4. Monorepo Structure
pnpm workspaces + TypeScript project references kept builds fast and cross-package types correct. The dependency graph (`bridge-types` → `hub`/`bridge` → `editor`) enforced clean layering.

### 5. Agent-Assisted Development
Using AI agents to implement the code (with the AGENTS.md guide) demonstrated that the TDD process document was machine-executable. The structured checkpoints (A, B2, E) provided natural points for human review.

---

## What Was Painful

### 1. Terminal Tool Blocking Dialog (Week 3, M18)
`vscode.window.showWarningMessage()` in `terminal.run` blocked the async MCP response handler — the agent waited indefinitely for a human click that never came because the agent's own tool call was blocking the UI. **Resolution:** Removed the inline confirmation; full confirmation flow redesigned as a proper round-trip in Week 4 (M23).

### 2. PID File Race Condition (Week 4, M29)
The Hub child process writing its own PID created a race with the parent process checking for it. **Resolution:** Parent writes `proc.pid` immediately after `execFile()` returns. Deferred backlog item: unlink should verify PID content matches before deleting.

### 3. Agent Config Fault Isolation (Week 4, M26/M27)
A single permission error on `.claude/` directory caused both config writes to fail. **Resolution:** Independent try/catch per config write; each failure is logged but doesn't block the other.

### 4. Audit Log Soft Error Classification (Week 4, M24)
Editor tools returning `{ success: true, data: { error: "..." } }` were classified as successes in the audit log. **Resolution:** Added `data.error` inspection after the success gate; now correctly audits as error and returns `isError: true` to MCP.

### 5. VSCode API Mocking Complexity (Week 3)
The editor test mock (`src/__tests__/mocks/vscode.ts`) grew to cover 21 tools' worth of VSCode API surface. Maintaining mock fidelity was error-prone. **Recommendation for Phase 2:** Consider `@vscode/test-electron` integration tests for new modality tools.

---

## Metrics

| Metric | Value |
|---|---|
| Total modules | 34 |
| Total tests | 797 |
| Hub tests | 329 |
| Bridge tests | 296 |
| Editor tests | 172 |
| MCP tools | 21 |
| Source files (`.ts`, excl. tests) | 24 |
| Test files | 20 |
| `:any` occurrences | 0 |
| `console.log` occurrences | 0 |

---

## Deferred Items

These items were identified during Phase 1 but intentionally deferred:

1. **ESLint configuration** — Type-checking serves as the static analysis gate. ESLint setup deferred to Phase 2.
2. **PID cleanup race** — Unlink should verify PID content matches before deleting (see Deferred Backlog in workplan.md).
3. **Module 19 workspace tools** — `getTree`, `search`, `diagnostics.list` removed as redundant with agent bash tools.
4. **Exact token counting** — `prompt-engine.ts` uses `chars / 4` heuristic; `tiktoken` integration deferred.
5. **Remote topology UX** — Port-forward notification for SSH/devcontainer scenarios.
6. **Checkpoint/rollback** — Git-stash snapshots before destructive operations.

---

## Recommendations for Phase 2

1. **Use `@vscode/test-electron` for modality tools.** The mock-based approach works but doesn't catch real VSCode API behavior changes. New modality extensions (Slidev, tldraw) should have at least a smoke test against a real VSCode instance.

2. **Add ESLint with strict rules.** Now that all packages are stable, adding ESLint will catch style drift and enforce consistent patterns across contributors.

3. **Instrument CI with timing.** Track test duration per package in CI to catch performance regressions early.

4. **Consider semantic versioning automation.** With CHANGELOG.md established, a tool like `changesets` or `standard-version` could automate version bumps and changelog entries.

5. **Grace window testing in real network conditions.** The 15s grace window was tested with mocks. A manual or integration test over real SSH with network interruption would increase confidence.

6. **Document the MCP agent setup end-to-end.** While individual READMEs exist, a "Getting Started with Accordo + Claude/OpenCode" tutorial would lower the barrier for new users.
