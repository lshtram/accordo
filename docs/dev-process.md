# Development Process

**Scope:** How we build every module in any project that adopts this process.  
**Authority:** This document is normative. When the user or task says "TDD", every step here is mandatory with no exceptions and no shortcuts.  
**Reference:** Each project's `AGENTS.md` (for mode selection rules, tooling equivalents) and its own `docs/coding-guidelines.md` (for language-specific style and banned patterns).

> **Tooling note:** This document uses generic placeholders for project-specific tools.
> Each project's `AGENTS.md` section 2.1 must document the concrete equivalents:
> - Test framework (e.g. vitest, pytest, jest)
> - Test command (e.g. `pnpm test`, `pytest`, `npm test`)
> - Type checker (e.g. `tsc --noEmit`, `mypy --strict`, n/a for dynamic languages)
> - Linter (e.g. eslint, ruff, rubocop)
> - Package manager (e.g. pnpm, npm, pip, cargo)

---

## 1. TDD Mode — The Full Cycle

When working in TDD mode, every implementation module goes through these phases **in order**. No skipping. No batching across phases.

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase A — Design, Stubs, and Coherence                         │
│                                                                 │
│  1. Read the requirements for this module from the relevant     │
│     requirements doc (e.g. docs/requirements-<component>.md).   │
│                                                                 │
│  2. Define all public interfaces with typed signatures and      │
│     documentation comments in the project's language style.     │
│                                                                 │
│  2.1 For each external technology boundary used by the module   │
│      (database, embedding provider, object storage, transport), │
│      define/verify a local abstraction (port/interface) and     │
│      document the swap contract: what can change vs what stays  │
│      stable for callers.                                        │
│                                                                 │
│  3. Verify every requirement has a corresponding interface      │
│     element — if one is missing, update the requirements doc    │
│     before proceeding.                                          │
│                                                                 │
│  4. Export stub implementation (empty methods that throw        │
│     "not implemented") so tests can import the module.          │
│                                                                 │
│  5. Verify coherence with the rest of the project:              │
│     — Interfaces are consistent with docs/architecture.md       │
│       (update it if new components or boundaries are added)     │
│     — Requirements are consistent across all requirements docs  │
│     — docs/workplan.md reflects the module being built          │
│     — No duplicate abstractions — reuse existing ones           │
│                                                                 │
│  6. Explain the module to TWO audiences:                        │
│                                                                 │
│     A. Product Manager / Non-Technical Stakeholder:             │
│        - What problem does this module solve?                   │
│        - What does it DO in simple English? (no jargon)         │
│        - What can go wrong and what happens when it does?       │
│        - How will we know when it works correctly?              │
│                                                                 │
│     B. Technical Reviewer:                                      │
│        - What are the key design decisions and why?             │
│          (class vs functions, ownership of types, error         │
│          strategy, integration points)                          │
│        - How does this module connect to the rest of the        │
│          system?                                                │
│        - Are there any requirements gaps found and resolved?    │
│                                                                 │
│  7. Hand off to the project-manager. The project-manager runs   │
│     the reviewer, then holds the user checkpoint.               │
│     STOP. Do not proceed until user approval.                   │
│                                                                 │
│  Deliverable: Compilable interfaces + importable stubs +        │
│               architecture.md updated if needed +               │
│               two-audience explanation.                          │
│               User approval required before Phase B.            │
├─────────────────────────────────────────────────────────────────┤
│  Phase B — Write Failing Tests                                  │
│                                                                 │
│  0. BEFORE writing tests, verify stub implementations exist     │
│     for every module under test. Stubs must:                    │
│       - Be importable (no collection errors at test discovery)  │
│       - Define all public classes, methods, and functions with  │
│         the correct signatures                                  │
│       - Raise "not implemented" errors (or return wrong values) │
│         in every method body — never silently succeed           │
│     This ensures test failures are requirement-level assertion  │
│     failures, not trivial collection errors.                    │
│                                                                 │
│  1. Write test file(s) for the module using the project's test  │
│     framework (see AGENTS.md section 2.1).                      │
│  2. For EVERY requirement in the spec, write at least one       │
│     test. The test name MUST reference the requirement ID       │
│     (e.g. "REQ-01: maintains in-flight counter").               │
│  3. Cover happy path, error cases, and edge cases.              │
│  4. Tests MUST import from the real module (not mocks of it).   │
│  5. Run the tests — they MUST ALL FAIL (red), with one explicit │
│     exception for structural contract tests (see below).        │
│     CRITICAL: "red" means assertion failures or "not            │
│     implemented" errors inside test bodies — NOT collection     │
│     or import errors. If any test fails at collection, fix the  │
│     stub first before calling Phase B done.                     │
│     EXCEPTION — structural contract tests MAY pass on stubs:    │
│       - Tests that verify class/function shape (abstract class, │
│         abstract method names, constructor signature, model      │
│         field existence). These test structural contracts, not  │
│         behavior, and are valid even when behavior is stub-only.│
│       - ALL other tests must fail. If a behavior test passes    │
│         on a stub, the test is wrong — fix it.                  │
│  6. Tests define the complete functional contract.              │
│     If you can't write a test for a requirement, the            │
│     requirement is incomplete — fix it first.                   │
│                                                                 │
│  Deliverable: Comprehensive failing test suite (assertion-level │
│               failures only — zero collection errors).          │
├─────────────────────────────────────────────────────────────────┤
│  Phase B2 — Demonstrate to User                                 │
│                                                                 │
│  1. STOP. Do not write implementation code yet.                 │
│  2. Show the user the test file(s).                             │
│  3. Run the tests and show they all fail (red).                 │
│     GATE: If the run shows ANY collection/import errors, do     │
│     NOT present B2. Fix the stubs and rerun until ALL failures  │
│     are assertion-level (test bodies executed, functions called, │
│     wrong values returned or "not implemented" raised).         │
│     Structural contract tests (shape, fields, signatures)       │
│     are allowed to pass on stubs.                               │
│  4. Walk the user through what each test validates.             │
│  5. Confirm with the user that the test coverage is sufficient. │
│  6. Wait for user acknowledgement before continuing.            │
│                                                                 │
│  Deliverable: User approves the test suite (assertion-level     │
│               failures demonstrated, zero collection errors).   │
├─────────────────────────────────────────────────────────────────┤
│  Phase C — Implement                                            │
│                                                                 │
│  1. Write the implementation code.                              │
│  2. Only write code that makes failing tests pass.              │
│  3. Do not add behaviour that isn't tested.                     │
│  4. Keep the implementation minimal and clean.                  │
│                                                                 │
│  Deliverable: Implementation code.                              │
├─────────────────────────────────────────────────────────────────┤
│  Phase D — Iterate Until Green                                  │
│                                                                 │
│  1. Run the full test suite.                                    │
│  2. Fix any failing tests by correcting the implementation      │
│     (not by weakening the tests).                               │
│  3. If a test is genuinely wrong (testing the wrong thing),     │
│     explain WHY before changing it.                             │
│  4. Repeat until ALL tests pass (green).                        │
│  5. Run linter + type checker — zero errors.                    │
│                                                                 │
│  Deliverable: All tests green, lint clean, types clean.         │
├─────────────────────────────────────────────────────────────────┤
│  Phase D2 — Code Review                                         │
│                                                                 │
│  1. Run the full mandatory checklist from                       │
│     docs/coding-guidelines.md (Code Review Checklist section).  │
│  2. Run linter: zero warnings on new code, zero errors total.   │
│  3. Run type checker: zero errors.                              │
│  4. Search for banned patterns defined in                       │
│     docs/coding-guidelines.md. Common examples:                 │
│       - Untyped escape hatches (e.g. `: any` in TS,            │
│         `type: ignore` in Python)                               │
│       - Debug logging left in production code                   │
│       - New TODO/FIXME comments added without tracking          │
│  5. Verify architectural constraints listed in the project's    │
│     AGENTS.md (section 4 — Architecture Constraints):           │
│       - External dependencies are behind ports/adapters         │
│       - Provider/backend swaps are isolated to adapter +        │
│         composition root config                                 │
│       - Any project-specific constraints are met                │
│  6. If ANY check fails → fix the code and return to Phase D     │
│     (run tests again after the fix).                            │
│  7. Only when ALL checks pass → proceed to Phase D3.            │
│                                                                 │
│  Deliverable: Code review checklist fully signed off.           │
│               Green tests + clean lint + zero type errors.      │
├─────────────────────────────────────────────────────────────────┤
│  Phase D3 — Write Testing Guide                                 │
│                                                                 │
│  1. Write a testing guide for the completed module(s).          │
│     Save it as: docs/testing-guide-<module-or-week>.md          │
│                                                                 │
│     The guide MUST be written as if explaining to someone who   │
│     has never seen the code.                                    │
│                                                                 │
│     Required sections:                                          │
│                                                                 │
│     a. Title and one-sentence purpose                           │
│                                                                 │
│     b. "Section 1 — Automated Tests"                            │
│        List every automated test covering this module:          │
│        - Exact command to run the tests                         │
│        - What each test group verifies                          │
│        - Expected output (all passing)                          │
│                                                                 │
│     c. "Section 2 — User Journey Tests"                         │
│        Written from the perspective of a real user:             │
│        - Through the actual UI or interaction model, not via    │
│          internal APIs (unless the product is a library/CLI)    │
│        - Each scenario is self-contained                        │
│        - Written in plain language with specific inputs and     │
│          expected results                                       │
│        - A non-technical person could follow these steps        │
│        For HTTP/API modules: include exact curl commands with   │
│          complete payloads and expected responses                │
│        For UI modules: include step-by-step actions with        │
│          expected visual results in a table format              │
│        For libraries/pure logic: write "N/A — this module has   │
│          no user-visible behaviour"                             │
│                                                                 │
│     d. "Section 3 — Final Check"                                │
│        - Build command and expected result                      │
│        - Full test suite command and expected result             │
│        - Any IDE/editor checks (e.g. Problems panel)            │
│                                                                 │
│     NO abstract JSON snippets without runnable commands.        │
│     NO "..." or "<N>" notation in expected responses.           │
│     NO assumed context — every step is self-contained.          │
│                                                                 │
│  Deliverable: Testing guide committed to docs/. Ready to        │
│               present to user for approval in Phase E.          │
├─────────────────────────────────────────────────────────────────┤
│  Phase E — User Approval                                        │
│                                                                 │
│  1. STOP. Show the user the final implementation.               │
│  2. Show the green test run.                                    │
│  3. Show the testing guide from D3 (or link to it).             │
│  4. Summarize what was built and how it maps to requirements.   │
│  5. Wait for explicit user approval before proceeding to F.     │
│                                                                 │
│  Deliverable: User approves the implementation and the testing  │
│               guide. No proceeding to F without approval.       │
├─────────────────────────────────────────────────────────────────┤
│  Phase F — Commit & Complete Cleanup                            │
│                                                                 │
│  Code                                                           │
│  1. Stage all changed files.                                    │
│  2. Commit each module with a conventional commit message:      │
│       feat(<module>): <what was implemented>                    │
│     Include test count and requirement IDs in the body.         │
│  3. Remove any temporary files, debug logs, or dead code.       │
│  4. Verify the full test suite still passes after cleanup.      │
│  5. Push all commits to remote.                                 │
│                                                                 │
│  Documentation                                                  │
│  6. Update docs/workplan.md Current Status table:               │
│     Mark the completed module/week with actual test count.      │
│  7. Move the completed week from the Weekly Plan into the       │
│     "DONE" section at the bottom of docs/workplan.md. Include:  │
│       — actual completion date                                  │
│       — actual test counts per module                           │
│       — spec gaps found and where they were fixed               │
│       — review archived reference                               │
│     Make the NEXT week the first visible entry so a new agent   │
│     sees only active work at a glance.                          │
│  8. Archive any review documents whose all findings are fixed:  │
│     Add a banner at the top of the file:                        │
│       > STATUS: ARCHIVED — YYYY-MM-DD                           │
│       > All findings resolved and verified. See workplan DONE.  │
│  9. Verify cross-document coherence:                            │
│     — Any spec gap found during implementation must be          │
│       reflected in the relevant requirements doc.               │
│     — docs/architecture.md must cover any new components.       │
│     — No active doc should reference a completed week as        │
│       "upcoming" or "to be done".                               │
│  10. Commit doc updates: docs(<scope>): update for week N done  │
│                                                                 │
│  Deliverable: All commits pushed. Active docs coherent.         │
│               Next agent opens workplan, sees only Week N+1.    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Batching Rules

