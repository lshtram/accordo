# Priority P — Architecture Review: Comment Store Unification (VS Code ↔ Browser Extension)

**Author:** Architect Agent  
**Date:** 2026-04-19  
**Input reference:** `docs/00-workplan/workplan.md` (Priority P, lines 172–202)

---

## 1) Files Reviewed

### Browser extension
- `packages/browser-extension/src/adapters/comment-backend.ts`
- `packages/browser-extension/src/relay-comment-handlers.ts`
- `packages/browser-extension/src/store.ts`
- `packages/browser-extension/src/relay-bridge.ts`
- `packages/browser-extension/src/sw-router.ts`
- `packages/browser-extension/src/sw-lifecycle.ts`
- `packages/browser-extension/src/sw-comment-sync.ts`
- `packages/browser-extension/src/content/comment-ui.ts`

### VS Code side (comments + browser relay)
- `packages/comments/src/comment-store.ts`
- `packages/comments/src/comment-tools/handlers.ts`
- `packages/comments/src/panel/navigation-router.ts`
- `packages/comments/src/panel/comments-tree-provider.ts`
- `packages/comments/src/comments-bootstrap.ts`
- `packages/browser/src/comment-notifier.ts`
- `packages/browser/src/relay-lifecycle.ts`
- `packages/browser/src/browser-comment-relay-handler.ts`

### Types + docs
- `packages/bridge-types/src/comment-types.ts`
- `docs/10-architecture/architecture.md`
- `docs/10-architecture/browser-extension-architecture.md`
- `docs/20-requirements/requirements-browser-extension.md`
- `docs/20-requirements/requirements-comments.md`
- `docs/20-requirements/requirements-comments-panel.md`

---

## 2) Diagnosis Assessment (Workplan Priority P)

## Verdict: **Partially correct; primary root cause is misstated/incomplete.**

What the workplan gets right:
- The symptom is real: agent-originated updates are not reliably visible as browser pins.
- The browser extension and VS Code comment store are separate persistence domains with sync glue.

What is incorrect/incomplete:
1. **`RelayBridgeClient` is not the place where forwarding logic belongs.** It is a transport client (`send()`), not the action-to-tool mapper.
2. **Comment mutation forwarding already exists** in the relay server path via `browserActionToUnifiedTool()` mapping to unified `comment_*` tools.
3. The high-probability runtime break is **relay mode divergence** in `packages/browser/src/relay-lifecycle.ts`:
   - per-window path wraps reads as `data: { threads }`
   - shared-relay path returns raw tool result (bare array)
   - browser-extension merge path expects `raw.threads`
   - result: Hub threads dropped in merge => agent comments/replies invisible in browser pins.
4. Shared-relay path also lacks the per-window post-mutation notify behavior parity.

Additional technical debt observed:
- `packages/browser/src/browser-comment-relay-handler.ts` executes `vscode.commands.executeCommand(toolName, ...Object.values(args))` instead of the Bridge `invokeTool(toolName, args)` contract used elsewhere. This is brittle and can diverge from MCP tool invocation semantics.

---

## 3) Requirements/Architecture Gaps Found and Updated

To remove ambiguity, requirements + architecture were updated before planning:

### Updated requirements
`docs/20-requirements/requirements-browser-extension.md`
- **BR-F-144:** `get_comments` / `get_all_comments` response envelope must be mode-invariant (`{ threads }`).
- **BR-F-145:** shared + per-window relay paths must have equivalent mutation notify semantics.
- **BR-F-146:** browser-extension parser must normalize `{ threads }` envelope and tolerate legacy bare-array shape.

### Updated architecture
`docs/10-architecture/architecture.md` §14.4
- Added explicit relay response contract and shared/per-window parity requirement for comment actions.

---

## 4) Phase A Plan (Design Only)

## 4.1 Requirement IDs in scope

- Existing: PU-F-41, PU-F-43, PU-F-44, PU-F-56, BR-F-122, BR-F-124, BR-F-130, BR-F-142, M38-CT-11
- New/clarifying: **BR-F-144, BR-F-145, BR-F-146**

## 4.2 Interface boundary to formalize

Define a single typed relay contract at the browser package boundary:

