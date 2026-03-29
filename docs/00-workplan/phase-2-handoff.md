# Phase 2 Handoff — Wave 1 Modularity Split

**Date:** 2026-03-29
**Committed by:** project-manager (Phase F complete)
**Baseline commit:** `b789aa9` (feat(bridge-types): split monolithic index.ts)
**Workplan:** `docs/00-workplan/workplan.md`

---

## Phase 1 Summary

**`b789aa9`** — `bridge-types` split into 5 domain files + barrel export + ESLint + downstream typecheck.

| Check | Result |
|---|---|
| `pnpm --filter @accordo/bridge-types test` | ✅ 10 tests pass |
| `pnpm --filter accordo-hub exec tsc --noEmit` | ✅ 0 errors |
| `pnpm --filter accordo-bridge exec tsc --noEmit` | ✅ 0 errors |
| `pnpm --filter @accordo/bridge-types run lint` | ✅ Exit 0 |
| `pnpm --filter @accordo/bridge-types run typecheck` | ✅ Exit 0 |

**Phase 1 gate is PASS.** Phase 2 is unblocked.

---

## Phase 2 Overview

**5 agents in parallel** — B1, B2, B3, B4 (sequential sub-steps), B5 (sequential sub-steps).

### Universal success criteria (all agents)

| Criterion | Definition |
|---|---|
| **API parity** | Exported symbol set unchanged (or delta documented explicitly) |
| **Behavior parity** | All package tests unchanged and green after refactor |
| **Type parity** | `tsc --noEmit` clean for the package |
| **Build parity** | Package `build` script clean |
| **Size target** | Original file → <250 LOC; no new file >300 LOC |
| **No cross-package deps** | No new cross-package runtime dependencies introduced |
| **Hub/Bridge auth** | Auth middleware and endpoint contract tests must still pass |

### TDD enforcement
- Each agent follows full TDD: Architect → Reviewer A → Test Builder → Developer → Reviewer D2 → Phase E → Phase F
- Tests must be written BEFORE implementation (failing tests demonstrating the refactor is safe)
- Review checkpoints are blocking — do not skip

---

## Agent B1 — `hub/server.ts` decomposition

**Package:** `packages/hub`
**Package name for pnpm:** `accordo-hub`
**Current test count:** 376 tests (all green)

### Target files

| File | LOC | Role |
|---|---|---|
| `src/server.ts` | 615 | **Split this** → delegation shell after split |
| `src/server-routing.ts` | **NEW** | HTTP routing dispatcher + auth middleware chain |
| `src/server-sse.ts` | **NEW** | SSE endpoint setup + connection management |
| `src/server-mcp.ts` | **NEW** | MCP protocol handler wiring |
| `src/server-reauth.ts` | **NEW** | Reauth flow logic |

### Modularity rationale
From `full-project-modularity-plugin-review-2026-03-29.md` §4 item 1: "Hub server mixes routing/auth/SSE/MCP wiring — `packages/hub/src/server.ts` (`handleHttpRequest`, endpoint handlers)."

### Key constraints
- `handleHttpRequest` is the hotspot — extract routing/auth into separate modules
- Auth middleware must remain FIRST on every authenticated endpoint (AGENTS.md §4.2)
- Do NOT change the WebSocket protocol or message types
- `HubToBridgeMessage` / `BridgeToHubMessage` unions must stay compatible

### Import stability note
`hub` imports from `@accordo/bridge-types` via the barrel (`import type { IDEState } from "@accordo/bridge-types"`). This must NOT change — no subpath imports.

---

## Agent B2 — `bridge/extension.ts` decomposition

**Package:** `packages/bridge`
**Package name for pnpm:** `accordo-bridge`
**Current test count:** 334 tests (all green)

### Target files

| File | LOC | Role |
|---|---|---|
| `src/extension.ts` | 726 | **Split this** → thin bootstrap/composition after split |
| `src/extension-bootstrap.ts` | **NEW** | VSCode activation event, context setup |
| `src/extension-composition.ts` | **NEW** | Tool registration, state publisher wiring |
| `src/extension-service-factory.ts` | **NEW** | Service instantiation (MCP client, webview, etc.) |

