/**
 * GAP-D1 — Spatial Relations Runtime Helpers (facade)
 *
 * Re-exports from split modules:
 *   spatial-relations-runtime-caps.ts   — count-cap + response-guard helpers
 *   spatial-relations-runtime-relay.ts  — relay response processing helpers
 *
 * @module
 */

export {
  checkCountCap,
  guardResponseObject,
} from "./spatial-relations-runtime-caps.js";

export {
  guardCapAndAudit,
  forwardWithAudit,
  classifyRelayErrorResponse,
  checkOriginPolicyResponse,
  narrowResponse,
  completeSpatialSuccess,
  narrowAndStore,
} from "./spatial-relations-runtime-relay.js";