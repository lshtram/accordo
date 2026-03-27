import { getAnchorPagePosition, getViewportAnchorPagePosition } from "../content-anchor.js";
import { resolveAnchorKey } from "./enhanced-anchor.js";

export interface PagePosition {
  x: number;
  y: number;
}

/**
 * Resolve a browser blockId/anchorKey to page coordinates for pin placement.
 * Supports enhanced keys (id:, data-testid:, aria:, css:, tag:, body:..%) and
 * legacy keys (tag:index:fingerprint@x,y).
 */
export function resolveAnchorPagePosition(blockId: string): PagePosition | null {
  // Viewport percentage anchors from normalized Hub/browser coordinates
  // must map to viewport position directly (not to <body> element bounds).
  const viewportPos = getViewportAnchorPagePosition(blockId);
  if (viewportPos) {
    return viewportPos;
  }

  const anchorElement = resolveAnchorKey(blockId);
  if (anchorElement) {
    return getAnchorPagePosition(blockId, anchorElement);
  }

  return null;
}
