# Module Map: `@accordo/browser-extension`

## Purpose
Chrome browser extension (service worker + content scripts) that captures page structure, handles comment CRUD from within Chrome, manages snapshot versioning for page retention, and relays all operations to accordo-browser via a WebSocket tunnel.

## Composition Root
`service-worker.ts` — The esbuild entry point. Imports the three focused sub-modules (sw-comment-sync.ts, sw-router.ts, sw-lifecycle.ts) and wires them together. Registers listeners on install, starts the relay bridge, and kicks off periodic sync. This file has no exports beyond re-exports for testability.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `service-worker.ts` | esbuild entry point; bootstraps and wires the three sub-systems | `handleMessage`, `registerListeners()`, `mergeLocalAndHubThread` |
| `sw-router.ts` | Factory for the message handler; dispatches incoming Chrome messages to the right handler function | `createHandleMessage()` |
| `sw-lifecycle.ts` | chrome.webNavigation listeners, onInstalled handler, periodic sync, relay bridge wiring | `registerListeners()`, `onInstalled()`, `startPeriodicSync()`, `stopPeriodicSync()` |
| `sw-comment-sync.ts` | Hub↔Browser comment sync; merges local and Hub threads, handles comment mutations | `mergeLocalAndHubThread()`, `relayBridge`, `broadcastCommentsUpdated()` |
| `relay-actions.ts` | Thin dispatch switch + re-exports; single public entry point for all relay actions | `handleRelayAction()`, `defaultStore`, `handleNavigationReset()` |
| `relay-definitions.ts` | All public types (RelayAction, RelayActionRequest, RelayActionResponse); module-level SnapshotStore singleton | `RelayAction`, `RelayActionRequest`, `RelayActionResponse`, `defaultStore`, `isVersionedSnapshot()` |
| `relay-handlers.ts` | Barrel re-exporting all handler sub-modules | All handler functions |
| `relay-comment-handlers.ts` | Comment CRUD handlers (get_all_comments, create_comment, reply, resolve, reopen, delete, etc.) | `handleGetAllComments()`, `handleCreateComment()`, etc. |
| `relay-page-handlers.ts` | Page understanding handlers (get_page_map, inspect_element, get_dom_excerpt, wait_for, get_text_map, get_semantic_graph) | `handleGetPageMap()`, `handleInspectElement()`, etc. |
| `relay-capture-handler.ts` | Screenshot capture and snapshot diff | `handleCaptureRegion()`, `handleDiffSnapshots()`, `cropImageToBounds()` |
| `relay-tab-handlers.ts` | Multi-tab management (list_pages, select_page) | `handleListPages()`, `handleSelectPage()` |
| `relay-forwarder.ts` | Cross-context messaging utilities (content script ↔ service worker) | Internal utility functions |
| `relay-bridge.ts` | WebSocket client that connects the service worker to accordo-browser's relay server; manages reconnection and request/response routing | `RelayBridgeClient` class |
| `snapshot-store.ts` | In-memory snapshot retention with 5-slot FIFO per page | `SnapshotStore` class |
| `snapshot-versioning.ts` | Snapshot ID minting, version tracking, navigation reset | `VersionedSnapshot`, `SnapshotEnvelope`, `resetDefaultManager()` |
| `content-anchor.ts` | Resolves comment anchors within page content | Content script utility |
| `content-input.ts` | Captures user input state within page forms | Content script utility |
| `content-pins.ts` | Manages visual pin overlays for comments in the browser | Content script utility |
| `exporter.ts` | Serialises snapshot data for export | `exportSnapshots()` |

## Extension Points

- **`RelayAction`** discriminated union: All 19 actions are enumerated in `relay-definitions.ts`. New relay actions are added by creating a handler in the appropriate `relay-*.ts` file and registering it in `relay-actions.ts`'s dispatch switch.
- **`SnapshotStore`** singleton: Exported as `defaultStore` for direct test access. The `handleNavigationReset()` function clears it on top-level navigation.
- **`RelayBridgeClient`**: The WebSocket client class — can be replaced or subclassed for alternative transport (e.g., chrome.runtime.connect instead of raw WebSocket).
- **`defaultStore`** (SnapshotStore): Module-level singleton used by all handler functions. `handleNavigationReset()` resets it on navigation.

## Internal Boundaries

- **`service-worker.ts`** is the only esbuild entry point. Content scripts (under `content/`) run in page context and communicate with the service worker via `relay-forwarder.ts` utilities — they should not import relay-handlers directly.
- **`relay-forwarder.ts`** is internal — its utilities are used by content scripts and the service worker but are not part of the public relay action API.
- **`snapshot-versioning.ts`** is internal to the capture pipeline — handlers in `relay-capture-handler.ts` use it to produce SnapshotEnvelopes, but external callers use the `SnapshotEnvelope` type from `relay-definitions.ts`.
- **`content/` directory**: Content scripts run in the Chrome page context and must not import Node.js modules or service worker modules. They communicate exclusively through the relay-forwarder message passing layer.
- **`defaultStore`** is a module-level singleton — handlers that need snapshot retention must use this shared instance rather than creating their own, to maintain coherent 5-slot FIFO semantics across all data-producing paths.
