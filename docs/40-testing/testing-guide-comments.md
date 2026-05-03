# Testing Guide — Comments Module

## 1) Automated tests

All commands below were executed successfully from a directory **outside** the repo (`/tmp`) to verify path-independent execution.

1. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments test`
   - Verifies end-to-end package behavior across repository/store logic, MCP tool handlers, native comments integration, comments panel tree/filter/commands, navigation router dispatch, and extension bootstrap/integration contracts.
   - Current result: **15 test files, 509 tests passed**.

2. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments typecheck`
   - Verifies TypeScript type-safety for the comments package.

3. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments build`
   - Verifies production compile (`tsc -b`) succeeds.

4. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments lint`
   - Current package output is: `no lint configured yet`.
   - This confirms the current intentional package state (placeholder lint script), not an eslint run.

## 2) User journey tests

For the authoritative **WebviewView-era** panel replacement boundary proof, use:

- `docs/40-testing/testing-guide-comments-webview-panel.md`

The scenarios below remain useful package-level/manual comments checks, but they are not the authoritative panel-replacement boundary guide.

1. **Create and view a text comment thread in the panel**
   - Open any text file in VS Code.
   - Use the inline comment UI to create a thread on a line.
   - Open **Accordo Comments** panel.
   - Expected: the thread appears under the correct group with file name label, anchor description, and status badge.

2. **Reply in context from panel**
   - In the Accordo Comments webview panel, expand a thread and activate the inline **Reply** action.
   - Expected: VS Code navigates to the thread anchor surface and opens native inline reply context (no top-screen input box).

3. **Resolve and reopen from panel**
   - Expand an open thread in the webview panel and activate **Resolve**; provide resolution text.
   - Expected: thread moves to Resolved state in panel and native inline widget state updates.
   - Then expand the resolved thread and activate **Reopen**.
   - Expected: thread returns to Open state in both panel and native widget.

4. **Group and filter behavior**
   - Use panel toolbar commands to switch group mode: `by-status`, `by-file`, `by-activity`.
   - Apply status and intent filters, then clear filters.
   - Expected: thread list updates immediately; counts/group headers reflect active filters.

5. **Cross-surface navigation (browser/slide/markdown-preview)**
   - Select a thread anchored to browser/slide/markdown-preview surface and trigger **Go to Comment Location**.
   - Expected: router dispatches to the correct surface focus command; if target extension is unavailable, user gets a graceful info/warning message (no crash).
