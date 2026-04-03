# Agent & Dev-Process Improvement Plan

**Last updated:** 2026-03-31

## Purpose

Implement all Tier 1/2/3 improvements for agent definitions, `dev-process.md`, and skill governance so the system is:

- coherent (no contradictory rules),
- maintainability-first (modular, swappable components),
- and token-efficient (minimal mandatory verbosity/skill overhead).

---

## Status Summary

| Workstream | Items | Status |
|---|---|---|
| A — Resolve contradictions | A1, A2 | ✅ DONE |
| B — Skill reliability | B1 | ✅ DONE |
| B — Trigger-based skills | B2 | ✅ DONE |
| C — Remove duplicate checks | C1 | ✅ DONE |
| D — Modularity enforcement | D1, D2 | ✅ DONE |
| E — Token optimization | E1, E3 | ✅ DONE |
| E — Agent file normalization | E2 | ⬜ NOT DONE — deferred (low priority) |
| F — Skill governance | F1, F2 | ✅ DONE |
| G — External-system-inspired improvements | G1–G5 | ✅ DONE |

---

## Success Criteria

1. No policy contradictions across `dev-process.md` and agent files.
2. All referenced skills are valid and loadable by exact identifier.
3. Reduced token/tool overhead per task without weakening quality gates.
4. Modularity requirements become measurable and reviewable.
5. Clear separation of responsibilities between Developer preflight and Reviewer gate.

---

## Scope of Files

### Core process/rules
- `~/.config/opencode/dev-process.md`
- `~/.config/opencode/AGENTS.md`
- `~/.config/opencode/project-setup-guide.md`

### Agent definitions
- `~/.config/opencode/agents/project-manager.md`
- `~/.config/opencode/agents/architect.md`
- `~/.config/opencode/agents/test-builder.md`
- `~/.config/opencode/agents/developer.md`
- `~/.config/opencode/agents/reviewer.md`
- `~/.config/opencode/agents/debugger.md`
- `~/.config/opencode/agents/debugger-hard.md`
- `~/.config/opencode/agents/fast.md`

### Skill governance
- `~/.config/opencode/agent-skill-manifest.md`
- `~/.config/opencode/skill-evaluation-protocol.md`
- `~/.config/opencode/skills-installed-map.md` (validation/reference only if generated)

---

## Workstreams and Required Changes

## Workstream A — Resolve Internal Contradictions (Tier 1) ✅ DONE

### A1. Unify batching vs module/commit rules in `dev-process.md` ✅

**Completed 2026-03-31.** `dev-process.md` rewritten:
- Replaced "one module at a time" with one phase-state at a time per batch.
- Phase order strict: A → B → B2 → C → D → D2 → D3 → E → F.
- Commit policy clarified: default per-module, batch only when tightly coupled.
- Dedicated "Batching Rules" section added.

### A2. Align `project-manager.md` with corrected batching semantics ✅

**Completed 2026-03-31.** `project-manager.md` updated:
- Batching section added with explicit constraint (all modules same phase).
- Checkpoint rule: batch modules presented together at user checkpoints.

---

## Workstream B — Skill Reliability + Minimal Skill Baseline (Tier 1 + Tier 3)

### B1. Fix skill identifier mismatches ✅ DONE

**Completed 2026-03-31.** Full audit of all agent files confirms:
- All agent files (`project-manager.md`, `architect.md`, `fast.md`) already reference `pi-planning-with-files` correctly.
- `agent-skill-manifest.md` uses the correct `pi-planning-with-files` identifier.
- `skills-installed-map.md` annotated to note the SKILL.md `name:` field is `pi-planning-with-files` (directory is `planning-with-files`).
- No stale references found in any active agent file.

### B2. Replace "mandatory broad skill packs" with trigger-based usage ✅

**Completed 2026-03-31.** All three agents updated:

**Reviewer (`agents/reviewer.md`):**
- Default D2 start: `code-reviewer` only.
- Conditional triggers table added for `dependency-auditor`, `semgrep`, `codeql`, `differential-review`, `property-based-testing`, `security-reviewer`.

**Developer (`agents/developer.md`):**
- Default pre-handoff: tests + lint + typecheck.
- Conditional triggers table added for `dependency-auditor`, `semgrep`, `property-based-testing`.
- Explicit "do not run reviewer-equivalent deep scans".

**Debugger / Debugger-hard:** No changes needed — already symptom-based.

---

## Workstream C — Remove Duplicate Checking Loops (Tier 1 + Tier 3) ✅ DONE

### C1. Define explicit boundaries: Developer preflight vs Reviewer gate ✅

**Completed 2026-03-31.** Changes across three files:

