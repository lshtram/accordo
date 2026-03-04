# AGENTS.md — Guide for AI Agents

This file tells any AI agent how to operate in this repository.  
Read this file first whenever you open this workspace.

---

## 1. What This Repo Is

Accordo IDE is an MCP-based AI co-pilot layer on top of VSCode. It consists of:

| Package | Role |
|---|---|
| `@accordo/bridge-types` | Shared TypeScript types (no runtime) |
| `accordo-hub` | Standalone MCP server — agents connect here |
| `accordo-bridge` | VSCode extension — connects editor to Hub |
| `accordo-editor` | VSCode extension — 16 editor/terminal/workspace tools |

**The always-authoritative starting point for any coding task is:**
→ [`docs/workplan.md`](docs/workplan.md) — current status, active week, next module

---

## 2. Modes of Work

### 2.1 TDD Mode — strictly required when user says "TDD"

When the user says **"TDD"**, or the task is implementing a new module listed in the workplan, you MUST follow the full process in [`docs/dev-process.md`](docs/dev-process.md) without omitting any phase or checkpoint.

**Key rules in TDD mode:**
- Phases A → B → B2 → C → D → D2 → D3 → E → F — in order, no skipping
- User checkpoints at A, B2, and E are **blocking** — stop and wait for explicit approval
- Never write implementation before the tests are approved by the user
- Every requirement gets a test; tests reference requirement IDs
- See `docs/dev-process.md` for the full cycle, batching rules, coverage audit, and commit format

### 2.2 Quick Fix Mode

For small bug fixes, typos, or isolated corrections that are clearly scoped:
- Identify the failing test or issue precisely
- Make the minimal change
- Run the affected test file to verify
- Commit with `fix(<module>): <description>`
- No phase checkpoints required, but still: banned patterns must be clean (see `docs/coding-guidelines.md §3`)

### 2.3 Exploration / Investigation Mode

For answering questions, reading code, explaining architecture, or assessing state:
- Read and report — no changes unless explicitly asked
- Point the user to the relevant requirements doc or workplan section

### 2.4 Documentation Mode

For updating docs, requirements, architecture, or the workplan:
- Changes to requirements docs must be consistent with architecture.md
- After any requirements change, note which modules may be affected
- Commit with `docs(<scope>): <description>`

### 2.5 Refactor Mode

For restructuring existing code without changing behaviour:
- Tests must remain green before and after
- No new requirements addressed in the same commit
- Commit with `refactor(<module>): <description>`

### 2.6 Compound Mode — Session Retrospective

Triggered when the user says **"compound"** or **"retrospective"** at the end of a session.
Follow the instructions in [`.copilot/compound.md`](.copilot/compound.md) exactly.

**Purpose:** Extract learnings from the completed session and write them to permanent files
so future sessions start smarter. This is the mechanism by which agent directives, tool
patterns, and architectural knowledge accumulate over time.

**Key design principle:** The compound command does NOT rely on conversation memory.
It uses `git log`, `git diff`, and `pnpm test` output as primary evidence — these survive
context compaction. Conversation context is supplementary only and treated as unreliable
for anything earlier than the last ~30 turns.

**When to suggest it (proactively):** After completing a TDD module (Phase F committed),
after a non-trivial debugging session, or after any session where the agent had to correct
course more than once.

---

## 3. Always-On Rules (every mode)

These apply regardless of which mode you are in:

1. **Follow `docs/coding-guidelines.md`.** Language style, banned patterns, type safety rules, and the D2 review checklist all live there. The rules are TypeScript/Node.js-specific and take precedence over any generic advice.
2. **Run tests before committing.** `pnpm test` must be clean in the affected package.
3. **Conventional commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
4. **One module per commit** when in TDD mode. Batch only within the same phase.
5. **Scan [`docs/patterns.md`](docs/patterns.md) before any non-trivial task.** Read only
   the YAML front matter (the `patterns:` block at the top) to see what is documented —
   load the full file only if a relevant pattern ID applies. When you hit new friction —
   a tool behaving unexpectedly, a workaround you had to invent, a process step that is
   fragile — add an entry to `patterns.md` immediately (YAML summary line + full section).
   Entries are periodically reviewed with the user and either resolved or archived.

---

## 4. Architecture Constraints (Accordo-specific)

These are project-level decisions that override or extend `coding-guidelines.md §3.5`:

1. **No VSCode imports in Hub packages.** Hub is editor-agnostic — importing `vscode` in `accordo-hub` is a hard failure.
2. **Security middleware comes first** on every authenticated HTTP endpoint. No request reaches a handler without passing the auth layer.
3. **Handler functions are never serialized.** They stay in the Bridge, off the wire. Only `ToolRegistration` (data) crosses the package boundary — never `ExtensionToolDefinition` (function).

---

## 5. Key Documents

| Document | Purpose |
|---|---|
| [`docs/workplan.md`](docs/workplan.md) | Current status, active week, next module, DONE history |
| [`docs/dev-process.md`](docs/dev-process.md) | Full TDD cycle — mandatory when user says "TDD" |
| [`docs/architecture.md`](docs/architecture.md) | System design, component boundaries, protocols |
| [`docs/coding-guidelines.md`](docs/coding-guidelines.md) | Code style, banned patterns, D2 review checklist |
| [`docs/requirements-hub.md`](docs/requirements-hub.md) | Hub functional requirements |
| [`docs/requirements-bridge.md`](docs/requirements-bridge.md) | Bridge functional requirements |
| [`docs/requirements-editor.md`](docs/requirements-editor.md) | Editor tools requirements |
| [`docs/patterns.md`](docs/patterns.md) | Agent working patterns, known friction, and workarounds |
| [`.copilot/compound.md`](.copilot/compound.md) | Compound mode — instructions for session retrospective |

---

## 6. Picking Up Mid-Project

1. Open [`docs/workplan.md`](docs/workplan.md) — read **Current Status** and **Weekly Plan §5**
2. The active module and its requirements source are listed in the week's TDD execution table
3. Check `git log --oneline -10` to see what was last committed
4. Run `pnpm test` in the affected package to verify the baseline is green
5. Identify which TDD phase the active module is in (look for stubs with `throw new Error("not implemented")`)
6. If joining mid-module, do not skip backwards — resume from the current phase forward
