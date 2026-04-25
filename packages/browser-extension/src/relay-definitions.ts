/**
 * relay-definitions.ts — Type contracts and shared state for the relay layer.
 *
 * Contains all public type definitions (RelayAction, RelayActionRequest,
 * RelayActionResponse, CapturePayload), the module-level SnapshotStore
 * singleton, and the isVersionedSnapshot type guard.
 *
 * Split from relay-actions.ts (B5a modularity).
 *
 * @module
 */

export type {
  CapturePayload,
  RelayAction,
  RelayActionRequest,
  RelayActionResponse,
} from "./relay-definition-types.js";
export { actionFailed, getErrorMeta } from "./relay-error-meta.js";
export { defaultStore, isVersionedSnapshot } from "./relay-snapshot-store.js";
