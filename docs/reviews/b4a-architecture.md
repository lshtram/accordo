# B4a Architecture — CommentRepository Extraction

**Task:** Extract pure domain logic from `comment-store.ts` (633 LOC) into a new
`comment-repository.ts` module with **zero `vscode` imports**.

**Goal:** `CommentStore` becomes a thin VSCode adapter that delegates all business
logic to `CommentRepository`. All existing imports from `"./comment-store.js"` keep
working unchanged.

---

## 1. Module Boundary

```
┌─────────────────────────────────────────────────────────┐
│  comment-repository.ts  (NEW — pure TypeScript)         │
│                                                         │
│  Imports: @accordo/bridge-types (barrel only), crypto   │
│  NO: vscode, node:fs/promises, any I/O                  │
│                                                         │
│  Owns:                                                  │
│  - In-memory state (_threads Map, _stale Set, _version) │
│  - All CRUD logic (create, reply, resolve, reopen, etc.)│
│  - List/filter/paginate/project (listThreads)           │
│  - Staleness tracking (onDocumentChanged, isThreadStale)│
│  - Aggregates (getCounts, getVersionInfo, getAllThreads) │
│  - Serialization (toStoreFile, loadFromStoreFile)       │
└─────────────────────────────────────────────────────────┘
         ▲ composition (this._repo = new CommentRepository())
         │
┌─────────────────────────────────────────────────────────┐
│  comment-store.ts  (SLIMMED — VSCode adapter)           │
│                                                         │
│  Imports: vscode, node:fs/promises, CommentRepository   │
│                                                         │
│  Owns:                                                  │
│  - load() — vscode.workspace.fs → repo.loadFromStoreFile│
│  - _persist() — repo.toStoreFile() → atomic file write  │
│  - _emit() + onChanged() — listener management          │
│  - _writeQueue — serializes concurrent persist calls    │
│  - _workspaceRoot — file path state                     │
│  - pruneStaleThreads() — async exists() predicate       │
│  - Async wrappers that call repo, then persist + emit   │
│  - Re-exports all types + CommentRepository (if needed) │
└─────────────────────────────────────────────────────────┘
```

---

## 2. CommentRepository — Class Design

```typescript
// comment-repository.ts

import type {
  CommentThread,
  CommentAnchor,
  AccordoComment,
  CommentAuthor,
  CommentIntent,
  CommentStatus,
  CommentStoreFile,
  CommentContext,
  CommentAnchorText,
  CommentAnchorSurface,
  CommentRetention,
} from "@accordo/bridge-types";
import {
  COMMENT_MAX_THREADS,
  COMMENT_MAX_COMMENTS_PER_THREAD,
  COMMENT_LIST_DEFAULT_LIMIT,
  COMMENT_LIST_MAX_LIMIT,
  COMMENT_LIST_BODY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";

export class CommentRepository {
  private readonly _threads = new Map<string, CommentThread>();
  private readonly _stale = new Set<string>();
  private _versionCounter = 0;
```

### 2.1 Serialization — Load / Save Boundary

```typescript
  /**
   * Populate in-memory state from a parsed CommentStoreFile.
   * Called by CommentStore.load() after reading + parsing the JSON file.
   * Clears any existing state before loading.
   */
  loadFromStoreFile(file: CommentStoreFile): void {
    this._threads.clear();
    this._stale.clear();
    for (const thread of file.threads) {
      this._threads.set(thread.id, thread);
    }
  }

  /**
   * Serialize current state to a CommentStoreFile.
   * Called by CommentStore._persist() to get the JSON payload.
   */
  toStoreFile(): CommentStoreFile {
    return {
      version: "1.0",
      threads: Array.from(this._threads.values()),
    };
  }
```

### 2.2 Read Methods (unchanged signatures, now synchronous)

```typescript
  getAllThreads(): CommentThread[] { ... }

  getVersionInfo(): { version: number; threadCount: number; lastActivity: string | null } { ... }

  getThread(threadId: string): CommentThread | undefined { ... }

  getThreadsForUri(uri: string): CommentThread[] { ... }

  listThreads(options: ListThreadsOptions): ListThreadsResult { ... }

  getCounts(): { open: number; resolved: number } { ... }

  isThreadStale(threadId: string): boolean { ... }
```

All read methods transfer verbatim from the current `CommentStore`. No async, no
side effects.

### 2.3 Mutation Methods — Synchronous, No Side Effects

