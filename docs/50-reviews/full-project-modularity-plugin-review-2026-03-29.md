# Full Project Review — Modularity, Plugin Separation, and VSCode-Independent Readiness

**Date:** 2026-03-29  
**Scope:** all packages under `packages/`  
**Primary lens:** readability, small/simple components, clear interfaces, replaceability, plugin-style architecture readiness.

---

## 1) Executive summary

The project has a **strong conceptual architecture** (Hub + Bridge + modality extensions + shared contracts), but implementation is currently **mid-tier modularity** rather than “small interchangeable units.”

### Overall score (vs your target architecture)

- **Readability:** 6/10
- **Modularity:** 5/10
- **Interface clarity:** 6/10
- **Replaceability/plugin readiness:** 5/10

In short: good base, but still too many large mixed-responsibility modules and too much coupling through central shared contracts.

---

## 2) Package-by-package stand-alone ratings

Scored as components in their current form.

| Package | Readability | Modularity | Interface Clarity | Standalone Viability | Notes |
|---|---:|---:|---:|---:|---|
| `hub` | 6 | 5 | 7 | 8 | Good standalone runtime role; `server.ts`/`bridge-server.ts` are large orchestration hotspots. |
| `bridge` | 5 | 5 | 6 | 3 | Clear API idea, but deeply VSCode-bound and very large composition root (`src/extension.ts`). |
| `bridge-types` | 6 | 4 | 7 | 9 | Useful shared contract package, but too monolithic (`src/index.ts` ~744 LOC). |
| `comments` | 6 | 5 | 6 | 3 | Core domain is strong, but store/tools/native/panel are tightly interwoven and VSCode-aware. |
| `comment-sdk` | 7 | 6 | 7 | 8 | Most portable UI component; could be even cleaner with further split of `sdk.ts`. |
| `browser-extension` | 5 | 5 | 6 | 8 | Standalone runtime exists; service-worker and relay actions are very large and mixed. |
| `browser` | 6 | 5 | 6 | 3 | Useful adapter extension but coupled to bridge/comments and stringly action mapping. |
| `diagram` | 6 | 5 | 6 | 4 | Conceptually separable, but webview panel/tooling files are very large and host-coupled. |
| `md-viewer` | 7 | 6 | 6 | 4 | Relatively manageable size; still hard-coupled to comments internal command path. |
| `marp` | 7 | 6 | 7 | 4 | Session/tool separation is okay; still VSCode extension-coupled in runtime and activation. |
| `script` | 7 | 7 | 7 | 5 | Better size/cohesion than many packages; could evolve into portable script runner core. |
| `voice` | 6 | 5 | 6 | 4 | Clear domain decomposition exists, but `extension.ts` is huge and runtime adapters are tightly integrated. |
| `editor` | 8 | 7 | 8 | 3 | Clean and relatively small extension entry; terminal/layout/panes are modules, not separate plugins yet. |

---

## 3) Structural separation quality (cross-package)

### What is already good

1. `@accordo/bridge-types` gives a central protocol/type vocabulary.
2. `@accordo/comment-sdk` enables surface reuse (browser extension, diagram, md-viewer).
3. Most modality extensions depend on Bridge API rather than direct Hub calls.
4. Many extensions already fail gracefully when bridge/comments are unavailable.

### Current separation bottlenecks

1. **Bridge as single hard runtime choke point** for many extensions.
2. **Comments domain is not isolated from VSCode host APIs** (`comments/src/comment-store.ts` imports `vscode`).
3. **Stringly action/tool contracts** spread between browser packages (`browser` + `browser-extension` + comments tools).
4. **Oversized files reduce local ownership boundaries**:
   - `packages/browser-extension/src/relay-actions.ts` (~712)
   - `packages/browser-extension/src/service-worker.ts` (~671)
   - `packages/bridge/src/extension.ts` (~618)
   - `packages/hub/src/server.ts` (~615)
   - `packages/comments/src/comment-tools.ts` (~676)
   - `packages/comments/src/comment-store.ts` (~628)
   - `packages/voice/src/extension.ts` (~776)
   - `packages/diagram/src/webview/panel.ts` (~763)

---

## 4) Top 15 architecture/readability issues (with concrete references)

1. **Bridge composition root too large** — `packages/bridge/src/extension.ts` (`activate`).
2. **Hub server mixes routing/auth/SSE/MCP wiring** — `packages/hub/src/server.ts` (`handleHttpRequest`, endpoint handlers).
3. **Browser SW mixes sync/store/relay/domain translation** — `packages/browser-extension/src/service-worker.ts`.
4. **Action switch monolith** — `packages/browser-extension/src/relay-actions.ts` (`handleRelayAction`).
5. **Comments extension bootstraps too many concerns in one place** — `packages/comments/src/extension.ts` (`activate`).
6. **Comment store persistence coupled directly to VSCode fs/events** — `packages/comments/src/comment-store.ts`.
7. **Comment tools combine schema definitions + handler logic in one file** — `packages/comments/src/comment-tools.ts` (`createCommentTools`).
8. **Bridge-types is a single giant index for many domains** — `packages/bridge-types/src/index.ts`.
9. **Browser relay mapping is stringly and manually synchronized** — `packages/browser/src/extension.ts` (`browserActionToUnifiedTool`).
10. **Diagram extension orchestration + command wiring + registry in one module** — `packages/diagram/src/extension.ts`.
11. **Diagram panel class has too many responsibilities** — `packages/diagram/src/webview/panel.ts` (`DiagramPanel`).
12. **Voice extension entrypoint does heavy orchestration/runtime selection** — `packages/voice/src/extension.ts` (`activate`).
13. **md-viewer relies on internal command to fetch store adapter** — `packages/md-viewer/src/extension.ts` (`accordo_comments_internal_getStore` usage).
14. **Some contracts return inconsistent shapes depending on flags** — `packages/comments/src/comment-tools.ts` (`comment_list` detail/browser path).
15. **Browser-extension backend abstraction incomplete** — `packages/browser-extension/src/adapters/comment-backend.ts` (`not implemented` adapter methods).

