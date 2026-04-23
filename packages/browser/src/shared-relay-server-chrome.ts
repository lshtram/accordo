import { WebSocket } from "ws";
import type { BrowserRelayResponse } from "./types.js";
import type { HubSocket } from "./shared-relay-server-state.js";

interface ChromeConnectionOptions {
  socket: WebSocket;
  currentChromeSocket: WebSocket | null;
  hubs: ReadonlyMap<string, HubSocket>;
  requestIdToHub: Map<string, string>;
  pendingByHub: ReadonlyMap<string, Map<string, (value: BrowserRelayResponse) => void>>;
  onChromeConnected: () => void;
  onChromeDisconnected: (socket: WebSocket) => void;
  emit: (event: string, details?: Record<string, unknown>) => void;
}

export function attachChromeConnection(options: ChromeConnectionOptions): void {
  if (options.currentChromeSocket && options.currentChromeSocket !== options.socket) {
    options.currentChromeSocket.close(1000, "replaced");
  }
  options.onChromeConnected();

  const remote = (options.socket as WebSocket & { remoteAddress?: string }).remoteAddress;
  options.emit("chrome-connected", { remote: remote ?? "unknown" });

  options.socket.on("message", (raw: Buffer) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof parsed["success"] !== "undefined") {
      const requestId = parsed["requestId"] as string | undefined;
      if (!requestId) return;
      const hubId = options.requestIdToHub.get(requestId);
      if (!hubId) return;
      options.requestIdToHub.delete(requestId);
      const pendingMap = options.pendingByHub.get(hubId);
      const resolve = pendingMap?.get(requestId);
      if (!resolve) return;
      pendingMap?.delete(requestId);
      resolve({
        requestId,
        success: parsed["success"] as boolean,
        data: parsed["data"],
        error: parsed["error"] as BrowserRelayResponse["error"],
      });
      return;
    }

    if (typeof parsed["action"] === "string") {
      const hubId = parsed["hubId"] as string | undefined;
      options.emit("chrome-event", { action: parsed["action"], hubId });
      if (hubId) {
        const hub = options.hubs.get(hubId);
        if (hub && hub.socket.readyState === WebSocket.OPEN) hub.socket.send(JSON.stringify(parsed));
        return;
      }
      for (const [, hub] of options.hubs) {
        if (hub.socket.readyState === WebSocket.OPEN) hub.socket.send(JSON.stringify(parsed));
      }
    }
  });

  options.socket.on("close", () => {
    options.onChromeDisconnected(options.socket);
    options.emit("chrome-disconnected");
  });
}
