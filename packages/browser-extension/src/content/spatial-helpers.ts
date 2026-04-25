/**
 * GAP-D1 — Spatial Geometry Helpers facade
 *
 * @module
 */

export type {
  Rect,
  SpatialRelation,
  SpatialRelationsResult,
  ViewportInfo,
} from "./spatial-types.js";
export {
  MAX_SPATIAL_NODE_IDS,
  SEMANTIC_CONTAINER_ROLES,
  SEMANTIC_CONTAINER_TAGS,
} from "./spatial-types.js";
export {
  above,
  computeSpatialRelations,
  contains,
  distance,
  leftOf,
  overlap,
  viewportIntersectionRatio,
} from "./spatial-geometry.js";
export { findNearestContainer } from "./spatial-containers.js";
