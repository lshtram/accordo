/**
 * M113-SEM — Semantic Graph helpers facade
 *
 * @module
 */

export {
  DEFAULT_MAX_DEPTH,
  EXCLUDED_TAGS,
  LANDMARK_ROLES,
  LANDMARK_TAG_ROLES,
  MAX_DEPTH_LIMIT,
  SEMANTIC_GRAPH_TIMEOUT_MS,
  TAG_ROLES,
} from "./semantic-graph-types.js";
export { NodeIdRegistry, getElementRect, isHidden } from "./semantic-graph-registry.js";
export { collectElementStates } from "./semantic-graph-states.js";
export { getAccessibleName, getRole, hasAccessibleLabel } from "./semantic-graph-accessibility.js";
