# Review — runtime-directives — Phase A

## PASS

- Modularity gate passes for the new Priority Y files reviewed here: `packages/hub/src/runtime-directives.ts` (64 lines), `packages/bridge-types/src/runtime-directives-types.ts` (89), `docs/20-requirements/requirements-runtime-directives.md` (108), `docs/test-plan-runtime-directives.md` (65), and `docs/30-development/mcp-tool-documentation-contract.md` (71). Each stays within the 150-line cap and has a single Phase A responsibility.
- Canonical type ownership is now clean: `packages/bridge-types/src/runtime-directives-types.ts:14-89` owns the shared runtime-directive shapes, while `packages/hub/src/runtime-directives.ts:1-27` imports/re-exports them instead of redefining them.
- The Phase A seam now covers publication, receipt, and parity abstractions required for later phases: `RuntimeDirectiveCatalog` exposes `getPublication`, `recordReceipt`, `validateParity`, and `getDiagnostics` in `packages/bridge-types/src/runtime-directives-types.ts:80-89`, and the stub mirrors that public shape in `packages/hub/src/runtime-directives.ts:35-63`.
- `/runtime-directives` and `/runtime-directives/diagnostics` are now fully represented across architecture, requirements, and test planning: see `docs/10-architecture/architecture.md:117-118`, `docs/20-requirements/requirements-runtime-directives.md:67-68`, and `docs/test-plan-runtime-directives.md:17-18` plus `:57-64`.
- Auth/security alignment is now coherent: the endpoint table declares both authenticated runtime-directives routes (`docs/10-architecture/architecture.md:117-118`), the Hub requirements specify bearer-auth behavior (`docs/20-requirements/requirements-hub.md:179-199`), and the security table includes the same routes (`docs/10-architecture/architecture.md:705`).
- Unauthorized and invalid-token coverage is explicitly planned for both new surfaces in `docs/test-plan-runtime-directives.md:57-63`.
- Scope remains correct: `docs/20-requirements/requirements-runtime-directives.md:13` and `:82-83` keep Priority Y focused on guidance consistency, delivery, diagnostics, and parity validation without changing tool-execution semantics.

## FAIL — must fix before Phase B

- None.
