import type * as vscode from "vscode";
import type { BrowserBridgeAPI } from "./types.js";
import { BrowserRelayServer } from "./relay-server.js";
import { RELAY_BASE_PORT, RELAY_HOST, findFreePort, writeRelayPort, EXTENSION_ID } from "./relay-lifecycle-primitives.js";
import { createRelayRequestHandler, registerRelayRuntime } from "./relay-lifecycle-runtime.js";
import { syncBrowserComments } from "./comment-sync-runtime.js";

export async function activatePerWindowRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  _commentsAvailable: boolean,
): Promise<BrowserRelayServer> {
  let relayStartError: string | null = null;
  let connectionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionSyncInFlight = false;
  const relayPort = await findFreePort(RELAY_BASE_PORT, RELAY_HOST).catch((err: unknown) => {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] findFreePort failed: ${relayStartError}`);
    return RELAY_BASE_PORT;
  });

  const relay = new BrowserRelayServer({
    host: RELAY_HOST,
    port: relayPort,
    token,
    onEvent: (event, details): void => {
      out.appendLine(`[accordo-browser] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      if (event === "relay-client-connected" || event === "relay-client-disconnected") {
        bridge.publishState(EXTENSION_ID, {
          connected: relay.isConnected(),
          relayHost: RELAY_HOST,
          relayPort,
          relayStartError,
        });
      }
    },
    onConnectionChange: (connected): void => {
      if (connected) scheduleConnectionSync();
    },
    onRelayRequest: createRelayRequestHandler({ out, bridge, getRelay: (): BrowserRelayServer => relay, logMappingDetails: true, includeInvokeErrorData: true }),
  });

  try {
    await relay.start();
    writeRelayPort(relayPort);
    out.appendLine(`[accordo-browser] relay listening on ${RELAY_HOST}:${relayPort} (per-window mode)`);
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  // onConnectionChange lets registerRelayRuntime subscribe to relay connection events
  // so an immediate sync is triggered when Chrome connects after VS Code reload.
  const onConnectionChange = (connected: boolean): void => {
    if (connected) {
      // Chrome connected after registration — registerRelayRuntime will handle sync.
      bridge.publishState(EXTENSION_ID, {
        connected: true,
        relayHost: RELAY_HOST,
        relayPort,
        relayStartError,
      });
    }
  };

  function scheduleConnectionSync(): void {
    if (connectionSyncTimer !== null) clearTimeout(connectionSyncTimer);
    connectionSyncTimer = setTimeout(() => {
      connectionSyncTimer = null;
      if (connectionSyncInFlight || !relay.isConnected()) return;
      connectionSyncInFlight = true;
      void syncBrowserComments(relay, bridge, out).finally(() => {
        connectionSyncInFlight = false;
      });
    }, 200);
  }

  context.subscriptions.push({
    dispose: () => {
      if (connectionSyncTimer !== null) clearTimeout(connectionSyncTimer);
      void relay.stop();
    },
  });
  registerRelayRuntime({ context, out, bridge, relay, onConnectionChange });
  bridge.publishState(EXTENSION_ID, { connected: relay.isConnected(), relayHost: RELAY_HOST, relayPort, relayStartError });
  return relay;
}
