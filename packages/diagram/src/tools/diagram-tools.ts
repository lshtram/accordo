/**
 * A14 — MCP tool definitions for the diagram package.
 *
 * Thin re-export facade maintaining the original public API surface.
 * Split into:
 *   diagram-tool-definitions.ts  — 6 ExtensionToolDefinition schema objects
 *   diagram-tool-handlers.ts     — all handler functions and types
 *
 * Public API (unchanged — all re-exported for API parity)
 * ──────────
 *   createDiagramTools(ctx) → ExtensionToolDefinition[]   (used by extension entry)
 *   resolveGuarded(root, inputPath) → string               (throws DiagToolError)
 *   listHandler / getHandler / createHandler / patchHandler / renderHandler / styleGuideHandler
 *   DiagToolError
 *   DiagramToolContext / DiagramPanelLike
 *   ToolOk<T> / ToolErr / ToolResult<T>
 *   DiagramListEntry / DiagramGetResult / DiagramCreateResult / DiagramPatchResult / DiagramRenderResult / DiagramStyleGuideResult
 *   ErrorCode
 *
 * Source: diag_workplan.md §4.14, diag_arch_v4.2.md §6
 */

// Re-export all public types and values from the split modules
export type { ErrorCode } from "./diagram-tool-handlers.js";
export type { ToolOk, ToolErr, ToolResult } from "./diagram-tool-handlers.js";
export type { DiagramPanelLike, DiagramToolContext } from "./diagram-tool-handlers.js";
export type {
  DiagramListEntry,
  DiagramGetResult,
  DiagramCreateResult,
  DiagramPatchResult,
  DiagramRenderResult,
  DiagramStyleGuideResult,
} from "./diagram-tool-handlers.js";
export { DiagToolError, resolveGuarded } from "./diagram-tool-handlers.js";
export {
  listHandler,
  getHandler,
  createHandler,
  patchHandler,
  renderHandler,
  styleGuideHandler,
} from "./diagram-tool-handlers.js";
export { createDiagramTools } from "./diagram-tool-definitions.js";
