# Accordo IDE — Development Process

**Scope:** How we build every module in this project.  
**Authority:** This document is normative. When the user or task says "TDD", every step here is mandatory with no exceptions and no shortcuts.  
**Reference:** workplan.md § Weekly Plan (for current tasks), AGENTS.md (for mode selection rules)

---

## 1. TDD Mode — The Full Cycle

When working in TDD mode, every implementation module goes through these phases **in order**. No skipping. No batching across phases.

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase A — Understand, Explain, and Design Stubs                │
│                                                                 │
│  1. Read the requirements for this module from the relevant     │
│     requirements doc (e.g. requirements-hub.md §5.2 for        │
│     state-cache).                                               │
│                                                                 │
│  2. Explain the module FIRST to TWO audiences:                  │
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
│        - Are there any requirements gaps?                       │
│                                                                 │
│  3. STOP. Wait for user acknowledgement before continuing.      │
│                                                                 │
│  4. Write/verify the TypeScript interfaces in                   │
│     @accordo/bridge-types or in the module's own types.         │
│     Reference any clarifications from step 2.                   │
│                                                                 │
│  5. Define all public method signatures with JSDoc.             │
│                                                                 │
│  6. Verify every requirement has a corresponding interface      │
│     element — if one is missing, update the requirements doc    │
│     before proceeding.                                          │
│                                                                 │
│  7. Export stub implementation (empty methods that throw        │
│     "not implemented") so tests can import the module.          │
│                                                                 │
│  Deliverable: User approval + Compilable interfaces + stubs.    │
├─────────────────────────────────────────────────────────────────┤
│  Phase B — Write Failing Tests                                  │
│                                                                 │
│  1. Write test file(s) for the module. Use vitest.              │
│  2. For EVERY requirement in the spec, write at least one       │
│     test. The test name MUST reference the requirement ID       │
│     (e.g. "CONC-01: maintains in-flight counter").              │
│  3. Cover happy path, error cases, and edge cases.              │
│  4. Tests MUST import from the real module (not mocks of it).   │
│  5. Run the tests — they MUST ALL FAIL (red).                   │
│     If any test passes on the stub, the test is wrong.          │
│  6. Tests define the complete functional contract.              │
│     If you can't write a test for a requirement, the            │
│     requirement is incomplete — fix it first.                   │
│                                                                 │
│  Deliverable: Comprehensive failing test suite.                 │
├─────────────────────────────────────────────────────────────────┤
│  Phase B2 — Demonstrate to User                                 │
│                                                                 │
│  1. STOP. Do not write implementation code yet.                 │
│  2. Show the user the test file(s).                             │
│  3. Run the tests and show they all fail (red).                 │
│  4. Walk the user through what each test validates.             │
│  5. Confirm with the user that the test coverage is sufficient. │
│  6. Wait for user acknowledgement before continuing.            │
│                                                                 │
│  Deliverable: User approves the test suite.                     │
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
│  1. Run the full mandatory checklist from docs/coding-          │
│     guidelines.md §3 (Code Review Checklist).                   │
│  2. Run eslint: zero warnings on new code, zero errors total.   │
│  3. Run typecheck: zero TypeScript errors.                      │
│  4. Search for banned patterns:                                 │
│       grep -r ": any" src/  → must be empty                    │
│       grep -r "console\.log" src/ → must be empty              │
│       grep -r "TODO\|FIXME" src/ → no new ones added           │
│  5. Verify architectural constraints:                           │
│       - No handler functions in wire types                      │
│       - No VSCode imports in Hub packages                       │
│       - Security middleware is first on every endpoint          │
│  6. If ANY check fails → fix the code and return to Phase D     │
│     (run tests again after the fix).                            │
│  7. Only when ALL checks pass → proceed to Phase D3.            │
│                                                                 │
│  Deliverable: Code review checklist fully signed off.           │
│               Green tests + clean lint + zero type errors.      │
├─────────────────────────────────────────────────────────────────┤
│  Phase D3 — Write Testing Guide                                 │
│                                                                 │
│  1. Write a manual testing guide for the completed module(s).   │
│     Save it as: docs/testing-guide-<module-or-week>.md          │
│                                                                 │
│     The guide MUST be written as if explaining to someone who   │
│     has never seen the code. Follow this exact format:          │
│                                                                 │
│     a. Title and one-sentence purpose                           │
│     b. "Part 1 — Get everything running" as numbered steps:     │
│        Step 1: exact command to build                           │
│        Step 2: exact action to start VS Code debug session      │
│        Step 3: exact curl to confirm health + what to see       │
│        Step 4: exact command to read token into $TOKEN          │
│        Step 5: exact curl to initialize MCP session             │
│                showing exact output format to look for          │
│                and exact command to save SESSION=<uuid>         │
│        Step 6: exact curl to send initialized notification      │
│     c. "Part 2 — Test each tool" — one sub-section per tool:   │
│        - Heading: "Tool N of M — `<tool.name>`"                 │
│        - One line describing what the tool does                 │
│        - "Setup:" describing any VS Code state needed           │
│        - Numbered tests: "Test Na — description"                │
│          Each test has:                                         │
│          · "Run:" followed by the COMPLETE curl command         │
│            (no placeholders except file paths)                  │
│          · "What you should see in VS Code:" (if visual)        │
│          · "What you should see in the response:" with the      │
│            exact JSON string                                    │
│     d. "Part 3 — Final check" with build, test, and Problems   │
│        panel steps                                              │
│                                                                 │
│     NO abstract JSON snippets without curl commands.            │
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
│  5. Push all commits to remote (git push origin main).          │
│                                                                 │
│  Documentation                                                  │
│  6. Update workplan.md §Current Status table:                   │
│     Mark the completed week ✅ with actual test count.          │
│  7. Move the completed week from §5 Weekly Plan into the        │
│     "DONE" section at the bottom of workplan.md. Include:       │
│       — actual completion date                                  │
│       — actual test counts per module                           │
│       — spec gaps found and where they were fixed               │
│       — review archived reference                               │
│     Make the NEXT week the first visible entry in §5 so a       │
│     new agent sees only active work at a glance.                │
│  8. Archive any review documents whose all findings are fixed:  │
│     Add a banner at the top of the file:                        │
│       > STATUS: ARCHIVED — YYYY-MM-DD                           │
│       > All findings resolved and verified. See workplan DONE.  │
│  9. Verify cross-document coherence:                            │
│     — Any spec gap found during implementation must be          │
│       reflected in the relevant requirements-*.md section.      │
│     — architecture.md must cover any new components.            │
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
- **Phase A** for all modules in a package — explain and define all interfaces, then wait for approval in one checkpoint.
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

