import { buildSnapshotEnvelope, buildVersionedSnapshot, createPageSessionId, findNodeByTag } from "./snapshot-versioning-runtime.js";
import type { CreateSnapshotInput, NodeIdentity, SnapshotEnvelope, SnapshotSource, VersionedSnapshot } from "./snapshot-versioning-types.js";

export class SnapshotManager {
  private readonly _pageId: string;
  private version: number;

  constructor(pageId: string) {
    if (pageId.length === 0 || pageId.includes(":")) {
      throw new Error("pageId must be non-empty and must not contain ':'");
    }
    this._pageId = pageId;
    this.version = 0;
  }

  get pageId(): string {
    return this._pageId;
  }

  async createSnapshot(input: CreateSnapshotInput): Promise<VersionedSnapshot> {
    const version = this.version++;
    return buildVersionedSnapshot(this.pageId, version, "dom", input.nodes, input.totalElements);
  }

  nextId(): string {
    const version = this.version++;
    return `${this.pageId}:${version}`;
  }

  resetOnNavigation(): void {
    this.version = 0;
  }

  getNodeIdForElement(snapshot: VersionedSnapshot, tag: string): number {
    const node = findNodeByTag(snapshot.nodes, tag);
    return node !== undefined ? node.nodeId : -1;
  }

  getNodeByTag(snapshot: VersionedSnapshot, tag: string): NodeIdentity | undefined {
    return findNodeByTag(snapshot.nodes, tag);
  }
}

let defaultManager: SnapshotManager = new SnapshotManager(createPageSessionId());

export function getCurrentSnapshotId(): string {
  return defaultManager.nextId();
}

export function captureSnapshotEnvelope(source: SnapshotSource = "dom"): SnapshotEnvelope {
  const snapshotId = defaultManager.nextId();
  return buildSnapshotEnvelope(defaultManager.pageId, snapshotId, source);
}

export function resetDefaultManager(): void {
  defaultManager = new SnapshotManager(createPageSessionId());
}

export function getDefaultManager(): SnapshotManager {
  return defaultManager;
}
