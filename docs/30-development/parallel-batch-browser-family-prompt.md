# Parallel Batch Prompt — Browser Family

## Purpose

Use this prompt for the **Browser + Browser-extension** parallel batch.

This batch owns modularity work for:

- `packages/browser`
- `packages/browser-extension`

It must improve modularity **without reopening foundation-level shared contract design** unless a true shared-foundation gap is discovered.

---

## Copy-paste prompt

You are working on the **Browser Family modularity batch** in the Accordo repo.

### Your ownership

You own ONLY these packages for this batch:

- `packages/browser`
- `packages/browser-extension`

You may read any repo files needed for context, but do not make source changes outside this batch unless explicitly required by a verified shared-foundation gap.

### Primary goal

Improve modularity so the browser family is easier to understand, easier to swap, and less tightly coupled internally.

The intended outcome is:

1. Browser activation/bootstrap becomes thin
2. Browser relay concerns are separated from tool registration and comments integration
3. Browser page tool logic is decomposed by responsibility
4. Browser-extension transport/config concerns are isolated cleanly
5. Browser/browser-extension remain aligned to the already-established shared relay contract foundation

### Mandatory constraints

1. **Do not redesign shared foundations unless necessary**
   - `packages/bridge-types` and `packages/capabilities` are now foundation-owned shared packages
   - treat them as stable
   - if you believe a change is required there, STOP and report it instead of casually editing it

2. **Single-writer rule on shared packages**
   - do not edit `packages/bridge-types`
   - do not edit `packages/capabilities`
   unless explicit coordination says this batch owns the temporary shared-package patch window

3. **No direct cross-modality imports**
   - browser/browser-extension must not create direct coupling to voice, diagram, marp, etc.
   - use shared contracts only

4. **Do not expand scope into feature work**
   - this is a modularity/refactor batch, not a feature batch
   - no new user-visible behavior unless required to preserve current behavior during refactor

5. **No fancy abstractions**
   - prefer clear file splits, explicit interfaces, and simple composition
   - no speculative plugin frameworks

### Source-of-truth docs to follow

Read and follow these before changing code:

- `docs/modularity-perfect-score-plan.md`
- `docs/30-development/modularity.md`
- `docs/30-development/capabilities-foundation-phase-a.md`
- `docs/30-development/coding-guidelines.md`

### Architecture intent for this batch

The browser family should end this batch with the following shape:

#### In `packages/browser`

- `extension.ts` or equivalent activation entry should be thin and orchestration-only
- relay bootstrap logic should be separated from tool registration
- comments integration should be isolated and optional in structure
- tool handler logic should be split by responsibility, especially where one file currently mixes:
  - transport
  - origin/security policy
  - redaction
  - snapshot persistence
  - response shaping

#### In `packages/browser-extension`

- relay transport/config should be clearly separated from handler logic
- hardcoded environment/connection assumptions should be minimized or isolated
- handler families should have clear ownership
- browser-extension should remain aligned to shared relay contracts rather than defining local wire-contract variants

### Specific modularity outcomes to target

#### Browser package

Aim to achieve as many of these as possible in a coherent minimal refactor:

1. Split oversized activation/bootstrap concerns into focused collaborators
2. Keep comments integration isolated from base browser operation
3. Reduce god-file behavior in page-tool handler implementations
4. Preserve a clear internal split between:
   - relay transport
   - policy/security
   - persistence/retention
   - tool orchestration

#### Browser-extension package

Aim to achieve as many of these as possible in a coherent minimal refactor:

1. Separate relay client transport from domain action dispatch
2. Isolate connection/config concerns
3. Reduce hidden singleton coupling where practical
4. Clarify handler families and dependency flow

### Explicit non-goals

Do NOT do these unless absolutely required to keep the code compiling or tests passing:

- invent a new shared package
- redesign capability naming
- redesign relay contracts already moved into `@accordo/bridge-types`
- change comments/presentation integration contracts beyond what browser family itself needs internally
- introduce broad filesystem/infra/tooling churn

### Required working method

1. Study the package structure first
2. Identify the minimum coherent browser-family refactor slice
3. Make changes in small, testable steps
4. Keep behavior stable
5. Run relevant tests/typechecks repeatedly
6. Stop and report if a true shared-foundation gap appears

### Required verification before reporting done

At minimum run and report:

- browser typecheck/build if available
- browser tests
- browser-extension typecheck/build if available
- browser-extension tests
- any newly affected integration tests

### Required final output

When done, report:

1. files changed
2. what structural changes were made
3. what responsibilities were separated
4. what remains intentionally deferred
5. exact verification commands and results
6. whether the batch stayed within its package ownership boundaries

### If you hit a blocker

If you discover a needed change in `@accordo/bridge-types` or `@accordo/capabilities`, do NOT patch around it locally.

Instead report:

- exact missing shared contract
- why existing foundation is insufficient
- smallest shared fix needed
- which file/package would need that fix

Do not continue with ad hoc local duplicates.

---

## Success definition

This batch is successful when:

- browser family is more decomposed and easier to replace piece-by-piece
- no new cross-modality coupling was introduced
- shared foundation contracts remain respected
- tests stay green
- code is clearer, not cleverer
