# Parallel Batch Prompt — Voice

## Purpose

Use this prompt for the **Voice** parallel batch.

This batch owns modularity work for:

- `packages/voice`

---

## Copy-paste prompt

You are working on the **Voice modularity batch** in the Accordo repo.

### Your ownership

You own ONLY this package for this batch:

- `packages/voice`

You may read any repo files needed for context, but keep source changes inside the batch unless a verified shared-foundation issue is discovered.

### Primary goal

Make the voice module a clean, portable, replaceable runtime with well-isolated adapters.

The intended outcome is:

1. voice runtime/core is free of host leakage
2. UI remains adapter-only
3. config/policy persistence is abstracted cleanly
4. provider contracts are clearer and easier to swap
5. activation/bootstrap is thinner and easier to reason about

### Mandatory constraints

1. **Do not redesign shared foundations unless necessary**
   - do not casually edit `packages/capabilities`
   - do not casually edit `packages/bridge-types`

2. **No direct coupling to other modality packages**
   - voice should stand on its own
   - no direct dependency on browser/diagram/marp/comments internals

3. **Prefer simple adapter boundaries**
   - clear interfaces and explicit dependency injection are good
   - avoid abstracting for hypothetical future needs beyond what current seams justify

4. **Keep behavior stable**
   - this is a modularity/refactor batch
   - not a feature redesign

### Source-of-truth docs to follow

Read and follow these before changing code:

- `docs/modularity-perfect-score-plan.md`
- `docs/30-development/modularity.md`
- `docs/30-development/coding-guidelines.md`

### Architecture intent for this batch

Voice should end this batch with the following shape:

- runtime/core logic is portable and host-agnostic
- host/UI/config concerns sit behind adapters
- provider boundaries are explicit and stable
- activation/bootstrap mainly wires collaborators

### Specific modularity outcomes to target

1. Remove or isolate any VS Code leakage from runtime/core
2. Keep UI code strictly presentation/adapter-level
3. Move persistence/config mechanics behind a clear adapter seam
4. Ensure STT/TTS/recording/playback providers are cleanly replaceable
5. Reduce orchestration heaviness in the extension entrypoint

### Explicit non-goals

Do NOT do these unless required for correctness:

- redesign modality capabilities beyond what voice itself needs
- invent new shared frameworks
- add unrelated new voice features
- broaden scope into documentation restructuring outside the voice batch

### Required working method

1. Study the package structure first
2. Confirm current runtime/adapters/UI/provider boundaries
3. Make the smallest coherent modularity improvements that materially improve replaceability
4. Verify after each slice

### Required verification before reporting done

At minimum run and report:

- voice typecheck/build if available
- voice tests
- any newly affected package checks if touched

### Required final output

When done, report:

1. files changed
2. what host leakage or tight coupling was removed
3. what adapters/contracts were clarified
4. what remains deferred intentionally
5. exact verification commands and results

### If you hit a blocker

If the batch seems to require changing shared packages, stop and report:

- exact missing shared contract
- why voice cannot proceed cleanly without it
- minimal shared patch needed

Do not invent a local workaround that duplicates a shared contract.

---

## Success definition

This batch is successful when:

- the voice runtime is more portable
- providers are more obviously swappable
- UI is more clearly adapter-only
- bootstrap is thinner
- tests remain green
