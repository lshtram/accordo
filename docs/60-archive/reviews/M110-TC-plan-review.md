# M110-TC Improvement Plan — Plan Review

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Plan under review:** [`docs/50-reviews/M110-TC-improvement-plan.md`](M110-TC-improvement-plan.md)  
**Evaluation basis:** [`docs/reviews/M110-TC-browser-tools-evaluation.md`](../reviews/M110-TC-browser-tools-evaluation.md)  
**Requirements cross-reference:** [`docs/20-requirements/requirements-browser-mcp.md`](../20-requirements/requirements-browser-mcp.md)

---

## Overall Verdict: **REVISE**

The plan is structurally sound and correctly identifies the highest-leverage gaps. The sequencing logic and effort tags are broadly credible. However, two issues require correction before approval:

1. **The Security 0→3 path relies on an unvalidated scoring assumption.** The plan's I-score math projects I: 0→1→2→3 across three sequential sub-items (I2, I1, I3), but the evaluation rubric scores security as a *category* on a 0–5 scale, not as an accumulation of sub-item credits. Unless the evaluation harness (`B2-EV`) explicitly credits partial security points linearly, this projection may not hold. Additionally, the screenshot-redaction gap (B2-PS-007 deferred while §3.3 adds full viewport/full-page capture) may prevent I1 from being awarded full credit by a reviewer who tests both text and visual PII surfaces.

2. **The H→4 path is incomplete.** §3.2 adds structured errors and retry hints, but never explicitly adds the three minimum-contract error codes that the evaluation flagged as missing (`element-off-screen`, `image-too-large`, `capture-failed`). These are required to satisfy H4 (error taxonomy) at the level needed for H: 3→4.

The remaining findings are detailed across all six review dimensions below.

---

## 1. Completeness

### Gaps addressed by the plan

Cross-referencing the evaluation's §8 "Key unresolved gaps" against plan items:

| Evaluation gap | Plan item | Addressed? |
|---|---|---|
| Visual capture — no viewport/full-page screenshot | §3.3 | ✅ |
| Security/privacy — all 4 items missing | §3.5 | ✅ (I1–I3 explicitly; I4 partially) |
| Cross-navigation diff — snapshot IDs reset | §3.4 | ✅ (identified, deliberately excluded from scoring path — see §7 of plan) |
| Bridge stability — reconnect with no retry hints | §3.2 | ✅ |
| `interactiveOnly` filter broken at shallow depth | §3.1 | ✅ |

All five P1/P2 evaluation gaps are addressed. P4/P5 items (actionability states, form labels, PNG format, readyState) are also present. **No critical gap is missing.**

### Coverage of evaluation items

The plan maps to every evaluation item that moves a score. Items left deferred (D2, D3, D4, F4) have written justifications in §7 ("What We're NOT Doing"). The deferral rationale is credible in each case:

- **D2 (relative geometry):** Agent-computable from bboxes — correct. Server-side helpers are convenience, not capability.
- **D3 (z-order/stacking):** CDP-level complexity with marginal return — correct.
- **F4 (eventability hints):** Niche, no agent demand on record — defensible.
- **Cross-navigation diff (§3.4):** Correctly identified as zero-score-impact; deferred with clear rationale.

**One minor omission:** The evaluation (H4) flags three error codes as missing from the minimum contract: `element-off-screen`, `image-too-large`, and `capture-failed`. The plan's §3.2 addresses H3 (retry hints) and H4 structurally (structured error objects), and MCP-ER-001 mandates structured errors generally. However, no plan item specifically adds these three named codes. MCP-ER-002 lists error codes with `retryable` semantics but omits all three. If the H4 scoring sub-criterion requires all minimum-contract codes, H: 3→4 may not be achievable from §3.2 alone. **See Finding F2.**

---

## 2. Score Math

### Claimed improvements audit

