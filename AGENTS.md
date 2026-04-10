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
→ [`docs/00-workplan/workplan.md`](docs/00-workplan/workplan.md) — current status, active week, next module

---

## 2. Modes of Work

### 2.1 TDD Mode — strictly required when user says "TDD"

When the user says **"TDD"**, or the task is implementing a new module listed in the workplan, you MUST follow the full process in the global OpenCode process file: `~/.config/opencode/dev-process.md` (loaded by the project-manager) without omitting any phase or checkpoint.

**Project-specific tooling:**
- Test framework: vitest
- Test command: `pnpm test` (in the affected package)
- Type checker: `tsc --noEmit`
- Linter: eslint
- Package manager: pnpm
- Test location: `packages/<package>/src/__tests__/<module>.test.ts`

**Key rules in TDD mode:**
- Phases A → B → B2 → C → D → D2 → D3 → E → F — in order, no skipping
- User checkpoints at A, B2, and E are **blocking** — stop and wait for explicit approval
- Never write implementation before the tests are approved by the user
- Every requirement gets a test; tests reference requirement IDs
- See `~/.config/opencode/dev-process.md` for the full cycle, batching rules, coverage audit, and commit format

### 2.2 Quick Fix Mode

For small bug fixes, typos, or isolated corrections that are clearly scoped:
- Identify the failing test or issue precisely
- Make the minimal change
- Run the affected test file to verify
- Commit with `fix(<module>): <description>`
- No phase checkpoints required, but still: banned patterns must be clean (see [`docs/30-development/coding-guidelines.md`](docs/30-development/coding-guidelines.md) §3)

### 2.3 Exploration / Investigation Mode

For answering questions, reading code, explaining architecture, or assessing state:
- Read and report — no changes unless explicitly asked
- Point the user to the relevant requirements doc or workplan section

### 2.4 Documentation Mode

For updating docs, requirements, architecture, or the workplan:
- Changes to requirements docs must be consistent with architecture.md
- After any requirements change, note which modules may be affected
- Commit with `docs(<scope>): <description>`

### 2.5 Debug Mode

For any debugging session — a failing test, unexpected runtime behaviour, or an error
you cannot immediately explain — load the debugging skill before touching code:

```
skills/debugging/skill.md           — entry point, quick reference, process map
skills/debugging/knowledge/systematic-process.md    — 5-phase workflow
skills/debugging/knowledge/instrumentation-guide.md — where/how to add logs
```

**Key rules in Debug Mode:**
- Follow the 5-phase rule: OBSERVE → INSTRUMENT → HYPOTHESIZE → VERIFY → FIX & CONFIRM
- Never form a hypothesis before you have the full error message (Phase 1 first)
- Root cause over symptoms — ask "why?" at least 3 times
- Remove all `// DEBUG:` instrumentation before committing
- Commit with `fix(<module>): <description>`

### 2.6 Refactor Mode

For restructuring existing code without changing behaviour:
- Tests must remain green before and after
- No new requirements addressed in the same commit
- Commit with `refactor(<module>): <description>`

### 2.7 Compound Mode — Session Retrospective

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
after a non-trivial debugging session (Debug Mode §2.5), or after any session where the agent had to correct
course more than once.

---

## 3. Always-On Rules (every mode)

These apply regardless of which mode you are in:

1. **Follow [`docs/30-development/coding-guidelines.md`](docs/30-development/coding-guidelines.md).** Language style, banned patterns, type safety rules, and the D2 review checklist all live there. The rules are TypeScript/Node.js-specific and take precedence over any generic advice.
2. **Run tests before committing.** `pnpm test` must be clean in the affected package.
3. **MCP tool naming convention.** All tools exposed via the MCP gateway use the `accordo_<modality>_<action>` prefix:
   - `accordo_editor_open`, `accordo_editor_close`, etc. (editor modality)
   - `accordo_terminal_open`, `accordo_terminal_run`, etc. (terminal modality)
   - `accordo_voice_dictation`, `accordo_voice_readAloud`, etc. (voice modality)
   - `accordo_browser_list_pages`, `accordo_browser_navigate`, `accordo_browser_click`, `accordo_browser_type`, `accordo_browser_press_key`, etc. (browser modality)
   - `comment_list`, `comment_create`, etc. (comment modality — exception to the rule)
   When adding new MCP tools, use the `accordo_<modality>_<action>` pattern. Internal relay action strings (between Hub and Chrome extension) are exempt — they use short names like `"get_page_map"`, `"navigate"`.
4. **Conventional commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
5. **One module per commit** when in TDD mode. Batch only within the same phase.
6. **Scan pattern files before any non-trivial task.** There are two:
   - [`docs/30-development/patterns.md`](docs/30-development/patterns.md) — generic agent tool patterns (all projects)
   - [`docs/30-development/accordo-patterns.md`](docs/30-development/accordo-patterns.md) — Accordo-specific patterns
   Read only the YAML front matter to see what is documented — load the full section
   only if a relevant pattern ID applies. When you hit new friction, add an entry to
   the appropriate file (generic tool issue → `patterns.md`, project-specific → `accordo-patterns.md`).
