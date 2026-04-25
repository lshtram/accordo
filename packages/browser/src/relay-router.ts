import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { DEFAULT_RELAY_REQUEST_TIMEOUT_MS } from "./relay-transport-constants.js";

export async function forwardRelayAction(
  relay: BrowserRelayLike,
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
): Promise<BrowserRelayResponse> {
  try {
    return await relay.request(action, payload, timeoutMs);
  } catch {
    return {
      requestId: "",
      success: false,
      error: "action-failed",
    };
  }
}
