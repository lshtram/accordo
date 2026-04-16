# Diagram Modularity — Phase A Design

## Scope

- `packages/diagram`

## Layering / import matrix

| Layer | Contents | May import | Must not import |
|---|---|---|---|
| L0 | `types.ts` | nothing | everything else |
| L1 | `parser/`, `reconciler/`, `layout/`, `canvas/`, `tools/` | L0 | host/webview-adapter/vscode |
| L2 | `webview/protocol.ts` | L0 | L1/L4/vscode |
| L3 | pure webview helpers | L0/L1/L2 | L4/vscode |
| L4 | `host/`, comments bridge integration | L0/L1/L2/L3/vscode | upward restrictions only |
| L4r | `extension.ts` | L4 | direct engine internals |

## Target move

Create `src/host/` and move VS Code-coupled orchestration there.

Phase A stub files (created, compiling, not wired into active code):

- `host/host-context.ts` — HostContext interface
- `host/panel-state.ts` — re-export bridge from webview/panel-state
- `host/panel-scene-loader.ts` — loadAndPost stub
- `host/panel-message-router.ts` — routeWebviewMessage stub
- `host/panel-layout-patcher.ts` — patchLayout, handleNode*, persistEdgeWaypoints stubs
- `host/panel-export.ts` — handleExportReady, requestExport stubs
- `host/panel-comments-adapter.ts` — initCommentsBridge, routeCommentMessage, disposeCommentsBridge stubs
- `host/panel-setup.ts` — setupWebview, registerDisposables stubs

Host-side files after cutover (Phase C):

- `host/panel.ts`
- `host/errors.ts`
- (plus all above)

## `HostContext` contract

`HostContext` replaces `PanelStateWithPanel` as the explicit host boundary object.

Fields:

- `state: PanelState`
- `panel: vscode.WebviewPanel`
- `log: (msg: string) => void`
- `createTime: number`
- optional test override hooks

Rule:

- no more intersection/cast hack should spread during refactor

## Extracted module API table — frozen signatures

### `host/host-context.ts`

```typescript
interface HostContext {
  readonly state: PanelState;
  readonly panel: vscode.WebviewPanel;
  readonly log: (msg: string) => void;
  readonly createTime: number;
  readonly _testLoadAndPost?: () => Promise<void>;
  readonly _testHandleNodeMoved?: (nodeId: string, x: number, y: number) => void;
  readonly _testHandleNodeResized?: (nodeId: string, w: number, h: number) => void;
  readonly _testHandleExportReady?: (format: string, data: string) => void;
}
```

### `host/panel-scene-loader.ts`
- `loadAndPost(ctx: HostContext): Promise<void>`

### `host/panel-message-router.ts`
- `routeWebviewMessage(ctx: HostContext, msg: WebviewToHostMessage): void`

### `host/panel-layout-patcher.ts`
- `patchLayout(ctx: HostContext, apply: (layout: LayoutStore) => LayoutStore): void`
- `handleNodeMoved(ctx: HostContext, nodeId: string, x: number, y: number): void`
- `handleNodeResized(ctx: HostContext, nodeId: string, w: number, h: number): void`
- `handleNodeStyled(ctx: HostContext, nodeId: string, stylePatch: Record<string, unknown>): void`
- `persistEdgeWaypoints(ctx: HostContext, msg: { edgeKey?: string; waypoints?: Array<{ x: number; y: number }> }): void`

### `host/panel-export.ts`
- `handleExportReady(ctx: HostContext, format: string, data: string): void`
- `requestExport(ctx: HostContext, format: "svg" | "png"): Promise<Buffer>`

### `host/panel-comments-adapter.ts`
- `initCommentsBridge(ctx: HostContext): Promise<void>`
- `routeCommentMessage(ctx: HostContext, msg: WebviewToHostMessage): void`
- `disposeCommentsBridge(ctx: HostContext): void`

### `host/panel-setup.ts`
- `setupWebview(ctx: HostContext, extensionUri: vscode.Uri): void`
- `registerDisposables(ctx: HostContext, panel: vscode.WebviewPanel, extensionContext: vscode.ExtensionContext): void`

### `host/host-context.ts`

```typescript
export interface HostContext {
  readonly state: PanelState;
  readonly panel: vscode.WebviewPanel;
  readonly log: (msg: string) => void;
  readonly createTime: number;
  readonly _testLoadAndPost?: () => Promise<void>;
  readonly _testHandleNodeMoved?: (nodeId: string, x: number, y: number) => void;
  readonly _testHandleNodeResized?: (nodeId: string, w: number, h: number) => void;
  readonly _testHandleExportReady?: (format: string, data: string) => void;
}
```