```ts
interface BrowserCommentReadEnvelope {
  threads: CommentThread[];
}

interface BrowserCommentRelayContract {
  normalizeReadResult(data: unknown): BrowserCommentReadEnvelope;
  normalizeMutationResult(action: BrowserRelayAction, data: unknown): Record<string, unknown>;
}
```

Canonical rule: reads (`get_comments`, `get_all_comments`) always return envelope `{ threads }` across relay modes.

## 4.3 Modules to change (Phase B/C implementation targets)

1. `packages/browser/src/relay-lifecycle.ts`
   - unify shared/per-window `onRelayRequest` behavior.
   - extract shared handler function for mapping, invocation, response shaping, and notify push.

2. `packages/browser/src/browser-comment-relay-handler.ts`
   - replace direct `executeCommand(...Object.values(args))` path with typed Bridge invocation path.

3. `packages/browser/src/comment-notifier.ts`
   - keep mapping pure; no behavioral branching by relay mode.

4. `packages/browser-extension/src/sw-comment-sync.ts`
   - add strict decode + normalization for read payloads (`{ threads }` canonical, legacy array tolerated).

5. `packages/browser-extension/src/sw-lifecycle.ts`
   - ensure notify semantics remain deterministic after normalization.

6. `packages/browser-extension/src/adapters/comment-backend.ts`
   - keep adapter selection behavior; add tests confirming `selectAdapter()` in connected/disconnected states.

## 4.4 Stubs to add in Phase A (if split into implementation PRs)

- `packages/browser/src/comment-relay-contract.ts`
  - `normalizeReadResult(data: unknown): BrowserCommentReadEnvelope`
  - `shapeRelayResponse(action, result): BrowserRelayResponse`
- `packages/browser/src/relay-comment-dispatch.ts`
  - `dispatchBrowserCommentAction(deps, action, payload): Promise<BrowserRelayResponse>`
- `packages/browser-extension/src/sw-comment-sync-contract.ts`
  - `decodeHubThreadsPayload(data: unknown): HubCommentThread[]`

Stub behavior for Phase A: compile-clean signatures returning `throw new Error("not implemented")`.

---

## 5) TDD/Testing Concerns to Front-load

- **Mode parity matrix:** every comment action must be tested in both shared relay and per-window relay paths.
- **Contract tests:** enforce `get_comments`/`get_all_comments` payload shape (`{ threads }`) in both paths.
- **Backward compatibility test:** legacy bare-array payload still parsed by browser-extension normalization layer.
- **Mocking boundaries:**
  - mock Bridge `invokeTool` (not `vscode.commands.executeCommand`) for comment tool invocation tests.
  - isolate Chrome APIs (`chrome.tabs`, `chrome.runtime`, `chrome.storage`) behind existing test doubles.

---

## 6) Architectural constraints confirmed (AGENTS.md)

- No `vscode` imports in `accordo-hub` packages.
- Handler functions are never serialized across package boundary (only registration data crosses wire).
- MCP tool naming remains `accordo_<modality>_<action>`; internal relay action names remain exempt.
- Security middleware-first requirement remains unchanged.

---

## 7) Non-Technical Explanation

Right now, part of the "comment synchronization" plumbing behaves differently depending on which relay mode is active. Because of that, comments created by the agent can be saved correctly in VS Code but still not appear as pins in the browser UI. The fix is to make one clear contract for comment data shape and enforce it everywhere, so browser pins and VS Code comments stay in sync.

What can go wrong if we do nothing: users will continue seeing “some comments appear, some don’t,” which breaks trust in comment tools.

How we know it works: after the fix, both relay modes return identical comment payloads, and end-to-end tests show agent-created/replied comments immediately appear as browser pins.

---

## 8) Technical Explanation

Key design decision: enforce a single cross-package read envelope (`{ threads }`) and a single shared dispatcher for comment actions, then consume that contract via strict decode/normalize in browser-extension sync code.

Why:
- eliminates hidden branching between `activateSharedRelay` and `activatePerWindowRelay`.
- prevents payload-shape drift from silently dropping Hub threads in merge.
- centralizes mutation side-effects (notify push) and tool invocation semantics.

Requirements gap resolved by adding BR-F-144..146 and updating architecture §14.4 so future contributors cannot reintroduce mode-specific response shapes.