**Key design decision:** Mutations in `CommentRepository` are **synchronous**. They
modify in-memory state and return results immediately. The caller (`CommentStore`)
is responsible for calling `_persist()` and `_emit()` afterward.

Each mutation returns a result object that includes the `affectedUri` so the
adapter knows which URI to emit for:

```typescript
  /** Result of a repository mutation — tells the adapter what to persist/emit. */
  // (Not exported — internal to the store/repository boundary)

  createThread(params: CreateCommentParams): CreateCommentResult & { affectedUri: string } {
    // Validates thread cap
    // Creates thread + first comment
    // Sets in _threads map
    // Increments _versionCounter
    // Returns { threadId, commentId, affectedUri: params.uri }
  }

  reply(params: ReplyParams): ReplyResult & { affectedUri: string } {
    // Validates thread exists, comment cap
    // Pushes comment, updates lastActivity
    // Increments _versionCounter
    // Returns { commentId, affectedUri: thread.anchor.uri }
  }

  resolve(params: ResolveParams): { affectedUri: string } {
    // Validates thread exists, not already resolved
    // Adds resolution comment, sets status
    // Increments _versionCounter
    // Returns { affectedUri: thread.anchor.uri }
  }

  reopen(threadId: string, author: CommentAuthor): { affectedUri: string } {
    // Validates thread exists, is resolved
    // Sets status to "open", updates lastActivity
    // Increments _versionCounter
    // Returns { affectedUri: thread.anchor.uri }
  }

  delete(params: DeleteParams): { affectedUri: string } {
    // Validates thread exists (+ comment if commentId given)
    // Removes thread or comment; cleans up _stale
    // Increments _versionCounter
    // Returns { affectedUri }
  }

  deleteAllByModality(surfaceType: string): { count: number; affectedUris: string[] } {
    // Collects matching threads
    // Removes from _threads and _stale
    // Does NOT increment _versionCounter (the caller does it? or we do?)
    //   → Decision: YES, increment here like other mutations
    // Returns { count, affectedUris: [...] }
  }
```

### 2.4 Staleness — Document Change Tracking

```typescript
  /**
   * Handle a text document change event.
   * Adjusts line numbers for text-anchored threads and marks overlapping
   * threads as visually stale.
   *
   * Returns the affected URI so the adapter can persist + emit.
   */
  onDocumentChanged(change: DocumentChangeInfo): { affectedUri: string } {
    // Same line-adjustment logic as current CommentStore
    // Returns { affectedUri: change.uri }
  }
```

---

## 3. CommentStore — Adapter Pattern

`CommentStore` becomes a thin adapter:

```typescript
export class CommentStore {
  private readonly _repo = new CommentRepository();
  private readonly _listeners: ChangeListener[] = [];
  private _workspaceRoot = "";
  private _writeQueue: Promise<void> = Promise.resolve();

  // ── Persistence (stays here — uses vscode.workspace.fs) ────────

  async load(workspaceRoot: string): Promise<void> {
    this._workspaceRoot = workspaceRoot;
    // Read file via vscode.workspace.fs
    // Parse JSON
    // Call this._repo.loadFromStoreFile(parsed)
  }

  private async _persist(): Promise<void> {
    // Chain onto _writeQueue
    // Call this._repo.toStoreFile()
    // Atomic write via vscode.workspace.fs + fsRename
  }

  private _emit(uri: string): void {
    for (const l of this._listeners) l(uri);
  }

  // ── Delegated reads (pure pass-through) ────────────────────────

  getAllThreads()    { return this._repo.getAllThreads(); }
  getVersionInfo()  { return this._repo.getVersionInfo(); }
  getThread(id)     { return this._repo.getThread(id); }
  getThreadsForUri(uri) { return this._repo.getThreadsForUri(uri); }
  listThreads(opts) { return this._repo.listThreads(opts); }
  getCounts()       { return this._repo.getCounts(); }
  isThreadStale(id) { return this._repo.isThreadStale(id); }
  toStoreFile()     { return this._repo.toStoreFile(); }

  // ── Delegated mutations (delegate → persist → emit) ────────────

  async createThread(params: CreateCommentParams): Promise<CreateCommentResult> {
    const result = this._repo.createThread(params);
    await this._persist();
    this._emit(result.affectedUri);
    return { threadId: result.threadId, commentId: result.commentId };
  }

  async reply(params: ReplyParams): Promise<ReplyResult> {
    const result = this._repo.reply(params);
    await this._persist();
    this._emit(result.affectedUri);
    return { commentId: result.commentId };
  }

  async resolve(params: ResolveParams): Promise<void> {
    const result = this._repo.resolve(params);
    await this._persist();
    this._emit(result.affectedUri);
  }

  async reopen(threadId: string, author: CommentAuthor): Promise<void> {
    const result = this._repo.reopen(threadId, author);
    await this._persist();
    this._emit(result.affectedUri);
  }

  async delete(params: DeleteParams): Promise<void> {
    const result = this._repo.delete(params);
    await this._persist();
    this._emit(result.affectedUri);
  }

  async deleteAllByModality(surfaceType: string): Promise<number> {
    const result = this._repo.deleteAllByModality(surfaceType);
    if (result.count > 0) {
      await this._persist();
      for (const uri of result.affectedUris) {
        this._emit(uri);
      }
    }
    return result.count;
  }

  // ── Staleness (hybrid — domain in repo, I/O in store) ──────────

  onDocumentChanged(change: DocumentChangeInfo): void {
    const result = this._repo.onDocumentChanged(change);
    void this._persist();
    this._emit(result.affectedUri);
  }

  // pruneStaleThreads stays here — async exists() predicate is I/O
  async pruneStaleThreads(exists: (uri: string) => Promise<boolean>): Promise<string[]> {
    // Same implementation as today — iterates _repo.getAllThreads(),
    // checks exists(), then calls _repo.removeThreadsByUris(staleUris)
    // (new method on repo), persists, emits.
  }

  // ── Listener management (stays here — VSCode disposable pattern) ─

  onChanged(listener: ChangeListener): { dispose(): void } { ... }

  // ── Workspace root accessor ────────────────────────────────────

  getWorkspaceRoot(): string { return this._workspaceRoot; }
}
```