Phases may be **batched across related modules** within the same package to reduce context-switching and user checkpoint overhead.

**Allowed batches:**
- **Phase A** for all modules in a package — design and define all interfaces, then wait for approval in one checkpoint.
- **Phase B + B2** for all modules in a package — write all failing tests, then demonstrate all in one checkpoint.
- **Phase D2** for all modules in a package — run the code review checklist across the full batch at once.
- **Phase D3** for all modules in a package — write all testing guides in one batch.
- **Phase E** for all modules in a package — present all results in one approval round.
- **Phase F** may produce one commit per module or one commit per batch, at the implementer's discretion.

**Not allowed:**
- Batching across phases (e.g. doing Phase A for module X and Phase C for module Y simultaneously). All modules in a batch must be at the same phase.
- Skipping any phase. Batching changes the *grouping*, not the *sequence*.

---

## 3. Rules for Agents (TDD Mode)

1. **Never skip phases.** Every module goes through A -> B -> B2 -> C -> D -> D2 -> D3 -> E -> F.
2. **Never write implementation before tests.** Phase C cannot start until Phase B2 is complete.
3. **Every requirement gets a test.** If a requirements doc says "reject if X", there must be a test that verifies that rejection.
4. **Tests reference requirement IDs.** Test descriptions include the requirement ID when one exists (e.g. `REQ-01`, `AUTH-05`, `CFG-06`).
5. **User checkpoints are blocking.** Phases A, B2, and E require user response before continuing. Do not proceed silently.
6. **D2 code review is mandatory.** Use the full checklist in `docs/coding-guidelines.md`. No user approval without passing D2.
7. **One module at a time.** Complete the full A->F cycle for one module before starting the next. Never have two modules half-implemented.
8. **Fix requirements upstream.** If during testing you discover a requirement is ambiguous or incomplete, update the requirements doc first, then update the test.
9. **Commit per module.** Each module that completes Phase F gets its own git commit. Do not batch multiple modules into one commit.
10. **Run the Phase B Coverage Audit before B2.** Before presenting any test suite to the user, complete every item in section 5. A missing test for a public API method is a Phase B failure, not a Phase C fix.
11. **Test each file in isolation before moving on.** After writing or editing a test file, run it in isolation using the project's test command. Never move to the next file while a syntax or collection error is present.
12. **Step-by-step spec means step-by-step tests.** Any spec that describes a multi-step conditional process MUST have one dedicated test per step. Do not combine steps in one assertion.
13. **Scan all secondary behaviors.** Every module's test file MUST cover: all error paths, all callback/event registration methods, all shutdown/cleanup methods, all "no-op when disconnected" guarantees.
14. **Phase F doc maintenance is mandatory.** After every week completes: (a) update docs/workplan.md Current Status, (b) move the week to the DONE section, (c) archive resolved review documents, (d) verify cross-document coherence, (e) commit and push.
15. **Phase D3 requires a testing guide.** Before presenting Phase E to the user, write `docs/testing-guide-<module-or-week>.md` following the template in Phase D3 above. No user approval (Phase E) without a testing guide committed in D3. The guide must be specific enough to run without any prior knowledge of the codebase.

