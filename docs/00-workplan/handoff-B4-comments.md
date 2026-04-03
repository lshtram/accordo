# Agent B4 Handoff — `comments` Decomposition (Sequential: B4a → B4b)

**Date:** 2026-03-29  
**Baseline commit:** `1651a03`  
**Package:** `packages/comments` (pnpm filter: `accordo-comments`)  
**Baseline tests:** 354 (all green)

---

## 1. Your Mission

Two sequential splits inside `packages/comments`:
1. **B4a**: Extract core comment operations from `comment-store.ts` (633 LOC) into a VSCode-free repository module
2. **B4b**: Split `comment-tools.ts` (676 LOC) into definitions + handlers

**B4a MUST complete before B4b** — the tools depend on store behavior.

All existing tests must remain green. No new cross-package dependencies.

---

## 2. B4a — Extract `comment-repository.ts`

### 2.1 Files You OWN (B4a)

| File | Action | Purpose |
|---|---|---|
| `src/comment-store.ts` | **MODIFY** — delegate core ops to repository | Keep `CommentStore` class, keep VSCode-dependent persistence, delegate logic |
| `src/comment-repository.ts` | **CREATE** | Core comment CRUD operations — **ZERO vscode imports** |
| `src/__tests__/comment-repository.test.ts` | **CREATE** | Unit tests for repository module |

### 2.2 Goal of B4a

`comment-store.ts` currently mixes:
- **Core domain logic**: thread CRUD, list filtering, pagination, validation, limit enforcement
- **VSCode I/O**: file persistence via `vscode.Uri`, `vscode.workspace.fs`, event emitters

Extract the core domain logic into `comment-repository.ts` with **zero `vscode` imports**. The `CommentStore` class becomes a thin adapter that:
1. Holds the `CommentRepository` instance
2. Provides VSCode-specific I/O (file read/write, event emitting)
3. Delegates all business logic to the repository

### 2.3 Exported Symbols After B4a

`comment-store.ts` MUST still export all of these (other files in the package import them):

```typescript
export interface ListThreadsOptions { ... }
export interface ListThreadsResult { ... }
export interface ThreadSummary { ... }
export interface CreateCommentParams { ... }
export interface CreateCommentResult { ... }
export interface ReplyParams { ... }
export interface ReplyResult { ... }
export interface ResolveParams { ... }
export interface DeleteParams { ... }
export interface DocumentChangeInfo { ... }
export type ChangeListener = (uri: string) => void;
export class CommentStore { ... }
```

These types can MOVE to `comment-repository.ts` and be re-exported from `comment-store.ts`, OR stay in `comment-store.ts`. Either way, the import `from "./comment-store.js"` must keep working for:
- `src/comment-tools.ts` → `import type { CommentStore } from "./comment-store.js"`
- `src/extension.ts` → `import { CommentStore } from "./comment-store.js"`
- `src/native-comments.ts` → `import type { CommentStore } from "./comment-store.js"`
- `src/state-contribution.ts` → `import type { CommentStore } from "./comment-store.js"`

### 2.4 Key Constraint (B4a)

`comment-repository.ts` must have **ZERO `vscode` imports**. It is pure TypeScript + `@accordo/bridge-types`. This enables future unit testing without VS Code mocks.

---

## 3. B4b — Split `comment-tools.ts` into Definitions + Handlers

**Only start B4b after B4a is committed and tests pass.**

### 3.1 Files You OWN (B4b)

| File | Action | Purpose |
|---|---|---|
| `src/comment-tools.ts` | **MODIFY** — shrink to barrel/composition | Keep `createCommentTools()` as the entry point, delegate to definitions + handlers |
| `src/comment-definitions.ts` | **CREATE** | JSON schema definitions for all 7+N comment tools |
| `src/comment-handlers.ts` | **CREATE** | Handler implementations that call `CommentStore` |
| `src/__tests__/comment-definitions.test.ts` | **CREATE** | Tests for schema definitions |
| `src/__tests__/comment-handlers.test.ts` | **CREATE** | Tests for handlers |

### 3.2 Exported Symbols After B4b

`comment-tools.ts` MUST still export:

```typescript
export function normalizeCommentUri(input: string, workspaceRoot: string): string
export interface CommentUINotifier { ... }
export class CompositeCommentUINotifier implements CommentUINotifier { ... }
export function createCommentTools(store: CommentStore, ui?: CommentUINotifier): ExtensionToolDefinition[]
export class CreateRateLimiter { ... }
```

`src/extension.ts` imports:
```typescript
import { createCommentTools, CompositeCommentUINotifier } from "./comment-tools.js";
import type { CommentUINotifier } from "./comment-tools.js";
```
These MUST keep working.

