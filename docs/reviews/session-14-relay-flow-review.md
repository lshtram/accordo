# Session 14 — End-to-End Relay Flow Review

**Scope:** Chrome Extension → accordo-browser (VS Code) → accordo-bridge → accordo-hub  
**Date:** 2026-03-24  
**Reviewer:** Project Manager (manual — reviewer agent unavailable)  
**Files reviewed:** 14 source files, 3 test files

---

## 1. Flow Trace (Step by Step)

### Step 1 — Chrome Extension: User action

A user action (e.g. creating a comment) fires from the content script or popup via `chrome.runtime.sendMessage`. The service worker (`service-worker.ts`) handles it in `handleMessage()`. For `CREATE_THREAD`, the local write to `chrome.storage.local` happens first (offline-first design), then `forwardToAccordoBrowser()` is called **fire-and-forget**:

```ts
void forwardToAccordoBrowser("create_comment", { body, url, anchorKey, authorName: author?.name });
```

✅ **Correct**: local write succeeds immediately regardless of relay state.

---

### Step 2 — Chrome → Relay: WebSocket send

`forwardToAccordoBrowser()` calls `relayBridge.send(action, payload, 5000)`. `RelayBridgeClient.send()` (in `relay-bridge.ts`) generates a `requestId` via `crypto.randomUUID()`, puts the resolve callback in `this.pending`, and sends:

```json
{ "requestId": "uuid", "action": "create_comment", "payload": { ... } }
```

The relay bridge connects to `ws://127.0.0.1:40111/?token=accordo-local-dev-token`.

✅ **Correct**: envelope shape matches what the relay server expects.

---

### Step 3 — accordo-browser: Relay Server receives

`BrowserRelayServer` in `relay-server.ts` receives the message in its `socket.on("message")` handler. It detects `typeof parsed["action"] === "string"` and routes to `onRelayRequest` (the interceptor set during `activate()`):

```ts
const result = await this.options.onRelayRequest(action, payload);
socket.send(JSON.stringify({ ...result, requestId }));
```

✅ **Correct**: `requestId` is echoed back in the response (fixed in `ce5ac12`).

---

### Step 4 — accordo-browser: Action-to-Tool mapping (`extension.ts`)

`browserActionToUnifiedTool()` maps `"create_comment"` → `{ toolName: "comment_create", args: {...} }`. Then:

```ts
const result = await bridge.invokeTool(mapped.toolName, mapped.args);
return { requestId: "", success: true, data: result };
```

**🔴 BUG P1 — requestId is always `""` in the onRelayRequest response**

The `onRelayRequest` closure in `extension.ts` always returns `{ requestId: "", ... }`. The relay server then does:

```ts
socket.send(JSON.stringify({ ...result, requestId }));
```

Because `result` contains `requestId: ""` and the spread is `{ ...result, requestId }`, the final object has `requestId` overwritten by the local `requestId` variable (which is correct). This is fine — the spread-then-overwrite works correctly.

✅ **Actually correct** — The `requestId` from the local variable overwrites the empty one from the closure. Not a bug.

---

### Step 5 — Bridge: `invokeTool()` call

`bridge.invokeTool(toolName, args)` is exposed from `BridgeAPI` in `packages/bridge/src/extension.ts`:

```ts
invokeTool(toolName, args, timeout = 30_000) {
  return router!.invokeTool(toolName, args, timeout);
},
```

`CommandRouter.invokeTool()` looks up the handler in the `ExtensionRegistry`:

```ts
const handler = this.registry.getHandler(toolName);
if (!handler) throw new Error(`Unknown tool: ${toolName}`);
return handler(args);
```

✅ **Correct**: calls the handler directly — **no Hub round-trip**. This is local in-process execution.

---

### Step 6 — The `comment_create` handler (in `accordo-comments`)

The handler is registered by `accordo-comments` via `bridge.registerTools("accordo-comments", tools)`. The `comment_create` handler in `comment-tools.ts` uses:

```ts
const scope = args["scope"] as Record<string, unknown> | undefined;
const finalUri = uri ?? (scope?.["url"] as string | undefined) ?? "";
```

The relay in `extension.ts` sends:
```ts
args: {
  body: payload["body"],
  scope: { modality: "browser", url: payload["url"] ?? "" },
  anchor: { kind: "browser", anchorKey: payload["anchorKey"] ?? "body:center" },
}
```

✅ **Correct**: `scope.url` is present, `scope.modality = "browser"` sets `retention = "volatile-browser"`, and the anchor kind `"browser"` is handled by `buildAnchor()`.

---

### Step 7 — Response flows back to Chrome

The handler returns `{ created: true, threadId, commentId }`. This bubbles up:
- `handler(args)` → `invokeTool()` → `bridge.invokeTool()` → `onRelayRequest` closure → relay server → `socket.send({ ...result, requestId })` → Chrome `relayBridge.handleIncoming()` → resolves the pending Promise in `relayBridge.send()`

