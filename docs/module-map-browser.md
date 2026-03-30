# Module Map: `@accordo/browser`

## Purpose
VSCode extension that hosts a local WebSocket relay server (127.0.0.1:40111), which Chrome's service worker connects to. Routes Chrome browser events through unified MCP tools (comment_*, browser_get_*), bridges comment mutations to accordo-comments, and registers 10 page-understanding tools for AI agents to inspect live browser pages.

## Composition Root
`extension.ts` — `activate()` acquires BridgeAPI, creates a BrowserRelayServer, wires a `browserActionToUnifiedTool` mapper (Chrome action → unified comment tool), registers all 10 browser tools, and subscribes to accordo-comments mutations to trigger Chrome popup refreshes.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VSCode entry point; owns relay lifecycle, tool registration, comment mutation subscriptions | `activate()`, `deactivate()` |
| `relay-server.ts` | HTTP server that accepts WebSocket connections from Chrome's service worker; handles relay request/response routing | `BrowserRelayServer` class |
| `relay-router.ts` | Maps Chrome relay events to handler responses; manages token validation | `RelayRouter` class |
| `page-tool-definitions.ts` | Builds 6 MCP tool definitions (browser_get_page_map, browser_inspect_element, browser_get_dom_excerpt, browser_capture_region, browser_list_pages, browser_select_page) | `buildPageUnderstandingTools()`, `resolveAnchorMetadata()` |
| `page-tool-handlers.ts` | Facade barrel re-exporting handler implementations and types | All handler functions and types |
| `page-tool-handlers-impl.ts` | Actual handler implementations — forward requests to Chrome via relay, persist snapshots to retention store | `handleGetPageMap()`, `handleInspectElement()`, etc. |
| `page-tool-types.ts` | All tool input/output type definitions and timeout constants | `GetPageMapArgs`, `CaptureRegionArgs`, etc. |
| `wait-tool.ts` | Implements browser_wait_for tool (M109-WAIT) | `buildWaitForTool()` |
| `text-map-tool.ts` | Implements browser_get_text_map tool (M112-TEXT) | `buildTextMapTool()` |
| `semantic-graph-tool.ts` | Implements browser_get_semantic_graph tool (M113-SEM) | `buildSemanticGraphTool()` |
| `diff-tool.ts` | Implements browser_diff_snapshots tool (M101-DIFF) | `buildDiffSnapshotsTool()` |
| `snapshot-retention.ts` | 5-slot per-page FIFO snapshot retention store for page-understanding tools | `SnapshotRetentionStore` class |
| `eval-harness.ts` | Ephemeral eval context for untrusted browser code | `EvalHarness` class |
| `eval-emitter.ts` | Event emitter for eval lifecycle (start, result, error, end) | `EvalEmitter` class |
| `eval-types.ts` | TypeScript types for the eval subsystem | `EvalConfig`, `EvalResult`, etc. |
| `types.ts` | Shared types for BridgeAPI, BrowserBridgeAPI, BrowserRelayAction | `BrowserBridgeAPI`, `BrowserRelayAction` union |

## Extension Points

- **`BrowserBridgeAPI`**: Local interface mirroring BridgeAPI but scoped to the browser package's needs (registerTools, publishState, invokeTool).
- **`browserActionToUnifiedTool()`**: The dispatch function that maps each BrowserRelayAction to a unified `comment_*` tool call. New Chrome→VSCode routing is added here.
- **`SnapshotRetentionStore`**: Shared across all 4 data-producing page-understanding tools. Provides coherent 5-slot FIFO per page — new tool implementations should call `snapshotStore.put()` rather than managing their own retention.
- **`BrowserRelayLike` interface**: The relay interface consumed by tool handlers. Allows injecting a mock relay in tests.

## Internal Boundaries

- **`eval-harness.ts`**, **`eval-emitter.ts`**, and **`eval-types.ts`** are internal to the eval subsystem — they are not imported by tool handlers or relay components.
- **`relay-router.ts`** is internal to the relay server — it is not used by tool handlers.
- **`page-tool-handlers-impl.ts`** should not be imported directly by external packages — use the barrel `page-tool-handlers.ts` instead.
- **`SnapshotRetentionStore`** uses a `WeakMap<BrowserPage, SnapshotEntry[]>` internally — external callers should use `put()`, `get()`, and `evict()` and not depend on the internal map structure.
- The **`BrowserRelayAction`** discriminated union in `types.ts` defines all Chrome→VSCode relay actions. Adding a new relay action requires adding it to this union and routing it in `browserActionToUnifiedTool()` in `extension.ts`.
