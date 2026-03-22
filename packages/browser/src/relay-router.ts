import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";

export async function forwardRelayAction(
  relay: BrowserRelayLike,
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  timeoutMs = 3000,
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