✅ **Correct**: bidirectional round-trip is complete.

---

### Step 8 — GET flow: Chrome asks for threads via `get_comments`

In `handleMessage` for `GET_THREADS`:
```ts
const hubResult = await relayBridge.send("get_comments", { url }, 3000);
if (hubResult.success && hubResult.data) {
  const raw = hubResult.data as { threads?: HubCommentThread[] };
```

The `get_comments` action maps to `comment_list` with args `{ scope: { modality: "browser", url } }`.

`comment_list` calls `store.listThreads({ ... anchorKind: "surface", surfaceType: "browser" })` and returns a raw `CommentThread[]` array.

**🔴 BUG P1 — Shape mismatch: `comment_list` returns `CommentThread[]`, Chrome expects `{ threads: HubCommentThread[] }`**

The Chrome service worker expects `hubResult.data` to have shape `{ threads: HubCommentThread[] }`:
```ts
const raw = hubResult.data as { threads?: HubCommentThread[] };
if (raw.threads && Array.isArray(raw.threads)) {
  hubThreads = raw.threads.filter(...).map(hubThreadToBrowserThread);
}
```

But `comment_list` handler returns `store.listThreads(...)` directly — which returns a `CommentThread[]` array (not an object with a `threads` property). Let's verify:

In `comment-store.ts`, `listThreads()` returns `CommentThread[]`.

So `hubResult.data` is `CommentThread[]` (an array), NOT `{ threads: CommentThread[] }`.

**Consequence**: `raw.threads` is `undefined` on an array value, so `hubThreads` stays `[]`. The merged thread list only shows local `chrome.storage.local` threads. Hub threads created by agents are **silently invisible** in the Chrome popup.

---

### Step 9 — `get_all_comments` mapping

`get_all_comments` maps to `comment_list` with args `{ scope: { modality: "browser" } }` — same shape mismatch problem as above.

In `handleMessage` for `EXPORT`, the same pattern:
```ts
const raw = hubResult.data as { threads?: HubCommentThread[] };
```
Same silent failure.

---

### Step 10 — Hub is NOT involved in this flow at all

**Important architectural observation**: The `invokeTool()` path goes directly to the local handler registered in the Bridge's `ExtensionRegistry`. It does **not** go through the Hub's `BridgeServer.invoke()` or the WebSocket to Hub. The Hub is only involved when an external MCP agent calls a tool via HTTP. Chrome mutations bypass the Hub entirely — they execute locally in VS Code process.

✅ **Correct by design** (as stated in Session 14 architecture doc).

---

## 2. Bugs Found

### BUG-1 — P1: Shape mismatch between `comment_list` return value and Chrome's expectation

**File:** `packages/browser-extension/src/service-worker.ts` lines 252–258, 363–370  
**Also:** `packages/browser/src/extension.ts` lines 21–29

**Description:**  
Chrome's service worker calls `get_comments` → relay maps to `comment_list` → handler returns `CommentThread[]` (bare array). Chrome unwraps it as `{ threads?: HubCommentThread[] }` so `raw.threads` is always `undefined`.

**Impact:** Hub threads (agent-created browser comments, resolved threads) are **never shown** in the Chrome popup. The GET_THREADS merge silently produces only local `chrome.storage.local` threads. Export also misses Hub threads.

**Suggested fix (Option A — change relay mapper):**  
Wrap the `comment_list` result in the Chrome-expected shape in the `onRelayRequest` interceptor:
```ts
case "get_comments": {
  const result = await bridge.invokeTool("comment_list", args);
  const threads = Array.isArray(result) ? result : [];
  return { requestId: "", success: true, data: { threads } };
}
```

**Suggested fix (Option B — change Chrome parser):**  
Change the Chrome service worker to handle the bare array directly:
```ts
const threads = Array.isArray(hubResult.data) ? hubResult.data as HubCommentThread[] : [];
```

Option A is cleaner since it keeps the Chrome code unaware of the Hub's internal format.

---

### BUG-2 — P2: `HubCommentThread` adapter filters by `anchor.uri === normalizeUrl(url)` but Hub stores browser URIs as plain page URLs (no normalization guarantee)

**File:** `packages/browser-extension/src/service-worker.ts` lines 255–257

```ts
hubThreads = raw.threads
  .filter((t) => t.anchor.uri === normalizeUrl(url))
  .map(hubThreadToBrowserThread);
```

The Hub's `CommentStore` stores `uri` as whatever was passed to `comment_create`. The relay sends `scope.url = normalizeUrl(url)` (from Chrome's `normalizeUrl()` in `store.ts`) but the Hub's `normalizeCommentUri()` function in `comment-tools.ts` may reformat the URL differently (it's designed for file URIs, not HTTP URLs — it calls `path.isAbsolute()` and `pathToFileURL()`, which may mangle HTTP URLs on Windows or return unexpected results for URLs that start with `https://`).

**Impact:** Thread filter may return 0 threads even when Hub has threads for that URL.

