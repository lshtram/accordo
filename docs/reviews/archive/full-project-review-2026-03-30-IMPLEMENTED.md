# Full Project Code Review — Accordo IDE Monorepo

Date: 2026-03-30

Reviewed packages:
- `packages/bridge-types/src/`
- `packages/hub/src/` (accordo-hub)
- `packages/bridge/src/` (accordo-bridge)
- `packages/editor/src/` (accordo-editor)

Also reviewed:
- `docs/30-development/coding-guidelines.md`
- `docs/10-architecture/architecture.md`

---

## 1) Executive Summary

**Overall health score: 7.6 / 10**

The codebase is generally well-structured, strongly typed, and heavily tested (very strong test volume in all 4 reviewed packages). Architecture boundaries are mostly respected (notably: **no `vscode` imports in Hub**, and Bridge correctly strips handlers before wire registration).

However, there are several important issues:
- one **cross-package contract drift** in reauth payload shape,
- several **guideline compliance gaps** (large files/functions, missing lint in 3/4 packages, a few unsafe casts/non-null assertions),
- and a few **security/reliability hardening gaps**.

Update (2026-03-30, follow-up verification): the previously reported Bridge command-ID mismatch has been re-checked and is **not present** in current code.

---

## 2) Critical Issues (must-fix immediately)

### C1. Reauth payload contract drift across architecture/types/implementation
- `packages/bridge-types/src/constants.ts:97-102` defines `ReauthRequest` as `{ secret, token }`.
- `packages/hub/src/server-reauth.ts:94-97` expects `{ newToken, newSecret }`.
- `packages/bridge/src/hub-health.ts:120` sends `{ newToken, newSecret }`.
- `docs/10-architecture/architecture.md:119` documents `{ "secret": "...", "token": "..." }`.

**Why critical:** This is a protocol contract inconsistency across architecture docs, shared types package, and runtime code. It increases break risk for any non-Bridge client and undermines interface trust.

**Fix:** Standardize on one payload shape repo-wide (recommended: shared-types shape), update hub/bridge runtime, tests, and architecture doc simultaneously.

---

## 3) High Priority Issues (should-fix soon)

### H1. Bridge command contribution IDs — follow-up status
**Status: RESOLVED / PASS in current codebase (verified 2026-03-30).**

- Manifest contributes:
  - `accordo.hub.restart`
  - `accordo.hub.showLog`
  - `accordo.bridge.showStatus`
  (`packages/bridge/package.json:67,71,75`)
- Runtime registers the same IDs:
  - `accordo.hub.restart`
  - `accordo.hub.showLog`
  - `accordo.bridge.showStatus`
  (`packages/bridge/src/extension-composition.ts:301,309,313`)

**Notes:**
- `status-bar.test.ts` executes `accordo.bridge.showStatus` and matches runtime/manifest.
- `requirements-bridge.md` defines the same command IDs, including mixed `hub`/`bridge` namespace usage.
- Mixed namespace appears intentional: Hub lifecycle actions under `accordo.hub.*`, Bridge UI/status action under `accordo.bridge.*`.

### H2. Linting is effectively disabled in 3 major packages
- `packages/hub/package.json:16`
- `packages/bridge/package.json:20`
- `packages/editor/package.json:20`

All three run `echo 'no lint configured yet'`.

**Impact:** guideline rules in `coding-guidelines.md` are not enforceable in CI for most runtime code.

**Fix:** add typed ESLint config and real lint scripts in hub/bridge/editor (same baseline already used in bridge-types).

### H3. Runtime modules exceed project size/complexity limits from coding-guidelines
Examples (non-test code):
- `packages/bridge/src/extension-composition.ts` (520 lines)
- `packages/bridge/src/hub-manager.ts` (391 lines)
- `packages/bridge/src/ws-client.ts` (375 lines)
- `packages/hub/src/bridge-dispatch.ts` (364 lines)
- `packages/hub/src/prompt-engine.ts` (332 lines)
- `packages/bridge/src/state-publisher.ts` (328 lines)
- `packages/editor/src/tools/terminal.ts` (297 lines)

**Impact:** maintainability and reviewability degrade; harder to reason about failure paths.

**Fix:** split by responsibilities (transport/protocol/state/auth/error mapping) and keep each unit within local module scope.

---

## 4) Medium Priority Issues (consider fixing)

### M1. Unsafe cast in Bridge API registration path
- `packages/bridge/src/extension-composition.ts:388`

`tools as unknown as ...ExtensionToolDefinition[]` bypasses type safety at a central boundary.

### M2. Non-null assertions in production without explicit justification comments
- `packages/bridge/src/hub-manager.ts:363` (`this.processState.token!`)
- `packages/bridge/src/extension.ts:192` (`bootstrap!`)

Guidelines require explicit justification on non-null assertions.

### M3. Blocking synchronous file writes in request path
- `packages/hub/src/server.ts:260` writes token file with `fs.writeFileSync` during credential rotation.

Reauth is an HTTP path; synchronous I/O can block event loop under contention.

### M4. `invokeTool` bypasses router controls and ignores timeout param
- `packages/bridge/src/command-router.ts:258-266`

The method accepts `timeout` but does not enforce it; direct handler invocation also bypasses confirmation and in-flight tracking.

### M5. Error swallowing reduces diagnosability in restart path
- `packages/bridge/src/hub-manager.ts:357` (`.catch(() => {})`)

Restart failures can be silently masked.

### M6. Security hardening gap on bridge secret comparison
- `packages/hub/src/security.ts:67-69`

Bearer check uses `timingSafeEqual`; bridge secret check uses plain equality.

### M7. State deep-clone via JSON stringify/parse
- `packages/hub/src/state-cache.ts:64,71`

