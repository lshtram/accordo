# Browser Family Modularity — Phase A Design

## Scope

- `packages/browser`
- `packages/browser-extension`

## Out of scope

- `packages/bridge-types`
- `packages/capabilities`
- feature changes unrelated to modularity

## Shared-foundation constraints

- `@accordo/bridge-types` is the canonical relay contract owner
- `@accordo/capabilities` is stable and must not be casually edited
- no direct `browser` ↔ `browser-extension` source imports
- no new cross-modality coupling

## Target structure

### `packages/browser`

1. Thin `extension.ts` composition root
2. Extract focused modules:
   - `comment-sync.ts`
   - `comment-notifier.ts`
   - `relay-lifecycle.ts`
   - `tool-assembly.ts`
   - `page-tool-pipeline.ts`
3. Keep comments integration optional at runtime
4. Remove `browser-tools.ts` only if removal gate passes

### `packages/browser-extension`

1. Add `relay-config.ts`
2. Add `relay-transport.ts`
3. Move singletons to composition root (`service-worker.ts`)
4. Preserve existing handler-family split

## Module interface/signature matrix

### `packages/browser/src/comment-sync.ts`

Exports:

```typescript
// Frozen Phase A signatures

export const SYNC_INTERVAL_MS = 30_000;

export interface RemoteBrowserThread {
  id: string;
  anchorKey: string;
  anchorContext?: {
    tagName?: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
  };
  pageUrl: string;
  status: "open" | "resolved";
  comments: RemoteBrowserComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

export interface RemoteBrowserComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user"; name: string };
  body: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  deletedAt?: string;
}

export interface GetCommentsResponse {
  url: string;
  threads: RemoteBrowserThread[];
}

export function remoteThreadToCreateArgs(
  thread: RemoteBrowserThread,
): Record<string, unknown>;

export function remoteCommentToReplyArgs(
  comment: RemoteBrowserComment,
): Record<string, unknown>;

export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<"success" | "partial">;

// BrowserCommentSyncScheduler — periodic sync with in-flight guard
export class BrowserCommentSyncScheduler {
  constructor(
    relay: BrowserRelayLike,
    bridge: BrowserBridgeAPI,
    out: vscode.OutputChannel,
  ): BrowserCommentSyncScheduler;

  start(): void;                              // idempotent; starts interval
  syncNow(): Promise<void>;                    // immediate sync; no-op if in-flight
  stop(): void;                               // clears timer and guard
}
```

Rules:

- may import `vscode`, `@accordo/bridge-types`, local browser types
- must not import comments-extension internals directly

### `packages/browser/src/comment-notifier.ts`

Exports:

```typescript
// Frozen Phase A signatures

export interface PushableRelay {
  push(action: string, payload: Record<string, unknown>): void;
}

export function registerBrowserNotifier(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  relay: PushableRelay,
): vscode.Disposable | undefined;

export function browserActionToUnifiedTool(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
): { toolName: string; args: Record<string, unknown> } | null;
```

Rules:

- `registerBrowserNotifier` performs the runtime comments-availability guard internally
- pure mapping stays separate from VS Code side effects

### `packages/browser/src/relay-lifecycle.ts`

Exports:

```typescript
// Frozen Phase A signatures

export function findFreePort(
  startPort: number,
  host: string,
  maxTries?: number,
): Promise<number>;

export async function resolveRelayToken(
  context: vscode.ExtensionContext,
): Promise<string>;

export function writeRelayPort(port: number): void;

export function getSecurityConfig(): SecurityConfig;

// RelayServices — the service bag wired by wireRelayServices
export interface RelayServices {
  readonly context: vscode.ExtensionContext;
  readonly out: vscode.OutputChannel;
  readonly bridge: BrowserBridgeAPI;
  readonly token: string;
  readonly commentsAvailable: boolean;
}

export function wireRelayServices(opts: RelayServices): vscode.Disposable[];

export async function activateSharedRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  commentsAvailable: boolean,
): Promise<void>;

export async function activatePerWindowRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  commentsAvailable: boolean,
): Promise<void>;
```

Rule:

- all common wiring is centralized in `wireRelayServices`

