# Full Modularity Pre-Consolidation Review (2026-04-16)

## Scope

Reviewed packages:

- `packages/bridge-types/`
- `packages/hub/`
- `packages/bridge/`
- `packages/editor/`
- `packages/marp/`
- `packages/md-viewer/`
- `packages/diagram/`
- `packages/browser/`
- `packages/browser-extension/`
- `packages/comments/`
- `packages/capabilities/`
- `packages/comment-sdk/`
- `packages/voice/`

Method: package manifests, activation entrypoints, public barrels, cross-package imports, and focus/navigation/comment-store call paths.

---

## 1) Per-package scores (1–10)

| Package | Readability | Interface clarity | Dependency hygiene | Plugin readiness | Notes |
|---|---:|---:|---:|---:|---|
| bridge-types | 9 | 9 | 10 | 9 | Clean barrel + type-only boundary (`packages/bridge-types/src/index.ts:7-15`). |
| hub | 8 | 8 | 10 | 8 | Strong server decomposition; editor-agnostic maintained. |
| bridge | 8 | 8 | 9 | 8 | Clear API composition; good handler/wire separation (`packages/bridge/src/extension-registry.ts:97-109`). |
| editor | 8 | 7 | 9 | 7 | Good tool modularization; API is mostly command/tool surface. |
| marp | 7 | 6 | 8 | 6 | Clear internals, but focus command divergence hurts pluginability (`packages/marp/src/extension.ts:84`, `:179`). |
| md-viewer | 8 | 8 | 8 | 8 | Good adapter-based integration (`packages/md-viewer/src/preview-bridge.ts:101-187`). |
| diagram | 7 | 7 | 8 | 7 | Good surface adapter usage; large extension entrypoint complexity. |
| browser | 7 | 7 | 8 | 6 | Good relay/tool assembly split; missing browser focus command blocks nav consolidation. |
| browser-extension | 7 | 6 | 9 | 5 | Decoupled from VS Code, but dual comment-store architecture + stub adapters. |
| comments | 8 | 8 | 8 | 7 | Strong command/capability layer; router has hardcoded branching pressure. |
| capabilities | 9 | 9 | 10 | 9 | Excellent contract package; central command constants. |
| comment-sdk | 9 | 9 | 10 | 9 | Clean reusable UI primitive with clear API (`packages/comment-sdk/src/sdk.ts:59-211`). |
| voice | 7 | 7 | 9 | 7 | Structured orchestration; bridge integration cleanly optional. |

---

## 2) Package dependency architecture (actual source imports)

```mermaid
graph TD
  BT[@accordo/bridge-types]
  CAP[@accordo/capabilities]
  SDK[@accordo/comment-sdk]

  HUB[accordo-hub] --> BT
  BRIDGE[accordo-bridge] --> BT
  EDITOR[accordo-editor] --> BT
  VOICE[accordo-voice] --> BT
  BROWSER[accordo-browser] --> BT

  CAP --> BT

  COMMENTS[accordo-comments] --> BT
  COMMENTS --> CAP

  MD[accordo-md-viewer] --> BT
  MD --> CAP
  MD --> SDK

  MARP[accordo-marp] --> BT
  MARP --> CAP
  MARP --> SDK

  DIAGRAM[accordo-diagram] --> BT
  DIAGRAM --> CAP
  DIAGRAM --> SDK

  BEXT[browser-extension] --> SDK
```

### Upward-dependency violations

No clear upward import violations found in source imports for scoped internal packages.

Evidence: aggregated import scan across `packages/*/src` showed edges only in the graph above.

---

## 3) Validation of key architectural rules

### Rule 1 — Hub is editor-agnostic (no `vscode` in hub)

✅ Pass. No `vscode` imports in `packages/hub/src` found.

### Rule 2 — Security middleware first on authenticated Hub endpoints

✅ Pass.

- `validateOrigin` runs before all authenticated paths (`packages/hub/src/server-routing.ts:102-107`).
- `validateBearer` precedes `/mcp`, `/instructions`, `/state` handlers (`:109-163`).
- `validateBridgeSecret` precedes `/bridge/reauth` and `/bridge/disconnect` (`:184-203`).

### Rule 3 — Handler functions never serialized across package boundary

✅ Pass (with good explicit guardrails).

- Bridge strips handlers when constructing wire `ToolRegistration` (`packages/bridge/src/extension-registry.ts:97-109`).
- Handlers remain in in-process map (`:43-45`, `:143-147`).
- Hub-local handlers are explicitly hub-internal (`packages/hub/src/hub-tool-types.ts:8-10`, `:31-33`).

