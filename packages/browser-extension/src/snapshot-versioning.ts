/**
 * M100-SNAP — Snapshot Versioning facade
 *
 * @module
 */

export { SnapshotStore } from "./snapshot-store.js";
export type { SnapshotNotFound } from "./snapshot-store.js";
export {
  SnapshotManager,
  captureSnapshotEnvelope,
  getCurrentSnapshotId,
  getDefaultManager,
  resetDefaultManager,
} from "./snapshot-versioning-manager.js";
export {
  buildSnapshotEnvelope,
  buildVersionedSnapshot,
  captureViewport,
  computePersistentId,
  createPageSessionId,
  enrichNode,
  findNodeByTag,
} from "./snapshot-versioning-runtime.js";
export type {
  CreateSnapshotInput,
  NodeIdentity,
  PageMapSnapshot,
  SnapshotEnvelope,
  SnapshotSource,
  VersionedSnapshot,
  Viewport,
} from "./snapshot-versioning-types.js";
export { DEFAULT_RETENTION_SIZE } from "./snapshot-versioning-types.js";
