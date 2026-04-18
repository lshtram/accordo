# Module Map: `@accordo/browser`

## Purpose
VSCode extension that hosts a local WebSocket relay server (`127.0.0.1:40111`), which Chrome's service worker connects to. Routes Chrome browser events through unified MCP tools (`comment_*`, `browser_*`), bridges comment mutations to accordo-comments, and registers page-understanding tools for AI agents to inspect live browser pages.

## Composition Root
`tool-assembly.ts` — `buildBrowserTools()` is the real composition function. It assembles all browser MCP tools by composing page-understanding, wait-for, text-map, semantic-graph, diff-snapshots, health, manage-snapshots, manage-screenshots, spatial-relations, control, and pair tools into a single array for registration with the bridge.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `tool-assembly.ts` | Assembles all 19 browser tools via `buildBrowserTools()` — the canonical composition point | `buildBrowserTools(relay, snapshotStore, securityConfig, screenshotStore?)` |
| `extension.ts` | VSCode entry point; owns relay lifecycle, command registration, tool registration via buildBrowserTools | `activate()`, `deactivate()` |
| `relay-server.ts` | HTTP server that accepts WebSocket connections from Chrome's service worker; handles relay request/response routing | `BrowserRelayServer` class |
| `relay-router.ts` | Maps Chrome relay events to handler responses; manages token validation | `RelayRouter` class |
| `shared-relay-server.ts` | Shared relay server for multi-window scenarios; Hub client connections | `SharedBrowserRelayServer` class |
| `shared-relay-client.ts` | Per-window client connecting to the shared relay server | `SharedRelayClient` class |
| `page-tool-definitions.ts` | Builds 6 page-understanding tool definitions (browser_get_page_map, browser_inspect_element, browser_get_dom_excerpt, browser_capture_region, browser_list_pages, browser_select_page) | `buildPageUnderstandingTools()`, `resolveAnchorMetadata()` |
| `page-tool-handlers.ts` | Barrel re-exporting handler implementations and types | All handler functions and types |
| `page-tool-handlers-impl.ts` | Actual handler implementations — forward requests to Chrome via relay, persist snapshots to retention store | `handleGetPageMap()`, `handleInspectElement()`, etc. |
| `page-tool-types.ts` | All tool input/output type definitions and timeout constants | `GetPageMapArgs`, `CaptureRegionArgs`, etc. |
| `wait-tool.ts` | Implements `browser_wait_for` tool (B2-WA-001..007) | `buildWaitForTool()` |
| `text-map-tool.ts` | Implements `browser_get_text_map` tool (B2-TX-001..010) | `buildTextMapTool()` |
| `semantic-graph-tool.ts` | Implements `browser_get_semantic_graph` tool (B2-SG-001..015) | `buildSemanticGraphTool()` |
| `diff-tool.ts` | Implements `browser_diff_snapshots` tool (B2-DE-001..007) | `buildDiffSnapshotsTool()` |
| `health-tool.ts` | Implements `browser_health` tool | `buildHealthTool()` |
| `manage-snapshots-tool.ts` | Implements `browser_manage_snapshots` tool (GAP-F1) | `buildManageSnapshotsTool()` |
| `manage-screenshots-tool.ts` | Implements `browser_manage_screenshots` tool (GAP-G1) | `buildManageScreenshotsTool()` |
| `spatial-relations-tool.ts` | Implements `browser_get_spatial_relations` tool (GAP-D1) | `buildSpatialRelationsTool()` |
| `control-tools.ts` | Implements navigation/interaction tools: browser_navigate, browser_click, browser_type, browser_press_key | `buildControlTools()` |
| `snapshot-retention.ts` | 5-slot per-page FIFO snapshot retention store for page-understanding tools | `SnapshotRetentionStore` class |
| `screenshot-retention.ts` | Screenshot retention store for file-ref capture mode (GAP-G1) | `ScreenshotRetentionStore` class |
| `eval-harness.ts` | Ephemeral eval context for untrusted browser code | `EvalHarness` class |
| `eval-emitter.ts` | Event emitter for eval lifecycle (start, result, error, end) | `EvalEmitter` class |
| `eval-types.ts` | TypeScript types for the eval subsystem | `EvalConfig`, `EvalResult`, etc. |
| `types.ts` | Shared types for BridgeAPI, BrowserBridgeAPI, BrowserRelayAction | `BrowserBridgeAPI`, `BrowserRelayAction` union |
| `relay-lifecycle.ts` | Shared relay activation logic (per-window vs shared mode) | `activateSharedRelay()`, `activatePerWindowRelay()` |

