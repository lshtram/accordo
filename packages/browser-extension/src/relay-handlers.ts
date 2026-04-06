/**
 * relay-handlers.ts — Barrel re-export for all relay action handlers.
 *
 * Aggregates exports from focused sub-modules:
 *   - relay-comment-handlers.ts   — comment CRUD actions
 *   - relay-page-handlers.ts      — page understanding + wait_for actions
 *   - relay-capture-handler.ts    — capture_region + diff_snapshots
 *   - relay-tab-handlers.ts       — list_pages + select_page
 *
 * Also re-exports cropImageToBounds (used in tests via relay-actions.js surface).
 *
 * @module
 */

export {
  handleGetAllComments,
  handleGetComments,
  handleCreateComment,
  handleReplyComment,
  handleDeleteComment,
  handleResolveThread,
  handleReopenThread,
  handleDeleteThread,
  handleNotifyCommentsUpdated,
} from "./relay-comment-handlers.js";

export {
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleGetTextMap,
  handleGetSemanticGraph,
  handleGetSpatialRelations,
  handleWaitFor,
} from "./relay-page-handlers.js";

export {
  cropImageToBounds,
  handleCaptureRegion,
  handleDiffSnapshots,
} from "./relay-capture-handler.js";

export {
  handleListPages,
  handleSelectPage,
} from "./relay-tab-handlers.js";

export {
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
} from "./relay-control-handlers.js";
