## Review — diagram-follow-up-batch — Phase A

Result: **FAIL**

### Findings

- [high] **Interface gap for grouped class components**: `ExcalidrawElement` (`packages/diagram/src/types.ts`) has no `groupIds` field, and `toExcalidrawPayload()` (`scene-adapter.ts`) hardcodes `groupIds: []`. The proposed design requires deterministic `groupIds` propagation (e.g., `class:<nodeId>`) across all class block elements (outer box, divider, title, members).
- [high] **Waypoint persistence flow is not fully designed in interfaces**: `detectNodeMutations()` currently returns only node-style/layout mutations (`message-handler.ts`) and does not emit an edge-routing mutation type; `panel-core.ts` still logs `canvas:edge-routed` as not implemented. The Phase A design must include the exact mutation/event contract and host patch path to `patchEdge()`.
- [medium] **Curved routing persistence contract incomplete**: current `routeEdge("curved", ...)` delegates to `routeCurved(source, target, direction)` and ignores stored waypoints (`edge-router.ts`). Phase A should explicitly define how persisted waypoints are consumed for curved mode (precedence and geometry semantics).
- [medium] **Architecture coherence doc not updated for this batch**: this follow-up introduces behavior across canvas generation, webview mutation protocol, and layout persistence; an architecture update entry for these boundaries is required by Phase A gate.
- [low] **Scope decision C is coherent and correct**: limiting `@excalidraw/mermaid-to-excalidraw` expansion remains appropriate now (`auto-layout.ts` flowchart-only async path; plan TODOs defer broader support).

### Required corrections before user checkpoint

1. Define and document `groupIds` support end-to-end:
   - extend internal element type(s) to carry group IDs,
   - assign deterministic class group ID (`class:<nodeId>`) to all class block sub-elements,
   - pass through in scene adapter (no forced empty override).
2. Define edge-routing mutation contract in Phase A interfaces:
   - extend mutation output shape for routed edges,
   - map to `canvas:edge-routed` payload with `edgeKey + waypoints (+ routing if needed)`,
   - wire host handling to `patchEdge(layout, edgeKey, { waypoints, routing? })`.
3. Specify curved-routing waypoint semantics and function signatures in design:
   - how `routeCurved`/`routeEdge` consume stored waypoints,
   - what happens when waypoints are empty vs present,
   - compatibility with existing auto/orthogonal/direct behavior.
4. Update architecture documentation for this batch’s new interaction/data flow boundaries before proceeding.

### Overall recommendation

Proceed with this batch only after the interface contracts above are made explicit and architecture docs are updated. The recommendation to **not** expand mermaid-to-excalidraw beyond flowcharts at this time should be kept.
