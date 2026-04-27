# Testing Guide — Priority T: Hub Original Registry Rebinding

> **Module:** `packages/bridge` + `packages/hub` (startup/rebind handshake + recovery)
> **What it fixes:** Bridge startup/reload now makes a deterministic reuse-vs-respawn decision from Hub health/registry state, with structured diagnostics.

---

## Section 1 — Automated tests

The following commands were executed and are currently passing.

### 1) Full bridge test suite

```bash
pnpm --filter accordo-bridge test -- --run
```

**What it verifies:**
- Rebind outcome classification (`registry-missing`, `registry-stale`, `registry-unreachable`, `registry-empty`, `registry-loaded`, `bridge-connected`)
- Reusable vs non-reusable decision contract
- Activation branching (reuse existing Hub vs spawn fresh)
- Health-read parsing and failure normalization
- Existing bridge lifecycle behavior remains non-regressed

**Current result:** 36 test files, 518 tests passing.

### 2) Bridge typecheck

```bash
pnpm --filter accordo-bridge exec tsc --noEmit
```

**What it verifies:**
- Strict type safety for rebind/health/activation changes
- No unresolved type errors in bridge package

### 3) Bridge lint

```bash
pnpm --filter accordo-bridge lint
```

**What it verifies:**
- No lint regressions in touched bridge modules/tests

### 4) Full hub test suite

```bash
pnpm --filter accordo-hub test -- --run
```

**What it verifies:**
- `/health` semantics used by the rebind handshake remain stable
- Hub-side behavior does not regress while bridge-side rebind logic changes

**Current result:** 43 test files passing (+ skipped E2E command-gateway tests as expected in suite output).

### 5) Hub typecheck

```bash
pnpm --filter accordo-hub exec tsc --noEmit
```

**What it verifies:**
- Hub package compiles cleanly with no type regressions

---

## Section 2 — User journey tests

These are manual end-to-end checks from a real user perspective in VS Code.

### Scenario 1 — Start a fresh session and confirm tools are available

1. Start the environment using the normal project startup flow.
2. Wait for the extension host to finish activation.
3. Ask the agent for IDE state/orientation.

**Expected result:**
- Bridge connects without manual intervention.
- Tool availability is non-empty shortly after startup.
- No manual "restart again" step is required to recover tools.

### Scenario 2 — Reload window, then verify automatic recovery

1. In VS Code, run **Developer: Reload Window**.
2. After reload completes, ask the agent for state/tool availability.

**Expected result:**
- Session reconnects automatically.
- Tool set is restored (not stuck at disconnected/empty state).
- No manual rebind command is needed.

### Scenario 3 — Simulate stale startup state and confirm fallback behavior

1. Start with a session where the previous process state may be stale (e.g., after abrupt stop/restart).
2. Start a new session normally.

**Expected result:**
- System does not remain stuck in a "reachable but unusable" startup state.
- Bridge recovers to a usable connected state automatically.
- Agent can execute normal tool workflows after startup.

---

## Notes

- Review artifact: `docs/reviews/hub-original-registry-rebinding-D2.md` (PASS).
- Test plan artifact: `docs/test-plan-hub-original-registry-rebinding.md`.