### Modularity rationale
From review §4 item 1: "Bridge composition root too large — `packages/bridge/src/extension.ts` (`activate`)."

### Key constraints
- VSCode imports (`vscode`, `window`, `workspace`, etc.) stay in `extension-bootstrap.ts`
- No `vscode` imports in Hub packages (AGENTS.md §4.1 — hard failure)
- Tool registration flow (`registerTools`, `createMcpClient`, etc.) goes into composition
- Service factory handles instantiation of webview panels, MCP clients

### Import stability note
`bridge` imports from `@accordo/bridge-types` via the barrel. Same constraint as B1.

---

## Agent B3 — `voice`, `diagram`, `editor` leaf splits

**Package:** `packages/voice`, `packages/diagram`, `packages/editor`
**pnpm names:** `accordo-voice`, `accordo-diagram`, `accordo-editor`
**Test counts:** voice=301 ✅, diagram=463 ✅, editor=182 ✅

All three are **fully parallel to each other** and to B1/B2.

### Voice — `packages/voice/src/extension.ts` (806 LOC → split)

| File | LOC | Role |
|---|---|---|
| `src/extension.ts` | 806 | **Split this** → thin bootstrap after split |
| `src/voice-bootstrap.ts` | **NEW** | VSCode activation, context wiring |
| `src/voice-runtime.ts` | **NEW** | Runtime selection (fork subprocess vs HTTP adapter) |
| `src/voice-adapters.ts` | **NEW** | Adapter instantiation (kokoro, faster-whisper, sherpa) |

Modularity rationale (review §4 item 12): "Voice extension entrypoint does heavy orchestration/runtime selection — `packages/voice/src/extension.ts` (`activate`)."

### Diagram — `packages/diagram/src/webview/panel.ts` (763 LOC → split)

| File | LOC | Role |
|---|---|---|
| `src/webview/panel.ts` | 763 | **Split this** → focused `DiagramPanel` class after split |
| `src/webview/panel-core.ts` | **NEW** | Core rendering + Mermaid parsing |
| `src/webview/panel-commands.ts` | **NEW** | VSCode command registration + webview message handling |
| `src/webview/panel-state.ts` | **NEW** | Diagram state machine (loading, error, ready) |

Modularity rationale (review §4 item 11): "Diagram panel class has too many responsibilities — `packages/diagram/src/webview/panel.ts` (`DiagramPanel`)."

### Editor — `packages/editor/src/tools/editor.ts` (594 LOC → split)

| File | LOC | Role |
|---|---|---|
| `src/tools/editor.ts` | 594 | **Split this** → focused tool definitions after split |
| `src/tools/editor-definitions.ts` | **NEW** | `editor_edit_file`, `editor_read_file`, etc. schema definitions |
| `src/tools/editor-handlers.ts` | **NEW** | Handler implementations for each tool |

Modularity rationale: `editor/tools/editor.ts` mixes schema + handler in one file. The split follows the same pattern used in `comments` and other well-structured tool packages.

### Editor package note
`packages/editor/src/extension.ts` is only 72 LOC (already clean — no split needed there).

---

## Agent B4 — `comments` decomposition (sequential: B4a → B4b)

**Package:** `packages/comments`
**pnpm name:** `accordo-comments`
**Current test count:** 354 tests (all green)

### B4a — Extract `comment-repository.ts` (zero vscode imports)

**Must complete before B4b** (tools depend on store behavior).

| File | LOC | Role |
|---|---|---|
| `src/comment-store.ts` | 633 | Refactor to delegate to `comment-repository.ts` |
| `src/comment-repository.ts` | **NEW** | Core comment operations — NO vscode imports |
| `src/vscode-comment-repository.ts` | **NEW** | VSCode-specific adapter (fs, event emitters) wrapping `comment-repository` |

Modularity rationale (review §4 item 6): "Comment store persistence coupled directly to VSCode fs/events — `packages/comments/src/comment-store.ts`."

### B4b — Split `comment-tools.ts` into definitions + handlers

**Runs after B4a completes.**

