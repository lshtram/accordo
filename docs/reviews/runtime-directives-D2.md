## Review — runtime-directives — Phase D2

### PASS
- Tests: `pnpm test` in `packages/hub` completed with 621 passing, 15 skipped, zero failures.
- Type check: `pnpm typecheck` in `packages/hub` is clean.
- Lint: `pnpm lint` in `packages/hub` is clean.
- `/instructions`, `initialize`, `/runtime-directives`, and `/runtime-directives/diagnostics` are now wired to the runtime-directives catalog in the reviewed scope.
- Updated publication/diagnostics endpoint tests now assert exact `200` responses instead of permissive `200 | 404` fallbacks.

### FAIL — must fix before Phase E
- `packages/hub/src/mcp-dispatch.ts:1` — Modularity gate failed. The file is 405 lines, well above the 150-line hard limit, and still owns request dispatch, initialize instruction composition, receipt recording, and response logging. This is an automatic blocker under the iron rule. — **Done when:** the file is split into focused modules so each file is `<=150` lines and each exported unit has one responsibility.

- `packages/hub/src/server-routing.ts:1` — Modularity gate failed. The file is 384 lines and combines route table definition, auth middleware, endpoint rendering, and router orchestration in one unit. This is an automatic blocker under the iron rule. — **Done when:** route descriptors, auth wrappers, and endpoint responders are separated so every file is `<=150` lines and each file has a single responsibility.

- `packages/hub/src/server.ts:1` — Modularity gate failed. The file is 342 lines and still mixes Hub composition, Bridge/SSE wiring, router setup, health/state projection, and lifecycle management. This is an automatic blocker under the iron rule. — **Done when:** server construction and runtime wiring are decomposed into smaller focused modules so every file is `<=150` lines and each function stays within the modularity limits.

- `packages/hub/src/runtime-directives/catalog.ts:79` — `validateParity()` only verifies that caller-supplied clause IDs exist; it does not compare a surface against the canonical set of clauses required for that surface. Missing required clauses on `initialize`, `/instructions`, or tool-description reinforcement targets therefore still report `ok: true`, which does not satisfy Y-09/Y-10/Y-13. — **Done when:** parity validation computes the canonical required clause IDs per surface, fails on omissions and undeclared references, and production tests assert those failures against `RuntimeDirectiveCatalogImpl`.

- `packages/hub/src/runtime-directives/canonical-clauses.ts:15` — The canonical bundle still does not match the approved Priority Y clause set in `requirements-runtime-directives.md` §4. It introduces unrelated mandatory behavior (for example the explicit `skill-tester` / `tdd-guide` / `test-master` routing wording) while omitting required existing guidance such as “use Accordo tools for editor/file/UI operations when available” and the explicit rule that tool descriptions are secondary to `initialize` and `/instructions`. That breaks Y-01/Y-04/Y-05/Y-12. — **Done when:** the canonical clauses are rewritten to cover the approved §4 mandatory directives exactly, no new mandatory behavior is introduced, and parity tests assert those exact clauses across runtime surfaces.
