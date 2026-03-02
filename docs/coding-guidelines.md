# Accordo IDE — Coding Style & Code Review Guidelines

**Applies to:** All packages in the Accordo IDE monorepo  
**Technologies:** TypeScript 5.x, Node.js ≥ 20, Vitest 3.x, `ws`, `node:http`  
**Sources:**
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices) (Yoni Goldberg — most comprehensive Node.js guide, 100k+ GitHub stars)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/) (Basarat Ali Syed)
- [Effective TypeScript](https://effectivetypescript.com/) (Dan Vanderkam)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

## 1. TypeScript Style

### 1.1 Type Safety — Non-Negotiable

| Rule | Rationale |
|------|-----------|
| `strict: true` in every tsconfig | Enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc. Non-negotiable. |
| **Never use `any`** | Use `unknown` when the type is genuinely unknown. Narrow it before use. `any` defeats the entire purpose of TypeScript. |
| **Never use non-null assertion `!`** without a comment | The assertion must be justified. Every `!` requires a one-line comment explaining why null is impossible here. |
| **No type cast `as X` without narrowing** | Use type guards (`isX(v)`) instead. `as X` suppresses the compiler and hides bugs. |
| All exported functions must have explicit return types | Prevents accidental `any` inference and makes API contracts visible. |
| Prefer `interface` for object shapes, `type` for unions/intersections | Interfaces are extensible and produce clearer error messages. Types are better for complex unions. |
| Use `readonly` for arrays/objects that should not be mutated | `readonly string[]`, `Readonly<IDEState>`. Signal intent and catch bugs at compile time. |
| Prefer union types over enums | TypeScript `enum` has runtime overhead and surprising behaviour with `const enum`. Use `type Foo = "a" \| "b" \| "c"`. |

### 1.2 Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Variables, parameters | `camelCase` | `bridgeSecret`, `toolCount` |
| Functions | `camelCase` | `validateOrigin()`, `renderPrompt()` |
| Classes | `PascalCase` | `StateCache`, `ToolRegistry` |
| Interfaces | `PascalCase` (no `I` prefix) | `IDEState`, `Session` |
| Type aliases | `PascalCase` | `DangerLevel`, `WsMessage` |
| Constants (truly constant) | `UPPER_SNAKE_CASE` | `DEFAULT_HUB_PORT`, `AUDIT_MAX_FILE_SIZE` |
| Files | `kebab-case` | `state-cache.ts`, `bridge-server.ts` |
| Test files | `<module>.test.ts` | `state-cache.test.ts` |
| Private class fields | `private` keyword, `camelCase` | `private tools: Map<...>` |

### 1.3 Functions & Modules

- **Pure functions over classes when there is no state.** `security.ts` exports plain functions. `state-cache.ts` uses a class because it holds state.
- **One export per file is not required, but keep files focused.** A file should have one primary responsibility.
- **Avoid default exports.** Named exports make refactoring and tree-shaking easier.
- **Keep functions short.** If a function doesn't fit on a screen (> ~40 lines), split it.
- **No commented-out code.** Dead code lives in git history, not in the source.
- **Async/await over raw Promises.** Only use `.then()/.catch()` when working with Promise combinators (`Promise.all`, `Promise.race`).
- **Never throw inside async functions without catching at the boundary.** Every async entry point (`server.start()`, `invoke()`) must handle its own rejections.

### 1.4 Error Handling (Node.js Best Practices §3)

- **Use typed error classes** for expected error scenarios:
  ```typescript
  class AccordoError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
      this.name = 'AccordoError';
    }
  }
  ```
- **Distinguish operational errors from programmer errors.** Operational: network down, auth failure, queue full. Programmer: wrong argument type, null dereference. Programmer errors → crash + fix. Operational errors → handle gracefully.
- **Always use `Error` objects**, never throw strings: `throw new Error("...")` not `throw "..."`.
- **Validate all external input** at system boundaries (incoming HTTP requests, WS messages, CLI args). After the boundary, trust the types.
- **Log errors with context**, not just the message. Include the operation, relevant IDs, and the error object.

### 1.5 Imports

- Use `type` imports for types: `import type { IDEState } from "@accordo/bridge-types"`.
- Group imports: 1) Node built-ins (`node:http`, `node:crypto`), 2) External (`ws`), 3) Internal (`@accordo/bridge-types`), 4) Relative.
- Use `node:` prefix for all built-in modules: `import { createHash } from "node:crypto"` not `"crypto"`.

---

## 2. Testing Guidelines (Vitest)

### 2.1 Test Structure

```typescript
// Pattern: describe('<module>') → describe('<public method>') → it('<REQ-ID>: <description>')
describe('StateCache', () => {
  describe('applyPatch', () => {
    it('applies partial patch without overwriting unrelated fields', () => { ... });
    it('merges modality keys without clobbering existing modalities', () => { ... });
  });
});
```

- **One `describe` per file per exported unit** (class or function group).
- **Test descriptions are sentences** that a PM could read and understand.
- **Every requirement ID in the test name** where one exists: `'CONC-01: maintains in-flight counter'`.
- **Arrange-Act-Assert (AAA)** structure with blank lines between sections.

### 2.2 Test Quality Rules

