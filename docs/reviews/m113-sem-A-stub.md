## Review — m113-sem — Phase A (Design & Stubs)

### Scope

- `docs/requirements-browser2.0.md` — §3.17 Semantic Graph (B2-SG-001..015)
- `docs/architecture.md` — §14.11 Semantic Graph
- `packages/browser-extension/src/content/semantic-graph-collector.ts` — content-script collector stub
- `packages/browser/src/semantic-graph-tool.ts` — MCP tool builder stub
- `packages/browser/src/types.ts` — `BrowserRelayAction` union update
- `packages/browser-extension/src/relay-actions.ts` — `RelayAction` union update
- `packages/browser-extension/src/content/content-entry.ts` — `PAGE_UNDERSTANDING_ACTION` dispatch
- `packages/browser/src/extension.ts` — tool registration in `allBrowserTools`

## Decision

**PASS**

### Requirements review (B2-SG-001..015)

1. **Completeness: PASS** — All 15 requirements defined with clear, testable acceptance criteria. Each covers a distinct facet: unified response (001), four sub-trees (002–005), node ID scope (006), envelope (007), input params (008–009), perf budget (010), registration (011), backward compat (012), security (013), implicit ARIA (014), and empty sub-trees (015).

2. **Traceability: PASS** — Every requirement ID maps to at least one interface element or doc comment in both the collector and tool stubs. The `@module` headers reference the full range B2-SG-001..015.

3. **No contradictions with existing requirements: PASS** — Reviewed against B2-TX-* (text map), B2-SV-* (snapshot versioning), B2-PU-* (page understanding). The node ID scope rule (B2-SG-006) is consistent with the same pattern in B2-TX-002. Snapshot envelope compliance (B2-SG-007) follows the established B2-SV-* contract.

### Architecture review (§14.11)

4. **Section completeness: PASS** — §14.11 includes: purpose, data flow diagram, type definitions, node ID scope rationale, ARIA role mapping table, password redaction, ownership boundaries (content-script vs MCP tool), performance budget (500 ms for 2000 nodes), and token cost estimate.

5. **Consistency with existing architecture: PASS** — Follows the same content-script → relay → MCP-tool pattern as §14.10 (Text Map). Single relay round-trip constraint (B2-SG-001) is documented and matches the existing `PAGE_UNDERSTANDING_ACTION` flow.

6. **No `vscode` import leakage: PASS** — Neither `semantic-graph-collector.ts` nor `semantic-graph-tool.ts` import `vscode`. The `extension.ts` import is the correct boundary (VS Code extension entry point).

### Interface coherence

7. **Type mirroring: PASS** — Both packages define the same five interfaces (`SemanticA11yNode`, `Landmark`, `OutlineHeading`, `FormField`, `FormModel`) with identical shapes. Content-script result type (`SemanticGraphResult`) extends `SnapshotEnvelope`; MCP-tool result type (`SemanticGraphResponse`) extends `SnapshotEnvelopeFields`. This mirrors the M112-TEXT pattern exactly.

8. **Input schema bounds: PASS** — `maxDepth` has `type: "integer"`, `minimum: 1`, `maximum: 16` in the JSON Schema. This matches B2-SG-008 and avoids the issue flagged in the M112-TEXT Phase A review.

9. **Error classification: PASS** — `SemanticGraphToolError` defines a union of `"browser-not-connected" | "timeout" | "action-failed"` which covers all relay failure modes. `classifyRelayError()` maps unknown errors conservatively to `"timeout"`.

### Stub quality

10. **Compilability: PASS** — `npx tsc --noEmit` passes in both `packages/browser` and `packages/browser-extension` with zero errors.

11. **Importability: PASS** — Content-entry dispatch lazily imports `collectSemanticGraph` in the `PAGE_UNDERSTANDING_ACTION` handler. `extension.ts` imports `buildSemanticGraphTool` and adds it to `allBrowserTools`.

12. **Stub behaviour: PASS** — `collectSemanticGraph()` throws `"not implemented"`. `handleGetSemanticGraph()` has a full relay dispatch skeleton (pre-flight connection check, relay request, envelope validation, error classification) — implementation is in the relay call and response parsing, which will come in Phase C.

13. **Test baseline preserved: PASS** — All 999 existing tests pass (browser-extension: 664, browser: 335).

### Relay routing

14. **Relay action registration: PASS** — `"get_semantic_graph"` added to both `BrowserRelayAction` (MCP tool side) and `RelayAction` (extension side) unions. No `handleRelayAction` case needed — this follows the M112-TEXT pattern where `PAGE_UNDERSTANDING_ACTION` routes directly through `content-entry.ts`.

15. **Content-entry dispatch: PASS** — New `else if (action === "get_semantic_graph")` block follows the established lazy-import pattern with `Parameters<typeof collectSemanticGraph>[0]` type assertion, consistent with `get_text_map` and other actions.

### Items noted (non-blocking)

- **Dual type definitions** — Five interfaces are defined in both packages. This is the existing project pattern (content-script has no shared types package), but could be a future refactoring target if the type count grows. Not a Phase A blocker.
- **`RelayAction` / `BrowserRelayAction` drift** — These unions are manually kept in sync. A shared types package would prevent drift. Known existing tech debt, not introduced by this module.

## Phase-A gate outcome for project-manager

Phase-A review is clean. All 15 requirements defined, architecture section coherent, interfaces compilable, stubs importable, relay routing wired, test baseline preserved. **M113-SEM Phase A passes; proceed to Phase B.**
