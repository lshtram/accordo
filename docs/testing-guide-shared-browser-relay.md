# Testing Guide — Shared Browser Relay (`shared-browser-relay`)

## What This Implements

The Shared Browser Relay allows multiple VS Code windows to share a single Chrome DevTools connection instead of each window running its own browser relay server.

**How it works:**
- The first window to start becomes the **Owner** — it starts `SharedBrowserRelayServer` on fixed port 40111, writes `~/.accordo/shared-relay.json`, and connects as the first Hub client via `SharedRelayClient`
- Subsequent windows become **Hub clients** — they read `shared-relay.json`, verify the PID is alive, and connect as additional Hub clients via `SharedRelayClient`
- If the Owner window closes, the remaining Hub clients race to acquire the lock file and the winner becomes the new Owner
- When `accordo.browser.sharedRelay` is `false` (or falls back due to lock contention), each window runs the original per-window `BrowserRelayServer`

**Feature flag:** `accordo.browser.sharedRelay` (VS Code setting, default `true`)

---

## Prerequisites

1. **Package built:** `cd packages/browser && pnpm build`
2. For user journey tests: Full system deployed — Hub process running, Bridge connected, `accordo-browser` extension loaded in VS Code

---

## Section 1 — Automated Tests

### 1a. Run all shared-relay module tests

```bash
cd /data/projects/accordo/packages/browser
pnpm test -- --run src/__tests__/relay-discovery.test.ts \
                    src/__tests__/shared-relay-server.test.ts \
                    src/__tests__/shared-relay-client.test.ts \
                    src/__tests__/write-lease.test.ts \
                    src/__tests__/relay-onrelay.test.ts \
                    src/__tests__/shared-relay-feature-flag.test.ts
```

**Expected:** 111 tests pass across 6 files. 0 failures.

### 1b. Run the full browser package test suite

```bash
cd /data/projects/accordo/packages/browser
pnpm test -- --run
```

**Expected:** 928 tests pass (33 test files). 0 failures.

### 1c. Type checker

```bash
cd /data/projects/accordo/packages/browser
pnpm exec tsc --noEmit
```

**Expected:** exits 0. Zero TypeScript errors.

### 1d. Linter

```bash
cd /data/projects/accordo/packages/browser
pnpm run lint
```

**Expected:** No lint errors or warnings.

---

### 1e. Per-test-file breakdown

#### `relay-discovery.test.ts` — 29 tests — Discovery file read/write/liveness (SBR-F-030..043)

Tests the real `relay-discovery.ts` using an in-memory `node:fs` mock. Covers:
- **Constants** (2): `SHARED_RELAY_FILE` is `shared-relay.json`, `SHARED_RELAY_LOCK_FILE` is `shared-relay.json.lock`
- **SBR-F-030 Read** (3): `readSharedRelayInfo()` returns `null` when file missing, `null` when malformed JSON, and parsed `SharedRelayInfo` when valid
- **SBR-F-031 Liveness** (3): `isRelayAlive()` returns `true` for live PID (via `process.kill(pid, 0)`), `false` for PID `0`, `false` for dead/missing PID (ESRCH)
- **SBR-F-032 Owner selection** (2): Missing file and dead PID both correctly trigger Owner mode
- **SBR-F-033 Write** (3): `writeSharedRelayInfo()` creates file at correct path; round-trip write+read preserves all fields; port is always 40111
- **SBR-F-034/035 Lock** (4): `acquireRelayLock()` returns `true` when free; `releaseRelayLock()` makes lock re-acquirable; returns `false` when already held; lock path is `~/.accordo/shared-relay.json.lock`
- **SBR-F-036 Permissions** (2): `0o600` has correct owner-read+write bits, no group/other; `writeSharedRelayInfo()` uses mode `0o600`
- **SBR-F-037 Fixed port** (1): Port is always 40111
- **SBR-F-038 Shared token** (2): Token persisted by `writeSharedRelayInfo()` round-trips; both `/hub` and `/chrome` URL paths include `?token=<token>`
- **SBR-F-039 Cleanup** (3): Owner writes valid file; stale file (dead PID) detected by `isRelayAlive`; both files use `0o600`
- **SBR-F-040..043 Ownership transfer** (4): `SharedRelayClient` is constructable; lock contention correctly denies second caller; `readSharedRelayInfo()` preserves port/pid; `SharedBrowserRelayServer` is constructable with correct initial state

