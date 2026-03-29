# Manual Testing Guide — Session 9: Custom Comments Panel (M45)

**Scope:** M45-FLT, M45-NR, M45-TP, M45-CMD  
**Modules:** `panel-filters.ts`, `navigation-router.ts`, `comments-tree-provider.ts`, `panel-commands.ts`  
**Package:** `accordo-comments`

---

## 0. Prerequisites

1. Build the extension: `pnpm --filter accordo-bridge build` and press **F5** to launch the Extension Development Host.
2. Open a workspace that has at least one TypeScript and one Markdown file.
3. Ensure the Accordo bridge is connected (status bar shows "Accordo Bridge ✓").
4. Open the Accordo Comments panel via **View → Open View → Accordo Comments** (or the activity bar icon).

---

## 1. Panel Renders (M45-TP-01 to TP-05)

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Open fresh workspace with no comments | Panel shows empty state (blank tree or "No comments yet" placeholder) |
| 1.2 | Create a comment thread (gutter click → type + submit) | Panel tree updates immediately — thread appears in the tree |
| 1.3 | Confirm the tree item label is the **filename** (not the anchor) | e.g. `README.md`, NOT `line 5` |
| 1.4 | Confirm description shows: status badge · anchor · intent emoji · reply count · date | e.g. `🔴 · line 5 · 🔧 · 0 replies · Mar 6 10:00` |
| 1.5 | Confirm the icon on the thread item is a **file-type ThemeIcon** | `.ts` → code icon; `.md` → markdown icon; `.json` → settings icon |

---

## 2. Three-Level Tree Expansion (M45-TP-06 to TP-12)

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Click the arrow to expand a thread item | Reveals level-2 comment items, one per comment/reply |
| 2.2 | Confirm each comment item shows author name as label | e.g. `"agent"` or `"User"` |
| 2.3 | Confirm each comment item description shows body preview + date | e.g. `"Fix the typo…   Mar 6 10:02"` |
| 2.4 | Add a reply via command (see §6.3) | New comment item appears in the expanded thread |
| 2.5 | Hover over a thread item | Tooltip shows full thread detail |

---

## 3. Group Modes (M45-FLT-14, M45-CMD-14)

### 3.1 Group by Status (default)

| # | Action | Expected |
|---|--------|----------|
| 3.1.1 | Open panel fresh | Two group headers: `🔴 Open (N)` and `✅ Resolved (N)` |
| 3.1.2 | Create open thread + one resolved thread | Counts update correctly in headers |

### 3.2 Group by File

| # | Action | Expected |
|---|--------|----------|
| 3.2.1 | Run `accordo.commentsPanel.groupBy` from Command Palette | QuickPick shows: `by-status`, `by-file`, `by-activity` |
| 3.2.2 | Select `by-file` | Headers change to filenames (e.g. `src/extension.ts (2)`) |
| 3.2.3 | All threads for the same file are nested under that filename | No status headers visible |

### 3.3 Group by Activity

| # | Action | Expected |
|---|--------|----------|
| 3.3.1 | Run `accordo.commentsPanel.groupBy` → select `by-activity` | Flat list of threads, no group headers, sorted most-recently-updated first |

### 3.4 Persistence

| # | Action | Expected |
|---|--------|----------|
| 3.4.1 | Switch to `by-file` mode, then reload the Extension Host window (Ctrl+R) | Panel reopens in `by-file` mode |

---

## 4. Filter Commands (M45-FLT, M45-CMD-08 to CMD-10)

### 4.1 Filter by Status

| # | Action | Expected |
|---|--------|----------|
| 4.1.1 | Run `accordo.commentsPanel.filterByStatus` → select `open` | Only open threads shown |
| 4.1.2 | Run `accordo.commentsPanel.filterByStatus` → select `resolved` | Only resolved threads shown |
| 4.1.3 | Run `accordo.commentsPanel.filterByStatus` → select `all` | All threads shown again |

### 4.2 Filter by Intent

| # | Action | Expected |
|---|--------|----------|
| 4.2.1 | Create threads with different intents (fix, review, question) | All visible initially |
| 4.2.2 | Run `accordo.commentsPanel.filterByIntent` → select `fix` | Only `fix` intent threads shown |
| 4.2.3 | Run `accordo.commentsPanel.filterByIntent` → select `all` | All threads visible again |

### 4.3 Combined Filters

| # | Action | Expected |
|---|--------|----------|
| 4.3.1 | Set status=open AND intent=review | Only open review threads shown |
| 4.3.2 | Run `accordo.commentsPanel.clearFilters` | All filters removed, all threads return |

### 4.4 Filter Persistence

| # | Action | Expected |
|---|--------|----------|
| 4.4.1 | Set status filter to `open`, reload window | Filter is still `open` after reload |

---

## 5. Navigation (M45-NR-01 to NR-11)

### 5.1 Text Anchor Navigation

