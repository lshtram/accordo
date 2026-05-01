# Review — comments-sync-hardening — Phase A re-review

## PASS

### Re-check of previous blockers

1. **Docs alignment** — RESOLVED
   - `docs/20-requirements/requirements-comments-panel.md:319-321` now scopes panel sync claims correctly: no panel-specific sync protocol, shared native reconcile seams allowed.
   - `docs/10-architecture/comments-panel-architecture.md:45-47,167` now matches the approved design: `CommentStore` is authoritative, native widgets are projections, and convergence is via the canonical store-driven reconcile path.

2. **Composition-root/runtime boundary** — RESOLVED
   - `packages/comments/src/comments-bootstrap.ts:37-51,77-84` now exposes the required Phase A activation seams:
     - `runStartupNativeProjectionReconcile(...)`
     - `wireStoreDrivenNativeProjectionReconcile(...)`
   - These are acceptable Phase A stubs: they reserve the real activation/runtime boundary without prematurely implementing Phase C logic.
   - `packages/comments/src/bridge-integration.ts:28,91-103,164-167` now defines and registers the internal diagnostic command boundary:
     - `COMMENTS_GET_SYNC_STATE_COMMAND`
     - `getCommentSyncStateSnapshot(...)`

3. **Validation contract** — RESOLVED
   - `docs/20-requirements/requirements-comments.md:124-145,333-336,394` now specifies the observable contract needed for Phase B:
     - covered mutation surfaces (`comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`)
     - trim/whitespace semantics
     - duplicate-load precedence
     - stable error vocabulary and precedence
     - delete-time whitespace `commentId` behavior

### Phase A gate assessment

- **Requirements/architecture coherence:** PASS
- **Interfaces cover the scoped requirements:** PASS
- **Proof surfaces defined for each new requirement:** PASS
- **Runtime/public boundary proof can be written in Phase B:** PASS

### Reviewer judgment on the new stubs

The new `comments-bootstrap.ts` and `bridge-integration.ts` additions are appropriate **Phase A stubs**. They create testable composition-root boundaries for:
- startup reconcile after load/prune
- store-driven native projection reconciliation
- sync-state diagnostics

They are design-complete enough for Phase B to write assertion-level failing tests against real activation/command registration boundaries, while still remaining intentionally non-functional.

### Non-blocking concerns

- Existing direct native-widget update calls still exist in several mutation paths outside the new canonical reconcile seam. That is acceptable for Phase A, but Phase B should explicitly prove the new canonical path itself rather than accidentally passing only through legacy imperative widget updates.

### Review doc path

- Updated: `docs/reviews/comments-sync-hardening-phase-a.md`

### Verdict

**Phase A may proceed to the user checkpoint before Phase B.**
