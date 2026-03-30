/**
 * A14 — MCP tool handlers for the diagram package.
 *
 * Slim facade — re-exports all public types and operations from
 * diagram-tool-types.ts and diagram-tool-ops.ts to maintain a stable
 * public API for callers.
 *
 * Public exports (from diagram-tool-types.ts)
 * ──────────────
 *   DiagToolError               — thrown/handled path guard error
 *   DiagramToolContext           — context interface
 *   DiagramPanelLike             — panel interface
 *   ToolOk<T> / ToolErr / ToolResult<T> — result envelope
 *   DiagramListEntry / DiagramGetResult / DiagramCreateResult / DiagramPatchResult / DiagramRenderResult / DiagramStyleGuideResult
 *
 * Public exports (from diagram-tool-ops.ts)
 * ──────────────
 *   resolveGuarded(root, inputPath) — throws DiagToolError on escape
 *   listHandler / getHandler / createHandler / patchHandler / renderHandler / styleGuideHandler
 *
 * Source: diag_workplan.md §4.14, diag_arch_v4.2.md §6
 */

// Re-export all public types from diagram-tool-types
export type {
  ErrorCode,
  ToolOk,
  ToolErr,
  ToolResult,
  DiagramListEntry,
  DiagramGetResult,
  DiagramCreateResult,
  DiagramPatchResult,
  DiagramRenderResult,
  DiagramStyleGuideResult,
} from "./diagram-tool-types.js";

export { DiagToolError } from "./diagram-tool-types.js";
export type { DiagramPanelLike, DiagramToolContext } from "./diagram-tool-types.js";

// Re-export all operations from diagram-tool-ops
export {
  resolveGuarded,
  listHandler,
  getHandler,
  createHandler,
  patchHandler,
  renderHandler,
  styleGuideHandler,
} from "./diagram-tool-ops.js";
