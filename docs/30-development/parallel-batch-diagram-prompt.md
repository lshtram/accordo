# Parallel Batch Prompt — Diagram

## Purpose

Use this prompt for the **Diagram** parallel batch.

This batch owns modularity work for:

- `packages/diagram`

---

## Copy-paste prompt

You are working on the **Diagram modularity batch** in the Accordo repo.

### Your ownership

You own ONLY this package for this batch:

- `packages/diagram`

You may read any repo files needed for context, but keep source changes inside the batch unless a verified shared-foundation issue is discovered.

### Primary goal

Make the diagram module a clearly layered system where parsing, layout, rendering, webview hosting, and comment integration are easier to understand and replace.

The intended outcome is:

1. host/webview boundary is explicit
2. panel orchestration is decomposed
3. internal engine stages are clearer and less entangled
4. comment integration stays adapter-only
5. rendering/host specifics do not leak into core stages unnecessarily

### Mandatory constraints

1. **Do not redesign shared foundations unless necessary**
   - shared relay/capability foundations are already in place
   - do not casually edit shared packages

2. **No direct cross-modality coupling**
   - diagram should not learn browser/voice/marp internals
   - comments integration should remain through shared contracts only

3. **Prefer explicit boundaries over abstraction theater**
   - parser, reconciler, layout, rendering, panel host, and comment bridge should each have understandable ownership

4. **Keep behavior stable**
   - modularity/refactor only

### Source-of-truth docs to follow

Read and follow these before changing code:

- `docs/modularity-perfect-score-plan.md`
- `docs/30-development/modularity.md`
- `docs/30-development/coding-guidelines.md`

### Architecture intent for this batch

Diagram should end this batch with the following shape:

- `webview/` or equivalent host-side modules are clearly identified as adapter/host layer
- engine stages have clearer ownership:
  - parse
  - reconcile
  - layout
  - visual model
  - scene/render adapter
- comments integration remains isolated
- panel class/orchestrator is thinner and easier to follow

### Specific modularity outcomes to target

1. Clarify and enforce the host boundary
2. Split panel orchestration from message routing / load flow / export / comments bridging where needed
3. Reduce cross-stage entanglement between parser/layout/rendering concerns
4. Keep Excalidraw or renderer-specific logic from bleeding into earlier semantic stages when possible
5. Keep comment SDK usage in adapter-level integration code

### Explicit non-goals

Do NOT do these unless required:

- redesign global comments capabilities
- redesign shared packages
- add new diagram features
- rewrite the module from scratch

### Required working method

1. Study current module structure and import directions
2. Identify biggest modularity pressure points
3. Make coherent boundary improvements in small slices
4. Keep tests green after each meaningful step

### Required verification before reporting done

At minimum run and report:

- diagram typecheck/build if available
- diagram tests
- any newly affected integration checks if touched

### Required final output

When done, report:

1. files changed
2. what boundaries were clarified
3. what orchestration was split
4. how comment integration remains isolated
5. exact verification commands and results

### If you hit a blocker

If you discover a need for shared package changes, stop and report the minimal shared-foundation gap rather than creating local duplicate types or commands.

---

## Success definition

This batch is successful when:

- diagram internals have clearer stage boundaries
- host/webview logic is more obviously adapter-level
- comment integration stays modular
- renderer-specific details are less entangled with semantic stages
- tests remain green