1. **Never skip phases.** Every module goes through A → B → B2 → C → D → D2 → D3 → E → F.
2. **Never write implementation before tests.** Phase C cannot start until Phase B2 is complete.
3. **Every requirement gets a test.** If requirements-hub.md says "reject if Origin present and not localhost", there must be a test named `"validates Origin: rejects non-localhost"`.
4. **Tests reference requirement IDs.** Test descriptions include the requirement ID when one exists (e.g. `CONC-01`, `WS-05`, `CFG-06`).
5. **User checkpoints are blocking.** Phases A, B2, and E require user response before continuing. Do not proceed silently.
6. **D2 code review is mandatory.** Use the full checklist in `docs/coding-guidelines.md §3`. No user approval without passing D2.
7. **One module at a time.** Complete the full A→F cycle for one module before starting the next. Never have two modules half-implemented.
8. **Fix requirements upstream.** If during testing you discover a requirement is ambiguous or incomplete, update the requirements doc first, then update the test.
9. **Commit per module.** Each module that completes Phase F gets its own git commit. Do not batch multiple modules into one commit.
10. **Run the Phase B Coverage Audit before B2.** Before presenting any test suite to the user, complete every item in §5. A missing test for a public API method is a Phase B failure, not a Phase C fix.
11. **Test each file in isolation before moving on.** After writing or editing a test file, run `pnpm vitest run src/__tests__/<file>.test.ts`. Never move to the next file while a transform or syntax error is present.
12. **Step-by-step spec means step-by-step tests.** Any spec that describes a multi-step conditional process MUST have one dedicated test per step. Do not combine steps in one assertion.
13. **Scan all secondary behaviors.** Every module's test file MUST cover: all error paths, all callback/event registration methods, all shutdown/cleanup methods, all "no-op when disconnected" guarantees.
14. **Phase F doc maintenance is mandatory.** After every week completes: (a) update workplan.md §Current Status, (b) move the week to the DONE section, (c) archive resolved review documents, (d) verify cross-document coherence, (e) commit and push.
15. **Phase D3 requires a testing guide.** Before presenting Phase E to the user, write `docs/testing-guide-<module-or-week>.md` following the template in Phase D3 above. No user approval (Phase E) without a testing guide committed in D3. The guide must be specific enough to run without any prior knowledge of the codebase.

