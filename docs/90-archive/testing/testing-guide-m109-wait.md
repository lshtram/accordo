# Testing Guide — M109-WAIT (`browser_wait_for`)

**Module:** M109-WAIT  
**Packages:** `packages/browser`, `packages/browser-extension`  
**Requirements:** B2-WA-001..B2-WA-007 (`docs/requirements-browser2.0.md`)  
**Date:** 2026-03-28

---

## Section 1 — Automated tests

### Commands run

```bash
# Browser tool handler tests
cd /data/projects/accordo-browser2.0/packages/browser
pnpm exec vitest run src/__tests__/wait-tool.test.ts

# Extension provider + relay routing tests
cd /data/projects/accordo-browser2.0/packages/browser-extension
pnpm exec vitest run tests/wait-provider.test.ts tests/relay-actions-wait.test.ts
```

### Results from this run

- `packages/browser/src/__tests__/wait-tool.test.ts`: **34 passed, 0 failed**
- `packages/browser-extension/tests/wait-provider.test.ts`: **24 passed, 0 failed**
- `packages/browser-extension/tests/relay-actions-wait.test.ts`: **8 passed, 0 failed**

### Requirement coverage map

| Requirement | Verified by | What it verifies |
|---|---|---|
| **B2-WA-001** wait for text | `wait-provider.test.ts`, `wait-tool.test.ts` | text polling resolves when matching text appears; tool returns `met: true` with matched condition |
| **B2-WA-002** wait for selector | `wait-provider.test.ts`, `wait-tool.test.ts` | selector polling resolves when element appears |
| **B2-WA-003** wait for stable layout | `wait-provider.test.ts`, `wait-tool.test.ts` | stability window detection and successful completion semantics |
| **B2-WA-004** configurable timeout | `wait-tool.test.ts`, `wait-provider.test.ts` | default timeout, clamping to max, invalid input handling |
| **B2-WA-005** timeout error semantics | `wait-provider.test.ts`, `wait-tool.test.ts` | timeout returns `met:false`, `error:"timeout"`, `elapsedMs` contract |
| **B2-WA-006** navigation interrupt | `wait-provider.test.ts`, `wait-tool.test.ts`, `relay-actions-wait.test.ts` | navigation interruption propagates as expected wait outcome/error semantics |
| **B2-WA-007** page close interrupt | `wait-provider.test.ts`, `wait-tool.test.ts`, `relay-actions-wait.test.ts` | page-close interruption semantics and relay routing behavior |

---

## Section 2 — User journey tests

These are manual end-to-end checks from the user perspective via normal Accordo chat usage with a live browser tab.

### Journey 1 — Wait for text after async load

1. Open a page that loads content asynchronously.
2. Ask the agent: "wait for text `<target text>`" using `browser_wait_for`.

**Expected:** the tool returns success (`met: true`) once the text appears, with a non-negative elapsed time.

### Journey 2 — Wait for selector to appear

1. Trigger a UI action that renders a modal/panel/button after delay.
2. Ask the agent to wait for the selector of that element.

**Expected:** successful completion once the selector is present.

### Journey 3 — Wait for stable layout

1. Open a page with visible motion/loading shifts.
2. Ask the agent to wait for stable layout for a configured duration.

**Expected:** tool succeeds only after layout remains stable for the requested stability window.

### Journey 4 — Timeout behavior

1. Ask agent to wait for text/selector that will not appear.
2. Set a short timeout.

**Expected:** tool returns `met: false`, `error: "timeout"`, and elapsed time consistent with timeout semantics.

### Journey 5 — Interrupt behavior during wait

1. Start a long `browser_wait_for` operation.
2. While waiting, navigate away or close the tab.

**Expected:** tool returns interruption outcome (`navigation-interrupted` or `page-closed`) instead of hanging indefinitely.