### Rule 4 — MCP tool naming convention (`accordo_<modality>_<action>`)

⚠️ Mixed.

- Most modern tools follow convention (e.g., editor/diagram/voice/browser-page tools).
- Known exceptions:
  - Comment tools use `comment_*` names by design in `accordo-comments` (`packages/comments/src/comment-tools/definitions.ts:24`, `:87`, `:103`, etc.).
  - Deprecated browser legacy tools still defined with `browser_*` names (`packages/browser/src/browser-tools.ts:1-7`, `:14-143`) but marked not registered.

### Rule 5 — Comment SDK as single source of truth for comment pin rendering

⚠️ Partially pass / partial drift.

- Active surfaces use SDK:
  - `diagram` uses `AccordoCommentSDK` (`packages/diagram/src/webview/comment-overlay.ts:18-37`).
  - `browser-extension` content UI uses SDK (`packages/browser-extension/src/content/comment-ui.ts:6-7`, `:102-118`).
  - `marp` webview bootstraps SDK (`packages/marp/src/marp-webview-html.ts:38-39`).
  - `md-viewer` template bootstraps SDK (`packages/md-viewer/src/webview-template.ts:122`).
- But there is a custom pin renderer module (`packages/browser-extension/src/content-pins.ts`) that duplicates pin concerns, appears unused in current path (only self-definitions found).

---

## 4) Critical findings (blocking / high risk)

## F1 — Browser focus-thread command is referenced but not implemented (Priority Q blocker)

### Evidence

- Router dispatches browser surface to `accordo_browser_focusThread` via deferred command constant (`packages/comments/src/panel/navigation-router.ts:174-180`; `packages/capabilities/src/index.ts:63`).
- No implementation/registration of `accordo_browser_focusThread` found in `packages/browser/src` or `packages/browser-extension/src`.

### Impact

- Browser-thread navigation from comments panel is best-effort/failing path today.
- Consolidating dispatch without fixing this will preserve a broken branch.

### Severity

**High (blocks safe dispatch consolidation).**

---

## F2 — Marp focus command ID divergence (Priority R blocker)

### Evidence

- Deferred constant expects underscore command: `accordo_presentation_internal_focusThread` (`packages/capabilities/src/index.ts:61`).
- Marp registers dotted command: `accordo.presentation.internal.focusThread` (`packages/marp/src/extension.ts:179`).
- Marp slide adapter also calls dotted command (`packages/marp/src/extension.ts:84`).
- Comments router fallback calls underscore command (`packages/comments/src/panel/navigation-router.ts:153`, `:164`).

### Impact

- Two parallel focus command IDs for same semantic operation.
- Registry path may work while deferred fallback path silently misses.

### Severity

**High (directly complicates consolidation and cross-surface consistency).**

---

## F3 — Browser extension still owns independent local comment store + relay handlers (Priority P blocker)

### Evidence

- Full local store CRUD in extension: `packages/browser-extension/src/store.ts`.
- Relay comment handlers directly mutate this store (`packages/browser-extension/src/relay-comment-handlers.ts:11-20`, `:80-163`).
- SW routing also mutates local store (`packages/browser-extension/src/sw-router.ts:104-167`).
- Intended adapter abstraction exists but is stubbed: `VscodeRelayAdapter`, `LocalStorageAdapter`, and `selectAdapter` all throw not implemented (`packages/browser-extension/src/adapters/comment-backend.ts:98-134`, `:148-183`, `:219-220`).

### Impact

- “Unify store” is not just moving data; it requires replacing active mutation paths and introducing conflict policy/offline sync protocol.

### Severity

**High (major precondition before store unification).**

---

## 5) Per-surface dispatch map (focusThread)

| Surface type | Router dispatch path | Command ID called | Implemented in | Status |
|---|---|---|---|---|
| `text` | direct text navigation | n/a (showTextDocument + optional `COMMENTS_EXPAND_THREAD`) | `comments` + VS Code text APIs | ✅ |
| `slide` (adapter path) | registry adapter `focusThread` | `accordo.presentation.internal.focusThread` | `marp` (`packages/marp/src/extension.ts:179`) | ✅ (adapter path) |
| `slide` (fallback path) | deferred command | `accordo_presentation_internal_focusThread` | not found in marp source | ❌ mismatch |
| `diagram` | capability command | `accordo_diagram_focusThread` | `diagram` (`packages/diagram/src/extension.ts:140`) | ✅ |
| `browser` | deferred command | `accordo_browser_focusThread` | not found | ❌ missing |
| `markdown-preview` | capability command | `accordo_preview_internal_focusThread` | `md-viewer` (`packages/md-viewer/src/extension.ts:121`) | ✅ |