6. **Commit every time a task or phase is done; push only when the user explicitly says "push".**

---

## 4. Architecture Constraints (Accordo-specific)

These are project-level decisions that override or extend [`docs/30-development/coding-guidelines.md §3.5`](docs/30-development/coding-guidelines.md):

1. **No VSCode imports in Hub packages.** Hub is editor-agnostic — importing `vscode` in `accordo-hub` is a hard failure.
2. **Security middleware comes first** on every authenticated HTTP endpoint. No request reaches a handler without passing the auth layer.
3. **Handler functions are never serialized.** They stay in the Bridge, off the wire. Only `ToolRegistration` (data) crosses the package boundary — never `ExtensionToolDefinition` (function).

---

## 5. Key Documents

| Document | Purpose |
|---|---|
| [`docs/00-workplan/workplan.md`](docs/00-workplan/workplan.md) | Current status, active week, next module, DONE history |
| `~/.config/opencode/dev-process.md` | Full TDD cycle — mandatory when user says "TDD" |
| [`docs/10-architecture/architecture.md`](docs/10-architecture/architecture.md) | System design, component boundaries, protocols |
| [`docs/30-development/coding-guidelines.md`](docs/30-development/coding-guidelines.md) | Code style, banned patterns, D2 review checklist |
| [`docs/20-requirements/requirements-hub.md`](docs/20-requirements/requirements-hub.md) | Hub functional requirements |
| [`docs/20-requirements/requirements-bridge.md`](docs/20-requirements/requirements-bridge.md) | Bridge functional requirements |
| [`docs/20-requirements/requirements-editor.md`](docs/20-requirements/requirements-editor.md) | Editor tools requirements |
| [`docs/30-development/patterns.md`](docs/30-development/patterns.md) | Generic agent tool patterns (shared across projects) |
| [`docs/30-development/accordo-patterns.md`](docs/30-development/accordo-patterns.md) | Accordo-specific patterns (VS Code, Hub, Bridge) |
| [`.copilot/compound.md`](.copilot/compound.md) | Compound mode — instructions for session retrospective |

## 5.1 Project Skills (Always Available)

**Read these skills directly from `skills/` when working on relevant tasks. These are project-specific skills not loaded via the global `skill` tool.**

| Skill | When to Use |
|---|---|
| [`skills/diagrams/skill.md`](skills/diagrams/skill.md) | User says "diagram", "flowchart", or needs to visualize architecture/processes. **Critical: Mermaid classDef is IGNORED — use `accordo_diagram_patch` with `nodeStyles` for all styling.** |
| [`skills/presentations/skill.md`](skills/presentations/skill.md) | User says "present", "deck", "slides", or needs to create a Marp presentation. |
| [`skills/script-authoring/skill.md`](skills/script-authoring/skill.md) | User says "demo", "walkthrough", "script", or needs narrated demonstrations. |
| [`skills/debugging/skill.md`](skills/debugging/skill.md) | Fails, test failures, unexpected runtime behavior — load before debugging. |
| [`skills/README.md`](skills/README.md) | Skills index — lists all project skills and how to create new ones. |

---

## 6. VS Code Extension Development

### Reloading VS Code after dist changes

When modifying VS Code extension code, VS Code in dev mode auto-reloads extensions when their `dist/` changes. If auto-reload doesn't work, or to force a clean reload:

```bash
# Full restart (rebuilds all packages first)
./scripts/start-session.sh

# Faster: skip rebuild if dist files are already fresh
./scripts/start-session.sh --no-build

# Or reload just the current window without rebuilding
# (Cmd+Shift+P → "Developer: Reload Window")
```

The `start-session.sh` script:
- Builds all VS Code extensions via `pnpm -r --filter="./packages/*" run build`
- Launches VS Code with all packages in `extensionDevelopmentPath` mode
- Uses a separate `--user-data-dir` so multiple instances don't conflict

`scripts/dev-open.sh` has been retired. Use `scripts/start-session.sh` as the canonical launcher in all docs and operator instructions.

### Iterating on a specific package

To rebuild a single package without touching the others:

```bash
cd packages/<package-name>
pnpm build
# Then reload VS Code window
```

### Checking extension logs

VS Code extension logs are at:
```
/run/user/1000/accordo-vscode-<project-slug>/logs/<timestamp>/window1/exthost/output_logging_<timestamp>/
```

Key log files:
- `1-Accordo Hub.log` — Hub relay server activity
- `4-Accordo Browser Relay.log` — Browser extension relay activity

---

## 7. Picking Up Mid-Project

1. Open [`docs/00-workplan/workplan.md`](docs/00-workplan/workplan.md) — read **Current Status** and **Weekly Plan §5**
2. The active module and its requirements source are listed in the week's TDD execution table
3. Check `git log --oneline -10` to see what was last committed
4. Run `pnpm test` in the affected package to verify the baseline is green
5. Identify which TDD phase the active module is in (look for stubs with `throw new Error("not implemented")`)
6. If joining mid-module, do not skip backwards — resume from the current phase forward