## MCP Tool Inventory (19 tools)

All tools use the `accordo_browser_*` naming convention (underscore-separated):

| Tool | File |
|------|------|
| `accordo_browser_get_page_map` | page-tool-definitions.ts |
| `accordo_browser_inspect_element` | page-tool-definitions.ts |
| `accordo_browser_get_dom_excerpt` | page-tool-definitions.ts |
| `accordo_browser_capture_region` | page-tool-definitions.ts |
| `accordo_browser_list_pages` | page-tool-definitions.ts |
| `accordo_browser_select_page` | page-tool-definitions.ts |
| `accordo_browser_wait_for` | wait-tool.ts |
| `accordo_browser_get_text_map` | text-map-tool.ts |
| `accordo_browser_get_semantic_graph` | semantic-graph-tool.ts |
| `accordo_browser_diff_snapshots` | diff-tool.ts |
| `accordo_browser_health` | health-tool.ts |
| `accordo_browser_manage_snapshots` | manage-snapshots-tool.ts |
| `accordo_browser_manage_screenshots` | manage-screenshots-tool.ts |
| `accordo_browser_get_spatial_relations` | spatial-relations-tool.ts |
| `accordo_browser_navigate` | control-tools.ts |
| `accordo_browser_click` | control-tools.ts |
| `accordo_browser_type` | control-tools.ts |
| `accordo_browser_press_key` | control-tools.ts |
| `accordo_browser_pair` | tool-assembly.ts |

## Shared Relay Architecture

The browser extension supports two relay modes (controlled by `accordo.browser.sharedRelay` feature flag, default `true`):

- **Shared mode**: A single `SharedBrowserRelayServer` runs as a Hub client. All VS Code windows connect as clients. Chrome extension connects once to the same server. Request routing uses `hubId` to ensure responses reach the correct window.
- **Per-window mode**: Each VS Code window runs its own `BrowserRelayServer`. Chrome extension maintains separate connections per window.

## Extension Points

- **`BrowserBridgeAPI`**: Local interface mirroring BridgeAPI but scoped to the browser package's needs (registerTools, publishState, invokeTool).
- **`SnapshotRetentionStore`**: Shared across all 4 data-producing page-understanding tools. Provides coherent 5-slot FIFO per page — new tool implementations should call `snapshotStore.save()` rather than managing their own retention.
- **`BrowserRelayLike` interface**: The relay interface consumed by tool handlers. Allows injecting a mock relay in tests.
- **`CommentBackendAdapter`**: Interface abstracting comment storage (VS Code relay adapter, local storage adapter, standalone MCP adapter for future use).

## Internal Boundaries

- **`eval-harness.ts`**, **`eval-emitter.ts`**, and **`eval-types.ts`** are internal to the eval subsystem — they are not imported by tool handlers or relay components.
- **`relay-router.ts`** is internal to the relay server — it is not used by tool handlers.
- **`page-tool-handlers-impl.ts`** should not be imported directly by external packages — use the barrel `page-tool-handlers.ts` instead.
- **`SnapshotRetentionStore`** uses a `WeakMap<BrowserPage, SnapshotEntry[]>` internally — external callers should use `save()`, `get()`, and `evict()` and not depend on the internal map structure.
- The **`BrowserRelayAction`** discriminated union in `types.ts` defines all Chrome→VSCode relay actions. Adding a new relay action requires adding it to this union and routing it in the relay handler.
