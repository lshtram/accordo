# Capabilities Foundation — Phase A Source of Truth

**Status:** Proposed Phase A design for implementation gating  
**Authority:** This document is the single source of truth for the capabilities-foundation batch.  
**Related docs:**
- `docs/30-development/modularity.md` — repo-wide governance rules
- `docs/modularity-perfect-score-plan.md` — overall modularity program and batch ordering
- `docs/10-architecture/architecture.md` — architecture context

---

## 1. Scope statement

This Phase A batch is **only** for stabilizing the shared cross-extension capability contract surface before module batches split.

### In scope

1. Establish one canonical capability-contract package: `@accordo/capabilities`
2. Freeze the **minimum required cross-extension command set** currently used across packages
3. Freeze the **minimum stable cross-extension interfaces** currently shared across packages
4. Separate **stable** vs **deferred** capability contracts explicitly
5. Define canonical vs legacy alias policy for the small number of existing legacy type aliases
6. Define concrete completion gates mapped to CI evidence

### Out of scope

1. Module-specific implementation refactors
2. New modality features
3. Runtime capability negotiation/discovery
4. New relay wire contracts (owned by `@accordo/bridge-types`)
5. Any new command IDs beyond the minimum set below
6. Presentation/browser capability implementation work beyond reserving deferred contracts

---

## 2. Minimum Capability Foundation Set

This table is the authoritative baseline for Phase A.

