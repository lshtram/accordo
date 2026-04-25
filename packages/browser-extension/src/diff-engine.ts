/**
 * M101-DIFF — Diff Engine facade
 *
 * @module
 */

export type {
  DiffChange,
  DiffError,
  DiffNode,
  DiffResult,
  DiffSummary,
  FlatNode,
} from "./diff-engine-types.js";
export { buildNodeIndex, computeDiff, flattenNodes, formatTextDelta } from "./diff-engine-runtime.js";