### 3.3 Split Strategy (B4b)

- **`comment-definitions.ts`**: All JSON schema objects for the 7 MCP tools (`comment_list`, `comment_get`, `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`) + any `comment_sync_version` tool. Export as named constants.
- **`comment-handlers.ts`**: All handler functions. The `buildAnchor()` and `inferBlockTypeFromAnchorKey()` helper functions. `CreateRateLimiter` class.
- **`comment-tools.ts`**: Imports definitions + handlers, assembles `ExtensionToolDefinition[]` array in `createCommentTools()`. Re-exports public types. `normalizeCommentUri()` can stay here or move to handlers (just re-export).

---

## 4. Files You MUST NOT Touch (Entire B4)

| File | Reason |
|---|---|
| `src/extension.ts` | Package entry point — imports from `comment-store.js` and `comment-tools.js` |
| `src/native-comments.ts` | Imports `CommentStore` type — must keep working |
| `src/state-contribution.ts` | Imports `CommentStore` type — must keep working |
| `src/panel/comments-tree-provider.ts` | Panel module — not part of this split |
| `src/panel/navigation-router.ts` | Panel module |
| `src/panel/panel-commands.ts` | Panel module |
| `src/panel/panel-filters.ts` | Panel module |
| `src/__tests__/comment-store.test.ts` | Existing tests — must pass unchanged |
| `src/__tests__/comment-store-durability.test.ts` | Existing tests |
| `src/__tests__/comment-tools.test.ts` | Existing tests |
| `src/__tests__/composite-notifier.test.ts` | Existing tests |
| `src/__tests__/extension-exports.test.ts` | Existing tests |
| `src/__tests__/extension.test.ts` | Existing tests |
| `src/__tests__/native-comments.test.ts` | Existing tests |
| `src/__tests__/state-contribution.test.ts` | Existing tests |
| Any file in `packages/hub/` | Agent B1's territory |
| Any file in `packages/bridge/` | Agent B2's territory |
| Any file in `packages/voice/`, `packages/diagram/`, `packages/editor/` | Agent B3's territory |
| Any file in `packages/browser-extension/` | Agent B5's territory |
| Any file in `packages/bridge-types/` | Shared types — frozen |

---

## 5. Critical Architecture Constraints

1. **`comment-repository.ts` has ZERO `vscode` imports** — this is the entire point of the B4a split. Pure domain logic.
2. **`@accordo/bridge-types` barrel only** — `import type { ... } from "@accordo/bridge-types"`. No subpath imports.
3. **Handler functions never cross the wire** — `ExtensionToolDefinition.handler` stays Bridge-side. The schema/definition is data, the handler is a function. They split cleanly.
4. **Re-export stability** — even if you move types to new files, the old import paths (`from "./comment-store.js"`, `from "./comment-tools.js"`) must still resolve them.

---

## 6. Verification Commands

After B4a:
```bash
pnpm --filter accordo-comments test    # 354 tests green
pnpm --filter accordo-comments exec tsc --noEmit
```

After B4b:
```bash
pnpm --filter accordo-comments test    # 354 tests + new tests green
pnpm --filter accordo-comments exec tsc --noEmit
pnpm --filter accordo-comments run build

# LOC checks
wc -l packages/comments/src/comment-store.ts packages/comments/src/comment-repository.ts packages/comments/src/comment-tools.ts packages/comments/src/comment-definitions.ts packages/comments/src/comment-handlers.ts
```

---

## 7. Commit Format

Two commits (one per sub-step):

```
refactor(comments): extract comment-repository with zero vscode imports (B4a)

- comment-store.ts: 633 LOC → <250 LOC thin VSCode adapter
- comment-repository.ts: core CRUD logic, filtering, validation (no vscode)
- Tests: 354 existing + N new (all green)
```

```
refactor(comments): split comment-tools into definitions + handlers (B4b)

- comment-tools.ts: 676 LOC → <250 LOC composition barrel
- comment-definitions.ts: JSON schemas for 7 MCP tools
- comment-handlers.ts: handler implementations + helpers
- Tests: 354+ existing + N new (all green)
```

---

## 8. What NOT to Do

- ❌ Do NOT start B4b before B4a passes all tests
- ❌ Do NOT modify any file outside `packages/comments/src/comment-store.ts`, `comment-tools.ts`, and new files
- ❌ Do NOT modify existing test files — only add new ones
- ❌ Do NOT change exported symbol names or types
- ❌ Do NOT add `vscode` imports to `comment-repository.ts`
- ❌ Do NOT break the import paths that `extension.ts`, `native-comments.ts`, and `state-contribution.ts` use
- ❌ Do NOT create new cross-package dependencies
