export const DEFAULT_RETENTION_SIZE = 5;

export type SnapshotSource = "dom" | "a11y" | "visual" | "layout" | "network";

export interface SnapshotEnvelope {
  pageId: string;
  frameId: string;
  snapshotId: string;
  capturedAt: string;
  viewport: Viewport;
  source: SnapshotSource;
}

export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

export interface NodeIdentity {
  tag: string;
  id?: string;
  text?: string;
  role?: string;
  children?: NodeIdentity[];
  nodeId: number;
  persistentId?: string;
}

export interface CreateSnapshotInput {
  pageUrl: string;
  title: string;
  nodes: NodeIdentity[];
  totalElements: number;
}

export interface VersionedSnapshot extends SnapshotEnvelope {
  nodes: NodeIdentity[];
  totalElements: number;
}

export type PageMapSnapshot = VersionedSnapshot;