| Plan item | From → To | Claim | Assessment |
|---|---|---|---|
| §3.1 `interactiveOnly` fix | F: 3→4 | +1 | ✅ Credible. Bug is well-diagnosed (depth-before-filter ordering). Fix option A (flat-list mode) is the right call — unambiguously closes the F1 gap. |
| §3.2 Bridge disconnect retry hints | H: 3→4 | +1 | 🟡 Partially credible. Structured errors + retry hints improve H3 and partially H4, but the three missing minimum-contract error codes are not added. Without them, H may remain at 3. Treat as +0.5–1 (uncertain). |
| §3.3 Viewport/full-page screenshot | E: 3→4 | +1 | ✅ Credible. Two ❌ items (E1, E2) become ✅. Fix is well-specified with correct use of `captureVisibleTab()` and CDP `Page.captureScreenshot`. |
| §3.5 I2 Origin policy | I: 0→1 | +1 | ⚠️ Assumption unvalidated. Category score may not increment by exactly 1 per sub-item. |
| §3.5 I1 Text redaction | I: 1→2 | +1 | ⚠️ Same concern. Additionally, screenshot-redaction gap may reduce I1 credit. |
| §3.5 I3 Audit trail | I: 2→3 | +1 | ⚠️ Same concern. |
| §3.7 Actionability states | C: 4→5 | +1 | ✅ Credible. The exact gap (missing `disabled`/`readonly`/`aria-expanded` from a11y tree) maps directly to C2. Combined with §3.10 (form labels, C5), C→5 is achievable. §3.7 alone "consolidates F→4" correctly noted as +0 for F. |
| §3.10 Form label text | Supports C→5 | +0 alone | ✅ Correctly noted as dependent on §3.7. |

**Projected score of 36–37/45 is realistic if and only if:**
1. H reaches 4 (uncertain without missing error codes)
2. I sub-item scoring is linear (unvalidated assumption)

**Worst-case check:** If H stays at 3 and I scoring does not credit partial completion linearly, worst case: 29 + 1 (F) + 2 (I, partial) + 1 (E) + 1 (C) = 34. This passes the basic threshold (≥30, no category below 2) but misses G1 (≥36). The plan's G1 claim is fragile under worst-case scoring. The basic pass claim is robust.

**Total effort of ~10 days** is plausible for the stated scope.

---

## 3. Effort Estimates

### Assessment by item

| Plan item | Estimate | Assessment |
|---|---|---|
| §3.1 `interactiveOnly` fix | 0.5–1d | ✅ Accurate. Single function change in `page-map-traversal.ts`. Option A (flat-list mode) is the simpler choice — 0.5d is achievable. |
| §3.2 Bridge disconnect retry hints | 1d | ✅ Accurate. Structured error shape change + `connection-health` relay action. Two-package touch adds coordination overhead, but 1d is solid. |
| §3.3 Viewport/full-page screenshot | 1.5d | ✅ Reasonable. `mode` parameter extension — `viewport` mode (`captureVisibleTab`) is straightforward. `fullPage` via CDP is slightly harder (relay round-trip, page height coordination), but 1.5d total is defensible. |
| §3.4 Cross-navigation snapshot ID | 1d | ✅ Accurate. Global monotonic counter is a focused change in `snapshot-store.ts`. |
| §3.5 Security package (I1–I3) | 4d | 🟡 Potentially tight for I1 (redaction). B2-PS-005 requires redaction before data leaves core — meaning the policy must be wired through all text-producing tool paths: `get_text_map`, `get_page_map` text content, `get_semantic_graph` form values, `inspect_element` text content. Four separate wiring points for 1.5d is optimistic. Consider 2d for I1; overall I1–I3 closer to 5d. Within normal estimation variance (±25%) — not a blocking concern. |
| §3.5 I4 Retention control | 0.5d | ✅ Accurate. Config key + clear action — straightforward. |
| §3.6 Navigate readyState | 0.5d | ✅ Accurate. Single response field with `DOMContentLoaded` wait. |
| §3.7 Actionability states | 1d | ✅ Accurate. Adding `states` array to `semantic-graph-collector.ts` and `element-inspector.ts`. Well-understood DOM attribute reading. |
| §3.8 PNG format support | 0.5d | ✅ Accurate. Canvas API `toDataURL('image/png')` is trivial; `format` parameter plumbing is the real work. |
| §3.9 Retention increase | 0.25d | ✅ Accurate. Config default change. |
| §3.10 Form labels | 0.5d | ✅ Accurate. `field.labels` lookup + `aria-label`/`aria-labelledby` fallback is within 0.5d. |

