/**
 * sw-lifecycle.ts — Service worker lifecycle facade
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import { relayTransport, wireRelayBridge } from "./sw-lifecycle-bridge.js";
import { broadcastCommentsUpdated, handleRelayActionWithBroadcast, onInstalled, registerListeners, registerRelayTokenReconnect } from "./sw-lifecycle-listeners.js";
import { checkAndSync, startPeriodicSync, stopPeriodicSync } from "./sw-lifecycle-sync.js";

export { broadcastCommentsUpdated, onInstalled, registerListeners } from "./sw-lifecycle-listeners.js";
export { registerRelayTokenReconnect } from "./sw-lifecycle-listeners.js";
export { handleRelayActionWithBroadcast } from "./sw-lifecycle-listeners.js";
export { checkAndSync, startPeriodicSync, stopPeriodicSync } from "./sw-lifecycle-sync.js";

export const relayBridge = wireRelayBridge(
  async (request: RelayActionRequest): Promise<RelayActionResponse> => handleRelayActionWithBroadcast(request),
);

export { relayTransport };

export async function forwardToAccordoBrowser(
  action: "create_comment" | "reply_comment" | "resolve_thread" | "reopen_thread" | "delete_comment" | "delete_thread",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await relayBridge.send(action, payload, 5000);
    if (!result.success) {
      // non-fatal
    }
  } catch {
    // non-fatal
  }
}