| # | Action | Expected |
|---|--------|----------|
| 5.1.1 | Click (single-click) a thread item in the panel | VS Code opens the file and scrolls to the annotated line |
| 5.1.2 | Confirm the cursor/selection lands at the correct line | Selection range matches the thread anchor |
| 5.1.3 | If the file is already open in a tab | That tab is focused, not a new one opened |

### 5.2 Markdown Preview Navigation

| # | Action | Expected |
|---|--------|----------|
| 5.2.1 | Create a comment on a block in a Markdown Preview | Thread appears with markdown icon |
| 5.2.2 | Click the thread item | Markdown preview scrolls/highlights the annotated block |

### 5.3 Slide Anchor Navigation

| # | Action | Expected |
|---|--------|----------|
| 5.3.1 | Create a slide comment (requires Slidev extension) | Thread item shows play icon |
| 5.3.2 | Click thread item | Slidev deck opens, then navigates to the correct slide number |
| 5.3.3 | If Slidev extension absent | Info message: "Slidev deck opened. Slide navigation unavailable — install the Accordo Slidev extension." |

### 5.4 Browser / Diagram Navigation (Graceful Degradation)

| # | Action | Expected |
|---|--------|----------|
| 5.4.1 | Click a browser-surface thread when browser extension absent | Info message: "Browser extension not connected." |
| 5.4.2 | Click a diagram-surface thread when diagram extension absent | Info message: "Diagram extension not connected." |

---

## 6. Thread Mutation Commands (M45-CMD-02 to CMD-07)

### 6.1 Resolve / Reopen

| # | Action | Expected |
|---|--------|----------|
| 6.1.1 | Right-click a thread item → **Resolve** | Input box: "Resolution note (optional)" — enter text → thread moves to Resolved group |
| 6.1.2 | Press Escape on the resolve input box | Operation cancelled, thread unchanged |
| 6.1.3 | Right-click an already-resolved thread → **Resolve** | Info message: "Thread is already resolved." |
| 6.1.4 | Right-click a resolved thread → **Reopen** | Thread moves back to Open group |
| 6.1.5 | Right-click an open thread → **Reopen** | Info message: "Thread is already open." |

### 6.2 Delete

| # | Action | Expected |
|---|--------|----------|
| 6.2.1 | Right-click a thread → **Delete** | Warning dialog: "Delete thread and all replies?" with Delete / Cancel |
| 6.2.2 | Click Cancel | Thread unchanged |
| 6.2.3 | Click Delete | Thread removed from tree and from gutter widget |

### 6.3 Reply

| # | Action | Expected |
|---|--------|----------|
| 6.3.1 | Right-click a thread → **Reply** | Input box: "Type your reply…" |
| 6.3.2 | Enter text + confirm | New comment appears in expanded thread; reply count increments |
| 6.3.3 | Leave input empty + confirm | No reply posted |

### 6.4 Refresh

| # | Action | Expected |
|---|--------|----------|
| 6.4.1 | Run `accordo.commentsPanel.refresh` | Tree re-renders; useful if auto-update missed a change |

### 6.5 No-Arg Commands

| # | Action | Expected |
|---|--------|----------|
| 6.5.1 | Run resolve/reopen/reply/delete from Command Palette (no tree item selected) | Info message: "Select a thread in the Comments panel first" |

---

## 7. Stale Thread Indicator (M45-TP-13)

| # | Action | Expected |
|---|--------|----------|
| 7.1 | Create a thread, modify the file so the range is no longer valid | Thread label gains `⚠` prefix (stale indicator) |
| 7.2 | Tooltip on stale item | Should indicate the thread is stale |

---

## 8. Edge Cases

| # | Scenario | Expected |
|---|----------|----------|
| 8.1 | Panel open when Accordo bridge goes offline | Tree shows last known state; no crash |
| 8.2 | Workspace with 50+ threads | Panel renders all without freezing; filters are fast |
| 8.3 | Thread with no comments (`thread.comments = []`) | Thread item renders without crash; 0 replies shown |
| 8.4 | Thread with only agent comments (no user replies) | Displays correctly, author name shown as "agent" |
| 8.5 | Long comment body (>200 chars) | Description shows first 80 chars + truncation; full text in tooltip |

---

## Checklist Summary

- [ ] Panel renders and updates in real time
- [ ] Three-level tree (groups → threads → comments) expands correctly
- [ ] Group modes: by-status / by-file / by-activity all work and persist
- [ ] Filter by status, by intent, combination, and clear all work
- [ ] Single-click navigates to correct file + line
- [ ] Markdown preview navigation works
- [ ] Slide navigation works (or graceful message)
- [ ] Browser/diagram graceful degradation messages shown
- [ ] Resolve / Reopen / Reply / Delete all work correctly
- [ ] Cancel / no-arg edge cases handled gracefully
- [ ] No crash on empty or malformed threads
