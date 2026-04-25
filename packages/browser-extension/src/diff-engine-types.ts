import type { NodeIdentity, SnapshotEnvelope, VersionedSnapshot } from "./snapshot-versioning.js";

export interface DiffNode {
  nodeId: number;
  tag: string;
  id?: string;
  text?: string;
  role?: string;
}

export interface DiffChange {
  nodeId: number;
  tag: string;
  field: "textContent" | `attribute:${string}` | "role";
  before: string;
  after: string;
}

export interface DiffSummary {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  textDelta: string;
}

export interface DiffResult extends SnapshotEnvelope {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: DiffNode[];
  removed: DiffNode[];
  changed: DiffChange[];
  summary: DiffSummary;
}

export interface DiffError {
  success: false;
  error: "snapshot-not-found" | "snapshot-stale";
}

export interface FlatNode {
  nodeId: number;
  persistentId: string;
  tag: string;
  text: string | undefined;
  role: string | undefined;
  id: string | undefined;
}

export type { NodeIdentity, VersionedSnapshot };
