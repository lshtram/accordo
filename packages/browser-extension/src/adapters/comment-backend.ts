/**
 * M90-ADP — Comment Backend Adapter facade
 *
 * @module
 */

import type { RelayBridgeClient } from "../relay-bridge.js";
import type { CommentBackendAdapter } from "./comment-backend-types.js";
import { LocalStorageAdapter } from "./local-storage-adapter.js";
import { VscodeRelayAdapter } from "./vscode-relay-adapter.js";

export type {
  CommentBackendAdapter,
  CommentThreadSummary,
  CreateThreadParams,
  ReplyParams,
  StandaloneMcpAdapterConfig,
} from "./comment-backend-types.js";
export { LocalStorageAdapter } from "./local-storage-adapter.js";
export { VscodeRelayAdapter } from "./vscode-relay-adapter.js";

export function selectAdapter(relay: RelayBridgeClient): CommentBackendAdapter {
  try {
    if (relay.isConnected()) {
      return new VscodeRelayAdapter(relay);
    }
  } catch {
    // fall through to offline adapter
  }
  return new LocalStorageAdapter();
}