---

## 4. Test File Conventions

| Convention | Rule |
|---|---|
| Location | `packages/<package>/src/__tests__/<module>.test.ts` |
| Framework | vitest |
| Naming | `describe('<module>')` → `it('<REQ-ID>: <human description>')` |
| Mocking | Use vitest mocks. Mock external dependencies (node:http, ws, vscode API), never mock the module under test. |
| Assertions | Use strict equality. No loose `toBeTruthy()` when an exact value is expected. |
| Coverage target | 100% of requirements. Line coverage is a secondary metric — requirement coverage is primary. |

---

## 5. Phase B — Mandatory Coverage Audit

Before calling Phase B complete, run this checklist against every test file. No Phase B2 checkpoint may be presented until all items are checked.

**1. Public API scan**  
Open the module's source file. For every exported function and every public class method, confirm a test exists that calls it. Write a comment-list at the top of the test file:
```
// API checklist:
// ✓ validateOrigin — 9 tests
// ✓ validateBearer — 7 tests
// ✓ validateBridgeSecret — 5 tests
// ✓ generateToken — 4 tests
```

**2. Multi-step spec behavior — one test per step**  
Any requirement that describes a sequential fallback or multi-step process MUST have one test per step, explicitly numbered:
- e.g. "If over budget: step 1 — omit null fields, step 2 — omit closed modalities, step 3 — truncate tools" → requires three separate `it()` blocks.

**3. Error path completeness**  
For every method that can fail, verify ALL failure paths have a test:
- Every `async` method → test both resolved and rejected cases.
- Every "not connected" / "not found" / "invalid input" path → explicit test.
- If a spec says "returns error code -32004 when queue full" → that specific error code must appear in a test.

**4. Contract-first cross-reference for CLI/config modules**  
Before writing any test that calls `parseArgs` or `resolveConfig`:
1. Open the actual TypeScript interface definition.
2. List every field explicitly: name, type, default, source (CLI flag vs env var).
3. Cross-reference each field against the test file. No field may be untested.
4. Any field sourced from env vars must have: (a) a test when the env var is set, (b) a test when it's absent (defaults or throws).

**5. Syntax validation per file**  
After writing each test file, run it in isolation before moving on:
```
pnpm vitest run src/__tests__/<module>.test.ts
```
Catch syntax/transform errors immediately, not at end-of-batch. A failing test that says "not implemented" is correct. A transform error means fix now.

**6. Post-edit fragment scan**  
After any batch edit, visually scan each modified file for:
- Duplicate code blocks (same `it()` or `describe()` appearing twice)
- Orphaned closing braces or unclosed blocks
- Missing blank lines between describe blocks

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
feat(state-cache): implement state cache with patch merging

- Implements requirements-hub §5.2: applyPatch, setSnapshot, getState, clearModalities
- Tests: 14 passing
```

---

## 7. Definition of Done (per module)

Every module is considered done when it has completed the full TDD cycle (Phases A→F):

1. **Interfaces defined and explained** — TypeScript types with JSDoc, compilable stubs, design explained to stakeholders (Phase A)
2. **User approved interfaces** — User acknowledged the design and explanation (Phase A)
3. **Failing tests written** — Every requirement has at least one test; all tests fail on stubs (Phase B)
4. **User approved tests** — User acknowledged the test coverage (Phase B2)
5. **Implementation complete** — Code compiles with zero TypeScript errors (Phase C)
6. **All tests pass** — No failures, no ESLint warnings/errors (Phase D)
7. **Code review passed** — Full checklist in `docs/coding-guidelines.md §3` signed off; zero `any`, zero `console.log`, all architectural constraints met (Phase D2)
8. **Testing guide written** — Manual testing doc committed to `docs/testing-guide-*.md` (Phase D3)
9. **User approved implementation** — User acknowledged the implementation and testing guide (Phase E)
10. **Committed** — Conventional commit, no dead code, test suite still green (Phase F)

Additional per-task checks:
- If interface change: `@accordo/bridge-types` updated first
- If behaviour change: requirements doc updated
- Commit message follows conventional commits (`feat:`, `fix:`, `test:`, `docs:`)