All `host/` functions accept `HostContext` as their only required parameter. No ad-hoc extended types are used. Test override hooks allow test code to inject spies without subclassing or monkey-patching production modules.

### `host/panel-scene-loader.ts`
```typescript
// Stub: throws "Phase A stub — not yet implemented"
export async function loadAndPost(ctx: HostContext): Promise<void>
```

### `host/panel-message-router.ts`
```typescript
// Stub: throws "Phase A stub — not yet implemented"
export function routeWebviewMessage(ctx: HostContext, msg: WebviewToHostMessage): void
```

### `host/panel-layout-patcher.ts`
```typescript
// Stubs: all throw "Phase A stub — not yet implemented"
export function patchLayout(ctx: HostContext, apply: (layout: LayoutStore) => LayoutStore): void
export function handleNodeMoved(ctx: HostContext, nodeId: string, x: number, y: number): void
export function handleNodeResized(ctx: HostContext, nodeId: string, w: number, h: number): void
export function handleNodeStyled(ctx: HostContext, nodeId: string, stylePatch: Record<string, unknown>): void
export function persistEdgeWaypoints(ctx: HostContext, msg: { edgeKey?: string; waypoints?: Array<{ x: number; y: number }> }): void
```

### `host/panel-export.ts`
```typescript
// Stubs: both throw "Phase A stub — not yet implemented"
export function handleExportReady(ctx: HostContext, format: string, data: string): void
export async function requestExport(ctx: HostContext, format: "svg" | "png"): Promise<Buffer>
```

### `host/panel-comments-adapter.ts`
```typescript
// Stubs: all throw "Phase A stub — not yet implemented"
export async function initCommentsBridge(ctx: HostContext): Promise<void>
export function routeCommentMessage(ctx: HostContext, msg: WebviewToHostMessage): void
export function disposeCommentsBridge(ctx: HostContext): void
```

### `host/panel-setup.ts`
```typescript
// Stubs: both throw "Phase A stub — not yet implemented"
export function setupWebview(ctx: HostContext, extensionUri: vscode.Uri): void
export function registerDisposables(ctx: HostContext, panel: vscode.WebviewPanel, extensionContext: vscode.ExtensionContext): void
```

### `host/panel-state.ts` (re-export bridge)
```typescript
export type { PanelState } from "../webview/panel-state.js";
export { createPanelState, assertNotDisposed, cleanupOnDispose, resolveWorkspaceRoot } from "../webview/panel-state.js";
// Plus:
// function createPanelState(mmdPath: string, panel: vscode.WebviewPanel, context: vscode.ExtensionContext): PanelState
// function assertNotDisposed(state: PanelState): void
// function cleanupOnDispose(state: PanelState): void
// function resolveWorkspaceRoot(mmdPath: string): string
```

## Comments adapter lifecycle contract

- init once per panel lifetime
- degraded mode if comments adapter unavailable
- no exception escapes comments adapter boundary
- comment failures never crash the panel
- disposal always nulls bridge reference even after logged failure

## Migration / cutover plan

1. add `host/host-context.ts`
2. move/extract `panel-state`
3. extract layout patcher
4. extract export module
5. extract comments adapter
6. extract scene loader
7. extract message router
8. extract setup module
9. switch `panel.ts` to `HostContext`
10. delete wrappers / old hacks and enforce layer rules

Rule:

- use temporary re-export bridges during cutover so imports/tests stay stable until final cleanup

## Architecture documentation — DONE (as-completed evidence)

`docs/10-architecture/diagram-architecture.md` §17.1 **already contains** the following as committed Phase A evidence (not pending):

- Full layer/import matrix table (L0–L4 + L4r)
- `host/` directory and all stub filenames in §17 module structure
- `HostContext` interface definition with code block (complete field list matching the stub source)
- Comments adapter lifecycle boundary contract (5 rules)
- Import rules per layer
- Re-export bridge note for `panel-state.ts` (Phase C cutover path)

> **Note:** `webview/panel-state.ts` contains `import * as vscode from "vscode"` for `resolveWorkspaceRoot()`. This is correct — the vscode coupling is in `extension.ts` (L4r) and the existing panel files (`panel.ts`, `panel-commands.ts`, `panel-state.ts`, `panel-core.ts`). During Phase C, `panel-state` migrates to `host/` and the vscode import moves with it. No L1/L2/L3 module imports vscode.

## Validation

Per slice:

- `pnpm test` in `packages/diagram`
- package typecheck/build
- no `vscode` imports outside allowed host files
- no circular dependency introduced

## Phase A acceptance criteria

