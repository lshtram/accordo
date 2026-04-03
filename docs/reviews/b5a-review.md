## Review — b5a — Phase D2

### Scope
- `packages/browser-extension/src/relay-actions.ts`
- `packages/browser-extension/src/relay-definitions.ts`
- `packages/browser-extension/src/relay-forwarder.ts`
- `packages/browser-extension/src/relay-handlers.ts`

### Evidence run
- ✅ Tests: `pnpm --filter browser-extension test`
  - Result: **33 files, 764 tests passed, 0 failed**
- ✅ Type check: `pnpm --filter browser-extension exec tsc --noEmit`
  - Result: **clean (0 errors)**
- ⚠️ Lint: `pnpm --filter browser-extension lint`
  - Command currently targets only `src/content/semantic-graph-*.ts`, so it does **not** validate the reviewed `relay-*.ts` files.
- ⚠️ Direct eslint on reviewed files reports they are ignored by current config (`File ignored because no matching configuration was supplied`).

### PASS
- Import-chain stability verified:
  - `service-worker.ts` still imports from `./relay-actions.js` exactly as required.
  - `relay-bridge.ts` still imports `RelayActionRequest/RelayActionResponse` from `./relay-actions.js` exactly as required.
- No `TODO`/`FIXME` found in reviewed `relay-*.ts` files.
- No `console.log` found in reviewed `relay-*.ts` files.
- No `vscode` imports in browser-extension sources.
- No explicit `any` found in reviewed `relay-*.ts` files.
- Existing tests reference requirement IDs across relay/snapshot/multi-tab coverage (e.g. BR-F-119, B2-CTX-001, B2-SV-*), indicating requirement traceability for the touched surface.

### FAIL — must fix before Phase E

#### BLOCKER
- `packages/browser-extension/src/relay-handlers.ts` (file-level)
  - **Issue:** File is 562 LOC, exceeding coding-guidelines §3.4 target (~200 lines of implementation code per file).
  - **Fix:** Split into focused modules (e.g. `relay-comment-handlers.ts`, `relay-page-handlers.ts`, `relay-capture-handler.ts`, `relay-tab-handlers.ts`) and keep the current barrel import pattern.

- `packages/browser-extension/src/relay-handlers.ts:368`
  - **Issue:** `executeCaptureRegion` is substantially over the ~40-line function guideline.
  - **Fix:** Extract subroutines (resolve bounds, capture tab, crop/retry/compress, envelope shaping) so each function stays small and testable.

- `packages/browser-extension/src/relay-actions.ts:79`
  - **Issue:** `handleRelayAction` dispatch function exceeds ~40-line guideline.
  - **Fix:** Replace switch body with an action→handler map or grouped dispatchers while preserving exhaustive action typing.

- `packages/browser-extension/src/relay-handlers.ts` and `packages/browser-extension/src/relay-forwarder.ts` (multiple lines)
  - **Issue:** Multiple unchecked `as X` casts from untyped payload/response data violate coding-guidelines §3.3 rule: “No unsafe `as X` casts without a type guard function”.
  - **Examples:**
    - `relay-handlers.ts:131, 158, 171, 181, 270, 305, 340, 487, 528, 538`
    - `relay-forwarder.ts:34, 62, 83, 107, 110`
  - **Fix:** Introduce request/response narrowing helpers (e.g. `isStringField`, `readOptionalString`, `isCapturePayload`, `isPageActionResponse`) and remove direct assertion-based reads.

- Lint gate for touched files is not enforceable with current command/config.
  - **Issue:** D2 requires lint clean on new code, but current lint setup does not include `relay-*.ts` (files are ignored).
  - **Fix:** Update package lint config/command to include these files, then rerun lint and attach clean output.

### WARNINGS
- `packages/browser-extension/src/relay-handlers.ts` (capture constants)
  - Repeated literals (`1200`, `500_000`, quality bounds, padding bounds) are domain constants and should be centralized as named constants for maintainability.

### D2 verdict
**FAIL** — BLOCKER items above must be resolved before Phase E.
