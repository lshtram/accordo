# M110-TC Improvement Plan — Second Plan Review

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Plan under review:** [`docs/50-reviews/M110-TC-improvement-plan.md`](../50-reviews/M110-TC-improvement-plan.md) (rev 1)  
**Previous review:** [`docs/50-reviews/M110-TC-plan-review.md`](../50-reviews/M110-TC-plan-review.md)  
**Requirements cross-reference:** [`docs/20-requirements/requirements-browser-mcp.md`](../20-requirements/requirements-browser-mcp.md) (v0.2.0)

---

## Overall Verdict: **PASS**

All four medium/high findings (F1–F4) have been meaningfully resolved. The two low-severity findings (F5, F6) are cleanly closed. The plan is coherent with the updated requirements doc (v0.2.0). Three residual observations below are non-blocking but should be noted before implementation begins.

---

## Finding-by-Finding Assessment

### F1 — I score projection (was: High; now: Resolved)

**Original concern:** The plan assumed linear per-sub-item scoring (I: 0→1→2→3) without validation, and did not flag the screenshot-redaction gap as a scoring risk.

**Revision made:** The plan now projects **I = 2 (conservative) / I = 3 (stretch)** with explicit rationale for each. The scoring rubric (0=missing → 5=production-ready) is reproduced inline. The I-category is correctly framed as a holistic 0–5 judgment, not a sub-item accumulation. The screenshot-redaction gap (B2-PS-007 deferred) is explicitly named as the reason I1 yields only partial credit.

**`redactionWarning` mitigation:** The plan adds `redactionWarning: "screenshots-not-subject-to-redaction-policy"` to all screenshot responses when a `RedactionPolicy` is active (§3.5, §3.3, §8 traceability → MCP-VC-005). This is formalized as a new requirement in requirements-browser-mcp.md v0.2.0 (MCP-VC-005, §4.1). The mitigation is honest: it makes the gap auditable rather than silent, and the plan correctly describes it as *strengthening* rather than *guaranteeing* the stretch I=3 case.

**Assessment:** The projection is now honest and internally consistent. Conservative I=2 is well-supported. Stretch I=3 is properly conditioned on evaluator interpretation. The worst-case analysis in §5 is correct: even at H=3 and I=2, total is 33 — basic threshold still clears.

**Verdict: ✅ Resolved.**

---

### F2 — Error taxonomy completeness (was: Medium; now: Resolved)

**Original concern:** §3.2 added structured errors and retry hints but did not explicitly add the three minimum-contract error codes (`element-off-screen`, `image-too-large`, `capture-failed`) required for H4 → H=4.

**Revision made:** The plan adds a named sub-item **H2-error-taxonomy** to §3.2 with the three codes explicitly listed. The sub-item:
- Identifies that the codes exist in the content script layer (`relay-capture-handler.ts`, tested at `capture-region.test.ts`) and in the `CaptureError` type
- Identifies the gap as relay → MCP handler propagation, not type definition
- Cross-references existing handler-level tests in `page-understanding-tools.test.ts`
- References `CR-F-12` as the originating requirement and MCP-ER-001 as the format requirement

The revised requirements doc (v0.2.0) formalizes this as **MCP-ER-004** (§4.2), with acceptance criteria requiring all five `CaptureError` codes to be returned at the MCP handler level and verified by integration tests. The effort estimate for §3.2 is adjusted from 1d to 1.5d to accommodate this addition.

**Assessment:** The gap is specifically named, the propagation path is correctly diagnosed, existing test coverage is cited, and a new requirement (MCP-ER-004) anchors the implementation contract. H→4 claim is now substantiated.

**One small note:** The plan's §3.2 says "existing tests in `page-understanding-tools.test.ts` already validate these at the handler level" — but MCP-ER-004's acceptance criteria says "Integration tests verify end-to-end propagation," implying new integration tests are needed. These two statements are slightly in tension. Implementers should read MCP-ER-004 as authoritative: the existing unit tests cover the content script layer, but end-to-end handler tests must be added or confirmed. This is a pre-implementation clarification, not a plan gap.

**Verdict: ✅ Resolved.**

---

### F3 — Snapshot ID contradiction with B2-SV-002/005 (was: Medium; now: Resolved)

