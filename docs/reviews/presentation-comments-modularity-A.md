# Presentation + Comments Integration — Phase A Design

## Scope

- `packages/marp`
- presentation-related integration/routing portions of `packages/comments`
- `packages/capabilities` (shared navigation contracts only — non-breaking additive exports)

## Phase A — What Was Done

All items below are **committed** and verified.

### Shared Navigation Contracts — Frozen

**File:** `packages/capabilities/src/navigation.ts`  
**Re-exported from:** `packages/capabilities/src/index.ts` (additive — no existing exports changed)

#### `NavigationEnv`

```ts
export interface NavigationEnv {
  executeCommand<T = unknown>(
    command: string,
    ...args: readonly unknown[]
  ): Promise<T>;
}
```

#### `NavigationAdapter`

```ts
export interface NavigationAdapter {
  readonly surfaceType: string;
  navigateToAnchor(
    anchor: Readonly<Record<string, unknown>>,
    env: NavigationEnv,
  ): Promise<boolean>;
  focusThread(
    threadId: string,
    anchor: Readonly<Record<string, unknown>>,
    env: NavigationEnv,
  ): Promise<boolean>;
  dispose?(): void;
}
```

#### `NavigationAdapterRegistry`

```ts
export interface NavigationAdapterRegistry {
  register(adapter: NavigationAdapter): void;
  unregister(surfaceType: string): void;
  get(surfaceType: string): NavigationAdapter | undefined;
  dispose(): void;
}
```

#### `createNavigationAdapterRegistry` (factory)

```ts
export function createNavigationAdapterRegistry(): NavigationAdapterRegistry;
```

**Registry lifecycle rules:**
- `register()` — last-writer-wins for same `surfaceType`; disposes previous adapter if it has `dispose()`
- `unregister()` — no-op if absent; disposes adapter if supported
- `get()` — returns adapter or `undefined`; callers handle missing adapters gracefully
- `dispose()` — disposes all registered adapters and clears the registry
- Missing adapter fallback: comments routing degrades gracefully, no throw

### Frozen Runtime Seam

**File:** `packages/marp/src/runtime-adapter.ts` (interface)

```ts
handleViewSlideChanged(index: number): void;
```

**File:** `packages/marp/src/marp-adapter.ts` (concrete implementation)

```ts
handleViewSlideChanged(index: number): void {
  if (index >= 0 && index < this.deck.slides.length && index !== this.currentIndex) {
    this.currentIndex = index;
    this.emitSlideChanged(index);
  }
}

/** @deprecated Use handleViewSlideChanged() — kept for backward compatibility during migration. */
handleWebviewSlideChanged(index: number): void {
  this.handleViewSlideChanged(index);
}
```

**Event flow:** Webview `postMessage({ type: 'presentation:slideChanged', index })` → `PresentationProvider.handleWebviewMessage()` → `adapter.handleViewSlideChanged(index)` (typed call, no cast) → adapter emits through `onSlideChanged` listeners.

### Frozen Presentation Renderer Seam

**File:** `packages/marp/src/types.ts`

```ts
export interface PresentationRenderer {
  render(markdown: string): MarpRenderResult;
  getNotes(result: MarpRenderResult, slideIndex: number): string | null;
}
```

`PresentationProvider` now accepts `PresentationRenderer` instead of concrete `MarpRenderer` class. `MarpRenderer` satisfies the interface — no changes needed to it.

## Phase A — What Is Deferred

The following are explicitly deferred past Phase A and will be addressed in future implementation slices.

### Deferred: Command Promotion

`PRESENTATION_GOTO` and `PRESENTATION_FOCUS_THREAD` currently live in `DEFERRED_COMMANDS`. Promotion to `CAPABILITY_COMMANDS` is deferred. Rules when executed:
- String values stay unchanged
- No alias/deprecation bridge needed
- Producer and consumer call sites update atomically in same slice
- `BROWSER_FOCUS_THREAD` stays deferred and untouched

### Deferred: Full Navigation Registry Wiring

The `PresentationCommentsBridge` currently encodes slide anchors directly and has no dependency on the navigation registry. The deferred migration path:
1. `accordo-marp` registers a `NavigationAdapter` with `surfaceType: "slide"` at extension activation
2. `accordo-comments` routes `focusThread` through the registry instead of current hardcoded path
3. Graceful degradation when no slide adapter is registered

**Phase A only established the contracts and ensured deferred commands are correctly placed.**

## Architecture Delta — Where to Find It

The architecture intent is now documented in:

| Topic | Location |
|---|---|
| Navigation adapter registry contracts + ownership | `docs/10-architecture/architecture.md` §17.1 |
| Provider ↔ adapter event seam | `docs/10-architecture/architecture.md` §17.2 |
| Presentation renderer seam | `docs/10-architecture/architecture.md` §17.3 |
| Deferred navigation registry wiring plan | `docs/10-architecture/architecture.md` §17.4 |
| Deferred command promotion plan | `docs/10-architecture/architecture.md` §17.5 |
| Full artifact traceability table | `docs/10-architecture/architecture.md` §17.6 |

## Phase A Acceptance Criteria

| Criterion | Status |
|---|---|
| Shared navigation contract location frozen | ✅ `packages/capabilities/src/navigation.ts` |
| Navigation contract signatures frozen | ✅ Exact signatures in §"Frozen Navigation Contracts" above |
| Runtime adapter seam frozen | ✅ `handleViewSlideChanged(index: number): void` |
| Renderer seam frozen | ✅ `PresentationRenderer` interface in `packages/marp/src/types.ts` |
| Registry lifecycle frozen | ✅ Rules documented above |
| Command promotion plan frozen | ✅ Deferred — documented in §17.5 of architecture.md |
| Architecture delta documented | ✅ Committed to `docs/10-architecture/architecture.md` §17 |
| All affected packages typecheck | ✅ capabilities + marp clean |
| All affected tests pass | ✅ capabilities 68/68, marp 229/229 |
| Architecture intent auditable without implementation | ✅ Deferred items clearly separated from Phase A done items |
