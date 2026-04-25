/**
 * relay-page-handlers.ts — Barrel exports for page-understanding relay handlers.
 *
 * @module
 */

export { handleGetPageMap } from "./relay-get-page-map.js";
export {
  handleGetDomExcerpt,
  handleGetSemanticGraph,
  handleGetSpatialRelations,
  handleGetTextMap,
  handleInspectElement,
} from "./relay-page-secondary-handlers.js";
export { handleWaitFor } from "./relay-page-wait.js";
