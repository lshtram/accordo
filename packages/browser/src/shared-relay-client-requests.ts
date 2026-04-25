import { randomUUID } from "node:crypto";
import type { BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import type { SharedRelayRequest } from "./shared-relay-types.js";
import { WebSocket } from "ws";
import { DEFAULT_RELAY_REQUEST_TIMEOUT_MS } from "./relay-transport-constants.js";

export async function requestViaSharedRelay(
  ws: WebSocket | null,
  hubId: string,
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  pending: Map<string, (value: BrowserRelayResponse) => void>,
  onError: ((error: string) => void) | undefined,
  timeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
): Promise<BrowserRelayResponse> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    onError?.("browser-not-connected");
    return { requestId: "", success: false, error: "browser-not-connected" };
  }

  const requestId = randomUUID();
  const envelope: SharedRelayRequest = { requestId, action, payload, hubId };
  return await new Promise<BrowserRelayResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      onError?.("timeout");
      resolve({ requestId, success: false, error: "timeout" });
    }, timeoutMs);

    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });

    ws.send(JSON.stringify(envelope));
  });
}

export function pushViaSharedRelay(
  ws: WebSocket | null,
  hubId: string,
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const requestId = randomUUID();
  const envelope: SharedRelayRequest = { requestId, action, payload, hubId };
  ws.send(JSON.stringify(envelope));
}
