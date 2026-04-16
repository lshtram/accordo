# Accordo IDE — Modularity Rules & Governance

**Applies to:** All packages in the Accordo IDE monorepo  
**Status:** ACTIVE — Foundation for parallel module batches (Phase D completion gate)

---

## 1. Purpose

This document establishes the repo-wide modularity contract: what can and cannot be shared across packages, when exceptions apply, how capabilities are governed, and the objective gates that allow module batches to proceed in parallel.

---

## 2. Package Layering

### 2.1 Layer Definitions

| Layer | Packages | Rule |
|---|---|---|
| **Shared runtime-free types** | `@accordo/bridge-types` | Type definitions and constants only. No logic, no classes, no functions (except minimal type guards). |
| **Shared capability contracts** | `@accordo/capabilities` | Command IDs, extension-to-extension interfaces, naming/versioning/deprecation rules for capabilities. |
| **Modality hosts** | `browser`, `editor`, `voice`, `diagram`, `marp` | Depend only on shared packages. Never import each other directly. |
| **Browser extension** | `browser-extension` | Depend only on shared packages. Acts as a backend for the browser modality. |

### 2.2 Dependency Direction Rule

```
@accordo/bridge-types  ←  all packages (read only)
@accordo/capabilities   ←  all packages (read only)
browser                 ←  @accordo/bridge-types, @accordo/capabilities
browser-extension        ←  @accordo/bridge-types, @accordo/capabilities
editor                  ←  @accordo/bridge-types, @accordo/capabilities
voice                   ←  @accordo/bridge-types, @accordo/capabilities
diagram                 ←  @accordo/bridge-types, @accordo/capabilities
marp                    ←  @accordo/bridge-types, @accordo/capabilities
```

**No package may import a modality host package.** Modality hosts are leaves in the dependency graph.

---

## 3. @accordo/bridge-types — What Belongs Here

### 3.1 Allowed

- Type aliases, interfaces, and enums used by **two or more packages** crossing a package boundary
- Union types for action strings, error codes, and state discriminators
- Protocol constants (timeouts, sizes, version strings)
- Minimal type guards (`isX(v): v is X`) only when needed for runtime safety

### 3.2 Not Allowed

- Runtime logic or orchestration
- Classes or constructor functions
- Host-specific types (VSCode, Chrome, Node.js APIs)
- Test fixtures or mock factories
- Default parameter values that imply runtime behavior

### 3.3 Explicit Exceptions — When Duplication Is Acceptable

The following categories are **explicitly allowed to duplicate** type definitions locally, even when similar types exist elsewhere:

#### 3.3.1 package.json Manifest Command Literals

Tool names, action strings, and configuration keys that are **declared in a package's own `package.json`** or extension manifest may have local type definitions. These are self-referential contracts owned by the package itself.

Example: `accordo_editor_open` as a tool name is defined in the package that registers it, not in bridge-types.

#### 3.3.2 Unavoidable External Protocol Literals

Strings that originate from **external standards** (W3C, MCP spec, Chrome DevTools Protocol, etc.) may be locally defined when the external standard is the authoritative source.

Example: Chrome CDP WebSocket event names, MCP protocol version strings.

#### 3.3.3 Intentional Test and Fixture Strings

Strings used **only in tests** for asserting on error messages, logging output, or fixture data. These are test-only contracts and do not constitute a shared surface.

#### 3.3.4 Local Runtime Helpers

Functions and classes that **cannot exist in bridge-types** because they require a specific runtime:
- `SnapshotStore` requires Chrome storage APIs
- `SnapshotManager` requires `window` globals
- `getErrorMeta()` requires local error policy

These stay in the package that owns the runtime.

---

## 4. @accordo/capabilities — Capability Governance

### 4.1 What Belongs Here

**Cross-extension command IDs and interfaces** that are owned no single package:

- Command string constants for inter-modality communication (e.g., `accordo_browser_focus_thread`)
- Shared interface types for extension-to-extension collaboration (e.g., `SurfaceCommentAdapter`, `PresentationNavigator`)
- Naming conventions, versioning policy, and deprecation policy for capabilities

### 4.2 Capability Naming Convention

All capability command IDs must follow:

```
accordo_<modality>_<resource>_<verb>
```

Examples:
- `accordo_browser_list_pages`
- `accordo_editor_open`
- `accordo_voice_dictation`

### 4.3 Capability Versioning Policy

| Stage | Meaning | Rule |
|---|---|---|
| **Active** | Currently supported | No suffix required |
| **Deprecated** | Will be removed | Suffix: `_deprecated_<semver>` in type only; runtime accepts both for transition window |
| **Removed** | No longer accepted | Removed from type union; runtime rejects with `unsupported-action` |

**Deprecation process:**
1. Add `_deprecated_<version>` suffix to the action string constant
2. Keep the old constant value in the union for one release (transition window)
3. Remove deprecated variant from the union in the next major release

### 4.4 Adding a New Capability

1. Add the command ID constant to `@accordo/capabilities`
2. Document the owner package, intended consumers, and expected behavior
3. All packages that use the capability import from `@accordo/capabilities` — no hardcoded strings

---

## 5. Browser Relay Shared Contract

### 5.1 Canonical Placement

The browser relay shared contract lives in `@accordo/bridge-types` as `src/relay-types.ts`.