#### `shared-relay-server.test.ts` — 19 tests — SharedBrowserRelayServer (SBR-F-001..009, SBR-F-040)

Tests `SharedBrowserRelayServer` with `node:http` and `ws` mocked to prevent real port binding. Covers:
- **SBR-F-001** (2): `start()` resolves and `getConnectedHubs()` returns empty `Map`; Hub registration API shape
- **SBR-F-002** (2): `isChromeConnected()` returns `false` before Chrome connects; single Chrome policy
- **SBR-F-002a** (1): Server constructed with shared token; `isChromeConnected()` is `false` after start
- **SBR-F-003** (1): `getConnectedHubs()` returns a `Map` keyed by hubId
- **SBR-F-004** (1): Response routing table API (`getConnectedHubs()` is `Map`)
- **SBR-F-005** (1): `SharedRelayRequest` includes `hubId`; Chrome view (`BrowserRelayRequest`) does not
- **SBR-F-006** (1): Chrome→Hub event routing API
- **SBR-F-007** (2): `stop()` clears Hub routing table; individual disconnect leaves others intact
- **SBR-F-008** (2): `isChromeConnected()` is `false` after stop; pending request error shape
- **SBR-F-009** (2): `isChromeConnected()` state; `ChromeStatusEvent` has correct shape `{ kind: 'chrome-status', connected: boolean }`
- **SBR-F-040** (1): Server disconnect causes Hub clients to attempt ownership transfer (API verified)
- **DECISION-SBR-05** (2): Port is always 40111; `start()` resolves (no real port binding in tests)
- **DECISION-SBR-06** (1): Token used by both server and clients

#### `shared-relay-client.test.ts` — 15 tests — SharedRelayClient (SBR-F-010..015)

Tests `SharedRelayClient` with `ws` fully mocked (Proxy-based `readyState` interception, synchronous `open` event, echo response for `send`). Covers:
- **SBR-F-010** (2): Constructor accepts options without throwing; implements `request()`, `push()`, `isConnected()`, `start()`, `stop()`
- **SBR-F-011** (3): `request()` sends `SharedRelayRequest` with `hubId` and receives response with `success`; `push()` is fire-and-forget; `hubId` matches UUID regex
- **SBR-F-012** (3): `isConnected()` is `false` before `start()`; `false` after `start()` with no Chrome; `false` until `ChromeStatusEvent(connected=true)` received
- **SBR-F-013** (2): Unexpected WS close schedules reconnect; `stop()` cancels timer
- **SBR-F-014** (2): `ChromeStatusEvent(connected=true)` delivered via mock message handler causes `isConnected()` to become `true`; `ChromeStatusEvent(connected=false)` reverts it
- **SBR-F-015** (2): `onRelayRequest` interceptor called for Chrome→Hub events; handles all 9 Chrome→Hub action types
- **DECISION-SBR-06** (1): WS URL includes `?hubId=<>&token=<>` query params

#### `write-lease.test.ts` — 24 tests — WriteLeaseManager (SBR-F-020..027)