### `packages/browser/src/tool-assembly.ts`

Exports:

```typescript
// Frozen Phase A signatures

export function buildBrowserTools(
  relay: BrowserRelayLike,
  snapshotStore: SnapshotRetentionStore,
  securityConfig: SecurityConfig,
): ExtensionToolDefinition[];
```

### `packages/browser/src/page-tool-pipeline.ts`

Exports:

```typescript
// Frozen Phase A signatures

export interface PageToolPipelineOpts<TArgs, TResponse> {
  readonly toolName: string;
  readonly relayAction: string;
  readonly timeoutMs: number;
  readonly validateResponse: (data: unknown) => TResponse | null;
  readonly extractOrigin?: (response: TResponse) => string | undefined;
  readonly redact?: (response: TResponse, security: SecurityConfig) => TResponse;
  readonly postProcess?: (response: TResponse) => TResponse;
  readonly saveSnapshot?: boolean;
}

export interface PipelineResult<TResponse> {
  readonly success: boolean;
  readonly data?: TResponse;
  readonly error?: PageToolError;
}

export async function runPageToolPipeline<TArgs, TResponse>(
  relay: BrowserRelayLike,
  args: TArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  opts: PageToolPipelineOpts<TArgs, TResponse>,
): Promise<PipelineResult<TResponse>>;
```

### `packages/browser-extension/src/relay-config.ts`

Exports:

```typescript
// Frozen Phase A signature
export interface RelayConfig {
  readonly host: string;           // e.g. "127.0.0.1"
  readonly port: number;           // e.g. 40111
  readonly reconnectDelayMs: number;
  readonly heartbeatIntervalMs: number;
  readonly tokenPollIntervalMs: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig;
export function getRelayConfig(): Promise<RelayConfig>;
```

### `packages/browser-extension/src/relay-transport.ts`

Exports:

```typescript
// Frozen Phase A signatures

// TransportState — closed union of connection states
export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// RelayTransportEvents — event listener bag
export interface RelayTransportEvents {
  onStateChange?: (state: TransportState) => void;
  onMessage?: (data: string) => void;
  onError?: (error: string) => void;
}

// RelayTransport — WebSocket connection lifecycle manager
export class RelayTransport {
  constructor(config: RelayConfig, events: RelayTransportEvents);

  getState(): TransportState;
  start(): void;        // idempotent — safe to call on every SW wake
  stop(): void;         // clears all timers
  send(data: string): boolean;
  isConnected(): boolean;
}
```

## Page-tool pipeline contract

## Fixed stage ordering

1. connection check
2. audit create
3. relay request
4. response validation
5. origin policy check
6. snapshot save
7. redaction
8. post-process
9. audit complete

## Invariants

- audit entry always completes
- redaction failures are fail-closed
- origin block happens before persistence
- pipeline never throws; returns structured error values
- returned object is detached copy, not aliased store data

## Handlers that stay outside pipeline

- `handleWaitForInline`
- `handleListPages`
- `handleSelectPage`

## `browser-tools.ts` removal gate

Delete `src/browser-tools.ts` only if all are true:

1. no source imports remain
2. no test imports remain
3. no barrel/export references remain
4. not referenced in `package.json`
5. not used by `extension.ts`

If any fail, keep it as deprecated shim for this batch.

## Optional comments fallback matrix

When comments extension is unavailable:

- browser extension still activates
- page tools remain unaffected
- comment sync scheduler is not created
- notifier is not registered
- one activation log line is emitted
- comment relay actions fail gracefully through existing error path
- no crash, no startup block

## MV3 lifecycle assumptions

- service worker state is ephemeral
- persistent state must live in `chrome.storage.local`
- transport/config/bootstrap must be safe to recreate on every wake
- snapshot store is cache-only and may be rebuilt
- `start()` methods must be idempotent

## Implementation slices

1. extract `comment-sync.ts`
2. extract `comment-notifier.ts`
3. extract `relay-lifecycle.ts`
4. extract `tool-assembly.ts`
5. add `page-tool-pipeline.ts` and refactor pipeline-eligible handlers
6. make comments optional
7. apply `browser-tools.ts` removal gate
8. add `relay-config.ts`
9. add `relay-transport.ts`
10. move singletons to composition root

