## Review — wave1-review-2026-04-06

Commit reviewed: `02880bc`  
Scope reviewed:
- `packages/browser/src/page-tool-types.ts`
- `packages/browser/src/wait-tool.ts`
- `packages/browser/src/page-tool-handlers-impl.ts`
- `packages/browser/src/semantic-graph-tool.ts`
- `packages/browser/src/__tests__/security-structured-errors.test.ts`
- `packages/browser-extension/src/content/element-inspector.ts`
- `packages/browser-extension/src/content/semantic-graph-a11y.ts`
- `packages/browser-extension/src/content/semantic-graph-collector.ts`
- `packages/browser-extension/src/content/semantic-graph-types.ts`

### Validation run

- ✅ Tests (targeted packages):
  - `pnpm --filter accordo-browser test -- --run ...`
  - `pnpm --filter browser-extension test -- --run ...`
  - Result: all tests passed in both packages.
- ⚠️ Typecheck:
  - `accordo-browser`: clean
  - `browser-extension`: fails, but failures are in pre-existing/non-wave files (`src/screenshot-redaction.ts` import path and an existing test cast in `tests/element-inspector.test.ts`).
- ✅ Lint:
  - `accordo-browser`: clean for configured lint scope
  - `browser-extension`: clean for configured lint scope

---

## Bugs found (must fix)

1. **Nested shadow roots are not traversed in semantic graph a11y builder**
   - File: `packages/browser-extension/src/content/semantic-graph-a11y.ts`
   - Location: `buildA11yChildrenFromRoot()` (lines ~76–116)
   - Problem:
     - The new shadow traversal handles a host's first open shadow root, but while iterating shadow children it never checks `child.shadowRoot` again.
     - This drops descendants in **nested** open shadow roots and breaks parity intent with `get_page_map` lineage behavior.
   - Why this matters:
     - C4 claims lineage parity (`inShadowRoot`/`shadowHostId`) with shadow traversal support. For nested shadow components, output is incomplete.
   - Fix:
     - In `buildA11yChildrenFromRoot()`, add traversal for `child.shadowRoot` when `piercesShadow` behavior is active (same pattern used in `buildA11yChildren()`), and ensure host rebasing behavior is explicit for nested hosts.

---

## Quality issues (should fix)

1. **Duplicate transient error maps create drift risk**
   - File: `packages/browser/src/page-tool-types.ts`
   - Locations: module constant `TRANSIENT_ERRORS` (~501) and local shadow copy inside `buildStructuredError()` (~528).
   - Issue:
     - Same data duplicated in two places; future edits can diverge silently.
   - Suggestion:
     - Keep a single source of truth (module-level constant) and reuse it in `buildStructuredError()`.

2. **Unsafe structural cast in shadow recursion**
   - File: `packages/browser-extension/src/content/semantic-graph-a11y.ts`
   - Location: line using `{ children: child.children } as unknown as ShadowRoot`.
   - Issue:
     - This is brittle and bypasses type safety.
   - Suggestion:
     - Refactor helper signatures to accept `ParentNode`/`Element` iteration directly, removing the fake `ShadowRoot` cast.

3. **Inline wait timeout fallback returns `elapsedMs: 0`**
   - File: `packages/browser/src/page-tool-handlers-impl.ts`
   - Location: `handleWaitForInline()` fallback (~538).
   - Issue:
     - Timeout fallback now includes retry hints (good), but `elapsedMs` remains `0`, which is inconsistent with timeout semantics in `wait-tool.ts` (`elapsedMs` = timeout value).
   - Suggestion:
     - Align inline fallback with main wait handler semantics (`elapsedMs` should reflect effective timeout).

---

## Test gaps

1. **No dedicated tests for semantic-graph C4 behavior (`piercesShadow`, `inShadowRoot`, `shadowHostId`)**
   - Missing in:
     - `packages/browser-extension/tests/semantic-graph-collector.test.ts`
     - `packages/browser/src/__tests__/semantic-graph-tool.test.ts`
   - Needed:
     - `piercesShadow: false` excludes shadow descendants.
     - `piercesShadow: true` includes shadow descendants.
     - Nodes inside shadow tree include `inShadowRoot: true` and valid `shadowHostId`.
     - Nested shadow root case coverage.

2. **No tests for F2 explicit boolean taxonomy fields (`disabled`, `readonly`)**
   - Missing in:
     - `packages/browser-extension/tests/element-actionability.test.ts`
   - Needed:
     - Assert explicit `disabled: false` for enabled button/input.
     - Assert explicit `disabled: true` for disabled controls.
     - Assert explicit `readonly: false/true` for input/textarea.

3. **No explicit tests for H2 retry hints on timeout fallback paths**
   - Missing in:
     - `packages/browser/src/__tests__/wait-tool.test.ts`
     - (and/or tests covering `handleWaitForInline`)
   - Needed:
     - Assert timeout fallback returns `retryable: true` and `retryAfterMs: 1000`.
     - Cover both `wait-tool.ts` and inline handler path.

---

## Overall assessment

- H3 and F2 changes are directionally correct.
- H2 change addresses the observed fallback shape gap, but timeout semantics are still inconsistent in inline path.
- C4 is partially implemented but **not complete** due to missing nested shadow traversal; this is a correctness bug and should be fixed before considering wave fully complete.