Tests `WriteLeaseManager` with vitest fake timers for time-dependent behavior. Covers:
- **SBR-F-020** (3): `MUTATING_ACTIONS` contains exactly `navigate`, `click`, `type`, `press_key`; `acquire()` must be called before mutating; non-mutating actions bypass the lease
- **SBR-F-021** (3): `currentHolder()` is `null` when idle; returns HUB_A after acquire; never returns a different hub
- **SBR-F-022** (4): Hub B queues when Hub A holds lease; queued Hub B gets lease after Hub A releases; queue order is FIFO; queue depth is limited to `maxQueueDepth`
- **SBR-F-023** (3): Lease expires after `leaseDurationMs` ms; expired lease is released automatically; active request extends expiry by `leaseExtensionMs`
- **SBR-F-024** (2): `release()` by non-holder is silently ignored; `release()` by holder triggers queue drain
- **SBR-F-025** (2): `acquire()` rejects when `hubId` is already the holder; re-acquisition resets expiry
- **SBR-F-026** (3): Queue emits `queued` event on enqueue; `dequeued` event on grant; `expired` on expiry
- **SBR-F-027** (4): `onDisconnect()` releases lease and removes from queue; `onDisconnect()` on non-holder/non-queued is no-op; after disconnect next queued hub gets lease; `currentHolder()` returns null after disconnect

#### `relay-onrelay.test.ts` — 15 tests — onRelayRequest response shapes (Chrome→Hub API)

Tests `onRelayRequest` behavior with `BrowserRelayServer` mocked and the per-window path forced (`sharedRelay=false` via workspace mock override in `beforeEach`). Verifies that `response.data` has the correct shape for each Chrome→Hub action type. Covers:
- `get_comments` → `response.data` is `{ threads: CommentThread[], total: number, hasMore: boolean }`
- `get_all_comments` → `response.data` is `{ threads: CommentThread[], total: number, hasMore: boolean }`
- `get_comments_version` → `response.data` is `{ version: number }`
- `create_comment` → success response with `threadId` and `commentId`
- `reply_comment` → success response with `commentId`
- `resolve_thread` → success response
- `reopen_thread` → success response
- `delete_comment` → success response
- `delete_thread` → success response
- Error cases: missing thread, invalid action, missing commentId
- Response envelope shape: `{ success: boolean, data: ... }` for all paths
- Unhandled rejection safety: no unhandled promise rejections from `onRelayRequest` chain

#### `shared-relay-feature-flag.test.ts` — 9 tests — Feature flag integration (SBR-F-050, SBR-F-051)

Tests the full `activate()` flow with `vscode`, `node:net`, `relay-server`, `shared-relay-server`, `shared-relay-client`, and `relay-discovery` all mocked. Covers:
- **SBR-F-050 sharedRelay=true** (4):
  - When no existing relay → `SharedBrowserRelayServer` is constructed (Owner path)
  - When existing alive relay found → `SharedRelayClient` is constructed (Hub path)
  - `registerTools()` called in Owner path with correct extension ID and expected tool names (`accordo_browser_get_page_map`, `accordo_browser_wait_for`, etc.)
  - `registerTools()` called in Hub path
- **SBR-F-051 sharedRelay=false/fallback** (3):
  - When `sharedRelay=false` → `BrowserRelayServer` constructed, shared relay classes NOT constructed, `registerTools()` called
  - When `sharedRelay=false` → `registerTools()` called with correct extension ID `accordo.accordo-browser`
  - When lock cannot be acquired → falls back to per-window `BrowserRelayServer`, `registerTools()` still called
- **SBR-NF-003 Interface unchanged** (2):
  - Shared mode tool set includes `get_page_map`, `wait_for`, `text_map`, `semantic_graph`, `diff_snapshots`
  - Per-window mode tool set includes the same tools

---

## Section 2 — User Journey Tests

These are end-to-end checks a developer can follow using VS Code with Accordo extensions loaded.

### Prerequisites for all user journey tests

1. Build the workspace: `pnpm build` at the project root
2. Launch VS Code with extensions in dev mode: `./scripts/start-session.sh`
3. Open an MCP client (e.g. OpenCode) and connect to the Hub
4. Have Chrome open with the Accordo Chrome extension installed and enabled

---

### Journey 1: Single-window shared relay (Owner mode)

**Setup:** One VS Code window open. `accordo.browser.sharedRelay` is `true` (default).

