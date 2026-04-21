# Testing Guide — `@accordo/comment-sdk`

## Section 1 — Automated tests

Run from repo root:

```bash
pnpm --filter @accordo/comment-sdk test
pnpm --filter @accordo/comment-sdk typecheck
pnpm --filter @accordo/comment-sdk build
```

What this verifies:
- SDK lifecycle (`init()` / `destroy()`)
- pin rendering + state-class transitions (`open` / `updated` / `resolved`)
- thread operations (`loadThreads`, `addThread`, `updateThread`, `removeThread`)
- popover interactions (reply/resolve/reopen/delete callback wiring)
- outside-click close behavior
- coordinate-driven reposition behavior on scroll/resize

Current suite size: **47 tests** (`packages/comment-sdk/src/__tests__/sdk.test.ts`).

## Section 2 — User journey tests

### Journey 1: Create a comment pin from a surface
1. Start the workspace in extension dev mode.
2. Open a supported comment-enabled surface (for example markdown preview or presentation view).
3. Hold `Alt` and click a rendered block.
4. Enter comment text and submit.

Expected:
- A new pin appears on the clicked block.
- The host surface reflects the created thread.

### Journey 2: Reply and resolve from the popover
1. Click an existing pin to open its popover.
2. Enter a reply and submit.
3. Click **Resolve**.

Expected:
- Reply appears in the thread.
- Pin state changes to resolved style.

### Journey 3: Reopen and delete from resolved state
1. Open a resolved pin popover.
2. Click **Reopen**.
3. Re-open popover and click **Delete**.

Expected:
- Reopen returns pin/thread to open state.
- Delete removes the pin from the surface.
