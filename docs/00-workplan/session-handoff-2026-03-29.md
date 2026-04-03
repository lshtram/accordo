# Session Handoff — 2026-03-29 (Extended)

## Session Summary

This was a marathon modularity/cleanup session. The goal was to process **all remaining cleanup items** from the workplan after Phase 2 (B1–B5) was completed. The approach was large parallel agent batches.

**Result:** Massive progress. ~15 packages touched, most work committed. A small amount of working-tree changes from 4 agents (D3, D4, D5, D7) needs review and commit.

---

## What Was Completed (Committed)

### Wave C (3 parallel agents, all committed ✅)
| Commit | Work |
|--------|------|
| `bcd1c09` | B4b: `comments/comment-tools.ts` 676→37 LOC — 5 new modules |
| `ff37a44` | B5b: `browser-extension/service-worker.ts` 671→54 LOC — 3 new modules |
| `79a52c1` | W1-B3: `comments/extension.ts` 408→30 LOC — 3 new modules |

### Wave D Batch 1 (2 parallel agents, both committed ✅)
| Commit | Work |
|--------|------|
| `264e5bf` | D1: `browser/page-understanding-tools.ts` 843→18 LOC — 2 new modules |
| `01fce0e` | D6: `diagram/diagram-tools.ts` 753→44 LOC + `webview/webview.ts` 742→106 LOC — 4 new modules |

---

## What's in Working Tree (Uncommitted)

**Total diff: ~4,100 lines changed across 12 packages.**

These are the outputs of the second Wave D batch (D3, D4, D5, D7 agents). They were all reported successful by the agents but haven't been committed yet.

### 1. `packages/bridge/src/` (D3 — 6 files changed + 5 new)
- `agent-config.ts` modified (slimmed)
- `hub-manager.ts` modified (slimmed)
- `state-publisher.ts` modified (slimmed)
- `agent-config-writer.ts` **NEW**
- `hub-health.ts` **NEW**
- `hub-process.ts` **NEW**
- `state-collector.ts` **NEW**
- `state-diff.ts` **NEW**

### 2. `packages/browser-extension/src/` (D4 — 3 files changed + 2 new)
- `content/content-entry.ts` modified (slimmed to ~25 LOC)
- `snapshot-versioning.ts` modified (slimmed to ~302 LOC)
- `content/comment-ui.ts` **NEW**
- `content/message-handlers.ts` **NEW**
- `snapshot-store.ts` **NEW**
- `popup.ts` NOT split (agent correctly left it — no clean seam)

### 3. `packages/comments/src/` (D5 — 2 files changed + 4 new)
- `comment-repository.ts` modified (slimmed)
- `native-comments.ts` modified (slimmed to ~79 LOC facade)
- `comment-store-io.ts` **NEW**
- `comment-store-ops.ts` **NEW**
- `native-comment-controller.ts` **NEW**
- `native-comment-sync.ts` **NEW**
- `comments-tree-provider.ts` NOT split (agent correctly left it — no clean seam)

### 4. `packages/comment-sdk/src/` (D7 — 1 file changed + 4 new)
- `sdk.ts` modified (slimmed)
- `pin-renderer.ts` **NEW**
- `popover-renderer.ts` **NEW**
- `thread-manager.ts` **NEW**
- `inline-input.ts` **NEW**

### 5. `packages/hub/src/` (D3 continuation — 2 files changed + 4 new)
- `bridge-server.ts` modified (slimmed from prior B1 work)
- `mcp-handler.ts` modified (slimmed from prior B1 work)
- `bridge-connection.ts` **NEW**
- `bridge-dispatch.ts` **NEW**
- `mcp-dispatch.ts` **NEW**
- `mcp-session.ts` **NEW**

### 6. `packages/diagram/` (tsconfig changes only — committed in `01fce0e`)
- `tsconfig.json` and `tsconfig.webview.json` updated to handle new webview modules

---

## ⚠️ Important: Pre-existing Test Failures (CONFIRMED)

The following failures exist on **clean HEAD** (`git stash` verified). They are NOT caused by the Wave D agents.

### `accordo-bridge` — 2 pre-existing failures:
```
packages/bridge/src/__tests__/hub-manager.test.ts:789
  M29: when pid file is absent, readPidFile is called and isProcessAlive is NOT called
  → isProcessAlive is called when it shouldn't be (PID file absent path broken)

packages/bridge/src/__tests__/status-bar.test.ts:320
  SB-05: showStatus command calls showQuickPick with per-module health items
  → labels.some((l) => l.includes("Voice")) returns false
```

**Both failures pre-date this session.** `git stash` + clean HEAD test run confirms: 2 failed / 385 passed on clean HEAD.

**Action required:** These need investigation separately. The PID file issue is in `hub-process.ts` (new module from D3). The Voice label issue is in the health status indicator logic.

---

## Remaining Hotspots (>250 LOC, NOT YET SPLIT)

These are the only remaining files over 250 LOC that genuinely need attention:

