# Review — diagram-style-persistence — Phase D2

**Bugs under review:** F-2 (fillStyle/strokeStyle not persisted), F-3 (fontFamily not persisted)  
**Files changed:**
- `packages/diagram/src/webview/scene-adapter.ts` — added `REVERSE_FONT_FAMILY_MAP`; changed `fillStyle` default from hardcoded to `??`
- `packages/diagram/src/webview/message-handler.ts` — added F-2 and F-3 detection blocks; updated WF-10..WF-16 in file header

**Reviewer:** AI Reviewer  
**Date:** 2026-03-31  
**Verdict:** PASS — all D2 checklist items clear; module cleared for Phase D3 (testing guide)

---

## 1. Tests pass

Command: `cd packages/diagram && pnpm test`

```
 Test Files  21 passed (21)
      Tests  515 passed (515)
   Start at  15:07:23
   Duration  2.90s
```

Zero failures. Zero skipped. ✓

---

## 2. Type checker clean

Command: `cd packages/diagram && pnpm exec tsc --noEmit`

```
(no output)
```

Zero type errors. ✓

---

## 3. Linter

ESLint configuration is listed as "to be added" (coding-guidelines.md §4) and is not yet wired in the monorepo. No linter failures are possible. **Not blocking.** Pre-existing condition for the entire project.

---

## 4. Coding guidelines — new code

### §1.1 Type safety

| Rule | Finding |
|---|---|
| Never use `any` | Zero occurrences in both changed files — confirmed by grep. ✓ |
| Non-null assertions with comment | No `!` assertions (non-null assertion operator) appear in new code. The `!mermaidId`, `!isText` in conditions are logical-not, not the assertion operator. ✓ |
| No `as X` cast without narrowing | See §5 below (Banned patterns — Type Casts). ✓ |
| All exported functions have explicit return types | `toExcalidrawPayload(): ExcalidrawAPIElement[]` — ✓; `applyHostMessage(): Promise<void>` — ✓; `detectNodeMutations(): NodeMutation[]` — ✓. No new exported functions added without return types. ✓ |

### §1.3 Functions & Modules

| Rule | Finding |
|---|---|
| No commented-out code | None in new lines. ✓ |
| Async/await over raw Promises | `applyHostMessage` uses `async`/`await` throughout. No `.then()/.catch()` in new code. ✓ |
| Keep functions short (≤ ~40 implementation lines) | `detectNodeMutations` has ~60 implementation lines (non-blank, non-comment). This is above the ~40-line guideline. However: (a) 26 of those lines are the new F-2 and F-3 blocks; (b) the function's structure is a single flat loop over `prev` — the logic cannot be split into smaller pieces without introducing helper functions that would obscure the diff-detection pattern; (c) the _pre-existing_ function body was already ~34 lines before these additions. The overage is modest and justified. Recorded as advisory. |

### §1.4 Error handling

`detectNodeMutations` and `toExcalidrawPayload` are pure synchronous functions. No I/O, no async paths, no error-handling surface. ✓

---

## 5. Banned patterns

### `: any` (§3.3)
```
$ grep -n ": any" message-handler.ts scene-adapter.ts
(no output)
```
Zero occurrences. ✓

### `console.log` (§3.1)
```
$ grep -n "console\." message-handler.ts scene-adapter.ts
(no output)
```
Zero occurrences. ✓

### `TODO` / `FIXME` (§3.1)
```
$ grep -n "TODO\|FIXME" message-handler.ts scene-adapter.ts
(no output)
```
Zero occurrences. ✓

### Type casts (`as X`) in new code (§3.3)

New casts introduced in this diff:

**`message-handler.ts:235–236`** (F-3 block — new):
```typescript
const nextFf = (nextEl as unknown as Record<string, unknown>).fontFamily as number | undefined;
const prevFf = (prevEl as unknown as Record<string, unknown>).fontFamily as number | undefined;
```

`ExcalidrawAPIElement.fontFamily` is typed as `number` (non-optional, line 63 of `scene-adapter.ts`). In theory `nextEl.fontFamily` is directly accessible as `number` without a cast. The double-cast to `number | undefined` is defensive — Excalidraw's real `onChange` data may return elements where this field is absent. The identical pattern was pre-existing for `fontSize` (lines 246–247, committed in Session 11) and this new block follows that established convention exactly.

**Verdict:** Acceptable — goes through `unknown` (not a direct unsafe `as X`), follows the pre-existing `fontSize` pattern on lines immediately below, and the defensiveness is documented in the comment block above the F-3 section. Not a §3.3 violation (§3.3 bans unsafe `as X` without narrowing; the route through `unknown` is the project's accepted widening idiom for Excalidraw's duck-typed element objects). ✓

**Pre-existing casts unchanged** (not in scope of this review):
- `msg.elements as ExcalidrawAPIElement[]` — line 133 (justified by comment above it)
- `base as unknown as Record<string, unknown>` — lines 157, 170 in `toExcalidrawPayload` (text and arrow field injection, Session 11 pattern)
- `prevFs/nextFs` casts — lines 246–247 (pre-existing `fontSize` pattern)

---

## 6. Test completeness

### Coverage of F-2 (fillStyle / strokeStyle)

| Requirement | Test | Status |
|---|---|---|
| fillStyle change on shape → `styled` mutation | WF-10 | ✓ |
| strokeStyle change on shape → `styled` mutation | WF-11 | ✓ |
| fillStyle NOT emitted for `:text` elements | WF-12 | ✓ |
| fillStyle NOT emitted for edge arrows (`->` in id) | WF-16 | ✓ |
| fillStyle passthrough in `toExcalidrawPayload` | SA-06 | ✓ |
| fillStyle defaults to `"hachure"` when absent | SA-07 | ✓ |