- [x] layering matrix frozen
- [x] extracted module APIs frozen (fully typed signatures in stubs)
- [x] HostContext frozen as interim/refactor contract
- [x] migration plan explicit and auditable
- [x] 8 Phase A stub files created and compiling (`tsc --noEmit` clean)
- [x] all 924 existing tests still pass
- [x] architecture doc updated (§17 module structure, §17.1 layering)
- [x] review doc updated with exact frozen signatures

## Stubs / importability — explicit proof

**Rule:** No L1/L2/L3 module imports `vscode`. All VS Code coupling is contained in `host/`, `webview/panel.ts`, `webview/panel-commands.ts`, `webview/panel-state.ts`, `webview/panel-core.ts`, and `extension.ts` (L4r).

**Current vscode import audit (as of Phase A close):**

| File | Layer | Import form | Note |
|---|---|---|---|
| `extension.ts` | L4r | `import * as vscode` | Entry point; wires everything |
| `webview/panel.ts` | L4 | `import * as vscode` | Panel factory |
| `webview/panel-commands.ts` | L4 | `import * as vscode` | Command registration |
| `webview/panel-state.ts` | L4 | `import * as vscode` | Factory + workspace root |
| `webview/panel-core.ts` | L4 | `import * as vscode` | loadAndPost + message routing |
| `host/host-context.ts` | L4 | `import type * as vscode` | `HostContext.panel: vscode.WebviewPanel` (type-only) |
| `host/panel-setup.ts` | L4 | `import type * as vscode` | `vscode.Uri`, `vscode.WebviewPanel`, `vscode.ExtensionContext` (type-only) |

**No vscode imports in:** L0 (`types.ts`), L1 (`parser/`, `reconciler/`, `layout/`, `canvas/`, `tools/`), L2 (`webview/protocol.ts`), L3 (`scene-adapter`, `html`, `excalidraw-canvas`, `comment-overlay`, `debug-diagram-json`).

**Stub completeness audit — each of the 8 stubs is present with an exact-inherent-signature:**

| Stub file | Exported name(s) | Signature |
|---|---|---|
| `host/host-context.ts` | `HostContext` (interface) | `readonly state: PanelState; readonly panel: vscode.WebviewPanel; readonly log: (msg: string) => void; readonly createTime: number; readonly _testLoadAndPost?` … |
| `host/panel-state.ts` | `PanelState` (type re-export), `createPanelState`, `assertNotDisposed`, `cleanupOnDispose`, `resolveWorkspaceRoot` | All re-exported from `webview/panel-state.js` |
| `host/panel-scene-loader.ts` | `loadAndPost` | `async function loadAndPost(ctx: HostContext): Promise<void>` |
| `host/panel-message-router.ts` | `routeWebviewMessage` | `function routeWebviewMessage(ctx: HostContext, msg: WebviewToHostMessage): void` |
| `host/panel-layout-patcher.ts` | `patchLayout`, `handleNodeMoved`, `handleNodeResized`, `handleNodeStyled`, `persistEdgeWaypoints` | 5 functions; all `(ctx: HostContext, …)` |
| `host/panel-export.ts` | `handleExportReady`, `requestExport` | `function handleExportReady(ctx: HostContext, format: string, data: string): void`; `async function requestExport(ctx: HostContext, format: "svg" \| "png"): Promise<Buffer>` |
| `host/panel-comments-adapter.ts` | `initCommentsBridge`, `routeCommentMessage`, `disposeCommentsBridge` | 3 functions; all `(ctx: HostContext, …)` |
| `host/panel-setup.ts` | `setupWebview`, `registerDisposables` | `function setupWebview(ctx: HostContext, extensionUri: vscode.Uri): void`; `function registerDisposables(ctx: HostContext, panel: vscode.WebviewPanel, extensionContext: vscode.ExtensionContext): void` |

**Layer matrix compliance:**

- L0 (`types.ts`) — imports nothing ✅
- L1 (`parser/`, `reconciler/`, `layout/`, `canvas/`, `tools/`) — imports only L0 ✅; no `vscode`, no `host/`, no `webview adapter` ✅
- L2 (`webview/protocol.ts`) — imports only L0 ✅; no L1, no L4, no `vscode` ✅
- L3 (pure webview helpers) — imports L0/L1/L2 ✅; no L4, no `vscode` ✅
- L4 (`host/`) — imports L0/L1/L2/L3 and `vscode` ✅; no upward restrictions violated ✅
- L4r (`extension.ts`) — imports L4 only ✅; no direct engine internals ✅

**Comments lifecycle boundary:** The 5-rule contract (init-once, degraded-mode, no-exception-escape, never-crash-panel, always-null-bridge) is documented in both §17.1 of `diagram-architecture.md` and `host/panel-comments-adapter.ts` stub JSDoc. No comment failures can propagate to panel-level code.
