import type { RelayActionRequest } from "./relay-actions.js";
import type { RelayTransport } from "./relay-transport.js";
import type { PendingResolver } from "./relay-bridge-routing.js";

export async function sendViaTransport(
  transport: RelayTransport,
  pending: Map<string, PendingResolver>,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const requestId = crypto.randomUUID();
  const envelope: RelayActionRequest = { requestId, action: action as RelayActionRequest["action"], payload };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ success: false, error: "timeout" });
    }, timeoutMs);

    pending.set(requestId, (response) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(response);
    });

    const sent = transport.send(JSON.stringify(envelope));
    if (!sent) {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ success: false, error: "browser-not-connected" });
    }
  });
}

export async function sendViaWebSocket(
  ws: WebSocket | null,
  pending: Map<string, PendingResolver>,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: "browser-not-connected" };
  }

  const requestId = crypto.randomUUID();
  const envelope: RelayActionRequest = { requestId, action: action as RelayActionRequest["action"], payload };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ success: false, error: "timeout" });
    }, timeoutMs);

    pending.set(requestId, (response) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(response);
    });

    if (!ws) {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ success: false, error: "browser-not-connected" });
      return;
    }
    ws.send(JSON.stringify(envelope));
  });
}