- **`dev-process.md`:** Phase D explicitly marked "lightweight self-check", developer "does NOT run deep reviews". Phase D2 is the independent deep review with full 10-item checklist.
- **`developer.md`:** Added "Phase D is a lightweight self-check. Do NOT run deep reviews — that is Phase D2 (reviewer's job)."
- **`reviewer.md`:** Phase D2 checklist expanded to 10 items (was missing architectural constraints, runtime exposure, modularity, replaceability).

---

## Workstream D — Make Modularity Enforceable (Tier 2) ✅ DONE

### D1. Add measurable modularity constraints ✅

**Completed 2026-03-31.**
- `dev-process.md` D2 checklist items 9-10: modularity thresholds and replaceability checks.
- `project-setup-guide.md` section 4.6: modularity constraints template for `coding-guidelines.md`.

### D2. Add "replaceability checks" in D2 ✅

**Completed 2026-03-31.**
- `dev-process.md` D2 item 10: composable components, adapter swap, no global mutable state.
- `reviewer.md` item 10: same checks replicated.

---

## Workstream E — Token/Verbosity Optimization Without Quality Loss (Tier 3)

### E1. Compress `dev-process.md` prose ✅

**Completed 2026-03-31.** Full rewrite:
- ASCII box diagram removed (~800 tokens saved).
- Phase summary table added at top.
- Actor labels on every step group.
- Quick Reference table replaces Section 3 prose.
- Estimated ~2,150–2,350 tokens saved (15-18% of original file).

### E2. Normalize agent file structure ⬜ NOT DONE — deferred

#### Target structure per agent
1. Mission
2. Do
3. Don't
4. Escalation triggers
5. Output contract

#### Goal
- Remove repeated universal rules duplicated across many agent files.

#### Note
Low priority — most agent files are already close to this structure after the other changes. Deferring until a natural refactor opportunity.

### E3. Strengthen `fast.md` maintainability floor ✅

**Completed 2026-03-31** (prior session). `fast.md` already has:
- Non-trivial changes require tests + lint + typecheck.
- Architecture boundary changes require architect consultation.

---

## Workstream F — Skill Governance Operationalization (Tier 2 + Tier 3) ✅ DONE

### F1. Enforce threshold policy in `skill-evaluation-protocol.md` ✅

**Completed 2026-03-31.** `skill-evaluation-protocol.md` already contains the Threshold Enforcement Policy section with:
- Demotion rule: default → conditional after two consecutive failed evaluation windows.
- Immediate disable: tooling incompatibility triggers instant disable for all agents.
- Quarterly pruning: ≥2 quarters below threshold or >25% token overhead without quality gain → removal candidate.
- Reinstatement: one successful evaluation window after fix → may restore to default.

### F2. Update `agent-skill-manifest.md` ✅

**Completed 2026-03-31.** Full rewrite of `agent-skill-manifest.md`:
- Removed stale priority columns (P0/P1/P2) — replaced with `default`/`conditional`/`disabled` classification.
- Every agent section now cites its source-of-truth agent file.
- All contradictions resolved:
  - `semgrep` for reviewer: changed from `default` → `conditional` (matching `reviewer.md`).
  - `dependency-auditor` for developer: changed from `default` → `conditional` (matching `developer.md`).
  - `code-reviewer` for developer: removed (developer does not do deep reviews — that's D2's job).
  - `observability-designer` for developer: removed (not referenced in `developer.md`).
  - `incident-commander` and `observability-designer` for debugger/debugger-hard: changed from `default` → `conditional` (matching symptom-triggered approach in agent files).
  - `skill-tester` for test-builder: kept as `default` (matches `test-builder.md` proactive usage).
- Added conditional trigger descriptions for every conditional skill.
- Added maintenance rules section linking to threshold enforcement policy.

---

## Additional Changes (not in original plan)

### Review timing bug fix ✅

**Discovered and fixed 2026-03-31.** Both `project-manager.md` and `reviewer.md` said the test review happens "After Phase B2" when it should happen "After Phase B" (before the user sees the tests in B2). Fixed in:
- `dev-process.md` — Phase B step 8, Phase summary table
- `project-manager.md` — review loop section
- `reviewer.md` — Review Point 2 heading
- `AGENTS.md` (global) — reviewer phases column

### D3 template rewrite ✅

**Completed 2026-03-31.** `dev-process.md` Phase D3 rewritten with two mandatory sections:
1. Agent-automated (unit tests + static analysis + deployed E2E)
2. User journey (plain-language, from the UI)

Deployed E2E is mandatory. `project-manager.md` D3 section replaced with reference to `dev-process.md`.

### Resume protocol ✅

**Completed 2026-03-31.** Added "Resuming Mid-Module" section to `dev-process.md` — 6-step protocol for agents joining a module already in progress.

---