## Validation

Per slice:

- `pnpm test` in affected package
- `tsc --noEmit` or package build
- no direct `browser` ↔ `browser-extension` imports introduced

High-risk smoke tests:

- shared relay mode activation
- per-window relay mode activation
- browser-extension reconnect behavior

## Requirement-to-artifact traceability

### Browser extension requirements → Phase A artifacts

| Requirement | Source | Artifact | Phase A status |
|---|---|---|---|
| M80-TYP shared types | `requirements-browser-extension.md` §3.1 | `browser-extension/src/types.ts` | ✅ types defined |
| M80-SW service worker bootstrap | `requirements-browser-extension.md` §3.2 | `browser-extension/src/service-worker.ts` | ✅ stub in place |
| MV3 lifecycle safety | `requirements-browser-extension.md` §3.3 | `browser-extension/src/relay-transport.ts` | ✅ `start()` idempotent, all timers cleared on `stop()` |
| Relay transport layer | `requirements-browser-extension.md` §3.4 | `browser-extension/src/relay-transport.ts` | ✅ `TransportState`, `RelayTransportEvents`, `RelayTransport` all signed |
| Relay config layer | `requirements-browser-extension.md` §3.4 | `browser-extension/src/relay-config.ts` | ✅ `RelayConfig`, `DEFAULT_RELAY_CONFIG`, `getRelayConfig()` signed |

### Browser package requirements → Phase A artifacts

| Requirement | Source | Artifact | Phase A status |
|---|---|---|---|
| Comment sync scheduler | `requirements-browser-mcp.md` §SBR-SYNC | `browser/src/comment-sync.ts` | ✅ `BrowserCommentSyncScheduler` class signed |
| Comment notifier registration | `requirements-browser-mcp.md` §SUB-01..SUB-03 | `browser/src/comment-notifier.ts` | ✅ `registerBrowserNotifier`, `browserActionToUnifiedTool` signed |
| Relay lifecycle management | `requirements-browser-mcp.md` §SBR-F-030..043 | `browser/src/relay-lifecycle.ts` | ✅ `activateSharedRelay`, `activatePerWindowRelay`, `wireRelayServices` signed |
| Port discovery + token resolution | `requirements-browser-mcp.md` §SBR-F-030 | `browser/src/relay-lifecycle.ts` | ✅ `findFreePort`, `resolveRelayToken`, `writeRelayPort` signed |
| Security config construction | `requirements-browser-mcp.md` §SBR-F-030 | `browser/src/relay-lifecycle.ts` | ✅ `getSecurityConfig`, `RelayServices` signed |
| Page-tool pipeline | `requirements-browser2.0.md` §B2-ER-007..008 | `browser/src/page-tool-pipeline.ts` | ✅ `PageToolPipelineOpts`, `PipelineResult`, `runPageToolPipeline` signed |
| Tool assembly | `requirements-browser-mcp.md` §MCP-REG | `browser/src/tool-assembly.ts` | ✅ `buildBrowserTools` signed |

### Key design decisions captured in this artifact

| Decision | Rationale | Documented in |
|---|---|---|
| `browser` ↔ `browser-extension` no direct source imports | Preserve independence; MV3 SW and VSCode extension are separate deployment targets | §"Shared-foundation constraints" |
| `RelayTransport.start()` idempotent | Service worker wakes are non-deterministic; start must be safe on every wake | `relay-transport.ts` docstring + §"MV3 lifecycle assumptions" |
| Comments optional at runtime | `accordo-comments` may not be installed; must not block browser relay activation | §"Optional comments fallback matrix" |
| Pipeline never throws | Reliability: all error paths return structured `PipelineResult` | §"Page-tool pipeline contract: invariants" |
| Origin block before persistence | Security: denied-origin responses must not touch disk | §"Page-tool pipeline contract: invariants" |

## Phase A acceptance criteria

- this document is the auditable source of truth
- modular split points are frozen for Phase B/C
- shared foundations remain untouched unless escalated
