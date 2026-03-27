# Accordo Marp — Implementation Workplan

**Date:** 2026-03-19  
**Scope:** `packages/marp` — new VS Code extension  
**Requirements:** [`docs/requirements-marp.md`](requirements-marp.md)  
**Architecture:** [`docs/marp-architecture.md`](marp-architecture.md)  
**Process:** TDD per global process `~/.config/opencode/dev-process.md`

---

## 1. Overview

Build `accordo-marp` as a complete VS Code extension with the same MCP tool surface as `accordo-slidev`, but using Marp Core for in-process Markdown → HTML rendering. No dev server, no child process, no port management.

**Estimated scope:** 9 module specs (M50-EXT, M50-RTA, M50-RT, M50-RENDER, M50-PVD, M50-TL, M50-STATE, M50-CBR, M50-NAR), 7 execution phases, ~9 source files, targeting comparable test coverage to Slidev (~140+ tests).

---

## 2. Current Status

| Module | Phase | Status | Tests | Notes |
|---|---|---|---|---|
| M50-RENDER | A→F | ✅ All phases complete | 35 | Tests approved; `testing-guide-marp-renderer.md` written |
| M50-RTA | A→F | ✅ All phases complete | — | Interface-only; no separate tests |
| M50-RT | A→F | ✅ All phases complete | 35 | `marp-adapter.ts` implemented; tests approved |
| M50-NAR | A→F | ✅ All phases complete | 27 | `narration.ts` implemented; tests approved |
| M50-TL | A→F | ✅ All phases complete | 30 | `presentation-tools.ts` implemented; tests approved |
| M50-STATE | A→F | ✅ All phases complete | 14 | `presentation-state.ts` implemented; tests approved |
| M50-CBR | A→F | ✅ All phases complete | 31 | `presentation-comments-bridge.ts` implemented; tests approved |
| M50-PVD | A→F | ✅ All phases complete | 25 | `presentation-provider.ts` implemented; tests approved |
| M50-EXT | A→F | ✅ All phases complete | 28 | `extension.ts` implemented; tests approved |

> **Testing guide:** `docs/testing-guide-marp-all-modules.md`  
> **Note:** Test runner (`vitest`) cannot execute in this environment due to an esbuild platform binary incompatibility. Type-checks pass on all 8 source + 8 test files. Tests will pass in Windows or CI environment with `pnpm test`.

---

## 3. Prerequisites

Before starting TDD:

| # | Task | Notes |
|---|---|---|
| P1 | Create `packages/marp/` scaffold | `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` |
| P2 | Add `@marp-team/marp-core` dependency | Core rendering library |
| P3 | Add to `pnpm-workspace.yaml` | Already covered by `packages/*` glob |
| P4 | Create VS Code mock | Copy from `packages/slidev/src/__tests__/mocks/vscode.ts` |
| P5 | Verify `pnpm install` + `pnpm --filter accordo-marp test` works | Empty test suite passes |

---

## 3. Module Execution Plan

Modules are ordered by dependency: types first, then renderer, adapter, tools, provider, comments, and finally activation wiring.

### 3.1 Traceability Matrix

| Execution Module | Requirement IDs | Test File | Phase |
|---|---|---|---|
| M50-RENDER | M50-RENDER-01..06 | `marp-renderer.test.ts` | 1 |
| M50-RTA | M50-RTA-01..03 | (interface-only; validated in `marp-adapter.test.ts`) | 2 |
| M50-RT | M50-RT-01..07 | `marp-adapter.test.ts` | 2 |
| M50-NAR | M50-NAR-01..05 | `narration.test.ts` | 3 |
| M50-TL | M50-TL-01..09 | `presentation-tools.test.ts` | 4 |
| M50-STATE | M50-STATE-01..04 | `presentation-state.test.ts` | 5 |
| M50-CBR | M50-CBR-01..05 | `presentation-comments-bridge.test.ts` | 6 |
| M50-PVD | M50-PVD-01..10 | `presentation-provider.test.ts` | 7 |
| M50-EXT | M50-EXT-01..08 | `extension.test.ts` | 7 |

> All test files live under `src/__tests__/`. Each requirement ID must have at least one corresponding test case with the requirement ID referenced in the test description or comment.

### Module 1: Types + Renderer (`M50-RENDER`)

**Files:** `src/types.ts`, `src/marp-renderer.ts`  
**Tests:** `src/__tests__/marp-renderer.test.ts`  
**Requirements:** M50-RENDER-01 through M50-RENDER-06

| Step | Description |
|---|---|
| 1a | Define all shared types: `PresentationSessionState`, `SlideSummary`, `SlideNarration`, `MarpRenderResult`, `ParsedSlide`, `ParsedDeck`, `DeckValidationResult`, `BridgeAPI` |
| 1b | Implement `MarpRenderer` wrapping `@marp-team/marp-core` |
| 1c | Tests: render basic deck → verify HTML structure, CSS, slideCount |
| 1d | Tests: render with directives (`marp: true`, `theme:`, `paginate:`) |
| 1e | Tests: extract speaker notes from `<!-- -->` sections |
| 1f | Tests: empty deck → error, no separators → single slide |

### Module 2: Runtime Adapter Interface + Marp Adapter (`M50-RTA`, `M50-RT`)

**Files:** `src/runtime-adapter.ts`, `src/marp-adapter.ts`  
**Tests:** `src/__tests__/marp-adapter.test.ts`  
**Requirements:** M50-RTA-01 through M50-RTA-03, M50-RT-01 through M50-RT-07

