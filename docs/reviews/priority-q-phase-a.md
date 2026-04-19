# Priority Q — Phase A Architecture Review: Comments Panel Navigation (Focus to Surface)

**Author:** Architect Agent  
**Date:** 2026-04-19  
**Input reference:** `docs/00-workplan/workplan.md` (Priority Q)

---

## 1) Corrected Diagnosis

### Summary

The reported behavior is real, but the main fault is not a single "wrong command" line. It is a **routing-contract drift** across three layers:

1. **Slide routing argument drift**
   - Router fallback path calls presentation focus with incomplete args in some paths.
   - Canonical Marp focus command expects `(uri, threadId, blockId)`.
   - Missing/shifted args can produce wrong target behavior and inconsistent focus.

2. **Browser failure messaging drift**
   - Browser navigation path treats command failure as relay disconnect.
   - This can produce false positives when relay health is actually connected (`accordo_browser_health.connected === true`) but focus dispatch fails for another reason.

3. **Anchor-shape divergence for `.md` comments**
   - User-created comments can be stored as text anchors in deck markdown files.
   - Smart-viewer markdown routing can override intended slide focus path and open/dismiss the wrong surface.

### What this changes in Phase A

- Define one explicit surface→command mapping contract.
- Define browser health abstraction for messaging correctness.
- Declare slide command signature as canonical (`uri, threadId, blockId`) in requirements + architecture.

---

## 2) Requirements + Architecture Updates

### Updated requirements

File: `docs/20-requirements/requirements-comments-panel.md`

- Corrected M45-NR-04: slide canonical command is `accordo.presentation.internal.focusThread(uri, threadId, blockId)`; goto stays fallback.
- Corrected M45-NR-05 command ID to `accordo_browser.focusThread`.
- Added M45-NR-12: browser health probe required before showing disconnected message.
- Added M45-NR-13: single explicit surface→command mapping constant.
- Added M45-NR-14: `.md` text anchors must not override slide-target navigation hints.

### Updated architecture

File: `docs/10-architecture/architecture.md` (§17)

- Clarified slide and browser command signatures in registered adapter table.
- Added browser health-aware routing note for Priority Q.
- Clarified slide focus path requires full `(uri, threadId, blockId)` command args.

---

## 3) Phase A Interfaces (typed contracts)

### `packages/comments/src/panel/navigation-contract.ts`

Defined:

- `SURFACE_FOCUS_COMMANDS` (canonical mapping)
- `SurfaceNavigationTarget`
- `NavigationDispatchPlan`
- `buildNavigationDispatchPlan(thread)` (plan builder stub-level contract)

Purpose:
- Prevent command string duplication across branches.
- Make mapping auditable and testable in isolation.

### `packages/comments/src/panel/browser-relay-health.ts`

Defined:

- `BrowserRelayHealth`
- `BrowserRelayHealthReader`
- `CommandBackedBrowserRelayHealthReader` (stub)

Purpose:
- Keep browser relay-health probing behind a local abstraction.
- Avoid direct command-coupling in router logic.

### `packages/comments/src/panel/navigation-router.ts`

Defined/refined:

- `NavigationEnv`
- `NavigationRouterDeps`
- `navigateToThread(...)` (Phase A stub)
- `navigateWithPlan(...)` (Phase A stub)
- `getAdapterRegistry()`

Purpose:
- Preserve stable public entrypoint while moving toward plan-based dispatch.
- Keep implementation deferred to Phase C per TDD phase boundaries.

---

## 4) Stub Locations (Phase A only)

1. `packages/comments/src/panel/navigation-router.ts`
   - `navigateToThread` → `throw new Error("not implemented")`
   - `navigateWithPlan` → `throw new Error("not implemented")`

2. `packages/comments/src/panel/browser-relay-health.ts`
   - `CommandBackedBrowserRelayHealthReader.readHealth` → `throw new Error("not implemented")`

These stubs import cleanly and compile as design placeholders.

---

## 5) Open Questions for Phase B/C

1. **Slide hint source for text anchors:**
   - Which metadata field is authoritative for detecting "this `.md` text anchor belongs to slide surface"?
   - Candidate: latest comment `context.surfaceMetadata`.

2. **Browser health probe semantics:**
   - Should failed `accordo_browser.focusThread` + healthy relay report a separate message key (e.g. `focus-unavailable`) for telemetry and UX consistency?

3. **Adapter ownership clarity:**
   - Browser adapter is currently local to comments router; architecture table lists package ownership by command producer. Confirm final ownership wording to avoid confusion.

---

## 6) Technical Decisions Snapshot

- Keep `navigateToThread` as single public API (no breaking call-site change).
- Introduce explicit mapping contract (`SURFACE_FOCUS_COMMANDS`) rather than free-form command strings in conditional branches.
- Add browser relay health abstraction to separate "focus command failed" from "relay disconnected".
- Keep all runtime behavior deferred (stubs only) to preserve Phase A scope.
