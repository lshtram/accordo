import { RelayBridgeClient } from "./relay-bridge.js";
import { DEFAULT_RELAY_CONFIG } from "./relay-config.js";
import type { RelayTransportEvents, TransportState } from "./relay-transport.js";
import { RelayTransport } from "./relay-transport.js";
import { setRelayClient } from "./relay-comment-handlers.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";

const RELAY_TOKEN_STORAGE_KEY = "relayToken";

function createTransport(): RelayTransport {
  const transportEvents: RelayTransportEvents = {
    onMessage: (data: string) => { void data; },
    onStateChange: (state: TransportState) => { void state; },
    onError: (error: string) => { void error; },
  };

  const config = {
    ...DEFAULT_RELAY_CONFIG,
    tokenProvider: async (): Promise<string | undefined> => {
      try {
        const result = await chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]);
        return result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
      } catch {
        return undefined;
      }
    },
  };

  return new RelayTransport(config, transportEvents);
}

export const relayTransport = createTransport();
export const relayBridge = new RelayBridgeClient(
  async (request: RelayActionRequest): Promise<RelayActionResponse> => ({ requestId: request.requestId, success: false, error: "action-failed" }),
  relayTransport,
);

export function wireRelayBridge(handler: (req: RelayActionRequest) => Promise<RelayActionResponse>): RelayBridgeClient {
  const bridge = new RelayBridgeClient(handler, relayTransport);
  setRelayClient(bridge);
  relayTransport.events.onMessage = (data: string): void => {
    bridge.handleTransportMessage(data);
  };
  return bridge;
}
