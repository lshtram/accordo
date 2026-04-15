# Browser Relay Auth Hardening — Requirements (Phase 1)

**Status:** Implemented and committed for Phase 1 auth hardening in `d91368f` on 2026-04-10. Deferred follow-up items are listed in §3.  
**Package:** `accordo-browser` (`packages/browser`)  
**Date:** 2026-04-10  
**Scope:** Harden the existing browser relay auth model. Does NOT include Chrome token discovery or native-messaging redesign (Phase 2).

---

## 1. Context

The browser relay uses a token-based auth model for WebSocket connections. A prior auth assessment identified several gaps in the current implementation. This document defines Phase 1 requirements: hardening the existing model without redesigning the Chrome discovery path.

**Architecture reference:** `docs/10-architecture/shared-browser-relay-architecture.md`  
**Prior art (Hub):** `packages/hub/src/security.ts` — serves as the target pattern for constant-time auth.

---

## 2. Requirements

### AUTH-01: Constant-time token comparison

**Pre-hardening state:** `relay-auth.ts` `isAuthorizedToken()` used `===`. `shared-relay-server.ts` used inline `!==`. Both were vulnerable to timing side-channel.  
**Requirement:** `isAuthorizedToken()` MUST compare tokens in constant time with respect to content. An attacker who can measure response latency MUST NOT be able to determine how many leading bytes of a candidate token match the expected token.  
**Architecture rule:** `relay-auth.ts:isAuthorizedToken()` is the single auth gate for all relay WebSocket connections. No relay server may perform its own inline token comparison.  
**Acceptance criteria:**
- Given two equal-length tokens that differ only in the last byte, `isAuthorizedToken()` takes the same observable time (within noise) as two tokens that differ in the first byte. *(Testable via: implementation review confirming `timingSafeEqual` or equivalent; no requirement to benchmark in CI.)*
- Null, undefined, empty-string, and length-mismatch candidates return `false` without reaching the constant-time path. *(Length is not secret — UUID format is public.)*
- No file in `packages/browser/src/` other than `relay-auth.ts` contains a direct `===` or `!==` comparison between a candidate token and an expected token.

### AUTH-02: Eliminate hardcoded dev token fallback

**Pre-hardening state:** `extension.ts` defined `DEV_RELAY_TOKEN = "accordo-local-dev-token"`, used as fallback when no stored token existed. `relay-bridge.ts` line 6 still uses the same hardcoded value.  
**Requirement:** The VS Code extension MUST always generate a fresh cryptographic token on first activation instead of falling back to a predictable dev token. The `DEV_RELAY_TOKEN` constant MUST be removed from `extension.ts`.  
**Constraint:** The Chrome extension (`relay-bridge.ts`) is OUT OF SCOPE for this module. It will continue to use its hardcoded token until Phase 2 (native-messaging token discovery). Chrome will fail to connect after this change — this is intentional and accepted.  
**Acceptance criteria:**
- No `DEV_RELAY_TOKEN` constant in `extension.ts`.
- `activate()` generates a token via `generateRelayToken()` when no stored token exists.
- Existing stored tokens are preserved (migration path: only first-ever activation changes).
- See AUTH-06 for the fail-closed guardrail that prevents re-introduction.

### AUTH-03: Migrate token storage from globalState to SecretStorage

**Pre-hardening state:** `extension.ts` stored the relay token in `context.globalState`, which is NOT encrypted.  
**Requirement:** The relay token MUST be stored in `context.secrets` (VS Code `SecretStorage` API) which provides OS-level credential encryption.

**Resolution order:**
1. `secrets.get(tokenKey)` succeeds and returns a non-empty string → use it.
2. `secrets.get(tokenKey)` returns `undefined` AND `globalState.get(tokenKey)` returns a non-empty string → migrate: `secrets.store()`, then `globalState.update(key, undefined)`, then return the token.
3. Both return `undefined` or empty → generate a fresh token via `generateRelayToken()`, store in SecretStorage, return it.

**Failure semantics (AUTH-03-ERR):**

| Step | Failure | Behaviour |
|------|---------|-----------|
| 1 — `secrets.get()` throws | SecretStorage backend unavailable (e.g. keyring daemon down on Linux) | **Generate a fresh ephemeral token**, log a warning (`"SecretStorage unavailable — using ephemeral token"`), proceed. Do NOT fall back to globalState for reads — that would silently revert to unencrypted storage. The token lives only in memory for this activation. |
| 2a — `secrets.store()` throws during migration | SecretStorage write failed | Log a warning. **Keep using the globalState token for this activation** (it was already in unencrypted storage — no regression). Do NOT delete from globalState. Retry migration on next activation. |
| 2b — `globalState.update(key, undefined)` throws after successful `secrets.store()` | Cleanup failed | Log a warning. The token now exists in both stores. Next activation will find it in SecretStorage (step 1) and the stale globalState entry is harmless. |
| 3 — `secrets.store()` throws for a fresh token | Cannot persist newly generated token | Log a warning. **Return the fresh token anyway** (ephemeral — lives in memory only). Next activation will generate another fresh token. |

**Invariant:** `resolveRelayToken()` MUST always return a valid non-empty token string. It MUST never throw. It MUST never return a hardcoded/predictable value.

