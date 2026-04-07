# ADR: Reconnect-First Hub Lifecycle (Reload Survival)

**Date:** 2026-04-05  
**Status:** Proposed  
**Module:** `packages/bridge`, `packages/hub`, `packages/bridge-types`

---

## Context

Two problems in the current Hub lifecycle:

### Problem 1 — Hub orphans on window close

`cleanupExtension()` in `extension-composition.ts` disconnects the WsClient, cancels the router, and disposes the StatePublisher and registry — but **never calls `hubManager.deactivate()` or `hubManager.killHub()`**. When VS Code closes, the Hub child process becomes an orphan adopted by init (ppid=1).

The Hub's parent-exit tracker (`ppid === 1` interval in `index.ts`) catches this **eventually** (up to 5 seconds), but no explicit signal is sent from the Bridge.

### Problem 2 — Unnecessary Hub restarts on reload

When a user reloads the VS Code window (`Developer: Reload Window`), the extension host is destroyed and recreated. The new `activate()` call always spawns a fresh Hub process, even though the previous Hub is still alive and listening on the same port with the same token and secret.

This causes a 2–3 second delay on every reload, kills all active MCP sessions, and forces agents to reconnect.

### Problem 3 — killHub has no SIGKILL fallback

`HubProcess.killHub()` sends `proc.kill()` (SIGTERM) and waits for the `exit` event with no timeout. If the Hub ignores SIGTERM or hangs in a shutdown handler, `killHub()` blocks forever.

---

## Decision

### D1 — Soft disconnect with grace timer (Problems 1 + 2)

Introduce a two-phase deactivation:

1. **Bridge side:** New `HubManager.softDisconnect()` method sends `POST /bridge/disconnect` to the Hub, then disconnects the WsClient. Does NOT kill the Hub process.

2. **Hub side:** New `POST /bridge/disconnect` endpoint (authenticated via bridge secret) starts a **10-second grace timer**. When the timer expires without a new WS connection, the Hub self-terminates (`process.exit(0)`). If a Bridge reconnects (new WS connection established) during the grace window, the timer is cancelled.

3. **`cleanupExtension()`** is updated to call `hubManager.softDisconnect()` instead of doing nothing.

### D2 — Reconnect-first activation (Problem 2)

Modify `HubManager.activate()` to attempt reconnection before spawning:

1. Read `hub.port` and `hub.pid` files from `~/.accordo/`.
2. Check if the PID is alive (`kill(pid, 0)`).
3. If alive, probe `GET /health` on the stored port.
4. If health responds `200`, emit `onHubReady(port, token)` — **skip spawn entirely**.
5. If probe fails → fall through to normal spawn path.

**Token/secret handling:** Tokens are preserved in `SecretStorage` across VS Code reloads — they are stable UUIDs generated once and reused. No rotation on reconnect. `opencode.json` and other agent config files are **not rewritten** during a reconnect (only on fresh spawn).

### D3 — SIGKILL fallback for killHub (Problem 3)

Add a 2-second timeout to `HubProcess.killHub()`. If the process hasn't exited after SIGTERM + 2s, send SIGKILL to force termination.

---

## Consequences

### Positive

- (+) Hub survives VS Code reloads — no agent session disruption
- (+) Reload completes in ~100ms (health probe) instead of ~3s (spawn + poll)
- (+) No orphan Hub processes on normal close (explicit disconnect + grace timer)
- (+) `opencode.json` stays stable during reload cycles (no config churn)
- (+) SIGKILL fallback prevents `killHub()` from blocking forever

### Negative / Risks

- (-) Hub lives 10 seconds longer than necessary after a true close (grace timer)
- (-) Race condition: if two VS Code windows share `~/.accordo/` files, the second window's `activate()` might probe the first window's Hub (mitigated: bridge secret will differ, WS auth fails → falls through to spawn)
- (-) New endpoint (`/bridge/disconnect`) increases Hub API surface
- (-) Grace timer adds mutable state to the Hub that must be carefully tested

### Unchanged

- MCP clients (`/mcp`, `/instructions`, `/state`) are unaffected — they use Bearer auth, not bridge secret
- `/health` remains public (no auth)
- Token rotation via `/bridge/reauth` is unchanged
- WebSocket protocol is unchanged

---

## Alternatives Considered

### A1 — Bridge-side timer (kill after 10s if no re-activate)

Rejected: Bridge process dies on deactivate — it cannot run a timer after the extension host is destroyed.

### A2 — Hub watches WS disconnect and self-terminates

Already partially exists (grace window in `BridgeConnection`), but that timer clears state, not the process. Extending it to self-terminate would conflate "Bridge disconnected during normal operation" with "VS Code window closing."

### A3 — File-based coordination (write a "shutting down" flag)

Rejected: race-prone, requires file watching, harder to test.

---

## Requirements Mapping

| Requirement | Interface Element |
|---|---|
| LCM-11 (deactivate) | `HubManager.softDisconnect()`, `cleanupExtension()` update |
| LCM-01/02/03 (activate) | `HubManager.activate()` reconnect-first logic |
| Hub §2.x (endpoints) | `POST /bridge/disconnect` route in `server-routing.ts` |
| Hub §2.5 (WS) | Grace timer cancel on new WS connect in `BridgeConnection` |
| LCM-07 (health poll) | `HubHealth.checkHealth()` reused for reconnect probe |

---

## References

- DECISION-MS-01 in `multi-session-architecture.md` ("Kill Hub on deactivate") — partially reversed by this ADR
- DEC-005 (Hub auto-start) — reconnect-first adds a "probe before spawn" step
- `BridgeServer.graceWindowMs` / `onGraceExpired` — existing grace window pattern leveraged for disconnect timer
