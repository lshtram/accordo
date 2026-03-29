/**
 * M91-PU + M91-CR — Page Understanding MCP Tools
 *
 * @module
 */

// Re-export everything for backwards compatibility
export type * from "./page-tool-definitions.js";
export type * from "./page-tool-handlers.js";
export { buildPageUnderstandingTools } from "./page-tool-definitions.js";
export {
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleCaptureRegion,
  handleListPages,
  handleSelectPage,
} from "./page-tool-handlers.js";
