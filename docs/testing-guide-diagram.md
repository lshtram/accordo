# Testing Guide — Diagram Module

## 1) Automated tests

All commands below were executed successfully from outside the repository root (`/tmp`) to verify path-independent execution.

1. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-diagram test`
   - Verifies parser, layout store, reconciler, canvas generator/router, panel host/webview flow, extension activation, tool handlers, comments bridge integration, and modality regression suites.
   - Current result: **41 test files, 1016 tests passed**.

2. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-diagram typecheck`
   - Verifies host + webview TypeScript type safety (`tsc --noEmit` + `tsconfig.webview.json`).

3. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-diagram build`
   - Verifies extension host build, webview bundle build, and static asset copy steps.

4. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-diagram lint`
   - Current package output is: `no lint configured yet`.
   - This confirms the current intentional package state (placeholder lint script), not an eslint run.

## 2) User journey tests

1. **Open an existing diagram in the custom editor**
   - In VS Code Explorer, open an `.mmd` file.
   - Expected: it opens in the Accordo diagram panel (custom editor), not plain text by default.

2. **Patch diagram source and preserve layout**
   - Make a small Mermaid source change (add/remove one edge or node) and save.
   - Expected: panel refreshes to reflect new topology while preserving existing node placement where possible.

3. **Canvas interaction persists layout**
   - Drag a node on canvas.
   - Close and reopen the same diagram.
   - Expected: node remains in the moved position (layout persistence is stable).

4. **Export flow**
   - With a diagram panel open, run SVG and PNG export from diagram tools/commands.
   - Expected: export files are written successfully and match the current canvas state.

5. **Comments focus from panel**
   - Select a diagram-anchored comment thread from the comments panel.
   - Expected: diagram panel opens (if needed) and focus thread flow routes through `accordo_diagram_focusThread` without crash.