**Overall effort estimate confidence: Medium-high.** §3.5/I1 is the one item most likely to slip by 0.5d. All other estimates are within ±20% of plausible. The total 10-day envelope has reasonable margin.

---

## 4. Security Path: 0 → 3

### Proposed path

The plan sequences three independent security sub-items:

1. **I2 — Origin policy** (1.5d): `OriginPolicy` with allow/block lists, checked before any DOM access.
2. **I1 — Text redaction** (1.5d): `RedactionPolicy` with configurable regex; applied pre-MCP-response in `packages/browser/src/security/`.
3. **I3 — Audit trail** (1d): Per-call logging — `timestamp`, `toolName`, `pageId`, `origin`, `action`, `redacted` — to VS Code output channel + optional JSON file.
4. **I4 — Retention control** (0.5d, optional): Configurable snapshot limit + `browser_clear_snapshots` action.

### Is this the right approach?

**Yes, architecturally.** The three items map directly to B2-PS-001..003 (origin policy), B2-PS-004..005 (redaction), and B2-PS-006 (audit trail) — the correct primitives for a system that should score "usable with known limitations" (3/5):

- **I2 (origin policy) first** is correct. It is the most fundamental control — without it, there is no concept of authorized access. VS Code settings storage is correct for user-controlled origin policy in the Accordo architecture.
- **I1 (redaction) second** is correct. Data-plane control; depends on knowing which origins are accessed. B2-PS-005's "redaction before data leaves core" is the key architectural constraint and the plan correctly locates this in `packages/browser/src/security/`.
- **I3 (audit trail) third** is correct sequencing — the audit log needs the origin policy decision (allowed/blocked) and the redaction decision (boolean) to be made first in order to log them accurately.

### Critical gap: fail-closed behavior not mentioned

**B2-ER-008** specifies: "When the redaction engine encounters an error, data is NOT returned (fail-closed)." This is a critical security property — a malformed regex in the policy must return an error, not silently pass through un-redacted data. The plan does not mention B2-ER-008 at all. If an implementer builds I1 without this constraint, the redaction system would fail-open on any regex error, which is a security regression relative to the current state (where no redaction policy exists but there is also no false sense of redaction being active). **See Finding F4.**

### Key risk: screenshot-redaction gap

The evaluation may not award full I1 credit when `capture_region` (and the new viewport/full-page modes from §3.3) returns un-redacted screenshots while text outputs are redacted. B2-PS-007 explicitly defers screenshot redaction, but the plan does not flag this as a scoring risk. A reviewer testing I1 ("Redaction hooks for PII/secrets in text and screenshots") against a surface that now captures full pages will likely note the gap and may award I1 partial credit only (e.g., 0.5 point), potentially capping I at 2 instead of 3.

**Mitigation options (either is sufficient):**
- Option A: Add a `redactionWarning` field to screenshot responses when a `RedactionPolicy` is configured, acknowledging that screenshots are not subject to the active policy. This makes the limitation explicit and auditable.
- Option B: Sequence §3.3 (visual capture) after the security phase is accepted and scored, so the evaluation can be incremental.

Option A is strongly preferred — it is a small addition that honestly represents the system's capability and defers no user-visible features.

### What would it actually take to reach 3/5?

The evaluation's scoring guide: 0=missing, 1=minimal stub/unusable, 2=partial/major gaps, 3=usable with known limitations, 4=strong/minor gaps, 5=production-ready. Category score of 3 does not automatically follow from 3 of 4 sub-items; it reflects whether the overall security posture is "usable":

- With I2 + I1 + I3 all genuinely implemented (not stubs), the surface can block unauthorized origins, redact known PII patterns, and log every tool call — this is meaningfully usable.
- Known limitations: screenshot PII is not redacted; time-based TTL is not implemented.
- This combination is consistent with a 3/5 score.

