import type { SnapshotEnvelopeFields } from "./types.js";

export interface InspectElementArgs {
  tabId?: number;
  anchorKey?: string;
  creationSnapshotId?: string;
  uid?: string;
  ref?: string;
  selector?: string;
  nodeId?: number;
  frameId?: string;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
}

export interface ElementStates {
  states?: string[];
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  checked?: boolean;
  expanded?: boolean;
  focused?: boolean;
  selected?: boolean;
  invalid?: boolean;
}

export interface InspectElementResponse extends SnapshotEnvelopeFields {
  found: boolean;
  anchorKey?: string;
  anchorStrategy?: string;
  anchorConfidence?: string;
  resolvedTier?: number;
  snapshotDrift?: boolean;
  canonicalAnchorKey?: string;
  canonicalAnchorStrategy?: string;
  canonicalAnchorConfidence?: string;
  canonicalResolvedTier?: number;
  element?: Record<string, unknown> & Partial<ElementStates>;
  context?: Record<string, unknown>;
  visibilityConfidence?: string;
  auditId?: string;
  redactionApplied?: boolean;
  redactionWarning?: string;
}