| Capability / Contract | Canonical package / location | Owner package | Consumer packages | Phase A status | Legacy support? | Verification artifact / check |
|---|---|---|---|---|---|---|
| `COMMENTS_GET_STORE` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_GET_STORE` | `comments` | `md-viewer` | Required now | No | `tsc --noEmit` in `comments`, `md-viewer`; no raw-string consumer remains |
| `COMMENTS_GET_THREADS_FOR_URI` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_GET_THREADS_FOR_URI` | `comments` | `md-viewer` | Required now | No | same |
| `COMMENTS_CREATE_SURFACE_COMMENT` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_CREATE_SURFACE_COMMENT` | `comments` | `diagram`, `marp` | Required now | No | same |
| `COMMENTS_RESOLVE_THREAD` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_RESOLVE_THREAD` | `comments` | `diagram`, `marp` | Required now | No | same |
| `COMMENTS_GET_SURFACE_ADAPTER` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER` | `comments` | `diagram`, `marp` | Required now | No | same |
| `COMMENTS_EXPAND_THREAD` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.COMMENTS_EXPAND_THREAD` | `comments` | `comments` | Required now | No | `tsc --noEmit` in `comments` |
| `PREVIEW_FOCUS_THREAD` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD` | `md-viewer` | `comments` | Required now | No | `tsc --noEmit` in `comments`, `md-viewer` |
| `DIAGRAM_FOCUS_THREAD` command | `@accordo/capabilities` → `CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD` | `diagram` | `comments` | Required now | No | `tsc --noEmit` in `comments`, `diagram` |
| `PRESENTATION_GOTO` command | `@accordo/capabilities` → `DEFERRED_COMMANDS.PRESENTATION_GOTO` | `marp` | planned: `comments` | Deferred | No | must not appear in any `registerCommand` site |
| `PRESENTATION_FOCUS_THREAD` command | `@accordo/capabilities` → `DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD` | `marp` | planned: `comments` | Deferred | No | must not appear in any `registerCommand` site |
| `BROWSER_FOCUS_THREAD` command | `@accordo/capabilities` → `DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD` | `browser` | planned: `comments` | Deferred | No | must not appear in any `registerCommand` site |
| `SurfaceCommentAdapter` interface | `@accordo/capabilities` | `capabilities` | `comments`, `diagram`, `marp`, `md-viewer` | Required now | Yes — see §4 | no local redefinition outside `@accordo/capabilities` |
| `CommentStoreAdapter` interface | `@accordo/capabilities` | `capabilities` | `comments`, `md-viewer` | Required now | Yes — see §4 | no local redefinition outside `@accordo/capabilities` |
| `CommentsCapability` interface | `@accordo/capabilities` | `capabilities` | `comments` | Required now | No | `tsc --noEmit` in `comments` |
| `PreviewCapability` interface | `@accordo/capabilities` | `capabilities` | `md-viewer` | Required now | No | `tsc --noEmit` in `md-viewer` |
| `DiagramCapability` interface | `@accordo/capabilities` | `capabilities` | `diagram` | Required now | No | `tsc --noEmit` in `diagram` |
| `PresentationCapability` interface | `@accordo/capabilities` | `capabilities` | none yet | Deferred | No | no `implements PresentationCapability` outside deferred area |
| `BrowserCapability` interface | `@accordo/capabilities` | `capabilities` | none yet | Deferred | No | no `implements BrowserCapability` outside deferred area |
| `CapabilityCommandMap` type | `@accordo/capabilities` | `capabilities` | all capability consumers | Required now | No | dedicated package test proves map matches stable command keys |

---

## 3. Stable vs Deferred matrix

### 3.1 Stable in foundation

These are frozen at foundation close.

| Category | Stable set | Rule |
|---|---|---|
| Command IDs | `COMMENTS_GET_STORE`, `COMMENTS_GET_THREADS_FOR_URI`, `COMMENTS_CREATE_SURFACE_COMMENT`, `COMMENTS_RESOLVE_THREAD`, `COMMENTS_GET_SURFACE_ADAPTER`, `COMMENTS_EXPAND_THREAD`, `PREVIEW_FOCUS_THREAD`, `DIAGRAM_FOCUS_THREAD` | Must exist in `CAPABILITY_COMMANDS` and in `CapabilityCommandMap` |
| Interfaces | `SurfaceCommentAdapter`, `CommentStoreAdapter`, `CommentsCapability`, `PreviewCapability`, `DiagramCapability` | Exported from package root; shape frozen for this batch |
| Type maps | `CapabilityCommandMap` | Must cover all stable command IDs, and only stable command IDs |
| Adapter contracts | `SurfaceCommentAdapter`, `CommentStoreAdapter` | Only canonical definitions live in `@accordo/capabilities` |
| Relay wire types | None | Relay wire types are out of capabilities scope and remain in `@accordo/bridge-types` |

### 3.2 Deferred in foundation

These may exist as placeholders but are explicitly not active.

| Category | Deferred set | Rule | Target batch |
|---|---|---|---|
| Command IDs | `PRESENTATION_GOTO`, `PRESENTATION_FOCUS_THREAD`, `BROWSER_FOCUS_THREAD` | Must live in `DEFERRED_COMMANDS`, not `CAPABILITY_COMMANDS` | Presentation / Browser follow-up |
| Interfaces | `PresentationCapability`, `BrowserCapability` | May exist in `deferred.ts`; must not be exported from package root as active contracts | Presentation / Browser follow-up |
| Helpers | typed runtime wrapper `invoke<K>()` | Deferred utility only, not needed for foundation | later utility batch |

### 3.3 Not allowed in foundation

| Not allowed | Reason |
|---|---|
| New command IDs not listed in §2 | Prevent scope creep |
| Runtime implementation code in `@accordo/capabilities` | Package must remain types/constants only, **except** the minimal `createNavigationAdapterRegistry()` factory which is the sole permitted runtime export |
| `vscode` imports in `@accordo/capabilities` | Must remain editor-agnostic |
| Relay wire types in `@accordo/capabilities` | Owned by `@accordo/bridge-types` |
| Module-specific adapter implementations | Belong to later module batches |
| Runtime discovery/negotiation/event bus | Out of foundation scope |

---

## 4. Canonical ↔ legacy mapping

Only the following legacy aliases are allowed during foundation.

| Canonical artifact | Accepted legacy alias | Location of legacy alias | Warning behavior | Removal milestone |
|---|---|---|---|---|
| `CommentStoreAdapter` from `@accordo/capabilities` | `CommentStoreLike` | `packages/md-viewer/src/preview-bridge.ts` | Add `@deprecated` TSDoc: “Import CommentStoreAdapter from @accordo/capabilities instead.” | Remove in next md-viewer refactor batch |
| `SurfaceCommentAdapter` from `@accordo/capabilities` | local re-export of `SurfaceCommentAdapter` | `packages/diagram/src/comments/diagram-comments-bridge.ts` | Add `@deprecated` TSDoc: “Import SurfaceCommentAdapter from @accordo/capabilities instead.” | Remove in next diagram refactor batch |

### Policy

1. No new legacy aliases may be introduced in this batch.
2. Legacy aliases are type-level only; there is no runtime compatibility layer.
3. If a future batch needs a runtime alias, it must add a new design pass.

---

## 5. Completion gates with concrete CI evidence

All gates below must pass before the capabilities foundation is complete.

| Gate | Purpose | Concrete command / CI evidence | Pass condition |
|---|---|---|---|
| G1 | Type coherence across consumers | `pnpm -r exec tsc --noEmit` | Exit code 0 across workspace |
| G2 | Capabilities package builds cleanly | `pnpm --filter @accordo/capabilities run build` | Exit code 0 |
| G3 | Stable command map coverage | `pnpm --filter @accordo/capabilities test` including a test asserting stable `CAPABILITY_COMMANDS` keys match `CapabilityCommandMap` keys | Test passes |
| G4 | No raw string cross-extension command consumers | `rg 'executeCommand\(' packages --glob '*.ts' | grep -v '__tests__'` reviewed against imported constants usage, or dedicated scripted check | No cross-package consumer uses raw string instead of `CAPABILITY_COMMANDS.*` |
| G5 | No local redefinition of stable interfaces | `rg 'interface (SurfaceCommentAdapter|CommentStoreAdapter)' packages --glob '*.ts' | grep -v 'packages/capabilities/'` | Zero matches |
| G6 | Deferred commands are not active | `rg 'registerCommand.*(PRESENTATION_GOTO|PRESENTATION_FOCUS_THREAD|BROWSER_FOCUS_THREAD)' packages --glob '*.ts'` against constants usage or dedicated scripted equivalent | Zero active registrations |
| G7 | Deferred interfaces are not implemented as active contracts | `rg 'implements\s+(PresentationCapability|BrowserCapability)' packages --glob '*.ts'` | Zero matches outside deferred area |
| G8 | Capabilities package is runtime-free (with exception) | `rg "from ['\"]vscode['\"]" packages/capabilities --glob '*.ts'` and dependency inspection in `package.json` | No `vscode` imports; no runtime dependency creep; `createNavigationAdapterRegistry` factory is the only permitted runtime export |
| G9 | Legacy aliases are explicitly deprecated | grep / read checks for `@deprecated` tags in the two files listed in §4 | Both aliases carry migration guidance |
| G10 | Affected package tests remain green | `pnpm --filter @accordo/capabilities test && pnpm --filter accordo-comments test && pnpm --filter accordo-diagram test && pnpm --filter accordo-marp test && pnpm --filter accordo-md-viewer test` | Exit code 0 for all affected packages |

### CI note

If CI job names are introduced later, they must map directly to G1–G10. Until then, the commands above are the authoritative evidence.

---

## 6. Deliverables summary

This is the expected output of the capabilities-foundation implementation batch.

| Deliverable | Expected file outcome |
|---|---|
| Canonical Phase A doc | This file exists and remains authoritative |
| Active capability constants | `packages/capabilities/src/index.ts` exports the stable `CAPABILITY_COMMANDS` set |
| Deferred capability constants | `packages/capabilities/src/index.ts` exports `DEFERRED_COMMANDS` separately |
| Stable interfaces | `packages/capabilities/src/index.ts` exports only the stable interfaces listed in §3.1 |
| Navigation registry factory | `packages/capabilities/src/navigation.ts` exports `createNavigationAdapterRegistry()` — the sole permitted runtime factory |
| Deferred interfaces | `packages/capabilities/src/deferred.ts` contains deferred interfaces and is not part of active public surface |
| Capability map test | `packages/capabilities/src/__tests__/capability-commands.test.ts` exists |
| Legacy deprecations | TSDoc `@deprecated` added in the two locations listed in §4 |
| CI / script checks | G1–G10 commands are runnable and documented in repo automation or scripts |

---

## 7. Batch close criteria

The capabilities-foundation batch is complete when:

1. All required-now items in §2 are implemented and exported from the canonical package
2. All deferred items in §2 remain explicitly deferred and inactive
3. All gates in §5 pass
4. No authority conflict exists between this doc, `modularity.md`, and `architecture.md`

When those conditions are met, the modularity foundation is complete enough to allow **all module batches** to start in parallel, subject to the shared-package single-writer rule.