---

## 4. Additional Repository Method for pruneStaleThreads

`pruneStaleThreads` needs to delete threads by URI set — the I/O part (checking
existence) stays in `CommentStore`, but the actual removal is domain logic:

```typescript
  // In CommentRepository:

  /**
   * Remove all threads anchored to any URI in the given set.
   * Returns the IDs of removed threads.
   * Used by CommentStore.pruneStaleThreads() after I/O-based existence check.
   */
  removeThreadsByUris(uris: Set<string>): string[] {
    const removed: string[] = [];
    for (const [id, thread] of this._threads) {
      if (uris.has(thread.anchor.uri)) {
        removed.push(id);
        this._threads.delete(id);
        this._stale.delete(id);
      }
    }
    if (removed.length > 0) {
      this._versionCounter++;
    }
    return removed;
  }
```

---

## 5. Type Placement and Re-exports

### Types defined in `comment-repository.ts`:
All domain types stay where they currently live in `comment-store.ts` but move to
`comment-repository.ts` since `CommentRepository` uses them:

- `ListThreadsOptions`
- `ListThreadsResult`
- `ThreadSummary`
- `CreateCommentParams`
- `CreateCommentResult`
- `ReplyParams`
- `ReplyResult`
- `ResolveParams`
- `DeleteParams`
- `DocumentChangeInfo`
- `ChangeListener`

### Re-exports from `comment-store.ts`:
```typescript
// comment-store.ts — top of file
export type {
  ListThreadsOptions,
  ListThreadsResult,
  ThreadSummary,
  CreateCommentParams,
  CreateCommentResult,
  ReplyParams,
  ReplyResult,
  ResolveParams,
  DeleteParams,
  DocumentChangeInfo,
  ChangeListener,
} from "./comment-repository.js";
```

This preserves the existing import contract:
```typescript
// These all keep working:
import { CommentStore } from "./comment-store.js";
import type { CommentStore } from "./comment-store.js";
import { CommentStore, type CreateCommentParams, type ListThreadsOptions } from "../comment-store.js";
```

### `CommentRepository` export:
`CommentRepository` is exported from `comment-repository.ts` directly. It is NOT
re-exported from `comment-store.ts` — consumers who need it import from the new
module. (Currently no external consumer needs it; only `CommentStore` uses it
internally.)

---

## 6. Persistence Flow

