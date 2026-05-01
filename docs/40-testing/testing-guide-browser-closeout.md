# Testing Guide — Browser Closeout Smoke Checklist

**Scope:** `packages/browser`, `packages/browser-extension`
**Purpose:** Compact live regression pass before browser hardening changes are considered closed.

Run the automated checks first:

```bash
pnpm --filter accordo-browser test
pnpm --filter accordo-browser typecheck
pnpm --filter accordo-browser lint
pnpm --filter browser-extension test
pnpm --filter browser-extension typecheck
pnpm --filter browser-extension lint
```

## Live Checklist

1. Pair the Chrome extension with Accordo using `accordo_browser_pair` if needed.
2. Call `accordo_browser_health`; expect `connected: true` and no recent relay errors.
3. Call `accordo_browser_list_pages`; record a `tabId` for Tab A.
4. Switch Chrome to Tab B, then call `accordo_browser_get_page_map({ tabId: <Tab A>, includeBounds: true })`; expect Tab A content, not Tab B content.
5. Call `accordo_browser_get_text_map({ tabId: <Tab A>, visibleOnly: true })`; expect visible Tab A text and a fresh `snapshotId`.
6. Call `accordo_browser_inspect_element` with a current selector or `uid`; expect element bounds, state, and anchor metadata.
7. Call `accordo_browser_get_spatial_relations` with one identity mode and the prior `snapshotId`; if your adapter emits the unused identity field, pass it as `[]`.
8. Mutate the page or wait for dynamic content, then call `accordo_browser_diff_snapshots` from the earlier snapshot; expect a non-empty or correctly empty diff summary.
9. Grant browser control in the Chrome popup for Tab A.
10. Validate `accordo_browser_navigate`, `accordo_browser_click`, `accordo_browser_type`, and `accordo_browser_press_key` on a safe test page.
11. Call `accordo_browser_capture_region({ mode: "viewport", transport: "file-ref" })`; expect `artifactMode: "file-ref"`, a `filePath`, and `width`/`height` matching the current viewport from the response envelope unless Chrome reports device-pixel dimensions, in which case record the device-pixel ratio explanation.
12. On a scrollable page, call `accordo_browser_capture_region({ mode: "fullPage", transport: "file-ref" })`; expect `height` greater than the viewport height and a retained screenshot record.
13. Call `accordo_browser_manage_screenshots({ action: "list" })`; expect retained records with accurate `width`, `height`, `format`, and `sizeBytes`.
14. Call `accordo_browser_manage_screenshots({ action: "clear" })`; expect `clearedCount` to match the retained records and subsequent list to be empty.

## Expected Result

The browser relay remains connected, explicit `tabId` keeps the agent on the intended tab, control tools work only after grant, snapshots/diffs remain page-local, and screenshot artifact metadata is accurate.
