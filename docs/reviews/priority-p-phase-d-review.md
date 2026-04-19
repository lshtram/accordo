## Review — priority-p-comment-store-unification — Phase D

### Scope reviewed
- `packages/browser/src/comment-relay-contract.ts`
- `packages/browser/src/relay-comment-dispatch.ts`
- `packages/browser-extension/src/sw-comment-sync-contract.ts`
- Wiring checks in:
  - `packages/browser/src/relay-lifecycle.ts`
  - `packages/browser/src/browser-comment-relay-handler.ts`

### Evidence collected
- Full suite run: `pnpm test -- --run` (workspace) — **pass**
- Focused files observed in run output:
  - `packages/browser/src/__tests__/comment-relay-contract.test.ts` — **11 passed**
  - `packages/browser/src/__tests__/relay-comment-dispatch.test.ts` — **11 passed**
  - `packages/browser-extension/tests/sw-comment-sync-contract.test.ts` — **11 passed**
- Lint:
  - `packages/browser`: `pnpm lint` — **clean**
  - `packages/browser-extension`: `pnpm lint` — **clean**
- Typecheck:
  - Workspace `pnpm typecheck` — fails (includes unrelated pre-existing failure in `packages/bridge` tests)
  - `packages/browser`: `pnpm typecheck` — **clean**
  - `packages/browser-extension`: `pnpm typecheck` — **FAIL**
    - `src/sw-comment-sync-contract.ts(52,15): TS2352`

---

### Checklist assessment

#### Correctness
- [x] All Phase B tests for this feature pass (33 observed; request said 32, current files execute 11+11+11)
- [x] `normalizeReadResult()` handles canonical, bare array, null/undefined, malformed envelope
- [x] `shapeRelayResponse()` generates fresh requestIds and discriminates success/error
- [x] `dispatchBrowserCommentAction()` routes all 8 actions to expected unified tool names
- [x] `decodeHubThreadsPayload()` supports canonical and legacy formats and filters some invalid entries
- [x] `encodeBrowserCommentAction()` throws `Error("not implemented")` for unknown action

#### Architecture compliance
- [x] No `vscode` import added in newly implemented contract/dispatch files
- [x] Handler functions are not serialized across package boundaries in reviewed changes
- [x] MCP naming usage in reviewed code remains valid (`comment_*` unified tools; internal relay actions exempt)
- [x] Security middleware-first behavior unchanged by this implementation

#### Code quality
- [x] No explicit `any` in reviewed implementation files
- [x] Functions are mostly pure where expected (`normalizeReadResult`, `decodeHubThreadsPayload`, `encodeBrowserCommentAction`)
- [x] Defensive null/undefined handling exists in read/decode normalization
- [ ] No duplicate logic
  - `relay-comment-dispatch.ts` duplicates action→tool mapping logic that already exists in `comment-notifier.ts` and is currently not wired

#### Wiring
- [x] `normalizeReadResult()` is wired in all 3 relay read paths in `relay-lifecycle.ts` (hub, owner, per-window)
- [x] TODO in `browser-comment-relay-handler.ts` clearly marks where `dispatchBrowserCommentAction()` should be wired

---

### PASS
- Feature test coverage for the requested Priority P contract/dispatch files is green.
- Read-envelope normalization parity (`{ threads }`) is wired in shared and per-window relay paths.
- Lint is clean in both affected packages.

### FAIL — must fix before Phase E
- `packages/browser-extension/src/sw-comment-sync-contract.ts:52` — TypeScript unsafe cast triggers TS2352 (`HubCommentThread` → `Record<string, unknown>`).  
  **Fix:** avoid direct structural cast; narrow via `unknown` first or implement a proper type guard helper (`isHubThreadLike`) and use narrowed fields without violating strict type compatibility.

### Additional non-blocking findings
- `packages/browser/src/relay-comment-dispatch.ts` currently has no runtime guard for malformed payload on some branches (e.g. non-object payload can throw before `try/catch`). Consider defensive payload narrowing at function entry.
- `packages/browser/src/comment-relay-contract.ts` `shapeRelayResponse()` accepts arbitrary string `error` values via cast; consider clamping to allowed discriminator union.
- Stale TODO in `packages/browser/src/relay-lifecycle.ts:508` says to replace inline read shaping with `normalizeReadResult()`, but code already does that at line 512.

### Verdict
**FAIL** — fix the typecheck error first, then re-run D review.
