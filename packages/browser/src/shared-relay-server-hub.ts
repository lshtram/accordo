import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import type { HubSocket } from "./shared-relay-server-state.js";
import { MUTATING_ACTIONS } from "./shared-relay-types.js";
import type { WriteLeaseManager } from "./write-lease.js";

interface HubConnectionOptions {
  socket: WebSocket;
  hubId: string;
  label?: string;
  hubs: Map<string, HubSocket>;
  pendingByHub: Map<string, Map<string, (value: BrowserRelayResponse) => void>>;
  requestIdToHub: Map<string, string>;
  writeLease: WriteLeaseManager;
  getChromeSocket: () => WebSocket | null;
  emit: (event: string, details?: Record<string, unknown>) => void;
}

function nextConnectedAt(prior?: HubSocket): string {
  const currentTime = Date.now();
  const priorTime = prior ? Date.parse(prior.connectedAt) : Number.NaN;
  const nextTime = Number.isNaN(priorTime) || currentTime > priorTime
    ? currentTime
    : priorTime + 1;
  return new Date(nextTime).toISOString();
}

export function attachHubConnection(options: HubConnectionOptions): void {
  const prior = options.hubs.get(options.hubId);
  if (prior) prior.socket.close(1000, "replaced");

  const hubSocket: HubSocket = {
    socket: options.socket,
    hubId: options.hubId,
    label: options.label,
    connectedAt: nextConnectedAt(prior),
  };
  options.hubs.set(options.hubId, hubSocket);
  options.pendingByHub.set(options.hubId, new Map());
  options.emit("hub-connected", { hubId: options.hubId, label: options.label });
  options.socket.send(JSON.stringify({ kind: "hub-register-ack", hubId: options.hubId, chromeConnected: options.getChromeSocket() !== null }));

  options.socket.on("message", (raw: Buffer) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }

    const action = parsed["action"] as BrowserRelayAction | undefined;
    if (!action) return;
    if (parsed["hubId"] !== options.hubId) return;
    const requestId = (parsed["requestId"] as string | undefined) ?? randomUUID();
    const isMutating = MUTATING_ACTIONS.includes(action as (typeof MUTATING_ACTIONS)[number]);

    const doForward = async (): Promise<void> => {
      options.requestIdToHub.set(requestId, options.hubId);
      const pendingMap = options.pendingByHub.get(options.hubId);
      pendingMap?.set(requestId, (response: BrowserRelayResponse) => {
        if (options.socket.readyState === WebSocket.OPEN) options.socket.send(JSON.stringify(response));
        if (isMutating) options.writeLease.release(options.hubId);
      });

      const chromeRequest: BrowserRelayRequest = {
        requestId,
        action,
        payload: (parsed["payload"] as Record<string, unknown>) ?? {},
      };

      const chromeSocket = options.getChromeSocket();
      if (chromeSocket && chromeSocket.readyState === WebSocket.OPEN) {
        chromeSocket.send(JSON.stringify(chromeRequest));
        return;
      }

      const resolve = pendingMap?.get(requestId);
      if (resolve) {
        pendingMap?.delete(requestId);
        resolve({ requestId, success: false, error: "browser-not-connected" });
      }
      options.requestIdToHub.delete(requestId);
      if (isMutating) options.writeLease.release(options.hubId);
    };

    if (!isMutating) {
      void doForward().catch(() => {});
      return;
    }

    void (async (): Promise<void> => {
      try {
        await options.writeLease.acquire(options.hubId);
      } catch {
        if (options.socket.readyState === WebSocket.OPEN) {
          options.socket.send(JSON.stringify({ requestId, success: false, error: "action-failed" }));
        }
        return;
      }
      await doForward();
    })();
  });

  options.socket.on("close", () => {
    options.hubs.delete(options.hubId);
    options.pendingByHub.delete(options.hubId);
    options.emit("hub-disconnected", { hubId: options.hubId });
    options.writeLease.releaseAll(options.hubId);
  });
}
