---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
header: "Accordo Security"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Browser Relay Auth
## Phase 1 Done · Phase 2 Gap

*Accordo IDE · April 2026*

<!-- notes
Opening. The auth system that secures the browser relay — what Phase 1 hardened and what's still broken. 30 seconds.
-->

---

# The Three Actors

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2em;text-align:center;margin-top:2em">
<div>

## 🧩
**VS Code Extension**
Owns the relay.
Generates the token.

</div>
<div>

## ⚡
**Relay Server**
`ws://127.0.0.1:40111`
Validates token in URL.

</div>
<div>

## 🌐
**Chrome Extension**
Connects as client.
Must present the token.

</div>
</div>

<!-- notes
Three actors. VS Code is the authority — it generates and stores the token. The relay server is the gatekeeper. Chrome is the client that must prove it knows the token. The gap is that Chrome currently can't discover what that token is.
-->

---

# Phase 1 — What We Hardened ✅

<div style="display:grid;grid-template-columns:1fr 1fr;gap:3em;margin-top:1em">
<div>

### Before
- Hardcoded `"accordo-local-dev-token"`
- Two inconsistent auth code paths
- No timing-safe comparison
- Token stored in plaintext `globalState`

</div>
<div>

### After
- `crypto.randomUUID()` — 128-bit random
- Single `isAuthorizedToken()` gate
- `timingSafeEqual` — no timing leaks
- VS Code `SecretStorage` (OS keychain)

</div>
</div>

<!-- notes
Phase 1 was entirely about the VS Code side. We replaced a hardcoded string with a random UUID, unified two separate auth code paths into one function, added timing-safe comparison, and moved storage to the OS keychain. Done and committed.
-->

---

<!-- _class: invert -->

# The Gap

> Chrome still sends `"accordo-local-dev-token"`.
>
> The relay compares it against `"630ac12d-..."` → **false**.
>
> Connection rejected: **1008 Policy Violation**.

*`packages/browser-extension/src/relay-bridge.ts` — line 5*

<!-- notes
Here's the gap in one sentence. Chrome hardcodes the old dev token. The relay now expects a random UUID. They don't match. Chrome is locked out. This was intentional — Phase 1 accepted the breakage, Phase 2 is the fix.
-->

---

# Why Chrome Can't Self-Heal

```
Chrome Extension sandbox:
  ❌ No filesystem access  → can't read ~/.accordo/shared-relay.json
  ❌ No VS Code API        → can't call SecretStorage
  ❌ No Node.js runtime    → can't call crypto module

Chrome Extension CAN:
  ✅ Launch a Native Messaging Host (trusted local binary)
  ✅ Exchange JSON messages with it
```

> The only bridge out of the Chrome sandbox is **Native Messaging**.

<!-- notes
The constraint is the Chrome extension sandbox. It literally cannot read files or call VS Code APIs. The only escape hatch Chrome provides is Native Messaging — a protocol where the extension launches a trusted local helper process and exchanges JSON with it. That helper can read the disk. That's Phase 2.
-->

---

# Phase 2 — The Fix

<div style="display:grid;grid-template-columns:1fr 1fr;gap:3em;margin-top:1em">
<div>

### Native Messaging Host
Small Node.js helper registered with Chrome.

1. Chrome launches it on startup
2. Host reads `~/.accordo/shared-relay.json`
3. Returns `{ "token": "630ac12d-..." }`
4. Chrome uses it for WebSocket connection

</div>
<div>

### Token Flow
```
VS Code
  → writes shared-relay.json (0600)

Chrome starts
  → launches NM host
  → host reads file
  → returns token
  → Chrome connects ✅
```

</div>
</div>

<!-- notes
Phase 2 uses Native Messaging. We register a small Node.js helper that Chrome is allowed to launch. It reads the shared relay JSON file — which it can do because it's a normal process — and passes the token back to Chrome. Chrome then uses that real token to connect. No more hardcoded value.
-->

---

# Is This All Necessary on Localhost?

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5em;margin-top:1.5em;text-align:center">
<div>

### ❌ Not Real
Remote attacker intercepts WebSocket

*Loopback only — unreachable from network*

</div>
<div>

### ✅ Real Threat
Malicious webpage connects to `127.0.0.1:40111`

*Any tab can make WebSocket requests to localhost*

</div>
<div>

### ⚠️ Accepted
Token in URL query string

*Visible in logs — loopback-only accepted risk*

</div>
</div>

<!-- notes
The real threat on localhost is a malicious webpage. Any tab you visit can make WebSocket requests to localhost. Without a real secret token, a compromised page could hijack your browser automation. That's what the random token is protecting against. The hardcoded dev token would be trivially known to anyone who knows Accordo is installed. The query-string transport is a known weakness but accepted because no remote party can see the connection.
-->

---

<!-- _class: lead -->

# Summary

**Phase 1** ✅ VS Code fully hardened — random token, OS keychain, single auth gate

**Gap** ❌ Chrome locked out — hardcoded token rejected (1008)

**Phase 2** ⏳ Native Messaging Host bridges token discovery

<!-- notes
That's the full picture. Phase 1 is solid. The gap is Chrome-side only. Phase 2 is clearly scoped. Questions welcome.
-->
