## Review — Gap 2 (REQ-TC-017 interaction control gating)

Date: 2026-04-16  
Reviewer: reviewer agent

### Scope reviewed
- `packages/browser-extension/src/relay-definitions.ts`
- `packages/browser-extension/src/relay-control-handlers.ts`
- `packages/browser-extension/tests/setup/chrome-mock.ts`
- `packages/browser-extension/tests/relay-control-handlers.test.ts`
- Coding standards reference: `docs/30-development/coding-guidelines.md` (§3 checklist + banned patterns)

### Verification run (actual)
- `pnpm test` (in `packages/browser-extension`): **50 files, 1250 tests passing, 0 failures**
- `pnpm typecheck`: **clean**
- `pnpm lint`: **0 errors, 2 warnings (pre-existing, outside this Gap 2 change set)**

Warnings observed during lint:
- `src/popup.ts:635` unused eslint-disable directive
- `src/relay-transport.ts:25` console statement warning

These warnings are not in the files changed for this fix.

---

### 1) Correctness: split failure modes
**PASS**

The implementation now correctly distinguishes:
1. **Invalid explicit tab target** → `"tab-not-found"`
2. **Existing tab without permission** → `"control-not-granted"`

Behavior is implemented consistently in all four handlers:
- `handleNavigate`
- `handleClick`
- `handleType`
- `handlePressKey`

Each performs REQ-TC-017 existence check **before** permission check when `payload.tabId` is explicitly provided.

---

### 2) Edge-case behavior
**PASS (with recommendation)**

Good:
- Existence check only runs for explicit numeric `payload.tabId`.
- Implicit tab resolution path (active tab) is unchanged.
- Non-existent tabs in tests are simulated realistically via `chrome.tabs.get()` rejection.

Recommendation (non-blocking):
- Add one regression test asserting that when `tabId` is omitted, the handler does **not** emit `tab-not-found` and continues through normal control-gating path.

---

### 3) Type safety (`"tab-not-found"` union integration)
**PASS**

- `RelayActionResponse.error` union includes `"tab-not-found"`.
- `ERROR_META` includes `"tab-not-found": { retryable: false }`.
- `actionFailed(..., code)` accepts the new code through the existing typed union.

No `any` or unsafe cast introduced by this change.

---

### 4) Test coverage adequacy for REQ-TC-017
**PASS**

Added tests cover all four handlers, each with two assertions:
- explicit invalid tabId → `tab-not-found`
- existing tab but no permission → `control-not-granted`

This is appropriate and directly aligned with the requirement split.

---

### 5) Coding-guidelines compliance (focus: §3 + banned patterns)
**PASS for changed files**

Checked against `docs/30-development/coding-guidelines.md`:
- No debug logs added in changed production paths
- No TODO/FIXME added
- No commented-out dead code introduced
- Error handling remains structured through `actionFailed`
- Test isolation maintained (`resetChromeMocks()` in `beforeEach`, state reset includes `nonExistentTabIds.clear()`)

Repository-level lint warnings exist but are outside this patch.

---

### 6) Header comment in `relay-control-handlers.ts` (lines 1–25)
**SHOULD UPDATE**

The module header lists requirement IDs up to `REQ-TC-015`, but this change implements `REQ-TC-017`. For requirement traceability consistency, add `REQ-TC-017` to the top header list.

This is documentation coherence, not functional correctness.

---

## Verdict

### PASS
- Fix is correct and complete for the stated Gap 2 behavior.
- Type wiring is correct.
- New tests are meaningful and cover the split failure modes.

### Non-blocking suggestions
1. Add `REQ-TC-017` to the file-level requirement header in `relay-control-handlers.ts`.
2. Add one explicit test for omitted `tabId` path to guard future regressions in gating order.

### Blocking issues
- **None** for this Gap 2 fix.
