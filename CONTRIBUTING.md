# Contributing to Accordo IDE

Thank you for your interest in contributing to Accordo IDE.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- VSCode >= 1.100.0 (for extension development)

## Setup

```bash
git clone https://github.com/lshtram/accordo.git
cd accordo
pnpm install
pnpm build
pnpm test
pnpm setup:hooks   # installs pre-push git hook
```

## Development Workflow

### Build

```bash
pnpm build              # build all packages
pnpm --filter <pkg> build   # build one package
```

Build order: `bridge-types` → `hub` + `bridge` (parallel) → `editor`

### Test

```bash
pnpm test               # run all tests
pnpm --filter <pkg> test    # run one package's tests
pnpm test:watch         # watch mode (all packages)
```

### Type Check

```bash
pnpm typecheck          # type-check all packages
```

## Code Standards

### Required

- **No `:any`** in source files. TypeScript strict mode is enforced.
- **No `console.log`** in source files. `console.error` is allowed in error handlers.
- **No VSCode imports** in Hub packages. Hub is editor-agnostic.
- **Security middleware first** on every authenticated HTTP endpoint.
- **Handler functions never serialized.** They stay in the Bridge, off the wire.
- **Run tests before committing.** `pnpm test` must be clean.

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(<module>): <summary>
fix(<module>): <summary>
docs(<scope>): <summary>
refactor(<module>): <summary>
test(<module>): <summary>
chore(<scope>): <summary>
```

Include requirement IDs and test counts in the body when applicable:

```
feat(state-cache): implement state cache with patch merging

- Implements requirements-hub §5.2: applyPatch, setSnapshot, getState, clearModalities
- Tests: 14 passing
```

## TDD Process

All new module implementations follow the TDD cycle defined in [`docs/dev-process.md`](docs/dev-process.md):

**A** (design + stubs) → **B** (failing tests) → **B2** (user review) → **C** (implement) → **D** (green) → **D2** (code review) → **D3** (testing guide) → **E** (user approval) → **F** (commit)

User checkpoints at A, B2, and E are blocking.

## Project Structure

```
packages/
  bridge-types/    @accordo/bridge-types — shared TypeScript types
  hub/             accordo-hub — MCP server
  bridge/          accordo-bridge — VSCode extension (Bridge)
  editor/          accordo-editor — VSCode extension (21 tools)
docs/              Architecture, requirements, process docs
scripts/           Build scripts, git hooks
```

## Key Documents

| Document | Purpose |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design and protocols |
| [`docs/dev-process.md`](docs/dev-process.md) | TDD cycle (mandatory for new modules) |
| [`docs/coding-guidelines.md`](docs/coding-guidelines.md) | Code style and review checklist |
| [`docs/workplan.md`](docs/workplan.md) | Current status and weekly plan |
| [`AGENTS.md`](AGENTS.md) | Guide for AI agents working in this repo |

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