---

## 4. Test File Conventions

| Convention | Rule |
|---|---|
| Location | Follow the project's standard test directory structure (defined in AGENTS.md) |
| Framework | Use the project's test framework (defined in AGENTS.md section 2.1) |
| Naming | `describe('<module>')` -> `it('<REQ-ID>: <human description>')` |
| Mocking | Mock external dependencies (network, file system, third-party APIs), never mock the module under test |
| Assertions | Use strict equality. No loose truthiness checks when an exact value is expected. |
| Coverage target | 100% of requirements. Line coverage is a secondary metric — requirement coverage is primary. |

---

## 5. Phase B — Mandatory Coverage Audit

Before calling Phase B complete, run this checklist against every test file. No Phase B2 checkpoint may be presented until all items are checked.

**1. Public API scan**  
Open the module's source file. For every exported function and every public class method, confirm a test exists that calls it. Write a comment-list at the top of the test file:
```
// API checklist:
// <check> methodName — N tests
// <check> otherMethod — N tests
```

**2. Multi-step spec behavior — one test per step**  
Any requirement that describes a sequential fallback or multi-step process MUST have one test per step, explicitly numbered:
- e.g. "If over budget: step 1 — omit null fields, step 2 — omit closed modalities, step 3 — truncate tools" requires three separate test blocks.

