# Security Review — Browser Relay Authentication (Accordo IDE)

Date: 2026-04-14  
Scope: `packages/browser` + `packages/browser-extension` relay auth and pairing design (commits `d91368f`, `e08a011`)

## Executive Summary

The identified flaw is **real**: authentication is currently one-way (client → relay), and the extension cannot verify relay identity. On loopback this is still exploitable by local processes, especially with a fixed public port (`127.0.0.1:40111`).

However, the highest-risk issue is broader than relay identity:

- `/pair/code` and `/pair/confirm` are callable from **any local process** (empty `Origin` allowed), so a local process can self-issue + redeem a code and obtain the relay token without user involvement.
- The pairing origin check allows **any** `chrome-extension://...` origin (not pinned to Accordo extension ID).

Given extension permissions (`debugger`, `scripting`, `<all_urls>`), any token compromise becomes high impact.

---

## Findings by Requested Review Point

## 1) Threat model correctness

### Finding 1.1 — Unidirectional auth flaw is exploitable
- **Classification:** **Real risk**
- **Attack scenario:** Malicious local process binds `127.0.0.1:40111` before VS Code starts, extension pairs to it, then trusts attacker relay. Or attacker races/impersonates during reconnect windows.
- **Recommendation:** **Fix** — add relay identity verification and harden pairing channel (details below).

### Finding 1.2 — Loopback-only does not eliminate hostile-local threat
- **Classification:** **Theoretical-to-real risk** (depends on user endpoint hygiene)
- **Attack scenario:** Same-user malware/dev tool/plugin abuses localhost APIs; loopback boundary is not a trust boundary against local code.
- **Recommendation:** **Accept + mitigate** — treat local untrusted processes as in-scope for this component because capabilities are unusually sensitive.

---

## 2) Phase 1 auth (token on WebSocket)

### Finding 2.1 — Token gate provides meaningful access control
- **Classification:** **Real security value** (not sufficient alone)
- **Attack scenario prevented:** Blind unauthenticated connections to `/hub` or `/chrome` are rejected (1008).
- **Recommendation:** **Accept-as-is** (keep token gate).

### Finding 2.2 — `timingSafeEqual` use is acceptable but low practical value here
- **Classification:** **Not a risk**
- **Attack scenario:** Timing side-channel over loopback WS query token is low signal and non-primary.
- **Recommendation:** **Accept-as-is**.

### Finding 2.3 — SecretStorage + discovery file split is reasonable, but plaintext relay token on disk remains sensitive
- **Classification:** **Theoretical risk** in single-user model; **real risk** if multi-user/misconfigured perms
- **Attack scenario:** Another principal reads `~/.accordo/shared-relay.json` and reuses token.
- **Recommendation:** **Monitor + tighten** (keep `0600`/`0700`, verify existing dir perms on startup, consider token rotation per owner session).

---

## 3) Phase 2 pairing flow

### Finding 3.1 — Origin check blocks webpage JS CSRF/fetch from normal web origins
- **Classification:** **Not a risk** (for web-origin callers)
- **Attack scenario prevented:** `https://evil.com` cannot successfully call pairing endpoints.
- **Recommendation:** **Accept-as-is** for web origins.

### Finding 3.2 — Empty-origin allowance lets any local process mint+redeem code
- **Classification:** **Real risk**
- **Attack scenario:** Local process performs `GET /pair/code` then `POST /pair/confirm` directly, obtains token, connects to `/hub`, drives browser extension actions via existing relay path.
- **Recommendation:** **Fix first (highest priority)**
  1. Remove unrestricted empty-origin trust for `/pair/confirm`.
  2. Bind pairing to explicit user gesture and single session state.
  3. Add per-attempt rate limits + failed-attempt lockout.

### Finding 3.3 — `chrome-extension://` origin is not pinned to your extension ID
- **Classification:** **Real risk**
- **Attack scenario:** Another installed extension can call `/pair/confirm` using valid code.
- **Recommendation:** **Fix** — allowlist exact extension origin (`chrome-extension://<your-extension-id>`), reject all other extension IDs.

### Finding 3.4 — Pair code generation uses `Math.random()`
- **Classification:** **Theoretical risk** (can become real with brute-force + no throttling)
- **Attack scenario:** Predictive/brute-force attempts against 8-digit code within TTL.
- **Recommendation:** **Fix** — generate code with CSPRNG (`crypto.randomInt`) and add strict request throttling.

### Finding 3.5 — TTL and one-time consumption are directionally correct
- **Classification:** **Not a risk**
- **Attack scenario prevented:** replay of already-consumed code; stale-code reuse.
- **Recommendation:** **Accept-as-is**, but combine with rate limiting.

### Finding 3.6 — Social engineering remains viable
- **Classification:** **Real risk** (user-mediated)
- **Attack scenario:** User enters attacker-provided code into popup.
- **Recommendation:** **Monitor + UX hardening** — show pairing provenance text in popup ("Only enter codes shown inside VS Code Accordo") and display short relay fingerprint after pairing.

---

## 4) Proposed server identity token fix

