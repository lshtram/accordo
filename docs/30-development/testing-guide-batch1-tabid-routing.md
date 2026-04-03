# Testing Guide — Batch 1: tabId Routing (`browser_capture_region`, `browser_diff_snapshots`)

**Date:** 2026-04-02
**Phase:** D3 (agent-automated) + D3 (user journey)
**Packages:** `accordo-browser`, `browser-extension`

---

## Section 1 — Agent-Automated Tests

### What to verify

Run the following test suites and confirm they all pass:

```bash
# Hub-side tabId routing for diff_snapshots
cd packages/browser && pnpm test

# Extension-side tabId routing for capture_region
cd packages/browser-extension && pnpm test
```

### Expected results

| Package | Test File | Expected |
|---|---|---|
| `accordo-browser` | `src/__tests__/diff-snapshots-tabid.test.ts` | **5/5 PASS** |
| `accordo-browser` | `src/__tests__/control-tools.test.ts` | 6 failures (pre-existing, unrelated) |
| `browser-extension` | `tests/capture-tabid-routing.test.ts` | **8/8 PASS** |
| `browser-extension` | `tests/browser-control-click.test.ts` | 4 failures (pre-existing, unrelated) |
| `browser-extension` | `tests/browser-control-keyboard.test.ts` | 6 failures (pre-existing, unrelated) |
| `browser-extension` | `tests/browser-control-type.test.ts` | 4 failures (pre-existing, unrelated) |

### Pre-existing failures (NOT in scope for this batch)

The following failures existed before this batch and are unrelated to tabId routing:

**`packages/browser/src/__tests__/control-tools.test.ts`** — 6 failures:
- REQ-TC-005..008: `handleClick` returns no-target/element-not-found/element-off-screen errors
- REQ-TC-009..012: `handleType` returns no-target/element-not-focusable errors
- REQ-TC-013: `handlePressKey` returns invalid-key error

**`packages/browser-extension/tests/browser-control-*.test.ts`** — 14 failures across click/keyboard/type tests:
- REQ-TC-006: CDP mouse event sequencing
- REQ-TC-008: double-click CDP sequence
- REQ-TC-010: Ctrl+A + Delete before typing
- REQ-TC-012..013: submitKey/keyUp dispatching

---

## Section 2 — User Journey (Manual Testing)

These scenarios are for a human tester to verify the tabId routing works in a real browser environment.

### Prerequisites

- Chrome browser with the Accordo extension installed
- Two or more open tabs (at least one with visible content)
- The Hub server running (`pnpm --filter accordo-hub run dev`)
- VS Code with Accordo connected

### Scenario 1 — `capture_region` with non-active tab

**Goal:** Verify that `capture_region` captures the correct tab even when it is not the active tab.

**Steps:**
1. Open Tab 1 (e.g., `https://example.com`)
2. Open Tab 2 (e.g., `https://wikipedia.org`) — this is now the active tab
3. Use the `browser_capture_region` tool with `tabId: <tab1-id>` (use `browser_list_pages` to get tab IDs)
4. Verify the captured screenshot shows Tab 1's content (not Tab 2's)

**Expected:** Screenshot of Tab 1 is returned, even though Tab 2 is active.

### Scenario 2 — `diff_snapshots` with non-active tab

**Goal:** Verify that `diff_snapshots` captures snapshots from the correct tab.

**Steps:**
1. Open Tab 1 and capture a snapshot (call `get_page_map` with `tabId: <tab1-id>`)
2. Wait a moment, then open Tab 2
3. Call `browser_diff_snapshots` with `tabId: <tab1-id>` and no explicit snapshot IDs (to trigger implicit capture)
4. Verify the diff result uses Tab 1's content for both `to` and `from` snapshots

**Expected:** Both snapshot captures happen on Tab 1, even though Tab 2 is active.

### Scenario 3 — Tab swap activation and restore

**Goal:** Verify that when `capture_region` targets a non-active tab, the original active tab is restored after capture.

**Steps:**
1. Note which tab is currently active
2. Call `browser_capture_region` targeting a different tab
3. After the call completes, verify the original tab is still the active tab in Chrome

**Expected:** The user's active tab selection is preserved after capture.

---

## Coverage Summary

| Requirement ID | Description | Test Coverage |
|---|---|---|
| B2-CTX-001 | Optional tabId on capture_region and diff_snapshots | MCP inputSchema |
| B2-CTX-002 | Hub-side: resolveFreshSnapshot passes tabId to get_page_map | 1 RED + 1 GREEN test |
| B2-CTX-003 | Hub-side: resolveFromSnapshot passes tabId to get_page_map | 1 RED + 1 GREEN test |
| B2-CTX-003 | Extension-side: toCapturePayload extracts and forwards tabId | 2 RED + 1 GREEN test |
| B2-CTX-003 | Extension-side: resolvePaddedBounds routes to targetTabId | Via full-chain integration test |
| B2-CTX-003 | Extension-side: handleCaptureRegion routes RESOLVE_ANCHOR_BOUNDS to correct tab | 1 RED + 1 GREEN test |
| B2-CTX-004 | Extension-side: tab-swap activates target, captures, restores original | 1 RED + 1 GREEN test |
| B2-CTX-005 | Extension-side: requestContentScriptEnvelope uses explicit tabId when provided | 1 RED + 1 GREEN test |

**Total new coverage:** 13 tests (7 RED verifying bugs fixed, 6 GREEN verifying backward compatibility).