Can become expensive with larger modality payloads and strips non-JSON values silently.

---

## 5) Low Priority Issues (nice to have)

### L1. Mixed naming conventions for tools/commands
Architecture docs include dotted names in places; implementation uses underscore naming for tool IDs and mixed `accordo.hub.*` vs `accordo.bridge.*` for commands.

### L2. Minor cast density in several modules
There are many `as` casts in runtime code, mostly safe, but reducing them at boundaries would improve type integrity.

### L3. Prompt engine complexity
`prompt-engine.ts` is feature-rich but now difficult to evolve safely; consider modular renderers (voice/comments/tabs/tools) and unit-tested budget policy helpers.

---

## 6) Per-Package Analysis

## `@accordo/bridge-types` (`packages/bridge-types/src`)

**Strengths**
- Clean type-only package with clear barrel export.
- No runtime logic leakage.
- Good docs/comments and deterministic tests.
- Lint + typecheck + tests all clean.

**Issues**
- Participates in reauth contract drift (`ReauthRequest` shape vs runtime).

---

## `accordo-hub` (`packages/hub/src`)

**Strengths**
- Strong modular decomposition (`server-routing`, `server-mcp`, `bridge-*`, `mcp-*`).
- Security middleware ordering is correct in router.
- Hub remains editor-agnostic (no `vscode` imports found).
- Very strong test breadth including E2E and protocol behaviors.

**Issues**
- Reauth payload mismatch (high/critical).
- Large files and complex modules beyond guideline targets.
- Synchronous file write in reauth path.
- Catch-all process handlers keep process alive after uncaught exceptions (`packages/hub/src/index.ts:279-284`), which can mask corrupted state.

---

## `accordo-bridge` (`packages/bridge/src`)

**Strengths**
- Good separation into bootstrap/factory/composition/transport/health/process modules.
- Uses `execFile` (good security posture) for Hub spawn.
- Handler/wire separation is correctly implemented in registry (`handler` never sent).
- Robust tests for WS client, lifecycle manager, registry, composition.

**Issues**
- Command ID mismatch (high).
- Missing lint enforcement.
- Several large/high-complexity files.
- A few unsafe casts and non-null assertions in production paths.
- Restart error swallowing and timeout bypass in `invokeTool` path.

---

## `accordo-editor` (`packages/editor/src`)

**Strengths**
- Strong handler coverage and good modularization by capability.
- Clear argument validation in many handlers.
- Solid test suite and typecheck pass.

**Issues**
- Missing lint enforcement.
- Some larger files (`terminal.ts`, `layout.ts`, `editor-handlers.ts`) over local style guidance.
- A few casts around VSCode terminal/tab APIs that could be wrapped behind typed helpers.

---

## 7) Architecture & Constraint Verification

### Verified PASS
- **Hub has zero VSCode imports** in reviewed source tree.
- **Handler serialization rule respected:** Bridge strips handlers and sends `ToolRegistration` only (`packages/bridge/src/extension-registry.ts:97-109`).
- **Security middleware ordering:** router applies origin/bearer/secret checks before protected handlers (`packages/hub/src/server-routing.ts`).

### Verified FAIL / Drift
- **Reauth contract consistency is broken** between architecture doc, shared type, and runtime implementation.

---

## 8) Testing Coverage Review

Coverage appears broad by test count and scenario design:
- Bridge-types: type contract + API surface tests.
- Hub: unit + integration + E2E across transport/auth/session/tool routing/concurrency.
- Bridge: lifecycle, ws behavior, composition, registry, state publishing.
- Editor: handler behavior and schemas.

**Gap:** no quantitative coverage report (line/branch %) was produced in this run; quality is inferred from test breadth and counts.

---

## 9) Verification Command Results

## `packages/bridge-types`
- `pnpm test` ✅
  - 1 file, **10 tests passed**
- `pnpm typecheck` ✅
- `pnpm lint` ✅

## `packages/hub`
- `pnpm test` ✅
  - 18 files, **455 tests passed**
- `pnpm typecheck` ✅
- `pnpm lint` ⚠️ (placeholder script)
  - Output: `no lint configured yet`

## `packages/bridge`
- `pnpm test` ✅
  - 10 files, **387 tests passed**
- `pnpm typecheck` ✅
- `pnpm lint` ⚠️ (placeholder script)
  - Output: `no lint configured yet`

## `packages/editor`
- `pnpm test` ✅
  - 6 files, **276 tests passed**
- `pnpm typecheck` ✅
- `pnpm lint` ⚠️ (placeholder script)
  - Output: `no lint configured yet`

---

## 10) Actionable Recommendations

1. **Fix protocol contract drift first (Critical).**
   - Align reauth payload in shared types + hub + bridge + docs + tests.

2. **(Resolved) Bridge command IDs are aligned.**
   - Keep `package.json contributes.commands`, runtime registration, and tests synchronized if IDs change.

3. **Enable real linting in hub/bridge/editor (High).**
   - Adopt typed ESLint config from coding guidelines and enforce in CI.

4. **Refactor oversized runtime files (High).**
   - Prioritize `extension-composition.ts`, `hub-manager.ts`, `ws-client.ts`, `bridge-dispatch.ts`, `prompt-engine.ts`.

5. **Remove unsafe casts/non-null assertions in production hotspots (Medium).**
   - Especially central boundary points and lifecycle paths.

6. **Harden runtime reliability/security (Medium).**
   - Avoid synchronous I/O in request handlers.
   - Replace plain secret equality with constant-time comparison.
   - Avoid swallowing restart errors silently.

7. **Add coverage reporting (Medium).**
   - Keep existing strong tests, but add line/branch thresholds to monitor regression.
