# Accordo IDE — Modularity & Runtime-Decoupling Workplan (Two Waves)

**Date:** 2026-03-29  
**Source reviews:**
- `../50-reviews/browser-stack-readability-modularity-review-2026-03-29.md`
- `../50-reviews/full-project-modularity-plugin-review-2026-03-29.md`

---

## 1) Goal and strategy

This plan is intentionally split into **two waves**:

- **Wave 1 (Committed):** improve code quality, readability, modularity, and component boundaries **without requiring VSCode separation yet**.
- **Wave 2 (Optional):** enable non-VSCode runtime paths (portable comments core + alternative bridge host/runtime).

Design principle: Wave 1 should leave the codebase naturally easier to detach later, even if not explicitly detached yet.

---

## 2) Success criteria

### Wave 1 success criteria

1. Major hotspot files are split into focused modules.
2. Each package has a clear composition root and clear internal boundaries.
3. Cross-package contracts are explicit and centralized (less stringly coupling).
4. Each extension is easier to onboard and assign as a small, isolated task area.
5. No functional regressions.

### Wave 2 success criteria (if executed)

1. Comments domain runs via a pure core package with pluggable repositories.
2. Bridge logic has host/runtime abstractions supporting both VSCode host and non-VSCode host.
3. Plugin capability contracts allow feature selection with reduced hard runtime coupling.

---

## 3) Baseline package ratings (from review)

| Package | Readability | Modularity | Interface Clarity | Standalone Viability |
|---|---:|---:|---:|---:|
| hub | 6 | 5 | 7 | 8 |
| bridge | 5 | 5 | 6 | 3 |
| bridge-types | 6 | 4 | 7 | 9 |
| comments | 6 | 5 | 6 | 3 |
| comment-sdk | 7 | 6 | 7 | 8 |
| browser-extension | 5 | 5 | 6 | 8 |
| browser | 6 | 5 | 6 | 3 |
| diagram | 6 | 5 | 6 | 4 |
| md-viewer | 7 | 6 | 6 | 4 |
| marp | 7 | 6 | 7 | 4 |
| script | 7 | 7 | 7 | 5 |
| voice | 6 | 5 | 6 | 4 |
| editor | 8 | 7 | 8 | 3 |

Primary hotspots:
- `bridge/src/extension.ts`
- `hub/src/server.ts`
- `comments/src/comment-tools.ts`
- `comments/src/comment-store.ts`
- `browser-extension/src/service-worker.ts`
- `browser-extension/src/relay-actions.ts`
- `voice/src/extension.ts`
- `diagram/src/webview/panel.ts`
- `bridge-types/src/index.ts`

---

## 4) Wave 1 — Code quality & modularity (no runtime detachment required)

## W1-A. Contract hygiene and shared boundaries

### A1. Split `bridge-types` monolith by domain
- **Current:** `packages/bridge-types/src/index.ts` is a single large file.
- **Target:**
  - `src/ide-state.ts`
  - `src/tool-contracts.ts`
  - `src/ws-messages.ts`
  - `src/comments.ts`
  - `src/constants.ts`
  - `src/index.ts` (stable barrel re-export)
- **Outcome:** faster discovery, lower accidental cross-domain coupling.

### A2. Centralize browser relay action/message contract
- **Current:** action names and mapping logic are spread.
- **Target:** single shared contract module (type + constants), consumed by `browser` and `browser-extension`.
- **Outcome:** reduced string drift, safer refactors.

### A3. Normalize tool response shapes where overloaded
- **Current:** some handlers use mode-dependent output shape.
- **Target:** consistent response schemas; separate tool/flag only when necessary.
- **Outcome:** cleaner interfaces and less caller-specific glue.

---

## W1-B. Composition-root slimming (large activate/server files)

### B1. Bridge extension decomposition
- **From:** `packages/bridge/src/extension.ts`
- **Extract to:**
  - `bridge-bootstrap.ts`
  - `hub-connection-orchestrator.ts`
  - `bridge-api-factory.ts`
  - `settings-sync.ts`
- **Outcome:** small orchestration units, easier ownership.

