import type { SnapshotEnvelopeFields } from "./types.js";
export type { WaitForArgs } from "./wait-tool-contracts.js";
export type { GetTextMapArgs } from "./text-map-tool-contracts.js";
export type { GetSemanticGraphArgs } from "./semantic-graph-tool-contracts.js";

export interface GetDomExcerptArgs {
  tabId?: number;
  anchorKey?: string;
  creationSnapshotId?: string;
  selector?: string;
  maxDepth?: number;
  maxLength?: number;
  frameId?: string;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
}

export interface DomExcerptResponse extends SnapshotEnvelopeFields {
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
  html?: string;
  text?: string;
  nodeCount?: number;
  truncated?: boolean;
  auditId?: string;
  redactionApplied?: boolean;
  redactionWarning?: string;
}