| File | LOC | Role |
|---|---|---|
| `src/comment-tools.ts` | 676 | **Split this** → tool schema + handler composition |
| `src/comment-definitions.ts` | **NEW** | All `createCommentTool` schemas (JSON schemas for each tool) |
| `src/comment-handlers.ts` | **NEW** | Handler implementations calling `comment-store` |

Modularity rationale (review §4 item 7): "Comment tools combine schema definitions + handler logic in one file — `packages/comments/src/comment-tools.ts` (`createCommentTools`)."

---

## Agent B5 — `browser-extension` decomposition (sequential: B5a → shim → B5b → cleanup)

**Package:** `packages/browser-extension`
**pnpm name:** `browser-extension`
**Current test count:** 764 tests (all green)

### B5a — Extract `relay-actions` per-feature handlers + compatibility shim

**Must complete before B5b** (service-worker imports from relay-actions).

| File | LOC | Role |
|---|---|---|
| `src/relay-actions.ts` | 868 | **Split this** → relay action dispatch |
| `src/relay-definitions.ts` | **NEW** | Action schema definitions |
| `src/relay-handlers.ts` | **NEW** | Per-feature handlers (text_map, semantic_graph, diff_snapshots, etc.) |
| `src/relay-forwarder.ts` | **NEW** | Bridge forwarding logic |
| `src/relay-actions-compat.ts` | **NEW** | Temporary shim re-exporting from new modules (for service-worker) |

Modularity rationale (review §4 item 4): "Action switch monolith — `packages/browser-extension/src/relay-actions.ts` (`handleRelayAction`)."

### B5b — Split `service-worker.ts` into focused modules

**Runs after B5a shim is in place.**

| File | LOC | Role |
|---|---|---|
| `src/service-worker.ts` | 671 | **Split this** → focused service worker entry |
| `src/sw-runtime.ts` | **NEW** | Service worker lifecycle + Chrome message routing |
| `src/sw-store.ts` | **NEW** | Tab state management, snapshot versioning |
| `src/sw-relay.ts` | **NEW** | Relay forwarding to CDP/Bridge |

### B5 cleanup — Remove compatibility shim

After B5b confirms the split works, remove `relay-actions-compat.ts` and update all imports.

---

## Phase 2 gating after all agents complete

After all 5 agents commit their splits:

```bash
pnpm -r typecheck   # must be zero errors across all packages
pnpm -r test        # all tests green
pnpm -r build       # all packages build cleanly
```

If any package fails, that agent rolls back and fixes before proceeding.

---

## Key files to read before starting

| File | Why |
|---|---|
| `docs/00-workplan/workplan.md` §§ Phase 2 | Full specification + success criteria |
| `docs/50-reviews/full-project-modularity-plugin-review-2026-03-29.md` | Detailed rationale for each split |
| `docs/30-development/coding-guidelines.md` | Non-negotiable code standards |
| `AGENTS.md` | TDD process, mode routing, architecture constraints |
| `~/.config/opencode/dev-process.md` | Full TDD cycle reference |

## Key architecture constraints (from AGENTS.md §4)

1. **No VSCode imports in Hub packages** — `vscode` imports in `accordo-hub` are a hard failure
2. **Security middleware comes first** on every authenticated HTTP endpoint in Hub
3. **Handler functions are never serialized** — `ExtensionToolDefinition.handler` stays Bridge-side only, never crosses the wire
4. **Barrel export stability** — no `@accordo/bridge-types/*` subpath imports anywhere (Phase 1 enforcement)

## Current baseline commit

```
b789aa9 feat(bridge-types): split monolithic index.ts into 5 domain type files
0accb10 docs(workplan): mark MOD-P1-01 done, Phase 1 complete, Phase 2 ready to launch
```

All Phase 2 target packages are GREEN at this commit:
- `accordo-hub`: 376 tests ✅
- `accordo-bridge`: 334 tests ✅
- `accordo-voice`: 301 tests ✅
- `accordo-diagram`: 463 tests ✅
- `accordo-comments`: 354 tests ✅
- `accordo-editor`: 182 tests ✅
- `browser-extension`: 764 tests ✅