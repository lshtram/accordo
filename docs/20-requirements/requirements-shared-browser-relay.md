# Shared Browser Relay — Requirements

**Status:** DRAFT — Phase A  
**Date:** 2026-04-08  
**Companion to:** docs/10-architecture/shared-browser-relay-architecture.md

---

## 1. Functional Requirements

### 1.1 Shared Relay Server

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-001 | The shared relay server SHALL accept multiple simultaneous Hub client WebSocket connections on path `/hub`. | MUST |
| SBR-F-002 | The shared relay server SHALL accept exactly one Chrome client WebSocket connection on path `/chrome`. A new Chrome connection SHALL replace the previous one (same as current behavior). | MUST |
| SBR-F-002a | Both `/hub` and `/chrome` connections SHALL authenticate with the same shared token via `?token=<token>` query parameter (SBR-F-038). | MUST |
| SBR-F-003 | Each Hub client connection SHALL be identified by a `hubId` (UUID) provided at connection time. | MUST |
| SBR-F-004 | The shared relay server SHALL route Chrome responses back to the Hub client that sent the original request, using `requestId` → `hubId` mapping. | MUST |
| SBR-F-005 | The shared relay server SHALL strip `hubId` from requests before forwarding to Chrome. Chrome SHALL never see `hubId`. | MUST |
| SBR-F-006 | When Chrome sends an incoming event (Chrome→Hub, via `onRelayRequest` path), the server SHALL route to the appropriate Hub client or broadcast to all Hub clients. | MUST |
| SBR-F-007 | When a Hub client disconnects, the server SHALL remove it from the routing table and release any write lease held by that Hub. | MUST |
| SBR-F-008 | When Chrome disconnects, all pending requests from all Hub clients SHALL resolve with `browser-not-connected`. | MUST |
| SBR-F-009 | The shared relay server SHALL broadcast `ChromeStatusEvent` to all Hub clients when Chrome connects or disconnects. | MUST |

### 1.2 Shared Relay Client

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-010 | `SharedRelayClient` SHALL implement `BrowserRelayLike`. | MUST |
| SBR-F-011 | `SharedRelayClient` SHALL include `hubId` in every outgoing request envelope. | MUST |
| SBR-F-012 | `SharedRelayClient.isConnected()` SHALL return `true` only when the WebSocket to the shared relay is OPEN AND Chrome is reported connected (via `ChromeStatusEvent`). | MUST |
| SBR-F-013 | `SharedRelayClient` SHALL auto-reconnect to the shared relay on disconnect (2s timer). | MUST |
| SBR-F-014 | `SharedRelayClient` SHALL handle `ChromeStatusEvent` messages and update internal `chromeConnected` state. | MUST |
| SBR-F-015 | `SharedRelayClient` SHALL support `onRelayRequest` interceptor for Chrome→Hub events, identical to the existing `BrowserRelayServer` contract. | MUST |

### 1.3 Write Lease

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-020 | Mutating actions (`navigate`, `click`, `type`, `press_key`) SHALL require a write lease before being forwarded to Chrome. | MUST |
| SBR-F-021 | Only one Hub client SHALL hold the write lease at any time. | MUST |
| SBR-F-022 | If the lease is held by another Hub, the request SHALL be queued (FIFO). | MUST |
| SBR-F-023 | Queue depth SHALL be limited (default: 8). Requests beyond the limit SHALL be rejected with `action-failed`. | MUST |
| SBR-F-024 | The lease SHALL auto-expire after `leaseDurationMs` (default: 10,000ms) if not renewed. | MUST |
| SBR-F-025 | Successful completion of a mutating action SHALL extend the lease by `leaseExtensionMs` (default: 2,000ms). | SHOULD |
| SBR-F-026 | When a Hub client disconnects, its lease SHALL be immediately released and queued requests for that Hub SHALL be discarded. | MUST |
| SBR-F-027 | Read-only actions SHALL bypass the write lease entirely. | MUST |

### 1.4 Relay Discovery

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-030 | On activation, the browser extension SHALL check for an existing shared relay by reading `~/.accordo/shared-relay.json`. | MUST |
| SBR-F-031 | If the file exists and the PID therein is alive, the extension SHALL connect as a Hub client. | MUST |
| SBR-F-032 | If the file is missing or the PID is dead, the extension SHALL start a `SharedBrowserRelayServer` and become the Owner. | MUST |
| SBR-F-033 | The Owner SHALL write `~/.accordo/shared-relay.json` with `{ port, pid, token, startedAt, ownerHubId }`. | MUST |
| SBR-F-034 | File write SHALL use a companion lock file (`shared-relay.json.lock`) to prevent race conditions between competing windows. | MUST |
| SBR-F-035 | Lock file acquisition SHALL time out after 2 seconds and fall back to client mode. | SHOULD |
| SBR-F-036 | `shared-relay.json` file permissions SHALL be `0600`. | MUST |
| SBR-F-037 | The shared relay port SHALL be fixed at 40111 (canonical). No dynamic port fallback. If port 40111 is unavailable, the shared relay SHALL NOT start and the activating window SHALL fall back to per-window `BrowserRelayServer`. (DECISION-SBR-05) | MUST |
| SBR-F-038 | The shared relay SHALL use a single shared authentication token for all connections (Chrome and Hub clients). The token SHALL be written to `~/.accordo/shared-relay.json` and read by all clients. (DECISION-SBR-06) | MUST |
| SBR-F-039 | `~/.accordo/shared-relay.json` and `~/.accordo/shared-relay.json.lock` are an explicit exception to DECISION-MS-10 (`~/.accordo/` for logs/audit only). Both files SHALL have permissions `0600` and SHALL be cleaned up on graceful Owner shutdown. Stale files (owner PID dead) SHALL be overwritten or removed by the next Owner. | MUST |

### 1.5 Ownership Transfer

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-040 | When the Owner window closes, all Hub clients SHALL detect the disconnect and attempt to become the new Owner. | MUST |
| SBR-F-041 | The first Hub client to successfully acquire the lock file and start the server SHALL become the new Owner. | MUST |
| SBR-F-042 | Other Hub clients SHALL reconnect to the new Owner's server. | MUST |
| SBR-F-043 | Chrome SHALL auto-reconnect to the new server (existing 2s reconnect timer is sufficient). | MUST |

### 1.6 Feature Flag

| ID | Requirement | Priority |
|---|---|---|
| SBR-F-050 | A VS Code setting `accordo.browser.sharedRelay` (boolean, default: `true`) SHALL control whether the shared relay model is used. | SHOULD |
| SBR-F-051 | When `false`, the extension SHALL fall back to the current per-window `BrowserRelayServer`. | SHOULD |

---

## 2. Non-Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| SBR-NF-001 | The shared relay SHALL add less than 5ms latency per request compared to the current direct relay. | SHOULD |
| SBR-NF-002 | The shared relay SHALL support at least 10 concurrent Hub clients. | SHOULD |
| SBR-NF-003 | The `BrowserRelayLike` interface SHALL remain unchanged. All existing browser tools SHALL work without modification. | MUST |
| SBR-NF-004 | Memory overhead of the shared relay server SHALL be less than 20MB above the current relay server. | SHOULD |
| SBR-NF-005 | Ownership transfer SHALL complete within 5 seconds (from Owner death to new Owner accepting connections). | SHOULD |