**3. Error path completeness**  
For every method that can fail, verify ALL failure paths have a test:
- Every async method -> test both resolved and rejected cases.
- Every "not connected" / "not found" / "invalid input" path -> explicit test.
- If a spec says "returns error code -32004 when queue full" -> that specific error code must appear in a test.

**4. Contract-first cross-reference for CLI/config modules**  
Before writing any test that calls argument parsing or config resolution:
1. Open the actual type/interface definition.
2. List every field explicitly: name, type, default, source (CLI flag vs env var vs config file).
3. Cross-reference each field against the test file. No field may be untested.
4. Any field sourced from env vars must have: (a) a test when the env var is set, (b) a test when it's absent (defaults or throws).

**5. Syntax validation per file AND stub import check**  
After writing each test file, create the corresponding stub if it doesn't yet exist, then run the test file in isolation using the project's test command. Catch syntax/transform errors and collection failures immediately, not at end-of-batch. A failing test that says "not implemented" is correct. A collection error means fix now — do NOT present B2 with collection failures outstanding.

**6. Post-edit fragment scan**  
After any batch edit, visually scan each modified file for:
- Duplicate code blocks (same test appearing twice)
- Orphaned closing braces or unclosed blocks
- Missing blank lines between test groups

---

## 6. Commit Message Format

