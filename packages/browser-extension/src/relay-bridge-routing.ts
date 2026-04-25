import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import type { RelayTransport } from "./relay-transport.js";

export type PendingResolver = (response: { requestId: string; success: boolean; data?: unknown; error?: string }) => void;
export type RelayActionHandler = (request: RelayActionRequest) => Promise<RelayActionResponse>;

export function tryResolvePending(
  parsed: Record<string, unknown>,
  pending: Map<string, PendingResolver>,
): boolean {
  if (typeof parsed["success"] === "undefined") return false;
  const requestId = parsed["requestId"] as string | undefined;
  if (!requestId) return true;

  const resolve = pending.get(requestId);
  if (resolve) {
    pending.delete(requestId);
    resolve({
      requestId,
      success: parsed["success"] as boolean,
      data: parsed["data"],
      error: parsed["error"] as string | undefined,
    });
  }
  return true;
}

export function routeIncomingRequest(
  parsed: Record<string, unknown>,
  handler: RelayActionHandler,
  transport: RelayTransport | undefined,
  ws: WebSocket | null,
): void {
  if (typeof parsed["action"] !== "string" || typeof parsed["requestId"] !== "string") {
    return;
  }

  const request = parsed as unknown as RelayActionRequest;
  void handler(request)
    .then((response) => {
      const payload = JSON.stringify(response);
      if (transport) {
        transport.send(payload);
        return;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    })
    .catch(() => {
      const failure = JSON.stringify({ requestId: request.requestId, success: false, error: "action-failed" });
      if (transport) {
        transport.send(failure);
        return;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(failure);
      }
    });
}