| Rule | Why |
|------|-----|
| Tests must be **deterministic** | No `Math.random()`, no `Date.now()` without mocking, no reliance on ordering |
| **Mock external dependencies**, not the unit under test | Mock `ws`, `node:http`, VSCode API — never mock `StateCache` when testing `StateCache` |
| **No `toBeTruthy()` when an exact value is expected** | `expect(result).toBe(true)` not `expect(result).toBeTruthy()` |
| **No `any` in tests** | Tests are code. Same rules apply. |
| Test **error paths** as rigorously as happy paths | Every `throw` and every `reject` should have a corresponding test |
| **Isolation** — each test sets up and tears down its own state | No shared mutable state between tests. Use `beforeEach` to reset. |
| **Test the contract, not the implementation** | Don't assert on private method calls. Assert on observable outcomes (return value, state change, event emitted). |

### 2.3 What We Do NOT Test

- TypeScript types (the compiler tests those)
- Private implementation details
- Third-party library internals (`ws`, `vitest` itself)

---

## 3. Code Review Checklist (Phase D2)

This is the mandatory checklist before any implementation can reach Phase E (user approval).
Run through every item. An unchecked item blocks the review.

### 3.1 Correctness

- [ ] **All tests pass** (`pnpm test` — zero failures, zero skipped)
- [ ] **TypeScript compiles** with zero errors (`pnpm typecheck`)
- [ ] **Every requirement from the spec has a test** — cross-reference the requirements doc
- [ ] No `TODO` or `FIXME` comments that were not pre-existing (new ones must go to a tracked issue)
- [ ] No `console.log` left in production code paths (use structured logging)
- [ ] No hard-coded values that should come from config/constants

### 3.2 Security (mandatory for Hub)

- [ ] All external inputs validated before use (HTTP request bodies, WS message payloads, CLI args)
- [ ] No raw `exec` or `spawn` with shell string interpolation — use `execFile` with argument arrays
- [ ] Bearer tokens and secrets never logged, never serialised to public fields
- [ ] Crypto operations use `node:crypto` — no hand-rolled crypto
- [ ] File writes use correct modes (`0600` for secrets, `0700` for directories)
- [ ] No `any` cast that discards type information on a security-sensitive type

### 3.3 Type Safety

- [ ] Zero `any` (search: `grep -r ": any" src/` — must be empty)
- [ ] Zero non-null assertions without an explaining comment (search `\!` in context)
- [ ] Zero unsafe `as X` casts without a type guard function
- [ ] All public function return types are explicit
- [ ] All `catch (e)` blocks type-narrow `e` before using it (`if (e instanceof Error)`)

### 3.4 Code Quality

- [ ] No function exceeds ~40 lines (excluding comments and blank lines)
- [ ] No file exceeds ~200 lines of implementation code (stubs + docs don't count)
- [ ] No duplication — logic that appears twice should be extracted into a shared function
- [ ] Error messages are human-readable and include context (not just "error occurred")
- [ ] Async functions do not have unhandled rejection paths

### 3.5 Architecture Compliance

- [ ] Handlers are **never** sent over the wire (only `ToolRegistration`, not `ExtensionToolDefinition`)
- [ ] `bridge-types` contains only types that cross a package boundary — no logic
- [ ] Hub has **zero** VSCode imports or dependencies
- [ ] Security middleware runs **before** any request handler — no endpoint is reachable without auth
- [ ] File paths use forward slashes (normalize with `path.posix` or `.replace(/\\/g, '/')`)

### 3.6 Test Quality

- [ ] No `toBeTruthy()` or `toBeFalsy()` where an exact value is expected
- [ ] No test imports the module under test's private state
- [ ] Test file covers all code paths in the module (not just happy path)
- [ ] Mocks are reset in `beforeEach` / `afterEach`

### 3.7 Commit Readiness

- [ ] Commit message follows conventional commits format
- [ ] No unrelated changes in the same commit
- [ ] No leftover debug files or generated files that shouldn't be committed

---

## 4. ESLint Configuration (to be added in Week 1 Day 1 cleanup)

Recommended rule set for this project:

```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/explicit-module-boundary-types": "error",
    "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": ["error", "always"]
  }
}
```

Key rules and why:
- `no-explicit-any` — enforces no `any` at the linter level, not just convention
- `no-floating-promises` — catches unhandled async calls (common security/reliability bug)
- `await-thenable` — prevents `await` on non-Promise values (a TypeScript gotcha)
- `consistent-type-imports` — enforces `import type` for types, keeping bundles lean

---

## 5. Git Conventions

### 5.1 Commit Messages

Format: `<type>(<scope>): <description>`

| Type | Use for |
|------|---------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `refactor` | Code change that doesn't add features or fix bugs |
| `chore` | Build process, dependency updates, CI |
| `perf` | Performance improvement |

Scope = package name: `bridge-types`, `hub`, `bridge`, `editor`

Example:
```
feat(hub): implement state-cache with patch merging

- Implements requirements-hub §5.2: applyPatch, setSnapshot, getState, clearModalities
- Tests: 14 passing
```

### 5.2 Branch Names

`<type>/<scope>-<description>` — e.g. `feat/hub-state-cache`, `fix/hub-security-origin`

---

## 6. Performance Guidelines (Node.js Best Practices §5)

- **Never block the event loop.** All I/O must be async. No `fs.readFileSync` in request handlers.
- **Regex on untrusted input must be bounded.** Potential ReDoS — test complex regexes with redos.vuln.be.
- **JSON.stringify/parse is slow for large objects.** Cache stringified state where possible.
- **`Map` over `Object` for dynamic keys** (e.g. tool registry, session map). `Map` has O(1) lookup and doesn't inherit prototype keys.
- **Avoid memory leaks in long-running servers:** clear timers (`clearTimeout`, `clearInterval`), remove WS listeners on close, clean up the session map on expiry.