```
LOAD:
  CommentStore.load(workspaceRoot)
    → vscode.workspace.fs.readFile(comments.json)
    → JSON.parse()
    → validate version === "1.0"
    → this._repo.loadFromStoreFile(parsed)

MUTATE (e.g. createThread):
  CommentStore.createThread(params)
    → const result = this._repo.createThread(params)  // sync, in-memory
    → await this._persist()                            // file I/O
    → this._emit(result.affectedUri)                   // notify listeners
    → return { threadId, commentId }

PERSIST:
  CommentStore._persist()
    → const data = this._repo.toStoreFile()
    → JSON.stringify(data)
    → write to .tmp → fsRename to .json (atomic)

DOCUMENT CHANGE:
  CommentStore.onDocumentChanged(change)
    → const result = this._repo.onDocumentChanged(change)  // sync line adjustment
    → void this._persist()                                 // fire-and-forget
    → this._emit(result.affectedUri)

PRUNE:
  CommentStore.pruneStaleThreads(exists)
    → collect URIs from this._repo.getAllThreads()
    → check exists() for each (async I/O)
    → this._repo.removeThreadsByUris(staleUris)
    → await this._persist()
    → emit for each stale URI
```

---

## 7. Decisions and Rationale

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Repository mutations are **synchronous** | Persistence and event emission are adapter concerns. Pure domain logic has no reason to be async. This makes the repository trivially testable without mocking I/O. |
| 2 | Mutations return `{ affectedUri }` alongside normal results | The adapter needs to know which URI to emit for. Embedding it in the return avoids the adapter re-deriving it from thread state. |
| 3 | Types move to `comment-repository.ts`, re-exported from `comment-store.ts` | Types belong with the domain logic that uses them. Re-exports preserve backward compatibility. |
| 4 | `CommentRepository` is not re-exported from `comment-store.ts` | No current consumer needs it. If future code needs the repo directly (e.g. for testing), they import from `comment-repository.js`. |
| 5 | `_versionCounter` lives in repository | It is pure domain state (monotonic counter incremented on mutations). The adapter does not touch it. |
| 6 | `_writeQueue` stays in adapter | It serializes I/O (file rename races). Pure domain logic does not need it. |
| 7 | `pruneStaleThreads` stays in adapter | Its core operation is an async existence check (I/O). The deletion part delegates to `repo.removeThreadsByUris()`. |
| 8 | `onChanged` + `_listeners` + `_emit` stay in adapter | Listener management is a side-effect concern. The repository never calls listeners. |
| 9 | `ChangeListener` type moves to repository | It is a pure type (no I/O), and `DocumentChangeInfo` already lives there. Keeps the type cluster together. |
| 10 | `loadFromStoreFile` clears existing state | Ensures idempotent reloads. If `load()` is called twice, no stale data leaks. |

---

## 8. Estimated LOC Split

| File | Current LOC | After Split |
|------|-------------|-------------|
| `comment-store.ts` | 633 | ~180 (adapter + re-exports) |
| `comment-repository.ts` | 0 (new) | ~350 (domain logic + types) |

Net effect: ~100 LOC reduction from eliminating duplication between domain logic
and adapter wrappers (the adapter methods are thin one-liners that delegate).

---

## 9. What Must NOT Change

1. **Public API of `CommentStore`** — every method keeps its current signature
   (name, params, return type, async/sync).
2. **Import paths** — `"./comment-store.js"` keeps exporting `CommentStore` + all
   current types.
3. **Test files** — zero changes to `comment-store.test.ts` or
   `comment-store-durability.test.ts`.
4. **Consumer files** — `extension.ts`, `comment-tools.ts`, `state-contribution.ts`,
   `native-comments.ts` require zero changes.
5. **Persistence format** — `CommentStoreFile` version `"1.0"` is unchanged.

---

## 10. Open Question

**`deleteAllByModality` — should it increment `_versionCounter`?**

Current code does NOT increment `_versionCounter` in `deleteAllByModality` — the
version counter is incremented in `createThread`, `reply`, `resolve`, `reopen`,
`delete`, `pruneStaleThreads`, but not `deleteAllByModality`. This appears to be
a bug in the current implementation. The repository version should be:

- **Option A:** Increment in `deleteAllByModality` (consistent with all other mutations).
- **Option B:** Leave the bug as-is to avoid behavioral change in this refactor.

**Recommendation:** Option A — fix it. The version counter is used only for sync
drift detection (`getVersionInfo`), and failing to increment it after a bulk delete
means the Hub would miss the change. This is a correctness fix, not a behavior change.

---

## Result: **READY FOR IMPLEMENTATION**

This document fully specifies the extraction. All method signatures, type
placements, and adapter patterns are defined. The developer can implement
`comment-repository.ts` and refactor `comment-store.ts` with zero ambiguity.
