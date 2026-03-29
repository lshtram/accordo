# Manual Testing Guide — Session 8A (M40-EXT-11)

**Purpose:** Verify that `accordo-comments` now exposes a generalised surface adapter command (`accordo.comments.internal.getSurfaceAdapter`) that any Accordo modality (slides, diagrams, browser) can use to persist comment threads with full anchor control.

**Module:** M40-EXT-11 in `packages/comments/src/extension.ts`  
**Tests added:** 11 (197 total in `accordo-comments`)  
**New export:** `SurfaceCommentAdapter` interface  

---

## 0. Pre-flight

```bash
cd /Users/Shared/dev/accordo
pnpm --filter accordo-comments build
pnpm --filter accordo-comments test
pnpm --filter accordo-comments typecheck
```

All three must exit 0 before proceeding. Expected test output:

```
 Test Files  5 passed (5)
       Tests  197 passed (197)
```

---

## 1. Automated test verification

The unit tests are the authoritative verification for this module. Run the extension test file in isolation:

```bash
cd /Users/Shared/dev/accordo
pnpm --filter accordo-comments exec vitest run src/__tests__/extension.test.ts
```

Expected output:

```
 ✓ src/__tests__/extension.test.ts (35 tests)
 Test Files  1 passed (1)
      Tests  35 passed (35)
```

The 11 new tests cover all M40-EXT-11 requirements:

| Test | Requirement validated |
|---|---|
| registers `getSurfaceAdapter` command | Command is available for `vscode.commands.executeCommand` |
| returns adapter with all 7 required methods | Interface contract correct |
| `createThread` accepts caller-provided `slide` anchor verbatim | Anchor passthrough — no internal anchor construction |
| `createThread` returns a valid CommentThread shape | `{ id, status: "open", comments: [{ body }] }` |
| `reply` appends a comment | Thread length grows by 1 |
| `resolve` marks thread resolved | `status === "resolved"` |
| `reopen` re-opens a resolved thread | `status === "open"` again |
| `delete` removes the thread | `getThreadsForUri` no longer returns it |
| `getThreadsForUri` returns only matching URI | URI isolation correct |
| `onChanged` fires when threads change | Listener called with the affected URI |
| `onChanged` returns a disposable | `{ dispose() }` returned |

---

## 2. End-to-end in VS Code Extension Development Host

> **Requires:** the `accordo-bridge` and `accordo-comments` extensions loaded. Press **F5** from the repository root (or Run → "Launch Bridge + Editor") to start the Extension Development Host with a debug session attached.
>
> **Where to run the snippets below:** Use the **Debug Console** in your main VS Code window (the one you pressed F5 from). The Debug Console runs in the **extension host context**, where `vscode` is available. Do NOT use `Developer: Toggle Developer Tools` — that console is the renderer process and `vscode` is not accessible there.

When the Extension Development Host window opens, the Debug Console in your main window becomes the REPL for all steps below.

### 2.1 Confirm the command is registered

1. Press **F5** to start the Extension Development Host.
2. In your **main VS Code window**, open the **Debug Console** panel (`Ctrl/Cmd+Shift+Y`, or View → Debug Console).
3. Paste and press Enter:

```javascript
const adapter = await vscode.commands.executeCommand(
  "accordo.comments.internal.getSurfaceAdapter"
);
console.log("Adapter methods:", Object.keys(adapter).sort());
```

**What you should see in the Debug Console:**

```
Adapter methods: ["createThread", "delete", "getThreadsForUri", "onChanged", "reopen", "reply", "resolve"]
```

If `undefined` is logged, `accordo-comments` is not loaded — check the Extensions view in the EDH window to confirm it is active.

---

### 2.2 Create a slide-surface comment thread

In the **Debug Console** (variables persist between pastes in the same session), paste:

```javascript
const adapter = await vscode.commands.executeCommand(
  "accordo.comments.internal.getSurfaceAdapter"
);

// Construct a slide anchor — same shape as accordo-slidev will use
const anchor = {
  kind: "surface",
  uri: vscode.workspace.workspaceFolders?.[0]?.uri.toString() + "/demo.md",
  surfaceType: "slide",
  coordinates: { type: "slide", slideIndex: 0, x: 0.5000, y: 0.3000 }
};

const thread = await adapter.createThread({
  uri: anchor.uri,
  anchor,
  body: "Review this slide opening",
  intent: "review"
});

console.log("Thread created:", JSON.stringify({
  id: thread.id,
  status: thread.status,
  body: thread.comments[0].body,
  surfaceType: thread.anchor.surfaceType,
  slideIndex: thread.anchor.coordinates.slideIndex
}, null, 2));
```

**What you should see in the Debug Console:**

```json
{
  "id": "<uuid>",
  "status": "open",
  "body": "Review this slide opening",
  "surfaceType": "slide",
  "slideIndex": 0
}
```

**What you should see in the EDH window:** The new comment thread appears in the **Comments** panel (View → Comments), listed against `demo.md`.

---

### 2.3 Reply, resolve, and verify

Continue in the **Debug Console** (the `thread`, `adapter`, and `anchor` variables persist):