**Steps:**
1. Open the Accordo output channel: **View → Output → Accordo Browser Relay**
2. Reload the VS Code window (Cmd+Shift+P → "Developer: Reload Window")
3. Observe the output channel

**Expected:**
- Log line containing `SharedBrowserRelayServer` starting on port 40111
- Log line indicating the Owner window wrote `~/.accordo/shared-relay.json`
- `~/.accordo/shared-relay.json` exists after reload: `cat ~/.accordo/shared-relay.json` should show JSON with `port: 40111`, `pid: <current PID>`, and an `ownerHubId`

4. From an MCP client, call `accordo_browser_get_page_map`

**Expected:** Tool returns a page map response (not an error). Chrome DevTools connection works through the shared relay.

---

### Journey 2: Two-window shared relay (Hub client joins)

**Setup:** First VS Code window open in Owner mode (Journey 1 completed). `shared-relay.json` exists with a live PID.

**Steps:**
1. Open a **second** VS Code window in the same workspace
2. Open its Accordo output channel

**Expected:**
- Log line indicating the second window read `~/.accordo/shared-relay.json`
- Log line indicating the second window connected as a Hub client (not starting a new server)
- No `EADDRINUSE` error — port 40111 is not bound twice

3. From the second window's MCP client session, call `accordo_browser_get_page_map`

**Expected:** Tool returns a valid page map response. Both windows share the same Chrome connection.

---

### Journey 3: Feature flag OFF — per-window relay

**Setup:** One VS Code window open.

**Steps:**
1. Open VS Code settings (Cmd+,)
2. Search for `accordo.browser.sharedRelay`
3. Set the value to `false`
4. Reload the VS Code window

**Expected:**
- Output channel shows `BrowserRelayServer` starting (not `SharedBrowserRelayServer`)
- `~/.accordo/shared-relay.json` is NOT written (or pre-existing file is not updated with this window's PID)
- MCP tool calls via `accordo_browser_get_page_map` still work normally through the per-window relay

5. Re-enable the setting (`true`) and reload

**Expected:** Shared relay path is taken again (Owner mode).

---

### Journey 4: Owner window closes — Hub client takes over

**Setup:** Two VS Code windows open, window A is Owner, window B is a Hub client.

**Steps:**
1. Close window A (the Owner — the one whose PID is in `shared-relay.json`)
2. Wait 3–5 seconds for window B to detect the disconnect

**Expected:**
- Window B's output channel shows detection of Owner disconnect
- Window B acquires the lock and starts a new `SharedBrowserRelayServer`
- Window B writes a new `~/.accordo/shared-relay.json` with its own PID
- `accordo_browser_get_page_map` from window B's MCP session continues to work

---

### Journey 5: Stale `shared-relay.json` on startup

**Setup:** `~/.accordo/shared-relay.json` exists but contains a dead PID (e.g. VS Code was force-killed previously).

**Steps:**
1. Manually edit `~/.accordo/shared-relay.json` and set `"pid": 1` (init process — never a VS Code window) or any PID that doesn't exist
2. Open a VS Code window with `accordo.browser.sharedRelay: true`

**Expected:**
- Output channel shows that the existing relay was detected as dead (liveness check failed)
- Window becomes Owner: starts `SharedBrowserRelayServer`, overwrites `shared-relay.json` with its own PID
- MCP tools work normally — no stale-relay errors

---

### Journey 6: Write lease — only one window types at a time

**Setup:** Two VS Code windows connected as Hub clients to the shared relay.

**Steps:**
1. From window A's MCP session, call `accordo_browser_type` with text `"hello from window A"` in a text field
2. Simultaneously (within the same second), call `accordo_browser_type` from window B's MCP session

**Expected:**
- Both type calls succeed eventually — they do not interfere with each other
- The text field contains content from one operation at a time, not interleaved characters
- If the queue fills (more than 8 concurrent mutating actions pending), excess requests receive a queue-full error rather than silently dropping
