# Review — T-01 edgeStyles in `accordo_diagram_patch` — Phase A

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Status:** REQUEST CHANGES — 2 blocking findings, 2 minor findings

---

## Verdict

**REQUEST CHANGES.**  
The core design is sound and the type infrastructure is ready, but two blocking gaps must be addressed before Phase B proceeds.

---

## Checklist

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `EdgeLayout.routing` and `EdgeLayout.style` confirmed sufficient — no new types needed | ✅ PASS | `EdgeLayout` (types.ts:116-129) has `routing` and `style: EdgeStyle`. `EdgeStyle` (193-202) has all four fields. |
| 2 | `patchEdge()` confirmed ready in `layout-store.ts` | ✅ PASS | Exists at lines 116-122, takes `(layout, edgeKey, patch: Partial<EdgeLayout>)`. |
| 3 | `edgeStyles` schema follows `nodeStyles` / `clusterStyles` pattern with `additionalProperties: false` | ✅ PASS | Pattern is established and consistent in `diagram-tool-definitions.ts`. |
| 4 | `routing` stored at `EdgeLayout.routing`, NOT inside `EdgeLayout.style` | ✅ PASS | Design correctly separates these. Handler must extract `routing` before building the style patch. |
| 5 | Handler deep-merges style (`style: { ...existing.style, ...styleFields }`) — not a raw `patchEdge` call | ✅ PASS (intent) / ⚠️ MINOR | Design intent is correct, but the deep-merge requirement is not written explicitly. `patchEdge` is a shallow spread — omitting this note risks a future bug. See FINDING-3. |
| 6 | Whitelist (`EDGE_STYLE_KEYS`) drops unknown fields silently | ✅ PASS | Mirrors `NODE_STYLE_KEYS` pattern. `["strokeColor", "strokeWidth", "strokeStyle", "strokeDash"]` is the correct whitelist. |
| 7 | Unknown edge keys silently skipped (no throw) | ✅ PASS | Mirrors `if (updatedNodes[nodeId] === undefined) continue;` at ops.ts:283. |
| 8 | Backwards compatible — absent `edgeStyles` param causes no error | ✅ PASS | Optional param, no `edgeStyles` → handler branch never entered. |
| 9 | `"curved"` accepted in schema even before D-03 is implemented | ✅ PASS | `routing` is `string`-typed in `EdgeLayout` — any string value is stored as-is. Renderer decides what to do with it. |
| 10 | DT-59..DT-65 cover all paths | ❌ FAIL | 7 tests proposed but the style-field preservation test is missing. See FINDING-2. |

**Additional items:**

| # | Item | Status | Notes |
|---|---|---|---|
| 11 | Tool description and style guide updated to mention `edgeStyles` | ❌ FAIL | Neither updated in design. See FINDING-1. |
| 12 | `waypoints` exclusion documented | ⚠️ MINOR | See FINDING-4. |

---

## Findings

### FINDING-1 — BLOCKING: Tool description and style guide not updated

**Files affected:**
- `packages/diagram/src/tools/diagram-tool-definitions.ts` lines 94-97 — the `accordo_diagram_patch` tool description currently reads: *"Use the optional 'nodeStyles' argument to set per-node colours..."*
- `packages/diagram/src/tools/diagram-tool-ops.ts` lines 464-522 — `styleGuideHandler` / `stylingInstructions` array lists `nodeStyles` and `clusterStyles` but will not mention `edgeStyles`

**Problem:** AI agents discover capabilities via the tool description and the style guide returned by `accordo_diagram_style_guide`. If `edgeStyles` is not mentioned in both places, it is effectively invisible at runtime. This breaks the "Runtime exposure" architectural constraint (AGENTS.md §4 / coding-guidelines.md D2 checklist item 8).

**Required fix:**
1. Update the tool description in `accordo_diagram_patch` to include `edgeStyles` alongside `nodeStyles`.
2. Add an `edgeStyles` section to `stylingInstructions` in `styleGuideHandler` — including the available fields (`strokeColor`, `strokeWidth`, `strokeStyle`, `strokeDash`, `routing`) and an example.

---

### FINDING-2 — BLOCKING: Missing style-field preservation test

**Problem:** `patchEdge()` in `layout-store.ts:121` does a shallow spread:
```typescript
{ ...layout.edges[edgeKey], ...patch }
```
If the handler passes `{ style: { strokeColor: "#f00" } }` as the patch (without deep-merging first), this REPLACES the entire `style` object, silently wiping any pre-existing `strokeWidth`, `strokeStyle`, or `strokeDash`. The handler must deep-merge (confirmed correct in the design intent), and a test must verify this behaviour.

**Required fix:** Add a test to the DT-59..DT-65 range (or extend to DT-66) that:
1. Calls `patchHandler` with `edgeStyles: { "e1": { strokeColor: "#f00" } }` on an edge that already has `strokeWidth: 2` set.
2. Asserts that the result retains `strokeWidth: 2` AND has `strokeColor: "#f00"`.

Without this test, the shallow-merge risk is undetected until a user encounters it at runtime.

---

### FINDING-3 — MINOR: Deep-merge requirement not written explicitly in implementation spec

**Problem:** The design describes the handler at a high level but does not spell out the critical implementation note: *"do NOT pass `style: styleFields` directly to `patchEdge`; instead, read the existing edge's style and spread it: `style: { ...existing.style, ...styleFields }`."*

The nodeStyles (ops.ts:300-307) and clusterStyles (ops.ts:325-332) implementations do this correctly, but a developer implementing `edgeStyles` without reading those blocks carefully would fall into the `patchEdge` shallow-merge trap.

**Required fix:** Add an explicit note in the design spec: *"Handler must read `existing.style ?? {}` and produce `style: { ...existing.style, ...styleFields }` before calling `patchEdge`. Do not pass the raw `styleFields` as the `style` value — this would wipe existing style properties."*

---

### FINDING-4 — MINOR: `waypoints` exclusion not documented in schema description

**Problem:** `EdgeLayout.waypoints` exists in the type (types.ts:126) but `edgeStyles` intentionally excludes it (D-04 deferred). Without a note in the schema or design document, a future developer might add `waypoints` to the `edgeStyles` schema without realising a deferred decision governs it.

**Required fix:** Add a brief comment to the schema definition and/or design doc: *"`waypoints` is intentionally excluded — deferred to D-04."*

---

## What Passes Already

- Type infrastructure is complete — no new types needed.
- `patchEdge()` is ready and correctly placed.
- Schema pattern (`additionalProperties: false`, per-key sub-objects) is clean and consistent with existing tools.
- Routing/style separation is correctly identified in the design.
- Whitelist approach is correct and matches existing code pattern.
- Backwards compatibility is guaranteed by the optional parameter.
- `"curved"` routing is correctly accepted before D-03 is implemented (string-typed field).
- Unknown edge keys are silently skipped, consistent with nodeStyles and clusterStyles handlers.

---

## Required Actions Before Phase B

1. **(Blocking)** Update `accordo_diagram_patch` tool description to mention `edgeStyles`.
2. **(Blocking)** Add `edgeStyles` section to `styleGuideHandler` / `stylingInstructions`.
3. **(Blocking)** Add the style-field preservation test to the proposed DT-59..DT-65 list (or extend to DT-66).
4. **(Minor)** Add explicit deep-merge implementation note to the design spec.
5. **(Minor)** Document `waypoints` exclusion as intentional (D-04 deferred) in schema description.

Once the architect addresses items 1-3, re-submit for re-review. Items 4-5 may be deferred to Phase C implementation notes if the architect prefers, but are strongly recommended.