This includes:
- `BrowserRelayAction` — canonical union of all relay actions
- `Viewport` — viewport dimensions and scroll position
- `SnapshotSource` — valid snapshot source types
- `SnapshotEnvelopeFields` — metadata envelope for data-producing tools
- `BrowserRelayRequest` — relay request envelope
- `BrowserRelayResponse` — relay response envelope
- `CapturePayload` — capture region action payload

### 5.2 What Stays Local

The following remain in their respective packages and are NOT in bridge-types:

| Package | Local-only types/helpers | Reason |
|---|---|---|
| `browser` | `hasSnapshotEnvelope()` | Requires runtime type narrowing |
| `browser` | `BrowserRelayLike` interface | Browser-specific runtime interface |
| `browser` | `BrowserBridgeAPI` interface | VSCode extension host API |
| `browser-extension` | `actionFailed()`, `getErrorMeta()` | Local error policy |
| `browser-extension` | `isVersionedSnapshot()` | Requires `VersionedSnapshot` type from snapshot-versioning |
| `browser-extension` | `SnapshotManager`, `SnapshotStore`, `VersionedSnapshot` | Require Chrome runtime |
| `browser-extension` | `RelayActionResponse` extension fields (`auditId`, `redactionWarning`) | Extension-specific metadata |

### 5.3 Adopting the Shared Contract

When importing shared relay types:
- Use `@accordo/bridge-types` for the shared contract
- Use local types for browser-specific or extension-specific runtime interfaces
- Convenience re-exports are permitted **only** when all of the following are true:
  1. The re-export is explicitly documented as a convenience re-export pointing to the canonical definition in `@accordo/bridge-types`
  2. The re-export does **not** create a local alias (e.g. `export type { Foo as Bar }`) that shadows the canonical name
  3. The re-export does not appear in the package's public API (no `export * from` or named exports to external consumers)
- The canonical definition of all shared relay types **always** lives in `@accordo/bridge-types/src/relay-types.ts` — this ownership is never ambiguous

---

## 6. Objective Completion Gates

These gates determine when a module batch is complete and when parallel batches may begin.

### 6.1 Per-Module Completion Gate

A module batch is **complete** when all of the following are true:

| # | Gate Criterion | Verification |
|---|---|---|
| G1 | All new types are added to `@accordo/bridge-types` or `@accordo/capabilities` | No local duplicate type unions found |
| G2 | All imports updated to use shared packages | `grep` finds zero cross-modality direct imports |
| G3 | All tests pass | `pnpm test` in affected package returns 0 failures |
| G4 | TypeScript compiles with zero errors | `pnpm typecheck` returns 0 errors |
| G5 | No banned patterns present | See §6.2 |
| G6 | Architecture docs updated | Changed modules are reflected in `docs/10-architecture/architecture.md` |

### 6.2 Banned Patterns (Automatic Rejection)

The following patterns cause automatic rejection at review:

| Banned Pattern | Why | Detection |
|---|---|---|
| Cross-modality direct import | Violates dependency direction | `grep` for `from "@accordo/browser"` in `diagram/`, `voice/`, etc. |
| Handler function in shared types |违背 "logic-free" rule | grep for `function` in `bridge-types/src/` |
| Raw command strings outside capabilities | Spreads coupling | `grep` for untyped string literals matching `accordo_*` pattern |
| VSCode import in Hub | Hub must remain editor-agnostic | `grep "from 'vscode'" in hub/src/` |
| `any` cast on security-sensitive type | Type safety violation | Manual review |

### 6.3 Parallel Batch Gate

Module batches may proceed in **parallel** when:

1. **Shared foundation is complete** — `@accordo/bridge-types` and `@accordo/capabilities` have the contracts the batch depends on
2. **Objective completion gates pass** — all G1–G6 criteria are met for each package in the batch
3. **No cross-batch dependency conflicts** — two batches do not modify the same shared package simultaneously

**The shared foundation batch (this batch) must complete before Browser, Voice, Diagram, and Presentation batches can proceed in parallel.**

### 6.4 Foundation Batch Completion Criteria

This batch is complete when:

| Criterion | Status |
|---|---|
| `docs/30-development/modularity.md` exists | Must be created |
| `packages/bridge-types/src/relay-types.ts` exists and exports all shared relay types | Must be created |
| `packages/browser/src/types.ts` imports from `@accordo/bridge-types` | Must be updated |
| `packages/browser-extension/src/relay-definitions.ts` imports from `@accordo/bridge-types` | Must be updated |
| All types compile with zero errors | `pnpm typecheck` clean |
| All tests pass for affected packages | `pnpm test` clean for `bridge-types`, `browser`, `browser-extension` |
| Architecture doc updated if needed | `docs/10-architecture/architecture.md` §14 updated |

---

## 7. Review Checklist (Phase D2)

Run this checklist for every module batch review:

- [ ] G1–G6 completion gates all pass
- [ ] Zero banned patterns detected
- [ ] Shared types only in `bridge-types` or `capabilities`
- [ ] No cross-modality direct imports
- [ ] Capability command IDs from `@accordo/capabilities`
- [ ] Runtime helpers remain in owning package
- [ ] Architecture docs reflect changes
- [ ] Tests pass, typecheck clean

---

## 8. Exceptions to This Document

Exceptions to §2–§5 require sign-off from the architect and must be documented inline with a `// EXCEPTION:` comment citing the specific subsection (e.g., `// EXCEPTION: §3.3.2 — Chrome CDP event names`).

Exceptions are tracked in the module's `EXCEPTIONS.md` if more than three exist.