```javascript
// Step 1: Reply
await adapter.reply({ threadId: thread.id, body: "Acknowledged, will update." });

// Step 2: Check thread has 2 comments
const threads = adapter.getThreadsForUri(anchor.uri);
const updated = threads.find(t => t.id === thread.id);
console.log("Comment count:", updated.comments.length); // Expected: 2

// Step 3: Resolve
await adapter.resolve({ threadId: thread.id, resolutionNote: "Fixed in next slide" });

// Step 4: Check status
const resolved = adapter.getThreadsForUri(anchor.uri).find(t => t.id === thread.id);
console.log("Status after resolve:", resolved.status); // Expected: "resolved"
```

**What you should see in the EDH window:** The thread in the Comments panel shows the reply and then is marked as resolved (icon changes from “open” to “resolved”).

---

### 2.4 Verify onChanged fires

In the **Debug Console**:

```javascript
let changeCount = 0;
const sub = adapter.onChanged((uri) => {
  changeCount++;
  console.log(`onChanged fired #${changeCount} — uri: ${uri}`);
});

// Create another thread to trigger the event
await adapter.createThread({
  uri: anchor.uri,
  anchor: { ...anchor, coordinates: { type: "slide", slideIndex: 1, x: 0.2000, y: 0.8000 } },
  body: "Diagrams slide needs work",
});

// Wait a tick, then check
await new Promise(r => setTimeout(r, 50));
console.log("Total onChanged events:", changeCount); // Expected: 1

// Clean up subscription
sub.dispose();
```

**What you should see in the Debug Console:**

```
onChanged fired #1 — uri: file:///…/demo.md
Total onChanged events: 1
```

---

### 2.5 Verify backwards compatibility — getStore still works

In the **Debug Console**:

`accordo-md-viewer` uses the older `getStore` internal command. Confirm it is unaffected:

```javascript
const store = await vscode.commands.executeCommand(
  "accordo.comments.internal.getStore"
);
console.log("getStore methods:", typeof store.createThread, typeof store.onChanged);
```

**What you should see in the Debug Console:**

```
getStore methods: function function
```

`getStore` is unchanged — `md-viewer` operations continue to work normally.

---

### 2.6 Verify persistence across reload

Comments created via `getSurfaceAdapter` are stored in `.accordo/comments.json` alongside all other threads.

1. After completing steps 2.2–2.4, check the workspace:

```bash
cat .accordo/comments.json | python3 -m json.tool | grep -A4 '"surfaceType": "slide"'
```

**What you should see:** One or more JSON objects with `"surfaceType": "slide"` and `"type": "slide"` inside `coordinates`.

2. Reload VS Code (in the EDH window: `Cmd+Shift+P` → `Developer: Reload Window`).
3. Once the EDH has reloaded, switch back to your **main window Debug Console** and run:

```javascript
const adapter = await vscode.commands.executeCommand(
  "accordo.comments.internal.getSurfaceAdapter"
);
const uri = vscode.workspace.workspaceFolders?.[0]?.uri.toString() + "/demo.md";
const threads = adapter.getThreadsForUri(uri);
console.log("Threads after reload:", threads.length); // Expected: ≥ 1
console.log("First anchor kind:", threads[0]?.anchor.kind,
            "surfaceType:", threads[0]?.anchor.surfaceType);
```

**What you should see in the Debug Console:**

```
Threads after reload: 2
First anchor kind: surface surfaceType: slide
```

---

## 3. Pass Criteria

| Check | What to verify |
|---|---|
| `pnpm --filter accordo-comments test` — 197 green | Run in terminal |
| `pnpm --filter accordo-comments typecheck` exits 0 | Zero TypeScript errors |
| No `: any` | `grep -r ": any" packages/comments/src/` → empty |
| No `console.log` | `grep -rn "console\.log" packages/comments/src/` → empty |
| `getSurfaceAdapter` command registered | Debug Console step 2.1 |
| `createThread` with slide anchor persists verbatim | Debug Console step 2.2 |
| `reply`, `resolve`, `getThreadsForUri` work | Debug Console step 2.3 |
| `onChanged` fires and returns disposable | Debug Console step 2.4 |
| `getStore` unchanged (backwards compat.) | Debug Console step 2.5 |
| Threads survive reload | Debug Console step 2.6 |

All 10 checks must pass before approving for commit.

---

## 4. What this enables (context for reviewers)

`getSurfaceAdapter` is the pre-condition for Session 8B (`accordo-slidev`). The slidev extension will call:

```typescript
const adapter = await vscode.commands.executeCommand(
  "accordo.comments.internal.getSurfaceAdapter"
) as SurfaceCommentAdapter;
```

It will then construct `CommentAnchorSurface` objects with `surfaceType: "slide"` and `coordinates: SlideCoordinates`, and pass them verbatim to `adapter.createThread`. The SDK `blockId` encoding convention (`"slide:{idx}:{x}:{y}"`) is the wire format between the webview and the extension host, decoded by `presentation-comments-bridge.ts` before calling this adapter.

No changes to `@accordo/comment-sdk`, `@accordo/bridge-types`, `accordo-bridge`, or `accordo-hub` are required for Session 8A.
