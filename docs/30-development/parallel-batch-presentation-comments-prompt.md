# Parallel Batch Prompt — Presentation + Comments Integration

## Purpose

Use this prompt for the **Presentation + Comments integration** parallel batch.

This batch owns modularity work for:

- `packages/marp`
- `packages/comments` (only the integration/navigation parts needed for presentation/comments modularity)

This batch is the most coordination-sensitive one, because it touches cross-modality navigation and presentation contracts.

---

## Copy-paste prompt

You are working on the **Presentation + Comments integration modularity batch** in the Accordo repo.

### Your ownership

You own ONLY these scopes for this batch:

- `packages/marp`
- the presentation/comments integration portions of `packages/comments`

You may read any repo files needed for context. Do not broaden comments-package changes beyond what is required for the approved modularity goals.

### Primary goal

Make presentation integration truly modular and engine-neutral enough for later replacement, while making comments navigation to presentation surfaces cleaner and less hardcoded.

The intended outcome is:

1. presentation runtime/host abstractions are more honest and complete
2. engine-specific behavior does not leak through fake-neutral interfaces
3. comments integration uses the shared capability foundation cleanly
4. comments package moves away from hardcoded modality-specific routing where this batch owns that change
5. presentation surface navigation becomes easier to replace later

### Mandatory constraints

1. **Architect-first sequencing inside this batch**
   - do not jump straight into broad implementation
   - first confirm the exact runtime adapter / navigation seam you are implementing

2. **Respect shared foundations**
   - `packages/capabilities` now exists as the canonical capability-contract surface
   - do not invent local command strings or local shadow interfaces

3. **Do not turn comments into a central god module**
   - comments should dispatch through contracts/adapters
   - it should not own detailed presentation engine behavior

4. **Keep scope tight**
   - only touch comments where needed for presentation/comments modularity cleanup
   - do not opportunistically refactor unrelated comments features

5. **No speculative plugin architecture beyond what current design requires**
   - keep it simple, explicit, and easy to replace

### Source-of-truth docs to follow

Read and follow these before changing code:

- `docs/modularity-perfect-score-plan.md`
- `docs/30-development/modularity.md`
- `docs/30-development/capabilities-foundation-phase-a.md`
- `docs/30-development/coding-guidelines.md`

### Architecture intent for this batch

#### In `packages/marp`

- the runtime adapter/host seam must be truthful and complete
- no engine-specific casts should remain where a shared interface claims neutrality
- host/session/panel concerns should be clearer and less entangled with engine internals

#### In `packages/comments`

- presentation navigation should go through shared capability contracts
- comments routing should not hardcode presentation behavior more than necessary
- if a registry/adapter seam is introduced, it should be simple and explicit, not framework-heavy

### Specific modularity outcomes to target

1. Complete the real presentation navigation/runtime seam
2. Separate engine-specific Marp concerns from generic presentation host concerns where practical
3. Align all presentation-related command usage to `@accordo/capabilities`
4. Reduce hardcoded comments→presentation knowledge where the batch can do so cleanly
5. Leave the code easier to swap to another presentation engine later

### Explicit non-goals

Do NOT do these unless required:

- redesign browser relay/shared wire contracts
- refactor all comments routing for all modalities if not needed in this batch
- introduce a broad plugin runtime
- add new presentation features unrelated to modularity

### Required working method

1. Identify the exact presentation runtime and navigation seams currently leaking engine details
2. Confirm the smallest coherent contract cleanup needed
3. Refactor presentation host/engine responsibilities carefully
4. Update comments integration only as much as required to align with the cleaned presentation seam
5. Verify after each slice

### Required verification before reporting done

At minimum run and report:

- marp typecheck/build if available
- marp tests
- comments typecheck/build if touched
- comments tests relevant to navigation/integration
- any other affected integration tests

### Required final output

When done, report:

1. files changed
2. what presentation abstraction problems were fixed
3. what comments integration/routing hardcoding was reduced
4. what remained intentionally deferred
5. exact verification commands and results
6. confirmation that shared capability contracts remained canonical

### If you hit a blocker

If you discover a shared contract gap in `packages/capabilities`, STOP and report:

- exact missing capability or interface
- why current foundation is insufficient
- smallest shared-package change needed
- which files currently depend on it

Do not create local duplicate command IDs or shadow interfaces in `marp` or `comments`.

---

## Success definition

This batch is successful when:

- presentation abstractions are more honest and replaceable
- comments integration relies on shared capability seams, not hardcoded engine assumptions
- no new cross-modality direct coupling is introduced
- tests remain green
- the code is simpler to reason about than before
