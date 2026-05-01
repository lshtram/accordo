# Browser Closeout Review — 2026-04-30

## Scope

- `docs/00-workplan/workplan.md`
- `docs/20-requirements/requirements-browser-mcp.md`
- `docs/30-development/module-maps/module-map-browser-extension.md`
- `docs/40-testing/testing-guide-browser-closeout.md`
- `packages/browser/src/security/security-types.ts`
- `packages/browser/src/__tests__/security-redaction.test.ts`
- `packages/browser-extension/src/relay-capture-cdp-modes.ts`
- `packages/browser-extension/src/relay-transport.ts`
- `packages/browser-extension/tests/capture-cdp-dimensions.test.ts`
- `packages/browser-extension/tests/relay-bridge.test.ts`
- `packages/browser-extension/tests/relay-privacy.test.ts`
- `packages/browser-extension/tests/relay-transport-reconnect.test.ts`

## Targeted verification run

- `packages/browser`: `pnpm vitest run src/__tests__/security-redaction.test.ts` ✅
- `packages/browser-extension`: `pnpm vitest run tests/capture-cdp-dimensions.test.ts tests/relay-bridge.test.ts tests/relay-privacy.test.ts tests/relay-transport-reconnect.test.ts` ✅

## Findings

### 1. Medium — Priority J closes the phone-redaction false-positive item too aggressively

- **Files:**
  - `packages/browser/src/security/security-types.ts:77`
  - `packages/browser/src/__tests__/security-redaction.test.ts:378-384`
  - `packages/browser-extension/tests/relay-privacy.test.ts:120-125`
  - `docs/00-workplan/workplan.md:118-125`
- **Why it matters:** The new browser regex is better for common UI numerics, but it still matches phone-like substrings inside longer digit runs (for example, trailing 10 digits inside a longer numeric identifier). The scoped tests only prove a few benign phrases and do not cover that class of false positive. Declaring "Remaining improvements: None" is therefore ahead of the code/test evidence.
- **Done when:** add focused regression tests for contiguous long numeric strings / long numeric identifiers in both browser and browser-extension redaction paths, and either tighten the regex further or keep the workplan item open.
- **Required proof surface:** automated unit tests + workplan update.

### 2. Medium — The new closeout guide does not prove the screenshot requirements it cites

- **Files:**
  - `docs/40-testing/testing-guide-browser-closeout.md:29-32`
  - `docs/20-requirements/requirements-browser-mcp.md:76,80`
  - `packages/browser-extension/tests/capture-cdp-dimensions.test.ts:20-34`
- **Why it matters:** the guide checks only for non-zero dimensions and retained records. That is weaker than the requirements: viewport mode should match viewport dimensions, and full-page mode should exceed viewport height on a scrollable page. As written, the checklist can pass even if full-page metadata silently falls back to viewport-sized values.
- **Done when:** update the live checklist to require a scrollable page and explicit viewport-vs-fullPage dimension comparison, and add an automated fallback-path test for when `Page.captureScreenshot` omits dimensions and `Page.getLayoutMetrics` is unavailable or fails.
- **Required proof surface:** live testing guide + automated unit test.

### 3. Low — Reconnect-coverage claim is a bit broader than the new tests actually prove

- **Files:**
  - `docs/00-workplan/workplan.md:121`
  - `packages/browser-extension/tests/relay-transport-reconnect.test.ts:78-103`
  - `packages/browser-extension/tests/relay-bridge.test.ts:156-175`
- **Why it matters:** the new tests cover repeated close-event deduplication and token refresh separately, but they do not directly exercise the token-rotation path where `pollToken()` closes the socket and both `pollToken()` and the socket close callback may attempt to schedule reconnect.
- **Done when:** add a focused `RelayTransport` test that changes the token while connected and asserts only one reconnect timer / one follow-up connection attempt.
- **Required proof surface:** automated unit test.

## Residual risks

- `Page.getLayoutMetrics` use in `relay-capture-cdp-modes.ts` looks reasonable, but the failure fallback currently relies on weaker metadata sources than the closeout docs imply.
- Browser and browser-extension redaction logic still use different phone-pattern implementations, so parity risk remains unless both paths are regression-tested against the same edge cases.