### B2. Hub server decomposition
- **From:** `packages/hub/src/server.ts`
- **Extract to:**
  - `http-router.ts`
  - `mcp-http-handler.ts`
  - `sse-broker.ts`
  - `reauth-handler.ts`
- **Outcome:** endpoint behavior is modular and replaceable.

### B3. Comments extension decomposition
- **From:** `packages/comments/src/extension.ts`
- **Extract to:**
  - `comments-bootstrap.ts` → ✅ DONE
  - `panel-bootstrap.ts` → ✅ DONE
  - `bridge-integration.ts` → ✅ DONE — this IS the internal command registry (5/6 commands)
  - `internal-command-registry.ts` → ⚠️ NOT EXTRACTED — `expandThread` correctly remains in `native-comment-controller.ts` because it operates on the VSCode widget map; extracting it would create a bad dependency on controller internals
- **Outcome:** ✅ COMPLETE — all commands properly located by concern; data commands in `bridge-integration.ts`, UI command in `native-comment-controller.ts`

---

## W1-C. Feature-slice splitting in high-complexity packages

### C1. Browser extension service worker split
- **From:** `browser-extension/src/service-worker.ts`
- **Extract to:**
  - `message-router.ts`
  - `comment-sync-service.ts`
  - `relay-sync.ts`
  - `bootstrap.ts`

### C2. Browser relay actions split
- **From:** `browser-extension/src/relay-actions.ts`
- **Extract to:**
  - `actions/comments-actions.ts`
  - `actions/page-actions.ts`
  - `actions/capture-actions.ts`
  - `actions/diff-actions.ts`
  - shared `action-forwarder.ts`

### C3. Comments tools split
- **From:** `comments/src/comment-tools.ts`
- **Extract to:**
  - `comment-tools/definitions.ts`
  - `comment-tools/handlers.ts`
  - `comment-tools/rate-limiter.ts`

### C4. Comments store split by concern
- **From:** `comments/src/comment-store.ts`
- **Extract to:**
  - `comment-domain.ts`
  - `thread-index.ts`
  - `comment-repository-vscode.ts`
  - `retention-policy.ts`

### C5. Voice extension split
- **From:** `voice/src/extension.ts`
- **Extract to:**
  - `voice-bootstrap.ts`
  - `provider-factory.ts`
  - `tool-registration.ts`
  - `ui-wiring.ts`

### C6. Diagram panel split
- **From:** `diagram/src/webview/panel.ts`
- **Extract to:**
  - `panel-lifecycle.ts` → ✅ DONE: `panel-state.ts` (122 LOC)
  - `panel-message-router.ts` → ✅ DONE: `panel-core.ts` (277 LOC)
  - `panel-export-service.ts` → ✅ DONE: in `panel-core.ts` (export request is thin public method)
  - `panel-comments-adapter.ts` → ✅ DONE: `../comments/diagram-comments-bridge.js`
- **Status:** ✅ COMPLETE — split achieved; naming differs from plan but responsibilities correctly decomposed

---

## W1-D. Interface clarity and dependency direction hardening

### D1. Introduce per-package module maps (`docs/module-map-<package>.md`)
- Explain composition root, key modules, and extension points.
- 🔲 IN PROGRESS — maps for 7 packages: bridge, comments, browser-extension, browser, diagram, voice, hub

### D2. Add "public interface" files per package
- `src/public-api.ts` (or equivalent) to document what is stable/internal.
- ✅ DECIDED: Do NOT create separate `public-api.ts` files — use existing barrel `index.ts` with header comments documenting public/internal boundary. Follow `comments/src/index.ts` pattern.

### D3. Reduce implicit inter-extension command coupling where possible
- Keep internal commands, but route through typed adapter boundaries.
- ✅ DONE — `@accordo/capabilities` typed `CAPABILITY_COMMANDS` replaces all raw string commands

### D4. Cleanup incomplete abstraction surfaces
- Either fully implement or explicitly quarantine stubs (no ambiguous "half-live" modules).
- 🔲 IN PROGRESS — 13 stubs in `comment-backend.ts` to be quarantined with `@stub`/`@planned` JSDoc

