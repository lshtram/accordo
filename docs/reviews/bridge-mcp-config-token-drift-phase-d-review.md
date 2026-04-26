# Review — bridge-mcp-config-token-drift — Phase D

## Verdict

**PASS**

## Scope reviewed

- `packages/bridge/src/hub-manager.ts`
- `packages/bridge/src/hub-manager-activate.ts`
- `packages/bridge/src/hub-manager-polling.ts`
- `packages/bridge/src/hub-manager-spawn.ts`
- `packages/bridge/src/hub-manager-lifecycle.ts`
- `packages/bridge/src/hub-manager-state.ts`
- `packages/bridge/src/agent-config-sync.ts`
- related tests on current HEAD, including:
  - `packages/bridge/src/__tests__/hub-manager-restart-token-ordering.test.ts`
  - `packages/bridge/src/__tests__/storage-writer-token-at-write-time.test.ts`
  - `packages/bridge/src/__tests__/token-source-contract.test.ts`
  - `packages/bridge/src/__tests__/workspace-agent-sync-target.test.ts`
  - `packages/bridge/src/__tests__/extension-config-sync-seams.test.ts`

## Evidence run on current HEAD

- `pnpm test` in `packages/bridge` → **PASS**
  - `27` files passed, `469` tests passed, zero failures
- `pnpm typecheck` in `packages/bridge` → **PASS**
- `pnpm lint` in `packages/bridge` → **PASS**

## PASS

- `hub-manager.ts` is now `118` lines and clears the reviewer modularity gate.
- Split HubManager files are focused and under the file-size limit:
  - `hub-manager.ts`
  - `hub-manager-activate.ts`
  - `hub-manager-polling.ts`
  - `hub-manager-spawn.ts`
  - `hub-manager-lifecycle.ts`
  - `hub-manager-state.ts`
  - `agent-config-sync.ts`
- CFG-07 is satisfied:
  - token is read from storage at write time in `writeAgentConfigsFromStorage()`
  - no-workspace target is a real no-op
  - missing token is surfaced as `token unavailable`
  - workspace writes flow through the real workspace config writer
- LCM-12 is satisfied:
  - hard fallback persists new credentials before ready/config-sync observers fire
  - ready notification uses the new token
  - restart ordering is covered by concrete token assertions in `hub-manager-restart-token-ordering.test.ts`
- No in-scope correctness, typecheck, lint, or package-gate failures remain on current HEAD.

## FAIL — must fix before Phase E

- None.

## Non-blockers / suggestions

- `packages/bridge/src/__tests__/storage-writer-token-at-write-time.test.ts:55` still uses a defensive `try/catch` on the success path; replacing that with an explicit success assertion would make the contract sharper.
- The remaining `"not implemented"` grep hits in reviewed scope are comment text only, not live code paths.

## In-scope vs unrelated/pre-existing failures

- **In scope remaining blockers:** none.
- **Unrelated/pre-existing remaining failures:** none observed in fresh `pnpm test`, `pnpm typecheck`, or `pnpm lint` output for `packages/bridge`.

## Freshness check against current HEAD

- Re-ran review evidence on current HEAD on `2026-04-21`.
- Confirmed `hub-manager.ts` is now below the reviewer file-length threshold.
- Confirmed prior correctness and package-gate issues remain resolved.
- No stale blockers carried forward from the previous review.
