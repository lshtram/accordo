# Testing Guide — Marp Cleanup Alignment

**Status:** ACTIVE  
**Owner:** Accordo maintainers  
**Last reviewed:** 2026-04-21  
**Canonical for:** marp cleanup validation (runtime + docs alignment)

---

## 1) Automated tests

All commands were executed from **outside the repo root** (`/tmp`) and passed.

1. `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" lint`
   - Verifies the package lint entrypoint behavior (currently explicitly deferred for this package).

2. `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" typecheck`
   - Verifies TypeScript correctness (`tsc --noEmit`) after cleanup edits.

3. `pnpm --dir "/home/liorshtram/projects/accordo/packages/marp" test`
   - Verifies marp unit/integration suite including:
     - provider live-reload behavior,
     - webview HTML message handling (`marp:update`, comments handlers),
     - tool contracts and focus-thread routing.
   - Current passing count: **308 tests**.

## 2) User journey tests

1. **Open and navigate a Marp deck**
   - Use `accordo_presentation_discover`, then `accordo_presentation_open` on a deck.
   - Navigate with `goto/next/prev` and verify slide index updates correctly.

2. **Live reload after editing deck**
   - Keep a deck open, edit the markdown, and save.
   - Verify the displayed slides refresh without reopening the session.
   - Verify current slide remains valid when slide count shrinks (clamped index behavior).

3. **Comments focus behavior**
   - Trigger a slide comment focus path (`accordo.presentation.internal.focusThread`).
   - Verify invalid/malformed slide anchors do not break navigation state.
   - Verify valid anchors navigate to target slide and open the comment popover.

4. **Capture behavior**
   - Use `accordo_webview_capture` with and without `output_path`.
   - Verify a valid SVG file is written and returned metadata includes `output_path`, `slide`, and `bytes`.