---

## 5) Plugin architecture readiness (pick-and-choose components)

### Already aligned with plugin model

- Most features are already separate packages.
- Bridge API (`registerTools`, `publishState`) acts as plugin registration seam.
- Hub consumes registered tools generically.

### Main blockers

1. **Runtime assumption that Bridge exists** in most extension flows.
2. **Comments as central dependency for multiple surfaces** with internal command coupling.
3. **No explicit plugin manifest/capability negotiation layer** (dependencies are mostly static `extensionDependencies`).
4. **No standard “feature capability contract”** per extension (what it provides + what optional deps it can consume).

### Required boundaries for real plugin mode

1. **Capability interfaces package** (e.g., `@accordo/capabilities`) with contracts like:
   - `ICommentsService`
   - `IToolRegistry`
   - `IStatePublisher`
   - `ISurfaceCommentAdapter`
2. **Optional dependency resolution** (runtime discovery with graceful fallback), not hardcoded chain assumptions.
3. **Per-plugin composition roots** with no direct imports across feature packages beyond interfaces.
4. **Feature flags/pack profiles** for selecting installed capabilities.

---

## 6) VSCode-independent mode gap analysis

Target: keep current VSCode mode, add non-VSCode mode.

### 6.1 Comments store extraction (critical)

Current state:
- `packages/comments/src/comment-store.ts` imports `vscode` and directly owns persistence behavior.

Needed shape:

1. Create a pure core package: `@accordo/comments-core`
   - Domain model + business rules only
   - No VSCode imports
2. Introduce storage interface:

```ts
interface CommentRepository {
  load(): Promise<CommentStoreFile | null>;
  save(file: CommentStoreFile): Promise<void>;
}
```

3. Adapters:
   - `VscodeCommentRepository` (uses `vscode.workspace.fs`)
   - `NodeFsCommentRepository` (for non-VSCode runtime)
   - optional remote repository later
4. Keep `accordo-comments` extension as host adapter layer around core.

### 6.2 Bridge abstraction for non-VSCode runtime

Current state:
- `packages/bridge` is a VSCode extension host bridge.

Needed shape:

1. Extract transport/control core into `@accordo/bridge-core`:
   - registry
   - command router
   - ws protocol adapter interface
2. Define host adapter ports:

```ts
interface HostEnvironment {
  getState(): IDEStateLike;
  confirmTool(name: string, args: unknown): Promise<boolean>;
  log(msg: string): void;
}
```

3. Implement:
   - `bridge-vscode-host` (current extension runtime)
   - `bridge-node-host` (headless/non-VSCode runtime)
4. Keep Hub unchanged as much as possible (it is already mostly editor-agnostic).

---

## 7) Target architecture proposal (pragmatic)

### Layer 1 — Pure cores (no VSCode)

- `@accordo/bridge-types` (split by domain files)
- `@accordo/comments-core`
- `@accordo/bridge-core`
- `@accordo/comment-sdk`
- surface-independent helper libs

### Layer 2 — Host adapters

- `accordo-bridge` (VSCode host adapter)
- `bridge-node-host` (future non-VSCode host adapter)
- `accordo-comments` (VSCode adapter over comments-core)
- `comments-node-service` (future non-VSCode adapter)

### Layer 3 — Feature plugins

- editor, diagram, md-viewer, marp, script, voice, browser relay
- each plugin depends only on capability interfaces + host adapter API

### Layer 4 — Runtime profiles

- **VSCode profile:** Bridge(VSCode) + selected plugins.
- **Headless profile:** bridge-node-host + selected plugins/services.

---

## 8) Prioritized roadmap (10–20 actions)

### Now (high impact)

1. Split `bridge-types/src/index.ts` into domain modules + stable barrel.
2. Extract `comments-core` from `comments/src/comment-store.ts` (no vscode in core).
3. Split `comments/src/comment-tools.ts` into `definitions` + `handlers`.
4. Split `bridge/src/extension.ts` into bootstrap/orchestration/service factories.
5. Split `hub/src/server.ts` into router + handler modules.

### Next

6. Split `browser-extension/src/service-worker.ts` by concern (router/sync/store-merge).
7. Split `browser-extension/src/relay-actions.ts` into per-feature handlers.
8. Introduce shared browser relay contract module (single source for actions/messages).
9. Normalize comments tool response shapes to reduce caller-specific wrappers.
10. Split `voice/src/extension.ts` into composition root + runtime provider factories.

### Later

11. Extract `bridge-core` with host environment interface.
12. Implement node/headless host adapter proof-of-concept.
13. Add capability manifest and runtime plugin discovery.
14. Convert hard `extensionDependencies` where possible to optional capability lookups.
15. Package terminal/panes subdomains as optional plugins (currently inside `accordo-editor`).
16. Add per-package module maps for onboarding (“where to change X”).

---

## 9) Direct answer to your architectural goal

Right now, the repository is **not yet at** the “small isolated component ownership” level you described.

It **can get there** with incremental refactors, because the conceptual boundaries already exist. The most important moves are:

1. pull domain cores out of VSCode-bound code (especially comments + bridge),
2. split large orchestration files,
3. replace stringly cross-package contracts with shared typed capability contracts,
4. formalize plugin capability discovery instead of static dependency assumptions.

Once those are in place, onboarding someone to a small isolated component becomes straightforward.