**Acceptance criteria:**
- Token is read from `context.secrets.get(TOKEN_KEY)` as primary source.
- Token is stored via `context.secrets.store(TOKEN_KEY, token)`.
- Migration from globalState to SecretStorage occurs as described in step 2.
- All four failure cases above are handled with warning logs, not exceptions.
- `resolveRelayToken()` never throws — always returns a usable token.

### AUTH-04: Unified auth validation path

**Pre-hardening state:** `BrowserRelayServer` (relay-server.ts) called `isAuthorizedToken()`. `SharedBrowserRelayServer` (shared-relay-server.ts) used inline `!==`. Two different validation paths existed.  
**Requirement:** Both relay servers MUST use the same `isAuthorizedToken()` function from `relay-auth.ts` for token validation.  
**Status:** ✅ Implemented in Phase A — `SharedBrowserRelayServer` now imports and calls `isAuthorizedToken()`.  
**Acceptance criteria:**
- `SharedBrowserRelayServer.start()` calls `isAuthorizedToken(token, this.options.token)` instead of inline comparison.
- No inline token comparison remains in any relay server file.
- A grep-based test confirms no `=== this.options.token` or `!== this.options.token` patterns exist in relay server files.

### AUTH-05: Dedicated auth test coverage

**Pre-hardening state:** `auth-token.test.ts` had 2 basic tests. There were no timing-safety tests, SecretStorage tests, or unified-path tests.  
**Requirement:** The auth module MUST have dedicated tests covering constant-time comparison contract, token generation quality, SecretStorage migration (including all error paths), unified validation, and the fail-closed guardrail.  
**Acceptance criteria:**
- Tests exist for: constant-time comparison contract (AUTH-01), no dev token fallback (AUTH-02), SecretStorage resolution and migration including all four error paths (AUTH-03), unified validation path (AUTH-04), fail-closed guardrail (AUTH-06).
- Tests reference requirement IDs in their names.
- All tests are in `packages/browser/src/__tests__/`.

### AUTH-06: Fail-closed guardrail — no predictable token fallback

**Requirement:** The token resolution path MUST be fail-closed: if all storage backends fail, the system generates a fresh cryptographic token. It MUST never fall back to a hardcoded, empty, or predictable token value.  
**Operator signal:** When SecretStorage is unavailable and an ephemeral token is generated, the extension MUST log a clearly identifiable warning string (e.g. `"[accordo-browser] WARN: SecretStorage unavailable — using ephemeral relay token"`) so operators can detect and remediate the underlying keyring issue.  
**Architecture rule:** No constant string matching the pattern of a token (UUID-like or fixed passphrase) may appear as a fallback value in `extension.ts` or `relay-auth.ts`. This is a permanent constraint — not just "remove the current one" but "never add another."  
**Acceptance criteria:**
- `resolveRelayToken()` never returns a value that was known at compile time.
- If SecretStorage is unavailable, the warning string is logged and the returned token is still cryptographically random.
- A static-analysis test (grep/regex over source) confirms no hardcoded token-like constant exists in `extension.ts` as a fallback.
- The test for AUTH-06 stubs both `secrets.get()` and `secrets.store()` to throw, and verifies the returned token is random and non-empty.

---

## 3. Deferred to Phase 2 / Out of Scope for Phase 1

These items are intentionally deferred. They are acknowledged gaps, but they are NOT addressed in this Phase 1 module:

- **Chrome token discovery via native messaging** — deferred. Chrome extension still hardcodes its token.
- **Query-string token transport** — deferred. WebSocket API limitation; loopback-only mitigates. Documented as accepted risk.
- **Token rotation** — deferred. No mechanism to rotate tokens without restarting.
- **Hub `validateBridgeSecret()` timing safety** — deferred to a separate Hub-scoped hardening module. Gap exists in `hub/security.ts:69`.

---

## 4. Requirement Traceability

| ID | File(s) affected | Current coverage | Implementation status |
|----|-----------------|------------------|-----------------------|
| AUTH-01 | `relay-auth.ts`, `relay-server.ts`, `shared-relay-server.ts` | `relay-auth.test.ts`, `relay-server.test.ts`, `shared-relay-server.test.ts`, `auth-token.test.ts` | ✅ Implemented |
| AUTH-02 | `extension.ts` | `extension-activation.test.ts`, `auth-static.test.ts` | ✅ Implemented |
| AUTH-03 | `extension.ts` | `extension-activation.test.ts` | ✅ Implemented |
| AUTH-04 | `shared-relay-server.ts` | `shared-relay-server.test.ts`, `auth-static.test.ts` (indirect guardrail via source checks for fallback removal remains separate) | ✅ Implemented |
| AUTH-05 | test files only | `auth-token.test.ts`, `relay-auth.test.ts`, `extension-activation.test.ts`, `relay-server.test.ts`, `shared-relay-server.test.ts`, `auth-static.test.ts` | ✅ Implemented for Phase 1 scope |
| AUTH-06 | `extension.ts`, `relay-auth.ts` | `extension-activation.test.ts`, `auth-static.test.ts` | ✅ Implemented |