**Original concern:** The §3.4 proposal (global monotonic counter) directly contradicted B2-SV-002 (reset on navigation) and B2-SV-005 (navigation resets version counter) without providing revised acceptance criteria.

**Revision made:** §3.4 is **dropped entirely**. The struck-through section carries explicit attribution ("Dropped per reviewer finding F3") and a clear rationale:
- B2-SV-002 and B2-SV-005 remain unchanged
- G stays at 4/5 (already strong; cross-nav diff is a nice-to-have with zero score impact)
- The 1d effort is reallocated to higher-priority items
- A "if revisited later" note documents revised acceptance criteria for both requirements, preserving institutional knowledge without committing to the change

The requirements doc v0.2.0 §5.1 confirms: "Cross-nav diff deferred (B2-SV-002/005 unchanged)" and G=4→4 with no remaining gap.

**Assessment:** Clean resolution. The plan is now coherent with the requirements as written. No implementation ambiguity remains.

**Verdict: ✅ Resolved.**

---

### F4 — Fail-closed behavior (B2-ER-008) not scoped (was: Medium; now: Resolved)

**Original concern:** §3.5/I1 did not mention B2-ER-008. A redaction implementation built without this constraint would fail-open on regex errors.

**Revision made:** B2-ER-008 is now explicitly named and quoted in §3.5/I1: *"Fail-closed (B2-ER-008): if redaction engine encounters an error (e.g., malformed regex, processing timeout), the entire response is blocked with `redaction-failed` error — never returned unredacted."* The requirement also appears in:
- The §3.5 scoring analysis: fail-closed behavior is listed as a factor supporting the stretch I=3 case
- The requirements traceability table (§8): B2-ER-008 cited alongside B2-ER-007
- The execution sequence (§4): "§3.5/I1 Text redaction (incl. fail-closed B2-ER-008)"
- The effort estimate: revised from 1.5d to 2d to accommodate fail-closed implementation plus four wiring points

The `redaction-failed` error code is also added to MCP-ER-002's retryable=false list in requirements v0.2.0.

**Assessment:** The fail-closed requirement is unambiguously in scope at every relevant level — plan text, effort estimate, scoring analysis, requirements traceability, and MCP-ER-002 error taxonomy. An implementer cannot miss it.

**Verdict: ✅ Resolved.**

---

### F5 — Phase 1 gate annotation (was: Low; now: Resolved)

The Phase Gate table (§5) now reads "❌ (I=0, below minimum floor)" instead of the misleading "❌ (I<2)." The distinction between I=0 (absolute fail) and I=1 (partial, still below floor) is now explicit.

**Verdict: ✅ Resolved.**

---

### F6 — C→5 bundle not atomic (was: Low; now: Resolved)

Both §3.7 and §3.10 carry "Bundle note (F6)" callouts making the dependency explicit. The execution sequence (§4) consolidates them into a single Phase 4 line: "§3.7 + §3.10 Actionability states + form labels (C→5 bundle), 1.5d." An implementer cannot complete §3.7 alone and miscount the C score.

**Verdict: ✅ Resolved.**

---

## Residual Observations (Non-Blocking)

These do not prevent plan approval but should be noted before implementation kickoff.

### R1 — MCP-ER-004 numbering is non-sequential (Minor)

Requirements v0.2.0 lists MCP-ER-001 (structured errors), MCP-ER-002 (retry hints), **MCP-ER-004** (capture error codes), MCP-ER-003 (connection health). The numbering is non-sequential: MCP-ER-004 appears before MCP-ER-003 in document order. This is cosmetic but will be confusing when referencing requirements in test code. Suggested fix: renumber to MCP-ER-001, MCP-ER-002, MCP-ER-003 (capture codes), MCP-ER-004 (connection health) — or accept the gap. No plan change needed before implementation.

### R2 — §3.3 has a runtime dependency on §3.5/I2 (Minor phase coupling)

The `redactionWarning` field is specified in §3.3 (screenshot modes, Phase 3) and wired through §3.5 logic (security, Phase 2). The effort is "(included in §3.3 effort)" — correctly placed in Phase 3. However, §3.3 cannot be fully integration-tested until the `RedactionPolicy` config type (introduced in §3.5/I2, Phase 2) exists. The plan's Phase 2 → Phase 3 ordering already handles this correctly. This is an implementation sequencing note for the developer, not a plan gap.