The path is **plausible** provided: (a) all three items are production-quality not stubs, (b) the fail-closed contract is respected, and (c) the screenshot-redaction gap is surfaced explicitly to evaluators.

---

## 5. Sequence Logic

### Is the ordering optimal?

**Score-per-effort (independent verification):**

| Phase | Effort | Score delta | Score/day |
|---|---|---|---|
| Phase 1 (§3.1 + §3.2) | 1.5d | +2 | 1.33 pts/day |
| Phase 2 (§3.5 I1–I3) | 4d | +3 | 0.75 pts/day |
| Phase 3 (§3.3 screenshot) | 1.5d | +1 | 0.67 pts/day |
| Phase 4 (polish) | 3.25d | +1–2 | 0.31–0.62 pts/day |

The plan correctly identifies Phase 1 as highest efficiency and Phase 4 as lowest. **Sequencing is optimal by score-per-effort.**

### Why security before screenshot is correct

Phase 3 (screenshot, 0.67 pts/day) has a higher efficiency ratio than security Phase 2 (0.75 pts/day) — but security must precede screenshot because:
1. I=0 fails the minimum-per-category gate (any category below 2 fails, regardless of total).
2. Phase 1 alone reaches 31 total but still has I=0 → gate still fails.
3. Only after Phase 2 (I=3) does the score satisfy the basic passing threshold.

The plan correctly captures this in §5 ("Key insight"). **The Phase 2 → Phase 3 ordering is non-negotiable for gate clearance.**

### Minor reorder suggestion within Phase 4

§4a (actionability states, §3.7) and §4b (form labels, §3.10) are jointly required for C→5. §3.7 alone gives "C: 4→4 (consolidates)" — no score improvement unless §3.10 is also done. Implementing §4a without §4b produces a half-done state with zero score benefit. These two items should be treated as an atomic bundle ("C→5 bundle") in the execution plan so implementers don't stop after §4a believing C→5 is done.

---

## 6. Coherence with Requirements

### Alignment with `requirements-browser-mcp.md`

| Plan item | Requirements reference | Alignment |
|---|---|---|
| §3.1 interactiveOnly fix | B2-FI-002 | ✅ Correctly identified as implementation fix |
| §3.2 retry hints | MCP-ER-001..003 | ✅ Requirements fully specify structured error shape and retryable flags |
| §3.3 viewport/fullPage | MCP-VC-001..003 | ✅ Requirements specify `mode` parameter, backward compat, CDP path |
| §3.4 snapshot ID | B2-SV-002, B2-SV-005 | ⚠️ Conflict — see below |
| §3.5 security | B2-PS-001..007 | ✅ Correctly promoted from P3 |
| §3.6 readyState | MCP-NAV-001 | ✅ Fully specified |
| §3.7 actionability | MCP-A11Y-001 | ✅ Fully specified with 8 named states |
| §3.8 PNG format | MCP-VC-004 | ✅ |
| §3.10 form labels | B2-SG-005 | ✅ Correctly identified as compliance fix |

### Conflicts and tensions

**Conflict 1 — §3.4 snapshot ID vs. B2-SV-002 and B2-SV-005.**  
The plan proposes a global monotonic counter (`{tabId}:{globalVersion}`) that *never resets on navigation*. B2-SV-002 specifies monotonic increments *within a page session* (reset on navigation); B2-SV-005 explicitly requires reset on navigation. The plan's proposed change contradicts both requirements as written.

The plan notes "Modify B2-SV-002, B2-SV-005" — which is acceptable if requirements are updated — but does not provide the revised acceptance criteria. An implementer reading the plan alongside current requirements would encounter an irreconcilable contradiction. **Revised acceptance criteria must be specified explicitly before implementation begins.** See Finding F3.

**Tension 2 — Phase mapping in requirements doc vs. plan sequence.**  
`requirements-browser-mcp.md` §8 Phase Mapping groups MCP-VC-001..003 (screenshot) and B2-PS-001..003 (security) in the same Phase 2. The plan correctly separates them (security Phase 2, screenshot Phase 3) for gate reasons. This is a minor documentation inconsistency — no functional conflict. The plan's sequence should be treated as authoritative; requirements §8 is informational.

