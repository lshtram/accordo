import type { RelayConfig } from "./relay-config.js";
import type { RelayTransportEvents } from "./relay-transport-types.js";

export function hasActiveSocket(ws: WebSocket | null): boolean {
  return ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
}

export async function loadTransportToken(
  tokenProvider: RelayConfig["tokenProvider"],
  currentToken: string | undefined,
): Promise<string | undefined> {
  if (!tokenProvider) return undefined;
  try {
    return (await tokenProvider()) ?? undefined;
  } catch {
    return currentToken;
  }
}

export function buildRelayUrl(config: RelayConfig, currentToken: string | undefined): string {
  let url = `ws://${config.host}:${config.port}/chrome`;
  if (config.tokenProvider && currentToken) {
    url += `?token=${encodeURIComponent(currentToken)}`;
  }
  return url;
}

export function attachSocketListeners(
  ws: WebSocket,
  events: RelayTransportEvents,
  handlers: {
    onOpen: () => void;
    onClose: () => void;
  },
): void {
  ws.addEventListener("open", handlers.onOpen);
  ws.addEventListener("message", (event) => {
    events.onMessage?.(event.data);
  });
  ws.addEventListener("error", () => {
    events.onError?.("WebSocket error");
  });
  ws.addEventListener("close", handlers.onClose);
}

export function clearTransportTimers(timers: {
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}): void {
  if (timers.reconnectTimer !== null) {
    clearTimeout(timers.reconnectTimer);
  }
  if (timers.heartbeatTimer !== null) {
    clearInterval(timers.heartbeatTimer);
  }
}

export function closeTransportSocket(ws: WebSocket | null): WebSocket | null {
  if (ws) {
    ws.close();
  }
  return null;
}
