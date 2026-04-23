import { randomUUID } from "node:crypto";
import type { BrowserRelayAction, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import { WebSocket } from "ws";

export function pushToBrowserClient(client: WebSocket | null, action: BrowserRelayAction, payload: Record<string, unknown>): void {
  if (!client || client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify({ requestId: randomUUID(), action, payload }));
}

export async function requestFromBrowserClient(
  client: WebSocket | null,
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  pending: Map<string, (value: BrowserRelayResponse) => void>,
  onDisconnected: () => void,
  onTimeout: () => void,
  timeoutMs = 3000,
): Promise<BrowserRelayResponse> {
  if (!client || client.readyState !== WebSocket.OPEN) {
    onDisconnected();
    return { requestId: "", success: false, error: "browser-not-connected" };
  }

  const requestId = randomUUID();
  const envelope: BrowserRelayRequest = { requestId, action, payload };
  return await new Promise<BrowserRelayResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      onTimeout();
      resolve({ requestId, success: false, error: "timeout" });
    }, timeoutMs);

    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });

    client.send(JSON.stringify(envelope));
  });
}