**Tension 3 — I-category requirements source consolidation.**  
The plan notes "consolidate [B2-PS-001..007] into `requirements-browser-mcp.md`." The MCP requirements doc already references these in its §5.1 traceability table (showing "❌ Not implemented (P3)"). The consolidation is partially done. What remains is removing the "P3" deferral tag and promoting them to the active implementation scope. This is housekeeping, not a functional conflict.

---

## 7. Summary of Findings

### Must fix before approval

| # | Finding | Severity | Location in plan |
|---|---|---|---|
| F1 | Security 0→3 path assumes linear per-sub-item scoring. Unvalidated. Screenshot-redaction gap (B2-PS-007 deferred while §3.3 adds full viewport capture) may cap I at 2. Plan must flag this as a scoring risk and propose mitigation (e.g., `redactionWarning` field on screenshot responses). | **High** | §3.5, Phase Gate table |
| F2 | §3.2 (H→4 fix) does not add the three missing minimum-contract error codes (`element-off-screen`, `image-too-large`, `capture-failed`). Without these, H: 3→4 is uncertain. These codes must be added explicitly to the §3.2 fix scope. | **Medium** | §3.2 |

### Should fix before approval

| # | Finding | Severity | Location in plan |
|---|---|---|---|
| F3 | §3.4 snapshot ID change contradicts B2-SV-002 and B2-SV-005 as written. Plan must state revised acceptance criteria (new B2-SV-002: global monotonic; new B2-SV-005: navigation adds `pageId` field, does not reset counter). | **Medium** | §3.4, §8 Requirements Traceability |
| F4 | §3.5/I1 (redaction) does not mention the fail-closed requirement (B2-ER-008). Must be explicitly noted: on redaction engine error, return the error — never return un-redacted data silently. | **Medium** | §3.5/I1 |

### Low-severity observations

| # | Finding | Severity | Location in plan |
|---|---|---|---|
| F5 | Phase 1 gate annotation "❌ (I<2)" is misleading. I=0 is qualitatively different from I=1; the constraint is "no category at 0" (below minimum floor). Reword to "❌ (I=0, below minimum floor)". | **Low** | §5 Phase Gate table |
| F6 | §4a (actionability, §3.7) and §4b (form labels, §3.10) must both be done to achieve C→5. Group as an atomic "C→5 bundle" to prevent a half-done state with no score benefit. | **Low** | §4 Execution Sequence |
| F7 | Requirements doc §8 Phase Mapping is inconsistent with the plan's execution sequence (groups screenshot and security in same phase; plan correctly separates them). Clarify that plan sequence is authoritative. | **Low** | requirements-browser-mcp.md §8 |

---

## 8. Required Actions Before Approval

1. **Extend §3.2 scope:** Add `element-off-screen`, `image-too-large`, and `capture-failed` as error codes to implement alongside structured errors and retry hints. (Closes F2)

2. **Add scoring risk note to §3.5:** State explicitly that the screenshot-redaction gap (B2-PS-007 deferred) may prevent full I1 credit when the evaluator tests both text and visual PII surfaces. Propose mitigation: add a `redactionWarning: "screenshot-redaction-not-implemented"` field to all screenshot responses when a `RedactionPolicy` is configured. (Closes F1)

3. **Add fail-closed note to §3.5/I1:** Explicitly state that the redaction implementation must follow B2-ER-008: return an error on redaction engine failure; never return un-redacted data on policy-processing error. (Closes F4)

4. **Add revised acceptance criteria for §3.4:** Replace the "Modify B2-SV-002, B2-SV-005" note with the specific new acceptance criteria: (a) B2-SV-002 new: version increments globally within tab session, never resets on navigation; (b) B2-SV-005 new: navigation does not reset version counter but MUST add a `pageId` field change to signal navigation to diff consumers. (Closes F3)

---

*Review written by Reviewer agent. No source code, test files, or plan documents were modified.*