```
feat(<module>): <summary>

- Implements <list of requirement IDs>
- Tests: <number> passing
- Closes: <any tracked issue>
```

Example:
```
feat(auth): implement token validation and origin checking

- Implements requirements-api.md section 3: validateToken, checkOrigin
- Tests: 14 passing
```

---

## 7. Definition of Done (per module)

Every module is considered done when it has completed the full TDD cycle (Phases A->F):

1. **Interfaces defined and explained** — typed signatures with documentation, compilable stubs, design explained to stakeholders (Phase A)
2. **User approved interfaces** — User acknowledged the design and explanation (Phase A)
3. **Failing tests written** — Every requirement has at least one test; all tests fail on stubs (Phase B)
4. **User approved tests** — User acknowledged the test coverage (Phase B2)
5. **Implementation complete** — Code compiles with zero type errors (Phase C)
6. **All tests pass** — No failures, no linter warnings/errors (Phase D)
7. **Code review passed** — Full checklist in `docs/coding-guidelines.md` signed off; no banned patterns, all architectural constraints met (Phase D2)
8. **Testing guide written** — Testing doc committed to `docs/testing-guide-*.md` (Phase D3)
9. **User approved implementation** — User acknowledged the implementation and testing guide (Phase E)
10. **Committed** — Conventional commit, no dead code, test suite still green (Phase F)

Additional per-task checks:
- If interface change: shared types package updated first
- If behaviour change: requirements doc updated
- Commit message follows conventional commits (`feat:`, `fix:`, `test:`, `docs:`)
