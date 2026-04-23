import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";
import type { BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import type { ChromeStatusEvent, HubClientInfo } from "./shared-relay-types.js";

export interface HubSocket {
  socket: WebSocket;
  hubId: string;
  label?: string;
  connectedAt: string;
}

export function buildConnectedHubInfo(hubs: ReadonlyMap<string, HubSocket>): ReadonlyMap<string, HubClientInfo> {
  const result = new Map<string, HubClientInfo>();
  for (const [hubId, hub] of hubs) {
    result.set(hubId, {
      hubId,
      label: hub.label,
      connectedAt: hub.connectedAt,
    });
  }
  return result;
}

export function broadcastChromeStatusToHubs(hubs: ReadonlyMap<string, HubSocket>, connected: boolean): void {
  const event: ChromeStatusEvent = { kind: "chrome-status", connected };
  for (const [, hub] of hubs) {
    if (hub.socket.readyState === WebSocket.OPEN) {
      hub.socket.send(JSON.stringify(event));
    }
  }
}

export function resolvePendingResponses(
  pendingByHub: ReadonlyMap<string, Map<string, (value: BrowserRelayResponse) => void>>,
  requestIdToHub: Map<string, string>,
  error: BrowserRelayResponse["error"],
): void {
  for (const [, pendingMap] of pendingByHub) {
    for (const [requestId, resolve] of pendingMap) {
      resolve({ requestId, success: false, error });
    }
    pendingMap.clear();
  }
  requestIdToHub.clear();
}

interface StopSharedRelayServerOptions {
  chromeSocket: WebSocket | null;
  hubs: Map<string, HubSocket>;
  pendingByHub: Map<string, Map<string, (value: BrowserRelayResponse) => void>>;
  wsServer: WebSocketServer | null;
  httpServer: HttpServer | null;
  onResolvedPending: () => void;
}

export async function stopSharedRelayServer(
  options: StopSharedRelayServerOptions,
): Promise<{ chromeSocket: WebSocket | null; wsServer: WebSocketServer | null; httpServer: HttpServer | null }> {
  options.onResolvedPending();

  if (options.chromeSocket) {
    options.chromeSocket.close();
  }

  for (const [, hub] of options.hubs) {
    hub.socket.close(1000, "server-shutdown");
  }
  options.hubs.clear();
  options.pendingByHub.clear();

  if (options.wsServer) {
    options.wsServer.close();
  }
  if (options.httpServer) {
    await new Promise<void>((resolve) => {
      options.httpServer?.close(() => resolve());
    });
  }

  return {
    chromeSocket: null,
    wsServer: null,
    httpServer: null,
  };
}

export function pushToChrome(chromeSocket: WebSocket | null, action: BrowserRelayAction, payload: Record<string, unknown>): void {
  if (!chromeSocket || chromeSocket.readyState !== WebSocket.OPEN) return;
  const requestId = randomUUID();
  chromeSocket.send(JSON.stringify({ requestId, action, payload }));
}
