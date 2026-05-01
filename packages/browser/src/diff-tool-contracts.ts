import type { SnapshotEnvelopeFields } from "./types.js";

export interface EvictionHint {
  requestedSnapshotId: string;
  retentionWindow: number;
  wasEvicted: boolean;
  suggestedAction: string;
}

export interface DiffSnapshotsArgs {
  tabId?: number;
  fromSnapshotId?: string;
  toSnapshotId?: string;
}

export interface DiffNodeResult {
  nodeId: number;
  tag: string;
  text?: string;
  role?: string;
}

export interface DiffChangeResult {
  nodeId: number;
  tag: string;
  field: string;
  before: string;
  after: string;
}

export interface DiffSummaryResult {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  textDelta: string;
}

export interface DiffSnapshotsResponse extends SnapshotEnvelopeFields {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: DiffNodeResult[];
  removed: DiffNodeResult[];
  changed: DiffChangeResult[];
  summary: DiffSummaryResult;
  orderingWarning?: string;
}

export interface DiffToolError {
  success: false;
  error: "snapshot-not-found" | "snapshot-stale" | "browser-not-connected" | "timeout" | "action-failed" | "implicit-snapshot-resolution-required";
  errorCode?: "snapshot-not-found" | "snapshot-stale" | "browser-not-connected" | "timeout" | "action-failed" | "implicit-snapshot-resolution-required";
  retryable: boolean;
  retryAfterMs?: number;
  recoveryHints?: string;
  details?: {
    eviction?: EvictionHint;
    navigationBoundary?: { currentVersion: number };
    reason: string;
    recoveryHints?: string;
    availableSnapshotIds?: string[];
  };
}

export const DIFF_TIMEOUT_MS = 5_000;
