---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Accordo Bridge
# MCP Token Drift 

## Investigation, Root Cause, and Recovery Plan

<!-- notes
Today I’ll summarize the MCP token drift  in Bridge, why it produced 401 errors, and how we are fixing it using the proper review-gated flow. (~20 sec)
-->

---

## Confirmed Runtime Symptom

- Hub endpoint is reachable at `http://localhost:3000/mcp`
- Requests fail with **401 Unauthorized**
- Failing requests used token from auto-generated configs:
  - `opencode.json`
  - `.claude/mcp.json`
  - `.vscode/mcp.json`

### Key signal

**Availability was healthy; auth state was stale.**

<!-- notes
The key distinction is that the endpoint was alive, so this was not a startup or network issue. The failure mode was stale credentials in generated config files. (~25 sec)
-->

---

## Root Cause: Lifecycle Desynchronization

1. **Reconnect path skipped rewrite**
   - `onHubReady(..., isReconnect=true)` bypassed config regeneration
2. **Credential rotation path skipped rewrite**
   - `onCredentialsRotated(...)` updated memory but not files
3. **Hard-restart fallback ordering risk**
   - `onHubReady` could fire before authoritative token state settled

### Net effect

Generated files were correct initially, then drifted stale during lifecycle transitions.

<!-- notes
This is a consistency bug across event paths, not a single bad write. Each path independently looked reasonable, but together they allowed token drift. (~35 sec)
-->

---

## Why It Matters

- MCP clients rely on file-based bearer tokens
- Any token drift creates immediate auth failures for agents
- Users experience intermittent breakage after reconnect/restart
- Confidence impact: “config exists but doesn’t work” is a high-friction failure mode

<!-- notes
Operationally this hurts because the setup appears correct to users. They see generated config and reachable endpoint, yet get unauthorized responses. (~20 sec)
-->

---

## Fix Direction (Agreed)

### Invariant

If active Hub token can change, Bridge must atomically:
- update in-memory state
- persist secret/token
- regenerate MCP config artifacts

### Concretely

- Trigger workspace config sync on **hub ready** (including reconnect)
- Trigger sync on **credential rotation**
- Ensure restart fallback emits ready events with current authoritative token

<!-- notes
The important shift is from opportunistic writes to an explicit lifecycle invariant. This removes class-level drift bugs instead of patching one branch at a time. (~30 sec)
-->

---

## Delivery Flow and Quality Gates

- We executed proper **TDD orchestration flow**
- Phase A architecture/design completed
- Independent reviewer loop run to closure
- Initial fails were remediated with a comprehensive pass plan
- Current gate status: **Phase A PASS**

### Checkpoint discipline

No move to Phase B/C until review blockers are fully cleared.

<!-- notes
We followed strict phase gates and did not bypass review findings. This is important because lifecycle bugs often hide in edge cases and require careful design coherence before implementation. (~30 sec)
-->

---

<!-- _class: section -->

# Next Steps

1. Phase B: write failing lifecycle sync tests
2. Phase C/D: implement minimal fix to green
3. Final review loop: full PASS
4. Produce testing guide + Phase E checkpoint

## Expected outcome

No stale-token 401s after reconnect, rotation, or restart fallback.

<!-- notes
Next step is tests-first implementation. The success metric is simple: all generated MCP configs stay in parity with the active Hub token across lifecycle transitions. (~20 sec)
-->
