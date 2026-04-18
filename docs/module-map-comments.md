# Module Map: `@accordo/comments`

## Purpose
Provides persistent inline comment threads anchored to text ranges or surface coordinates, with full CRUD operations, a VSCode Comments API integration (gutter icons, inline threads, Comments Panel), and MCP tools for AI agents to query and mutate comment state.

## Composition Root
`extension.ts` — Thin VSCode entry point that calls `comments-bootstrap.ts`'s `activate()` and `deactivate()`. Re-exports types for inter-extension callers.

`comments-bootstrap.ts` — The real composition root: creates CommentStore, loads persisted data, auto-prunes stale threads, initialises NativeComments (gutter icons, inline thread widgets), wires the custom Comments Panel via `wirePanelAndCommands()`, registers inter-extension internal commands (bridge-integration), acquires BridgeAPI (if present) and registers the 8 MCP comment tools and state contribution.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `comments-bootstrap.ts` | VSCode activation ceremony; wires CommentStore, NativeComments, Bridge tools, state contribution, panel/commands | `activate()`, `deactivate()`, `CommentsExtensionExports` interface |
| `comment-store.ts` | VSCode adapter around CommentRepository; owns persistence (workspace.fs), write queue, event listeners | `CommentStore` class, `vscodeWorkspaceFsAdapter()`, `StorageAdapter` interface |
| `comment-repository.ts` | Pure in-memory domain logic; all CRUD, filtering, staleness tracking, serialization — zero vscode imports | `CommentRepository` class, all domain types |
| `comment-store-ops.ts` | Core domain operations mixed into CommentRepository (createThread, reply, resolve, reopen, delete, etc.) | Base class mixin |
| `comment-store-io.ts` | Type definitions for store I/O (ListThreadsOptions, CreateCommentParams, etc.) | All domain param/result types |
| `native-comments.ts` | Owns the vscode.CommentController lifecycle, widget map, and command registration | `NativeComments` class |
| `native-comment-controller.ts` | Creates CommentController, registers gutter icons and comment commands, builds CommentThread widgets | `NativeCommentController` class |
| `native-comment-sync.ts` | Synchronises CommentRepository threads to VSCode CommentThread widgets; handles lifecycle events | Internal to NativeComments |
| `panel-bootstrap.ts` | Creates the custom Comments Panel via `vscode.window.createTreeView('accordo-comments-panel', ...)`, registers panel commands (resolve/reopen/reply/delete/navigate/groupBy/filter), wires `CommentsTreeProvider` + `PanelFilters`, and registers the `accordo.comments.new` command (gutter reply handler) | `wirePanelAndCommands()` |
| `comment-tools/handlers.ts` | MCP tool handler factory; maps Bridge tool calls to CommentRepository mutations | `buildCommentToolHandlers()`, `CommentUINotifier`, `CompositeCommentUINotifier` |
| `comment-tools/definitions.ts` | Tool schemas (JSON Schema for each tool) | `commentToolSchemas`, `ToolSchema` type |
| `bridge-integration.ts` | Registers inter-extension commands (comment CRUD from browser context) | `registerBridgeIntegrationCommands()` |
| `state-contribution.ts` | Pushes comment modality state to Bridge via publishState | `startStateContribution()` |

## Extension Points

- **`CommentUINotifier`** interface: Allows external callers (e.g., accordo-browser) to register notifiers that fire when comment threads are added, updated, or removed. The browser popup refreshes via this interface.
- **`StorageAdapter`** interface: Abstracts persistence layer. Default implementation uses `vscode.workspace.fs`; can be replaced with a plain file system adapter for testing.
- **`CommentsExtensionExports.registerBrowserNotifier()`**: The public entry point for accordo-browser to subscribe to comment mutation events.
- **Bridge tools**: Eight MCP tools (`comment_list`, `comment_get`, `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`, `comment_sync_version`) are registered with the Bridge when accordo-bridge is present. These tools are the public interface for AI agents to query and mutate comment state.
- **`SurfaceCommentAdapter`** type: Consumed from bridge-integration for routing browser-based comment operations.

## Internal Boundaries

- **`CommentRepository`** and **`comment-store-ops.ts`** are pure domain — no `vscode` imports. These are the only files safe for non-VSCode environments to import.
- **`CommentStore`** wraps CommentRepository but adds persistence and vscode event handling. It is **not** exported from the public barrel (`index.ts`) — external packages must not depend on it directly.
- **`native-comment-controller.ts`** and **`native-comment-sync.ts`** are internal VSCode adapters — they are not re-exported and should not be imported outside the comments package.
- **`panel-bootstrap.ts`** is internal to the bootstrap layer — it creates the VSCode `TreeView` panel, command registrations, and document-change staleness tracking infrastructure. Other packages do not need to know about these internals.
- The **`comment-tools/`** subdirectory is internal — the barrel `index.ts` re-exports `buildCommentToolHandlers` but not the individual tool implementation files.
