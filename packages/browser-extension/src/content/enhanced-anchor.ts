/**
 * M90-ANC — Enhanced Anchor System facade
 *
 * @module
 */

export type { AnchorGenerationResult, AnchorResolvedTier, AnchorStrategy, ParsedEnhancedAnchor } from "./enhanced-anchor-types.js";
export { STRATEGY_CONFIDENCE, STRATEGY_PREFIXES, STRATEGY_RESOLVED_TIER } from "./enhanced-anchor-types.js";
export {
  buildCssPath,
  chooseBestElement,
  getAriaKey,
  getTestId,
  getViewportPct,
  hasStableAncestor,
  isRenderable,
  queryBest,
  splitAnchorOffset,
} from "./enhanced-anchor-helpers.js";
export {
  findAnchorElementByKey,
  generateAnchorKey,
  isEnhancedAnchorKey,
  parseAnchorKey,
  parseEnhancedAnchorKey,
  parseViewportAnchorKey,
  resolveAnchorKey,
} from "./enhanced-anchor-resolution.js";
