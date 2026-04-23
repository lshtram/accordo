import type * as vscode from "vscode";
import type { BrowserBridgeAPI } from "./types.js";
import { BrowserRelayServer } from "./relay-server.js";
import { RELAY_BASE_PORT, RELAY_HOST, findFreePort, writeRelayPort, EXTENSION_ID } from "./relay-lifecycle-primitives.js";
import { createRelayRequestHandler, registerRelayRuntime } from "./relay-lifecycle-runtime.js";

export async function activatePerWindowRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  _commentsAvailable: boolean,
): Promise<void> {
  let relayStartError: string | null = null;
  const relayPort = await findFreePort(RELAY_BASE_PORT, RELAY_HOST).catch((err: unknown) => {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] findFreePort failed: ${relayStartError}`);
    return RELAY_BASE_PORT;
  });

  let relay!: BrowserRelayServer;
  relay = new BrowserRelayServer({
    host: RELAY_HOST,
    port: relayPort,
    token,
    onEvent: (event, details) => {
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
    onRelayRequest: createRelayRequestHandler({ out, bridge, getRelay: () => relay, logMappingDetails: true, includeInvokeErrorData: true }),
  });

  try {
    await relay.start();
    writeRelayPort(relayPort);
    out.appendLine(`[accordo-browser] relay listening on ${RELAY_HOST}:${relayPort} (per-window mode)`);
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  context.subscriptions.push({ dispose: () => relay.stop() });
  registerRelayRuntime({ context, out, bridge, relay });
  bridge.publishState(EXTENSION_ID, { connected: relay.isConnected(), relayHost: RELAY_HOST, relayPort, relayStartError });
}