### Finding 4.1 — Concept is correct (need relay authentication to extension)
- **Classification:** **Real risk addressed**
- **Attack scenario prevented:** Extension reconnecting to wrong relay after having previously paired to legitimate relay.
- **Recommendation:** **Fix** — implement mutual trust, not one-way trust.

### Finding 4.2 — “Check WS upgrade response headers in extension” is not practical in browser WebSocket API
- **Classification:** **Not a viable approach**
- **Attack scenario:** Browser extension JS cannot reliably inspect handshake headers from `new WebSocket(...)`.
- **Recommendation:** **Do not use header-check approach**.

### Finding 4.3 — Use post-connect challenge/response (or signed hello)
- **Classification:** **Recommended fix**
- **Attack scenario prevented:** Wrong relay cannot prove possession of stored identity secret.
- **Recommendation:** **Fix with protocol step**:
  - On first successful pairing, return `{ relayToken, relayIdentitySecret }`.
  - On each WS connect, relay sends nonce; extension requires HMAC(nonce, relayIdentitySecret) (or equivalent signed hello) before processing any action.
  - If verification fails, disconnect + require re-pair.

### Finding 4.4 — Identity token alone does not fix initial rogue pairing
- **Classification:** **Real design gap**
- **Attack scenario:** If first pairing is to attacker, identity token just pins to attacker.
- **Recommendation:** **Fix in tandem** with pairing endpoint hardening (Finding 3.2/3.3).

---

## 5) `chrome.storage.local` token storage

### Finding 5.1 — Appropriate for extension-secret storage in Chrome model
- **Classification:** **Not a risk** (for web pages / other origins)
- **Attack scenario prevented:** web pages cannot directly read extension storage.
- **Recommendation:** **Accept-as-is**.

### Finding 5.2 — Compromised extension context compromises token
- **Classification:** **Theoretical risk** (common extension trust assumption)
- **Attack scenario:** malicious code inside same extension package or supply-chain compromise reads token.
- **Recommendation:** **Monitor** — standard extension hardening, signed release process, minimal third-party deps.

---

## 6) `~/.accordo/shared-relay.json` plaintext token

### Finding 6.1 — Plaintext file is acceptable only under strict local-permission assumptions
- **Classification:** **Theoretical risk** in normal dev setup; **real risk** on shared/misconfigured systems
- **Attack scenario:** another OS user/process with read access reuses token.
- **Recommendation:** **Accept-with-conditions**
  - Keep `~/.accordo` at `0700`, file at `0600` (already implemented).
  - On startup, validate and correct permissions for existing directory/file.
  - Consider omitting token from discovery file and exposing only owner PID/port if architecture permits.

---

## 7) Overall architecture decision (proportionate posture)

### Finding 7.1 — Current design is close, but trust bootstrap is under-hardened for the capability level
- **Classification:** **Real risk**
- **Attack scenario:** local process or rogue extension obtains pairing/token and then gains broad browser control.
- **Recommendation:** **Redesign selected parts, not full rewrite**:
  1. Keep localhost relay + token model.
  2. Harden pairing endpoint access and extension-ID pinning.
  3. Add relay-identity proof on every WS session.
  4. Add rate limiting + attempt telemetry.

### Finding 7.2 — Native Messaging would provide stronger local identity guarantees
- **Classification:** **Theoretical architectural improvement**
- **Attack scenario mitigated:** fake loopback service impersonation becomes harder when trust roots in installed native host registration + OS ACLs.
- **Recommendation:** **Monitor / future option** — not mandatory if above hardening is done, but strongest long-term path.

---

## 8) Additional vulnerabilities / concerns

### Finding 8.1 — No brute-force throttling on `/pair/confirm`
- **Classification:** **Real risk**
- **Attack scenario:** rapid local attempts over 5-minute TTL.
- **Recommendation:** **Fix** — per-source and global rate limits; exponential backoff; temporary lockout.

### Finding 8.2 — No message-level auth/integrity after WS authentication
- **Classification:** **Theoretical risk**
- **Attack scenario:** if token leaked once, attacker can send any relay message; no secondary channel binding.
- **Recommendation:** **Monitor / optional fix** — include session nonce binding and strict action allowlisting on both sides.

### Finding 8.3 — Fixed port improves predictability for attackers
- **Classification:** **Theoretical risk**
- **Attack scenario:** easier pre-bind/race scanning on known port.
- **Recommendation:** **Accept for UX**, but mitigate with identity verification and robust startup ownership checks.

---

## Overall Recommendation

1. **Should server identity token fix be implemented?**  
   **Yes.** Implement relay identity proof (challenge/response) on every WS session.

2. **Are there higher-priority fixes first?**  
   **Yes — two higher-priority fixes should ship first or together:**
   - Restrict pairing endpoints so arbitrary local processes cannot mint+redeem codes.
   - Pin allowed pairing origin to the exact Accordo extension ID (not any `chrome-extension://`).

3. **Keep, redesign, or simplify pairing flow?**  
   **Keep the pairing UX, but redesign security controls around it.** The flow is user-friendly, but must add:
   - strict caller constraints,
   - CSPRNG codes + throttling,
   - relay identity verification,
   - explicit user-facing anti-phishing guidance.

If these are implemented, the localhost architecture can be proportionate for a developer tool while materially reducing practical takeover paths.