### Coverage of F-3 (fontFamily)

| Requirement | Test | Status |
|---|---|---|
| fontFamily change on `:text` element → `styled` mutation (reverse-mapped) | WF-13 | ✓ |
| fontFamily NOT emitted on shape element | WF-14 | ✓ |
| Unknown numeric fontFamily (99) → NOT emitted | WF-15 | ✓ |

### Advisory gaps from Phase B (carried forward, non-blocking)

1. **`:label` guard branch untested (Advisory Gap 1 from Phase B):** The `!mermaidId.endsWith(":label")` arm of the triple guard has no dedicated test. WF-12 covers `:text`, WF-16 covers `->`. The `:label` guard is a belt-and-suspenders protection for edge label text overlays. Risk is low: `:label` suffixed elements are rare in practice and the `->` guard already catches the most common edge mermaidIds. This gap is unchanged from Phase B. Not blocking.
2. **Combined fillStyle + strokeStyle change untested (Advisory Gap 2 from Phase B):** WF-10 and WF-11 each change one property. No test exercises simultaneous change. Source inspection shows sequential `if` statements (not `else if`), making the gap notional. Not blocking.

No test was weakened; no existing test was removed or loosened.

---

## 7. Architectural constraints (AGENTS.md §4)

| Constraint | Status |
|---|---|
| No VSCode imports in Hub packages | Not applicable to `diagram` package. The two changed files both contain `No VSCode import` in their file headers. ✓ |
| Security middleware first on authenticated endpoints | Not applicable to pure computation functions. ✓ |
| Handler functions never serialized | Not applicable. ✓ |
| `bridge-types` contains only types — no logic | No changes to `bridge-types`. ✓ |
| Hub has zero VSCode imports | No changes to Hub. ✓ |

---

## 8. Runtime exposure

F-2 and F-3 are bug fixes to an existing data-flow path:

```
Excalidraw onChange → detectNodeMutations → canvas:node-styled → handleNodeStyled → patchLayout → writeLayout → layout.json
```

The path was already wired in production (Session 11). The new code extends what properties are detected; no new message types, no new endpoints, no new tool registrations, and no new MCP tools were added. Runtime discoverability is unchanged. ✓

The one end-to-end path that cannot be exercised by unit tests is the Excalidraw browser `onChange` callback in the webview. This is a pre-existing constraint documented in Phase B (§3.6 guideline "If real deployed E2E could not be executed, review includes explicit constraint + residual risk note"):

**Constraint:** The webview code (`message-handler.ts`) runs in a browser context inside a VSCode webview panel. The Excalidraw `onChange` hook that calls `detectNodeMutations` cannot be triggered by `vitest` (Node.js environment). All 515 tests validate the function's pure logic via direct invocation.

**Residual risk:** If the production Excalidraw version's `onChange` callback passes element objects with a different shape than what the tests assume (e.g., `fontFamily` field absent, `fillStyle` field absent), the `undefined` baseline would suppress mutations silently rather than corrupt data. This matches the defensive intent of the `as number | undefined` widening casts and the `fontName != null` guard. Risk: low.

---

## 9. Modularity

| Check | Finding |
|---|---|
| No function exceeds ~40 lines | `detectNodeMutations`: ~60 implementation lines. Modestly over; see §4 for justification. Advisory only. |
| No file exceeds ~200 lines of implementation | `message-handler.ts`: 258 total lines (many blank + comment). `scene-adapter.ts`: 177 total lines. Both within reasonable range given documentation density. ✓ |
| No forbidden cross-layer imports | `message-handler.ts` imports `REVERSE_FONT_FAMILY_MAP` from `scene-adapter.ts` — same layer (webview utilities). ✓ |
| No cyclic dependencies | `scene-adapter.ts` does not import from `message-handler.ts`. One-way dependency. ✓ |

---

## 10. Replaceability

| Check | Finding |
|---|---|
| New capability is composable | `REVERSE_FONT_FAMILY_MAP` is a standalone exported constant. `detectNodeMutations` is a pure function with no side effects. ✓ |
| Adapter swap possible without caller changes | The `fillStyle ?? "hachure"` fix in `toExcalidrawPayload` is internal — callers (`panel.ts`) are unchanged. ✓ |
| No new global mutable state | Both new exports are `const` with `Readonly<>`. Zero mutable module-level state introduced. ✓ |

---

## Summary

| Checklist Item | Verdict |
|---|---|
| 1. Tests pass (515 passing, 0 failures) | ✓ PASS |
| 2. Type checker clean (zero errors) | ✓ PASS |
| 3. Linter | N/A — not yet configured (pre-existing) |
| 4. Coding guidelines | ✓ PASS (one advisory: detectNodeMutations slightly over 40-line guideline) |
| 5. Test completeness | ✓ PASS (2 advisory gaps carried from Phase B, non-blocking) |
| 6. Banned patterns | ✓ PASS (zero `any`, zero console.log, zero TODO/FIXME; casts follow established project idiom) |
| 7. Architectural constraints | ✓ PASS |
| 8. Runtime exposure | ✓ PASS (pre-existing E2E constraint documented with residual risk note) |
| 9. Modularity | ✓ PASS (one advisory: detectNodeMutations slightly over line guideline) |
| 10. Replaceability | ✓ PASS |

**Overall verdict: PASS — Phase D3 (testing guide) may begin.**

No blocking findings. The two advisory items (function line count and advisory test gaps) are recorded for awareness but do not require fixes before Phase E.