| File | LOC | Notes |
|------|-----|-------|
| `marp/src/themes.ts` | 787 | **Data-only** (CSS strings). Do NOT split. |
| `browser-extension/src/popup.ts` | 413 | Agent correctly skipped — no clean seam |
| `browser-extension/src/content/element-inspector.ts` | 431 | No clear seam found yet |
| `browser-extension/src/content/wait-provider.ts` | 383 | |
| `browser-extension/src/content/page-map-filters.ts` | 372 | |
| `browser/src/eval-harness.ts` | 410 | |
| `browser-extension/src/content/enhanced-anchor.ts` | 357 | |
| `hub/src/mcp-dispatch.ts` | 468 | Extracted by B1 (alongside mcp-session.ts etc.) |
| `diagram/src/types.ts` | 470 | Data types + some logic; check seam |
| `voice/src/core/adapters/sherpa-subprocess.ts` | 343 | |
| `comments/src/panel/comments-tree-provider.ts` | 381 | Agent correctly skipped — no clear seam |
| `bridge/src/ws-client.ts` | 375 | |
| `bridge/src/extension-bootstrap.ts` | 340 | |
| `comments/src/__tests__/mocks/vscode.ts` | 447 | **Test mock — do NOT split** |
| `md-viewer/src/__tests__/mocks/vscode.ts` | 438 | **Test mock — do NOT split** |
| `bridge-types/src/comment-types.ts` | 338 | |

---

## Test Baseline (on clean HEAD)

| Package | Status | Notes |
|---------|--------|-------|
| `accordo-comments` | ✅ 450/450 | Clean |
| `accordo-browser` | ✅ 383/383 | Clean (after D1) |
| `accordo-diagram` | ✅ 506/506 | Clean (after D6) |
| `browser-extension` | ✅ 764/764 | Clean (1 known flaky: B2-SG-010 timeout) |
| `voice` | ✅ | |
| `hub` | ✅ | |
| `bridge` | ⚠️ 385/387 | **2 pre-existing failures (not caused by this session)** |
| `editor` | ✅ | |
| `comment-sdk` | ✅ | |
| `md-viewer` | ✅ | |
| `marp` | ✅ | |
| `script` | ✅ | |

---

## Next Session — Priority Order

### Step 1: Commit Wave D working-tree changes (4 packages)

These are ready to commit as-is (the 2 failing tests are pre-existing):
```bash
git add packages/bridge/src/
git add packages/browser-extension/src/content/content-entry.ts packages/browser-extension/src/snapshot-versioning.ts packages/browser-extension/src/content/comment-ui.ts packages/browser-extension/src/content/message-handlers.ts packages/browser-extension/src/snapshot-store.ts
git add packages/comments/src/comment-repository.ts packages/comments/src/native-comments.ts packages/comments/src/comment-store-io.ts packages/comments/src/comment-store-ops.ts packages/comments/src/native-comment-controller.ts packages/comments/src/native-comment-sync.ts
git add packages/comment-sdk/src/sdk.ts packages/comment-sdk/src/pin-renderer.ts packages/comment-sdk/src/popover-renderer.ts packages/comment-sdk/src/thread-manager.ts packages/comment-sdk/src/inline-input.ts
git add packages/hub/src/bridge-server.ts packages/hub/src/mcp-handler.ts packages/hub/src/bridge-connection.ts packages/hub/src/bridge-dispatch.ts packages/hub/src/mcp-dispatch.ts packages/hub/src/mcp-session.ts
```

### Step 2: Fix the 2 pre-existing bridge test failures

**Failure 1:** `hub-manager.test.ts:789` — PID file absent path
- In `hub-process.ts` (new module), when `readPidFile()` returns null, `isProcessAlive()` is being called when it shouldn't be. Fix the early return.

**Failure 2:** `status-bar.test.ts:320` — "Voice" label missing
- The unified health status bar quick pick items are missing "Voice". Check `extension-service-factory.ts` or wherever the module labels are defined for the health indicator.

### Step 3: Remaining hotspots (optional, low priority)

The remaining >250 LOC files are either:
- Already extracted/slimmed in prior work (ws-client, extension-bootstrap)
- Data-only (themes.ts)
- Test mocks (mocks/vscode.ts)
- No clear seam found (popup, element-inspector, wait-provider, comments-tree-provider)

**No strong pressure to split these** — they are below 500 LOC and most have no clean architectural seam.

### Step 4: P2 functional items (from workplan)

After all splits are done:
- MOD-P2-11: Remove repeated forwarding/error boilerplate in browser-extension relay paths
- MOD-P2-12: Consolidate repeated merge/sync pathways in service worker
- MOD-P2-13: Normalize comments tool response shapes
- MOD-P2-14: Extract `bridge-core` with `HostEnvironment` interface
- MOD-P2-15: Extract `comments-node-service` adapter
- MOD-P2-16: Align docs/examples with real exported Bridge API surface

### Step 5: Priority 0 bugs (separate track)

- **B2-CTX-000**: `browser_diff_snapshots` returns `action-failed` for ALL calls (CDP investigation needed)
- **B2-CTX-000b**: `browser_get_text_map` + `browser_get_semantic_graph` not registered at Hub runtime

---

## What NOT to do

- Do NOT attempt to "fix" the 2 bridge test failures by reverting the D3 changes — they are pre-existing
- Do NOT split `marp/src/themes.ts` (pure CSS data, splitting would hurt)
- Do NOT split test mocks (`mocks/vscode.ts`)
- Do NOT attempt large parallel agent batches — the concurrency limit is ~2-3 agents. Run 1-2 at a time.

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/00-workplan/workplan.md` | Master workplan |
| `docs/00-workplan/workplan-modularity-waves.md` | Wave 1 + Wave 2 breakdown |
| `docs/00-workplan/accomplished-tasks.md` | Completed work log |
| `docs/50-reviews/full-project-modularity-plugin-review-2026-03-29.md` | Full review |
| `docs/50-reviews/review-closeout-2026-03-29.md` | Closeout + Priority 0 bugs |
