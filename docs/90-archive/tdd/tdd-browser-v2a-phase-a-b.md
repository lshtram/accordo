# Browser Extension v2a — TDD Phase A + B Plan

**Date:** 2026-03-21  
**Scope:** SDK convergence + Accordo connectivity (agent read/reply/delete)  
**Applies to:** `packages/browser-extension` + new `packages/browser`

---

## Phase A — Understand, Explain, and Design Stubs

### A.1 PM / Non-Technical Explanation

This work solves one product problem: browser comments are useful, but the agent cannot act on them yet.

- Users can already place comments, but the UI path is split between SDK and custom forms/popovers, so behavior drifts over time.
- We will make browser comments use the same `@accordo/comment-sdk` interaction model end-to-end.
- We will add a bridge path so Accordo agents can read browser comments and perform basic moderation actions: reply, delete comment, delete thread.
- If relay/connection fails, browser commenting still works locally; only remote agent actions are unavailable.
- We know this works when an agent can call browser-comment tools from Hub and the browser updates live with matching storage state.

### A.2 Technical Reviewer Explanation

#### Current state and gaps

- Browser extension has local data + service-worker routes + MCP-shaped read handlers.
- UI is partially converged: existing thread interactions use SDK, new-comment flow still has custom form path.
- No transport from extension to Accordo stack (`packages/browser/` relay package is absent).
- No registered Hub tools that call into browser-extension comment state.

#### Key design decisions for v2a

1. **Single UI engine:** use SDK callbacks for create/reply/resolve/reopen/delete pathways in browser extension; keep only thin browser adapters.
2. **Additive architecture:** preserve existing extension storage schema and MCP handler logic; add transport + tool registration.
3. **Local relay package:** create `packages/browser` VS Code extension (`accordo-browser`) that bridges Hub tools to the active Chrome extension via WebSocket.
4. **Agent action scope (v2a):** `get_all_comments`, `get_comments`, `reply_comment`, `resolve_thread`, `reopen_thread`, `delete_comment`, `delete_thread`.
5. **Security baseline:** token-authenticated local WebSocket relay, strict request validation, correlation IDs, explicit error envelopes.

#### Integration points

- `packages/browser-extension`: SDK adapter and relay client endpoint.
- `packages/browser`: WebSocket relay server + Bridge tool registration.
- `packages/hub` and `packages/bridge`: no architecture changes required; relay extension registers tools through existing Bridge API.

#### Requirements/spec gaps identified and resolved

- Existing architecture/requirements marked SDK integration and relay as v1 out-of-scope but lacked actionable v2 wiring details.
- This phase adds explicit v2a wiring, tool contracts, and module boundaries to:
  - `docs/browser-extension-architecture.md`
  - `docs/requirements-browser-extension.md`
  - `docs/workplan.md`

### A.3 External boundary abstractions (ports)

1. **Browser relay transport port** (extension side)
   - stable for callers: request/response API for browser-comment actions
   - swappable: WebSocket implementation details, reconnect strategy
2. **Hub tool port** (relay side)
   - stable for Hub: tool names + JSON arg/response schemas
   - swappable: backend transport to extension (local WS now; native messaging later)
3. **SDK adapter port** (content-script side)
   - stable for extension domain: `BrowserCommentThread` <-/-> `SdkThread` mapping and action callbacks
   - swappable: future SDK API evolution isolated in adapter file(s)

---

## Phase B — Failing Test Plan (before implementation)

All behavior tests below must fail initially (assertion-level, no import/collection failures).

### B.1 Module test map

1. **M81-SDK-CONVERGENCE** (`packages/browser-extension`)
   - test files:
     - `tests/content-sdk-convergence.test.ts`
     - `tests/relay-actions.test.ts`
   - targets:
     - BR-F-117: new-comment flow uses SDK create path (no standalone custom submit path)
     - BR-F-118: right-click anchor opens SDK composer with anchor key
     - BR-F-119: service-worker relay action handlers exposed for get/reply/delete operations
     - BR-F-127: all thread actions route through SDK callbacks + service-worker messages

2. **M82-BROWSER-RELAY** (`packages/browser` new package)
   - test files:
     - `src/__tests__/relay-server.test.ts`
     - `src/__tests__/auth-token.test.ts`
     - `src/__tests__/request-router.test.ts`
   - targets:
     - BR-F-120: token-authenticated browser relay accepts extension connection
     - BR-F-121: request/response with correlation IDs and timeout behavior
     - BR-F-123: relay dispatches read/mutation actions to extension transport
     - BR-F-125: typed relay/tool failure classes are preserved end-to-end

3. **M83-BROWSER-TOOLS** (`packages/browser`)
   - test files:
     - `src/__tests__/browser-tools.test.ts`
     - `src/__tests__/extension-activation.test.ts`
   - targets:
     - BR-F-122: tools are registered through Bridge API with expected schemas
     - BR-F-124: `get_all_comments`, `get_comments`, `reply_comment`, `resolve_thread`, `reopen_thread`, `delete_comment`, `delete_thread` invoke relay correctly

4. **M84-END-TO-END-CONTRACT** (contract/integration tests)
   - test file: `packages/browser-extension/tests/relay-contract.test.ts`
   - targets:
     - BR-F-125: action responses reflect updated thread/comment state
     - BR-F-126: extension reconnect + relay restart recovery

### B.2 Requirement-to-test matrix

| Requirement | Primary test coverage |
|---|---|
| BR-F-117 | `content-sdk-convergence.test.ts` — create flow callback assertions |
| BR-F-118 | `content-sdk-convergence.test.ts` — right-click -> SDK composer invocation |
| BR-F-119 | `relay-actions.test.ts` — extension relay action handlers exposed and routable |
| BR-F-120 | `auth-token.test.ts` — reject unauthenticated extension socket |
| BR-F-121 | `request-router.test.ts` — correlation ID + timeout + error envelope |
| BR-F-122 | `browser-tools.test.ts` — tool registration names/schemas |
| BR-F-123 | `relay-server.test.ts` — dispatch to extension transport client |
| BR-F-124 | `browser-tools.test.ts` — tool args routed to relay actions |
| BR-F-125 | `request-router.test.ts` + `relay-contract.test.ts` — typed failure classes |
| BR-F-126 | `relay-contract.test.ts` — reconnect and resume behavior |
| BR-F-127 | `content-sdk-convergence.test.ts` — reply/resolve/delete callback route checks |

### B.3 Stub plan before tests

- Add minimal compile stubs for new package `packages/browser` modules:
  - `relay-server.ts`
  - `relay-auth.ts`
  - `relay-router.ts`
  - `browser-tools.ts`
  - `extension.ts`
- Add extension-side relay client stub in `packages/browser-extension/src/relay-client.ts`.
- Each stub exports real signatures and throws `new Error("not implemented")`.

---

## Stop Gate

This document completes planning for **Phase A + Phase B only**.

No implementation code should be written until:

1. User approves this A/B plan.
2. A review pass confirms architecture + requirements + workplan alignment.
3. We execute B2 with red test evidence.