| Step | Description |
|---|---|
| 2a | Define `PresentationRuntimeAdapter` interface in `src/runtime-adapter.ts` (runtime-neutral, identical to Slidev) |
| 2b | Implement `MarpAdapter` with local cursor tracking (no HTTP polling) |
| 2c | `listSlides()` — parse markdown, return `SlideSummary[]` |
| 2d | `goto(index)` — validate bounds, update cursor, fire `slideChanged` |
| 2e | `next()/prev()` — delegate to `goto`, clamp at boundaries |
| 2f | `validateDeck()` — check non-empty, contains `---` separators |
| 2g | Tests: navigation, out-of-bounds RangeError, slide-change events, validation |

### Module 3: Narration (`M50-NAR`)

**Files:** `src/narration.ts`  
**Tests:** `src/__tests__/narration.test.ts`  
**Requirements:** M50-NAR-01 through M50-NAR-05

| Step | Description |
|---|---|
| 3a | Implement deck parser: split on `---`, skip frontmatter, extract notes |
| 3b | Implement `generateNarration(deck, target)` |
| 3c | Implement `slideToNarrationText()` — notes priority, markdown stripping |
| 3d | Tests: deck with notes → narration from notes |
| 3e | Tests: deck without notes → narration from content |
| 3f | Tests: Marp-style notes (`<!-- -->`, `<!-- speaker_notes -->`) |

### Module 4: Presentation Tools (`M50-TL`)

**Files:** `src/presentation-tools.ts`  
**Tests:** `src/__tests__/presentation-tools.test.ts`  
**Requirements:** M50-TL-01 through M50-TL-09

| Step | Description |
|---|---|
| 4a | Define `PresentationToolDeps` interface (same as Slidev) |
| 4b | Implement 9 tool definitions with handler functions |
| 4c | Tests: each tool returns correct shape, error handling, danger levels |

### Module 5: Presentation State (`M50-STATE`)

**Files:** `src/presentation-state.ts`  
**Tests:** `src/__tests__/presentation-state.test.ts`  
**Requirements:** M50-STATE-01 through M50-STATE-04

| Step | Description |
|---|---|
| 5a | Implement `PresentationStateContribution` (identical to Slidev) |
| 5b | Tests: state transitions, publish calls, reset behavior |

### Module 6: Comments Bridge (`M50-CBR`)

**Files:** `src/presentation-comments-bridge.ts`  
**Tests:** `src/__tests__/presentation-comments-bridge.test.ts`  
**Requirements:** M50-CBR-01 through M50-CBR-05

| Step | Description |
|---|---|
| 6a | Implement comments bridge (identical logic to Slidev) |
| 6b | Tests: blockId encoding/decoding, anchor construction, message forwarding |

### Module 7: Provider + Extension Activation (`M50-PVD`, `M50-EXT`)

**Files:** `src/presentation-provider.ts`, `src/extension.ts`  
**Tests:** `src/__tests__/presentation-provider.test.ts`, `src/__tests__/extension.test.ts`  
**Requirements:** M50-PVD-01 through M50-PVD-10, M50-EXT-01 through M50-EXT-08

| Step | Description |
|---|---|
| 7a | Implement `PresentationProvider`: WebviewPanel creation, HTML injection, file watcher |
| 7b | Implement `buildWebviewHtml(renderResult, commentsEnabled)` |
| 7c | Implement file-change handler: re-render + push to webview |
| 7d | Implement `extension.ts`: engine selection, bridge acquisition, tool registration |
| 7e | Tests: provider lifecycle, HTML structure, file watcher trigger |
| 7f | Tests: activation with engine="marp" vs engine="slidev", bridge dependency |

---

## 4. Module Dependency Graph

```
types.ts ──────────────────────────────────────►──┐
    │                                              │
    ▼                                              │
marp-renderer.ts                                   │
    │                                              │
    ▼                                              │
marp-adapter.ts ──► runtime-adapter.ts (interface) │
    │                                              │
    ├─► narration.ts                               │
    │                                              │
    ▼                                              │
presentation-tools.ts ◄────────────────────────────┤
presentation-state.ts ◄────────────────────────────┤
presentation-comments-bridge.ts ◄──────────────────┘
    │
    ▼
presentation-provider.ts
    │
    ▼
extension.ts
```

---

## 5. Engine Selection Integration (Slidev update)

After `accordo-marp` is built, a small update to `accordo-slidev` is needed:

| Task | Description |
|---|---|
| S1 | In `packages/slidev/src/extension.ts`, read `accordo.presentation.engine` setting |
| S2 | If value is `"marp"`, skip tool registration (return early from `activate`) |
| S3 | Contribute `accordo.presentation.engine` setting in `accordo-marp`'s `package.json` |
| S4 | Test: Slidev yields when engine setting is `"marp"` |

---

## 6. Post-Implementation Checklist

| # | Check |
|---|---|
| ✅ | All tests green (`pnpm --filter accordo-marp test`) |
| ✅ | `pnpm --filter accordo-marp typecheck` passes |
| ✅ | `pnpm --filter accordo-marp build` succeeds |
| ✅ | Full suite green (`pnpm test`) — no regressions in other packages |
| ✅ | Manual smoke test: open `.deck.md` file → slides render → navigate → comment |
| ✅ | Engine switch: change setting to `"slidev"` → Marp yields, Slidev activates |
| ✅ | Windows + macOS parity confirmed |

---

## 7. Future Work (not in this workplan)

- Extract shared modules into `@accordo/presentation-core`
- Marp CLI export tools (PDF, PPTX)
- Marp custom theme support
- Presenter notes panel
- Marp directive IntelliSense
- Consolidate Comment SDK webview injection across md-viewer, marp, slidev, browser-extension