---

## W1-E. Work packaging / execution order

### Sprint 1 (foundation) — ✅ COMPLETE
1. A1 `bridge-types` split ✅
2. A2 browser relay contract centralization ✅
3. B1 bridge extension decomposition (first slice) ✅

### Sprint 2 (runtime orchestrators) — ✅ COMPLETE
4. B2 hub server decomposition ✅
5. B3 comments extension decomposition ✅
6. C3 comments tools split ✅

### Sprint 3 (browser complexity) — ✅ COMPLETE
7. C1 service-worker split ✅
8. C2 relay-actions split ✅
9. D4 stub cleanup/quarantine 🔲 IN PROGRESS

### Sprint 4 (modularity hotspots) — 🔲 IN PROGRESS
10. C5 voice split ✅
11. C6 diagram panel split ✅ (achieved via panel-state.ts, panel-core.ts, panel-commands.ts)
12. D1 module maps + D2 public interface docs 🔲 IN PROGRESS

---

## 5) Wave 2 — Optional non-VSCode runtime enablement

> Execute only after Wave 1 is stable.

## W2-A. Comments core portability

### A1. Create `packages/comments-core` (pure domain package)
- No `vscode` imports.
- Owns thread/comment domain behavior and business rules.

### A2. Repository interface + adapters

```ts
interface CommentRepository {
  load(): Promise<CommentStoreFile | null>;
  save(file: CommentStoreFile): Promise<void>;
}
```

- `comments/src/repo/vscode-repository.ts`
- `comments-node/src/repo/node-fs-repository.ts` (new)

### A3. Keep `accordo-comments` as VSCode adapter package
- Host UI and native comment projection stay here.

---

## W2-B. Bridge/runtime portability

### B1. Create `packages/bridge-core`
- Registry/router/protocol coordination without VSCode APIs.

### B2. Define host environment port

```ts
interface HostEnvironment {
  getState(): Promise<Record<string, unknown>>;
  confirmTool(name: string, args: unknown): Promise<boolean>;
  log(level: "debug"|"info"|"warn"|"error", msg: string): void;
}
```

### B3. Implement host adapters
- `bridge-vscode-host` (current behavior)
- `bridge-node-host` (headless/non-VSCode)

---

## W2-C. Plugin capability model

### C1. Introduce capabilities package (contracts only)
- `ICommentsService`, `IToolRegistry`, `IStatePublisher`, `ISurfaceCommentAdapter`

### C2. Runtime capability discovery
- Replace hard assumptions with optional capability negotiation.

### C3. Deployment profiles
- VSCode profile
- Headless profile

---

## 6) Governance rules for both waves

1. Refactors should be **behavior-preserving** unless explicitly scoped otherwise.
2. Split large files only with clear API seams and ownership docs.
3. New cross-package dependency requires explicit justification.
4. No new stringly cross-package contracts if typed alternative exists.
5. Every major split includes a short migration note in package docs.

---

## 7) Tracking template (for each module)

Use this checklist for each work item:

- [ ] Current responsibilities documented
- [ ] Target module boundaries defined
- [ ] Public interfaces defined
- [ ] Internal dependencies inverted/contained
- [ ] Old module slimmed or removed
- [ ] Package/module map updated
- [ ] No behavioral drift verified

---

## 8) Recommended first 10 implementation tasks

1. Split `bridge-types/index.ts` into domain modules.
2. Add shared browser relay action/message contract.
3. Extract bridge bootstrap/orchestration from `bridge/src/extension.ts`.
4. Extract hub router + SSE broker from `hub/src/server.ts`.
5. Split comments tools definitions/handlers.
6. Split comments extension bootstrap from command and panel wiring.
7. Split browser-extension service-worker router from sync logic.
8. Split browser-extension relay-actions into feature slices.
9. Split voice extension into bootstrap/factory/registration modules.
10. Split diagram panel lifecycle/message/export responsibilities.

---

This workplan is intended to be the execution bridge between the recent review findings and implementation planning.