**Suggested fix:** The relay mapper should return threads already filtered by modality (`anchorKind: "surface", surfaceType: "browser"`), so Chrome doesn't need to re-filter by URI. Or compare after decoding both URLs with `new URL(uri).href`.

---

### BUG-3 — P2: `GET_THREADS` in Chrome service worker uses `relayBridge.send("get_comments", ...)` but the relay's `get_comments` action routes to `comment_list`, which returns ALL threads for the modality — not filtered by the current tab URL

**File:** `packages/browser/src/extension.ts` lines 21–29

```ts
case "get_comments": {
  const url = payload["url"] as string | undefined;
  return {
    toolName: "comment_list",
    args: url
      ? { scope: { modality: "browser", url } }
      : { scope: { modality: "browser" } },
  };
}
```

The `comment_list` handler ignores `scope.url` — it only uses `scope.modality` to set `anchorKind: "surface", surfaceType: "browser"`. There is no `url` filter in `listThreads()`.

**Impact:** When Chrome fetches comments for `https://example.com/page-a`, it gets ALL browser-modality threads from the Hub store (for all URLs). The `filter((t) => t.anchor.uri === normalizeUrl(url))` in Chrome's service worker would then do the filtering, but only if BUG-1 is fixed first.

**Suggested fix:** `comment_list` should support `scope.url` as a `uri` filter, OR the relay mapper should pass `scope.url` as the `uri` field to `comment_list`. Currently neither happens.

---

### BUG-4 — P3: `browser-tools.ts` tests verify tools that are explicitly `@deprecated` and never registered

**File:** `packages/browser/src/__tests__/browser-tools.test.ts`

The test verifies `createBrowserTools()` — but `extension.ts` explicitly does NOT call `createBrowserTools()` (M86 migration). These tests provide false confidence that the tool-registration path is tested. The actual active code path (the `onRelayRequest` interceptor) is only tested by `extension-activation.test.ts`, and only for the `create_comment` action.

**Impact:** No test coverage for `get_comments`, `resolve_thread`, `reopen_thread`, `delete_comment`, `delete_thread`, `get_all_comments` in the `onRelayRequest` path.

---

### BUG-5 — P3: Auth token hardcoded on both sides — no mechanism to communicate a generated token to Chrome

**File:** `packages/browser/src/extension.ts` line 107; `packages/browser-extension/src/relay-bridge.ts` line 5

Both sides hardcode `"accordo-local-dev-token"`. The extension does call `generateRelayToken()` and stores it, but then falls back to `DEV_RELAY_TOKEN` if `globalState` is empty:

```ts
const token = (context.globalState.get<string>(TOKEN_KEY) ?? DEV_RELAY_TOKEN).trim();
```

Since Chrome extension cannot read VS Code's `globalState`, Chrome always uses the hardcoded dev token. This means a production deployment with a generated token would silently fail to connect.

**Impact:** Not a bug in the current dev setup (both use the hardcoded token). But it means there's no actual auth security — any local process that knows the hardcoded token can connect to the relay.

---

## 3. Verdict

**PARTIAL — Core mutation flow works; read flow is broken**

The **write path** (Chrome creates/replies/resolves/deletes a comment → relay → unified `comment_*` tools → VS Code CommentStore) is structurally sound after the `ce5ac12` and `e0f0b70` fixes. A user comment created in Chrome will be forwarded to VS Code and appear in the Comments Panel.

The **read path** (Chrome popup fetching Hub threads to merge into its view) is silently broken. `comment_list` returns a bare `CommentThread[]` array but Chrome expects `{ threads: CommentThread[] }` — so agent-created browser comments are **never visible in the Chrome popup**. This is a P1 bug that must be fixed.

Additionally, even if the shape mismatch is fixed, `comment_list` does not actually filter by URL (BUG-3), so Chrome would receive all browser comments regardless of current tab. The URL-filter in Chrome's service worker would need to work correctly (BUG-2) for this to display correctly.

The Hub is correctly bypassed in this flow — `invokeTool()` executes handlers directly in the VS Code process, which is the intended design.

### Summary Table

| # | Severity | Description | File |
|---|---|---|---|
| BUG-1 | 🔴 P1 | `comment_list` returns bare array; Chrome expects `{ threads: [...] }` | `relay-server.ts` mapping / `service-worker.ts` |
| BUG-2 | 🟠 P2 | URI filter in Chrome uses `===` comparison; Hub may store different URL format | `service-worker.ts` line 255 |
| BUG-3 | 🟠 P2 | `comment_list` ignores `scope.url` — returns all browser threads, not per-URL | `extension.ts` get_comments mapping |
| BUG-4 | 🟡 P3 | Tests cover deprecated `browser-tools.ts`, not the active `onRelayRequest` path | `browser-tools.test.ts` |
| BUG-5 | 🟡 P3 | Auth token is hardcoded dev token — no real security, no production token delivery | `extension.ts`, `relay-bridge.ts` |
