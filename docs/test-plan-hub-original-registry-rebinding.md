# Test Plan — hub-original-registry-rebinding

**Module:** Priority T — Hub Original Registry Rebinding hardening
**Phase:** A
**Primary packages:** `packages/bridge`, `packages/hub`

---

## 1. Planned test files

| Package | File | Scope |
|---|---|---|
| `bridge` | `src/__tests__/hub-rebind-probe.test.ts` | Outcome classification + reusable/non-reusable decisions |
| `bridge` | `src/__tests__/hub-manager-activate-rebind.test.ts` | `activate()` consumes `HubRebindProbeReport` and branches on reusable vs non-reusable outcomes |
| `bridge` | `src/__tests__/hub-health-read-health.test.ts` | `/health` body parsing and failure normalization |
| `hub` | `src/__tests__/health-rebind-semantics.test.ts` | `/health` semantics for disconnected+non-zero vs disconnected+zero tool states |

---

## 2. Requirement coverage map

| ID | Requirement | Planned assertions |
|---|---|---|
| LCM-13 | Parse full `/health` JSON payload | 200 status alone is insufficient; parsed `bridge` + `toolCount` drive decision |
| LCM-14 | Deterministic outcome IDs | Every probe path maps to exactly one documented outcome string |
| LCM-15 | Reuse only reusable outcomes | `activate()` consumes `HubRebindProbeReport`; `bridge-connected` and `registry-loaded` reuse, all other outcomes respawn |
| LCM-16 | Structured diagnostics, no secrets | Diagnostic record exposes explicit `projectId`, `registryPath`, `outcome`, optional `pid`/`port`/`bridge`/`toolCount`, and excludes token/secret material |

---

## 3. Edge-case register

| Case | Expected outcome | Notes |
|---|---|---|
| Registry entry absent | `registry-missing` | Spawn path continues |
| Registry PID dead | `registry-stale` | Entry cleanup asserted |
| Registry PID alive, `/health` fails | `registry-unreachable` | No reuse |
| `/health` ok, `bridge:"disconnected"`, `toolCount: 0` | `registry-empty` | Must not reuse |
| `/health` ok, `bridge:"disconnected"`, `toolCount > 0` | `registry-loaded` | Original registry is reusable |
| `/health` ok, `bridge:"connected"` | `bridge-connected` | Reuse existing Hub |

---

## 4. PASS-ELIGIBLE-IN-B register

The following cases can legitimately pass against Phase B stubs because the stub
happens to return exactly what the test asserts — the assertion matches the stub's
return value, not because the stub implements correct behavior. These are regression
guards; they verify the error seams work but cannot distinguish stub from real impl.