### R3 — I4 (retention control) contribution to stretch I=3 is underspecified (Minor)

§3.5 labels I4 as "partial" and lists it as Phase 4 item 4e with note "I: strengthens 3 case." However, the §5 Phase Gate table does not include I4 in Phase 2, and the conservative/stretch I projections do not attribute any increment to I4. If I4 genuinely contributes to stretch I=3, its placement in Phase 4 (after the security phase is scored) risks missing its scoring contribution. If it does not, the "strengthens 3 case" note is imprecise. Developers should treat I4 as pure polish unless the evaluator signals that retention control is required for I=3.

---

## Requirements Document Alignment (v0.2.0)

| Plan section | Requirement added/updated | Alignment |
|---|---|---|
| §3.3 screenshot modes | MCP-VC-001, MCP-VC-002, MCP-VC-003 | ✅ Fully specified with acceptance criteria |
| §3.3 + §3.5 `redactionWarning` | MCP-VC-005 | ✅ Added to §4.1; cross-references B2-PS-007 |
| §3.2 structured errors + retry | MCP-ER-001, MCP-ER-002 | ✅ Fully specified in §4.2 |
| §3.2 capture error taxonomy | MCP-ER-004 | ✅ Added to §4.2; integration test acceptance criterion stated |
| §3.2 connection health | MCP-ER-003 | ✅ Specified in §4.2 |
| §3.6 navigate readyState | MCP-NAV-001 | ✅ Specified in §4.3 |
| §3.7 actionability states | MCP-A11Y-001 | ✅ Specified in §4.4 with 8 named states and DOM source mapping |
| §3.8 PNG format | MCP-VC-004 | ✅ Specified in §4.1 |
| §3.5 security | B2-PS-001..007 (promote from P3) | ✅ §5.1 status updated |
| §3.5 fail-closed | B2-ER-008 | ✅ `redaction-failed` added to MCP-ER-002 retryable=false list |
| ~~§3.4 snapshot ID~~ | ~~B2-SV-002, B2-SV-005~~ | ✅ Dropped; requirements unchanged; §6 traceability reflects no G delta |

Prior low-severity finding **F7** (requirements §8 phase mapping inconsistency) is also resolved: requirements v0.2.0 §8 now correctly separates security (Phase 2) from visual capture (Phase 3).

---

## Score Math Recheck

| Item | From → To | Prior verdict | Current verdict |
|---|---|---|---|
| §3.1 `interactiveOnly` fix | F: 3→4 | ✅ Credible | ✅ Unchanged |
| §3.2 Structured errors + retry + taxonomy | H: 3→4 | 🟡 Uncertain (missing codes) | ✅ Now credible (MCP-ER-004 closes the gap) |
| §3.3 Viewport/full-page screenshot | E: 3→4 | ✅ Credible | ✅ Unchanged |
| §3.5 I2+I1+I3 | I: 0→2 (conservative) | ⚠️ Unvalidated | ✅ Credible at I=2; stretch I=3 properly conditioned |
| §3.7 + §3.10 bundle | C: 4→5 | ✅ Credible | ✅ Unchanged |

**Conservative path:** Phase 1 (31) + Phase 2 I=2 (33) + Phase 3 (34) + Phase 4 C→5 (35) = **35/45.** Passes basic threshold (≥30, no category <2). ✅  
**Stretch path:** I=3 adds 1 point in Phase 2 → total **36/45.** G1 (≥36, all categories ≥3) achievable at stretch. 🟡 Contingent on evaluator interpretation of screenshot gap.  
**Worst case:** H=3 (taxonomy incomplete at integration level), I=2: 29 + 1 + 2 + 1 + 1 = **34/45.** Still passes basic threshold. ✅

---

## Summary

All six findings from the first review are closed. The plan is internally consistent, coherent with requirements-browser-mcp.md v0.2.0, and free of the requirement contradictions and scoring optimism that prompted the initial REVISE verdict. The three residual observations are cosmetic or implementation-level notes — none prevent execution. **The plan is approved to proceed to Phase 1 implementation.**

---

*Review written by Reviewer agent. No source code, test files, or plan documents were modified.*
