import type { AnchorStrategy } from "./enhanced-anchor.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";

export interface DomExcerptResult extends SnapshotEnvelope {
  found: boolean;
  anchorKey?: string;
  anchorStrategy?: AnchorStrategy;
  anchorConfidence?: "high" | "medium" | "low";
  resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  snapshotDrift?: boolean;
  canonicalAnchorKey?: string;
  canonicalAnchorStrategy?: AnchorStrategy;
  canonicalAnchorConfidence?: "high" | "medium" | "low";
  canonicalResolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  html?: string;
  text?: string;
  nodeCount?: number;
  truncated?: boolean;
}

export interface InspectElementArgs {
  uid?: string;
  anchorKey?: string;
  creationSnapshotId?: string;
  ref?: string;
  selector?: string;
  nodeId?: number;
}

export interface ElementContext {
  parentChain: string[];
  siblingCount: number;
  siblingIndex: number;
  nearestLandmark?: string;
}

export interface ElementDetail {
  tag: string;
  id?: string;
  classList?: string[];
  role?: string;
  ariaLabel?: string;
  textContent?: string;
  attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  visibleConfidence: "high" | "medium" | "low";
  accessibleName?: string;
  testIds?: Record<string, string>;
  states?: string[];
  disabled?: boolean;
  readonly?: boolean;
  hasPointerEvents?: boolean;
  isObstructed?: boolean;
  clickTargetSize?: { width: number; height: number };
}

export interface InspectElementResult extends SnapshotEnvelope {
  found: boolean;
  anchorKey?: string;
  anchorStrategy?: AnchorStrategy;
  anchorConfidence?: "high" | "medium" | "low";
  resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  snapshotDrift?: boolean;
  canonicalAnchorKey?: string;
  canonicalAnchorStrategy?: AnchorStrategy;
  canonicalAnchorConfidence?: "high" | "medium" | "low";
  canonicalResolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  element?: ElementDetail;
  context?: ElementContext;
  visibilityConfidence?: "high" | "medium" | "low";
}