| ID | Test file | Requirement | Rationale |
|---|---|---|---|
| HLTH-04 | `rebind-health-http.test.ts` | LCM-13 | Stub returns `null` for 503 (non-2xx); real impl also returns `null` for non-2xx |
| HLTH-11 | `rebind-health-check.test.ts` | LCM-13 | Stub returns `false` for 503; real impl also returns `false` for non-2xx |
| HLTH-12 | `rebind-health-check.test.ts` | LCM-13 | Stub returns `false` for ECONNREFUSED; real impl also returns `false` on connection errors |
| IS-02 | `rebind-is-reusable.test.ts` | LCM-15 | Stub returns `false` for all outcomes; `registry-missing/stale/unreachable/empty → NOT reusable` — assertion `toBe(false)` matches stub |
| LR-02 | `rebind-probe-reusable.test.ts` | LCM-15 | Stub returns `reusable: false`; `registry-empty/missing → reusable=false` — assertion `toBe(false)` matches stub |
| DIAG-01 | `rebind-probe-diags.test.ts` | LCM-16 | Stub returns report with `projectId` populated from `PROJECT` arg; assertion `toBe(PROJECT)` matches stub |
| DIAG-02 | `rebind-probe-diags.test.ts` | LCM-16 | Stub returns report with `registryPath` populated from `REG_PATH` arg; assertion `toBe(REG_PATH)` matches stub |
| DIAG-06 | `rebind-probe-diags.test.ts` | LCM-16 | Stub returns report without `token`/`secret` keys; `Object.keys` check passes |
| A-01 | `rebind-activate.test.ts` | LCM-01 | Stub always calls `spawnAndWait`; first-launch path also calls `spawnAndWait` — assertion matches stub |
| A-04 | `rebind-activate.test.ts` | LCM-15 | Stub always calls `spawnAndWait`; `registry-missing → non-reusable → spawn` — assertion matches stub |
| A-05 | `rebind-activate.test.ts` | LCM-15 | Stub always calls `spawnAndWait`; `registry-stale → non-reusable → spawn` — assertion matches stub |
| A-06 | `rebind-activate.test.ts` | LCM-15 | Stub always calls `spawnAndWait`; `registry-empty → non-reusable → spawn` — assertion matches stub |
| A-07 | `rebind-activate.test.ts` | LCM-15 | Stub always calls `spawnAndWait`; `registry-unreachable → non-reusable → spawn` — assertion matches stub |
| A-08 | `rebind-activate.test.ts` | LCM-15 | Stub skips `probeExistingHub` when `autoStart=false`; assertion `not.toHaveBeenCalled()` matches stub |
| A-10 | `rebind-activate.test.ts` | LCM-01 | Stub applies stored credentials to `processState` before probing; assertions on `secret`/`token` match stub |
| LCM-14-01 | `rebind-probe-outcomes.test.ts` | LCM-14 | Stub returns `"registry-missing"` for all paths; `no registry entry → registry-missing` assertion matches stub |
| HS-01 | `health-rebind-semantics.test.ts` | LCM-13 | Real HubServer with no bridge connected returns `bridge: "disconnected"` — uses real server, not stub |
| HS-02 | `health-rebind-semantics.test.ts` | LCM-13 | Real HubServer returns `toolCount` as a number — uses real server |
| HS-03 | `health-rebind-semantics.test.ts` | LCM-13 | Real HubServer `/health` requires no auth — uses real server |
| HS-04 | `health-rebind-semantics.test.ts` | LCM-14 | Real HubServer `/health` includes `protocolVersion` — uses real server |
| HS-05 | `health-rebind-semantics.test.ts` | LCM-13 | Real HubServer `/health` body matches full `HealthResponse` shape — uses real server |
| HS-06 | `health-rebind-semantics.test.ts` | LCM-15 | Real HubServer `/health` returns valid `bridge`+`toolCount` values — uses real server |

### Intentional pass-eligible cases

These tests cannot distinguish stub from real implementation in Phase B:

- **HLTH-04, HLTH-11, HLTH-12**: The null/false return for error paths is semantically correct.
  Stub and real impl agree; tests serve as regression guards for the error seam.
- **IS-02, LR-02**: The `reusable=false` outcomes are deterministic from the return value alone.
  Stub returns `false` (hardcoded) → `toBe(false)` passes on both stub and real impl.
- **DIAG-01, DIAG-02**: `projectId` and `registryPath` are copied from function arguments
  directly into the stub return value — stub and real impl agree identically.
- **DIAG-06**: No `token`/`secret` keys appear in the stub return value — matches stub.
- **A-01, A-04–A-07**: Stub always calls `spawnAndWait`; the spawn-when-reusable path also
  calls `spawnAndWait`. Both stub and real impl call spawn for these outcomes — assertion matches stub.
- **A-08**: `autoStart=false` causes stub to skip `probeExistingHub` entirely — same code path as real impl.
- **A-10**: Stub applies `secretStorage` results to `processState` before probing — same behavior as real impl.
- **LCM-14-01**: Stub returns `"registry-missing"` for every path; the `no registry entry` test
  also expects `"registry-missing"` — exact match, cannot distinguish in Phase B.
- **HS-01..HS-06**: These tests use the real `HubServer` (no mocks) — they verify actual Hub behavior
  against the running server, not against stubs. They are structurally pass-eligible because they
  test the real implementation.

### All other tests — non-pass-eligible

Every other test asserts behavior the stub does NOT provide:
- Stub throws `"not implemented"` → tests assert values → RED at assertion
- Stub `probeHubRebind` returns hardcoded `"registry-missing"` → tests assert other outcomes → RED
- Stub `isReusableHubRebindOutcome` returns `false` for all → `true` assertions → RED
- Stub `readHubHealthWithDeps` returns `null` → `not.toBeNull()` assertions → RED
- Stub `checkHubHealth` returns `false` → `true` assertions → RED