---

## 6) Priority focus areas (P / Q / R)

### Priority P — Comment store silo

Current reality:

- Browser extension is still operationally local-store-first.
- Hub/VS Code sync exists, but as synchronization glue rather than authoritative ownership (`packages/browser/src/comment-sync.ts:118-291`, `packages/browser-extension/src/sw-comment-sync.ts:146-177`).

Assessment:

- Decoupling primitives exist, but adapter layer is unfinished.
- Unification now without finishing adapter path will require invasive rewrites.

### Priority Q — Navigation router consolidation

Current reality:

- Router is surface-branching imperative dispatcher (`packages/comments/src/panel/navigation-router.ts:110-198`).
- Slide has both adapter and fallback pathways; browser/diagram are direct command calls.

Assessment:

- Adding a future surface (e.g., PDF) currently requires router modification.
- Registry abstraction exists (`packages/capabilities/src/navigation.ts`) but not uniformly used by all surfaces.

### Priority R — Marp command divergence

Current reality:

- Two command IDs represent one conceptual operation.

Assessment:

- This is a contract-level inconsistency, not just implementation detail.

---

## 7) Recommendations for planned major moves

### Move 1 — Unify comment store (VS Code authoritative)

### Preconditions (must do first)

1. **Finish backend adapter layer in browser-extension**
   - Implement `VscodeRelayAdapter` and `LocalStorageAdapter` + `selectAdapter()` (`packages/browser-extension/src/adapters/comment-backend.ts`).
2. **Refactor mutation entrypoints to adapter use**
   - `sw-router.ts`, `relay-comment-handlers.ts`, and content message handlers should stop direct `store.ts` writes.
3. **Define explicit offline contract**
   - Queue format, replay semantics, idempotency keys, conflict precedence (Hub vs local tombstones).
4. **Establish one canonical thread identity + anchor-key reconciliation rule**
   - Reuse existing merge logic in `sw-comment-sync.ts` as baseline.

### Suggested target architecture

- **Authoritative source**: VS Code comments store.
- **Browser-extension online mode**: adapter routes CRUD via relay to unified comment tools.
- **Offline mode**: local append-only queue + local cache; replay on reconnect.
- **Sync loop**: reconcile by thread/comment IDs with tombstone precedence policy.

### Move 2 — Consolidate navigation dispatch

### Preconditions (must do first)

1. **Unify Marp focus command ID**
   - Pick one canonical ID and update `DEFERRED_COMMANDS` + marp registration + callers.
2. **Implement browser focus command**
   - Add `accordo_browser_focusThread` (or migrate browser to registry adapter).
3. **Shift router to registry-first for all non-text surfaces**
   - Router should delegate by `surfaceType` adapter map; fallback only generic file open.
4. **Add contract tests in capabilities + comments**
   - Ensure each supported surface registers `navigateToAnchor` + `focusThread`.

### Suggested target architecture

- Router becomes thin: `adapter = registry.get(surfaceType)` then execute adapter pipeline.
- Surface modules own command IDs internally; comments package stops hardcoding per-surface commands.

---

## 8) Non-blocking findings / tech debt

1. **Dead/legacy browser tool definitions still in tree**
   - `packages/browser/src/browser-tools.ts` marked deprecated; keep/remove decision should be explicit.
2. **Potential confusion from unused custom pin module**
   - `packages/browser-extension/src/content-pins.ts` duplicates SDK concern; appears unused.
3. **Comments package has both extension entry and public package index**
   - Good for reuse, but boundaries should be documented to avoid accidental internal imports.
4. **Large extension entrypoints (diagram/marp/voice)**
   - Functional but high cognitive load; gradual composition extraction would improve plugin swapability.

---

## 9) Overall readiness verdict for planned simplifications

- **Comment-store unification**: **Not ready yet** (Priority P blockers present).
- **Navigation dispatch consolidation**: **Not ready yet** (Priority Q/R blockers present).

The codebase is generally modular and decoupled at package boundaries, but these two simplifications require contract-level cleanup first (especially focus command consistency and browser focus implementation), not just refactoring.