## Workstream G — External-System-Inspired Improvements ✅ DONE

Researched Superpowers (91K+ stars), SupaConductor, and the Most-Capable-Agent system prompt. Selected 5 improvements from 7 proposals (user chose #1, #2, #3, #4, #7; declined #5 model routing and #6 status check protocol).

### G1. Requirements clarification step in Phase A ✅

**Completed 2026-03-31.** Inspired by Superpowers' Socratic brainstorming step.
- `dev-process.md`: Added "Architect clarifies requirements (step 0)" — checks measurability, error scenarios, integration boundaries, contradictions. Max one exchange, then document assumption and proceed.
- `architect.md`: Added "Requirements clarification (before design)" section with the same checklist.
- Quick Reference table: rule #11 added.

### G2. Decision log (ADR-lite) ✅

**Completed 2026-03-31.** Inspired by SupaConductor's Board of Directors + Most-Capable's filesystem-first approach.
- `project-setup-guide.md`: Added `docs/decisions.md` as required file. Added section 6 with ADR-lite template (DEC-NNN format: date, module, context, decision, alternatives, consequences).
- `architect.md`: Added step 6 "Record decisions" — architect logs non-obvious design choices to `docs/decisions.md`.
- `reviewer.md`: Review Point 1 feasibility check includes verifying decisions are recorded.
- Validation checklist updated to include `docs/decisions.md`.

### G3. Anti-stall rules ✅

**Completed 2026-03-31.** Inspired by Most-Capable's Momentum Engine.
- `dev-process.md`: Added "Anti-Stall Rules" section with 4 rules:
  1. Decompose on block (never retry same approach 3x)
  2. Guardrail on repeated failure (add preventive check + pattern entry)
  3. Never end empty-handed (minimum output: tried/failed/question)
  4. Escalate early (outside expertise → appropriate agent)
- Quick Reference table: rules #12, #13 added.

### G4. Auto-compound / ratchet in Phase F ✅

**Completed 2026-03-31.** Inspired by Most-Capable's background compounding loops.
- `dev-process.md`: Added "Ratchet — reusable artifacts" subsection to Phase F (steps 12-14):
  - Every module produces ≥1 reusable artifact
  - Failures become test cases/patterns/guards
  - PM suggests compound/retrospective after F
- `project-manager.md`: Added "Ratchet (mandatory)" subsection to Phase F with same 3 rules.
- Quick Reference table: rule #14 added.

### G5. Plan feasibility in Phase A review ✅

**Completed 2026-03-31.** Inspired by SupaConductor's evaluate-loop pattern.
- `dev-process.md`: Phase A step 7 expanded — reviewer checks both **correctness** and **feasibility** (scope realistic, dependencies available, no blocked-path risks).
- `reviewer.md`: Review Point 1 expanded from one-liner to structured correctness + feasibility checklist.

### Declined proposals

- **#5 Model routing guidance** (Medium priority) — declined by user. Rationale: model assignments are already in agent file frontmatter and change frequently.
- **#6 Status check protocol** (Medium priority) — declined by user. Rationale: PM already reads project state at session start per existing instructions.

---

## Rollout Sequence

1. **Phase 1:** Contradictions + skill-name fixes (A + B1) — ✅ Done
2. **Phase 2:** Skill policy refactor + dedup boundaries (B2 + C) — ✅ Done
3. **Phase 3:** Modularity metrics/checklists (D) — ✅ Done
4. **Phase 4:** Verbosity/token optimization (E) — ✅ E1+E3 done, ⬜ E2 deferred
5. **Phase 5:** Governance + manifest alignment (F) — ✅ Done
6. **Phase 6:** External-system-inspired improvements (G) — ✅ Done

---

## Validation Checklist (Post-Implementation)

1. **Consistency audit** ✅
   - No contradictory directives for batching/module/commit flow.
   - Review timing aligned across all files (after A, after B, after D).
2. **Skill resolution audit** ✅
   - Every referenced skill identifier exists and loads. All agent files use correct `pi-planning-with-files` identifier.
3. **Process simulation** ⬜
   - Dry-run one module through A→F; no ambiguous instructions at gates.
4. **Efficiency comparison** ⬜
   - Compare before/after tool calls and tokens on equivalent task sample.
5. **Maintainability verification** ✅
   - D2 checklist now includes measurable modularity constraints (items 9-10).

---

## Remaining Work

| Item | Priority | Effort | Blocked by |
|---|---|---|---|
| E2 — Agent file normalization | Low | Medium | Nothing |
| Validation #3 — Process simulation | Medium | Medium | Next TDD module |
| Validation #4 — Token comparison | Low | Small | Next TDD module |

This plan can be deleted once all remaining items are resolved or explicitly abandoned.
