# Marp Cleanup Review

**Date:** 2026-04-21  
**Scope:** `clean-up-plan-marp.md` alignment pass

## Summary

- Aligned Marp docs with actual current package/runtime contracts.
- Implemented webview-side live-reload handling (`marp:update`) and comment refresh/focus safety fixes.
- Cleaned stale phase-era test commentary and removed checked-in Marp output artifacts.

## Key alignments completed

1. **Docs/contract normalization**
   - Updated Marp requirements date and public tool namespace wording (`accordo_presentation_*`).
   - Updated architecture wording to separate public MCP tool names from internal command IDs.
   - Added canonical docs router pointer to active Marp architecture.

2. **Runtime behavior cleanup**
   - Added `marp:update` handling in webview script, including monotonic revision gate and slide clamping behavior.
   - Fixed comment pin refresh on `comments:update` and `comments:remove`.
   - Hardened `comments:focus` parsing/validation to avoid invalid slide mutations.
   - Added `webview:ready` emission for provider-side resync flow.

3. **Provider lifecycle cleanup**
   - Added file-change debounce (~300ms) before reload to match documented behavior.
   - Removed stale `slideSubscription` session scaffolding in extension session state.
   - Ensured bridge extension activation is explicit (`await bridgeExt.activate()`).

4. **Repo hygiene cleanup**
   - Removed stale generated artifacts:
     - `packages/marp/slide1.svg`
     - root `tmp-slide*.png/svg` captures
   - Kept lint script explicitly deferred (workspace ESLint config not yet wired for this package).

## Validation evidence

Executed from `/tmp`:

- `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" lint`
- `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" typecheck`
- `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" test`

Result: **PASS** (`12` files, `308` tests).
