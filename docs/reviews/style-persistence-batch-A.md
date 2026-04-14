## Review — style-persistence-batch — Phase A

### FAIL — must fix before checkpoint

- [HIGH] `packages/diagram/src/types.ts` — `NodeStyle` and `EdgeStyle` do not yet expose `roundness?: number | null`; interfaces do not cover the stated persistence scope.
- [HIGH] Cross-module contract conflict (`types.ts` / `canvas/edge-router.ts`) — proposed “edge route intent lives only in `EdgeStyle.roundness`” is not coherent with existing route-strategy semantics (`routing: auto|curved|orthogonal|direct`) and waypoint behavior; orthogonal/direct intent cannot be represented by roundness alone.
- [MEDIUM] `packages/diagram/src/webview/message-handler.ts` — current style diffing does not include edge/node `roundness` detection; reusing `canvas:node-styled` is viable, but the detection contract is incomplete.
- [MEDIUM] `packages/diagram/src/canvas/canvas-generator.ts` — node rendering currently uses shape defaults (`shapeProps.roundness`) and has no explicit override path from `NodeStyle.roundness`; precedence rule is not yet encoded.
- [MEDIUM] `docs/30-development/diagram-update-plan.md` — new batch decisions are not captured as Phase A interface targets/signatures; architecture coherence checkpoint is incomplete.

### Required corrections before user checkpoint

1. Add `roundness?: number | null` to both `NodeStyle` and `EdgeStyle` in `types.ts`, with comments defining semantics and null behavior.
2. Finalize and document one coherent split of responsibilities:
   - `EdgeLayout.routing` = geometric path strategy (auto/orthogonal/direct/curved),
   - `EdgeStyle.roundness` = visual corner curvature only.
   Do not collapse geometric routing into style roundness.
3. Extend mutation detection (`detectNodeMutations`) to emit `roundness` changes for supported elements so `canvas:node-styled` can persist them.
4. Define and implement precedence in generator path: explicit `NodeStyle.roundness` overrides shape default, but only for rectangle-family shapes; non-applicable shapes ignore it.
5. Update `diagram-update-plan.md` with explicit Phase A interface/signature targets for this batch.

### Overall recommendation

Do not proceed to B-phase tests yet. First lock the interface and ownership model (routing vs visual roundness), then add the minimal signature/diffing contracts so tests can be written against stable behavior.
