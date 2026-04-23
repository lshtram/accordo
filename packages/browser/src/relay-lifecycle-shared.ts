import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import { SharedBrowserRelayServer } from "./shared-relay-server.js";
import { SharedRelayClient } from "./shared-relay-client.js";
import {
  readSharedRelayInfo,
  writeSharedRelayInfo,
  isRelayAlive,
  acquireRelayLock,
  releaseRelayLock,
  removeSharedRelayInfo,
} from "./relay-discovery.js";
import type { SharedRelayInfo } from "./shared-relay-types.js";
import { EXTENSION_ID, RELAY_BASE_PORT, RELAY_HOST } from "./relay-lifecycle-primitives.js";
import { createRelayRequestHandler, registerRelayRuntime } from "./relay-lifecycle-runtime.js";
import { activatePerWindowRelay } from "./relay-lifecycle-window.js";
import { startSharedRelayOwner } from "./relay-lifecycle-owner.js";

interface SharedState {
  relayConnected: boolean;
  chromeConnected: boolean;
}

function publishSharedState(
  bridge: BrowserBridgeAPI,
  relayPort: number,
  relayStartError: string | null,
  sharedState: SharedState,
): void {
  bridge.publishState(EXTENSION_ID, {
    connected: sharedState.relayConnected && sharedState.chromeConnected,
    relayConnected: sharedState.relayConnected,
    chromeConnected: sharedState.chromeConnected,
    relayHost: RELAY_HOST,
    relayPort,
    relayStartError,
  });
}

function updateSharedState(event: string, details: Record<string, unknown> | undefined, sharedState: SharedState): void {
  if (event === "relay-connected") {
    sharedState.relayConnected = true;
  } else if (event === "relay-disconnected") {
    sharedState.relayConnected = false;
    sharedState.chromeConnected = false;
  } else if (event === "chrome-status") {
    sharedState.chromeConnected = details?.["connected"] === true;
  }
}

export async function activateSharedRelay(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  commentsAvailable: boolean,
  handleBrowserComment?: (
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    relay: SharedRelayClient,
    correlationId?: string,
  ) => Promise<BrowserRelayResponse>,
): Promise<void> {
  let relayStartError: string | null = null;
  let relayPort = RELAY_BASE_PORT;
  const sharedState: SharedState = { relayConnected: false, chromeConnected: false };
  const handleSharedClientEvent = (event: string, details?: Record<string, unknown>): void => {
    updateSharedState(event, details, sharedState);
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
  };

  const existingInfo = readSharedRelayInfo();
  if (existingInfo && isRelayAlive(existingInfo)) {
    out.appendLine(`[accordo-browser] shared relay already running on ${RELAY_BASE_PORT} — connecting as Hub`);
    const hubId = randomUUID();
    let client!: SharedRelayClient;
    client = new SharedRelayClient({
      host: RELAY_HOST,
      port: RELAY_BASE_PORT,
      hubId,
      token: existingInfo.token,
      label: "accordo-browser-hub",
      onEvent: (event, details) => {
        out.appendLine(`[accordo-browser:hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
        handleSharedClientEvent(event, details);
      },
      onRelayRequest: createRelayRequestHandler({ out, bridge, getRelay: () => client, handleBrowserComment }),
    });
    client.start();
    context.subscriptions.push({ dispose: () => client.stop() });
    out.appendLine(`[accordo-browser] SharedRelayClient started for hub ${hubId}`);
    registerRelayRuntime({ context, out, bridge, relay: client, modeLabel: "shared mode" });
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
    return;
  }

  out.appendLine(`[accordo-browser] no running shared relay found — starting as Owner`);
  if (!acquireRelayLock()) {
    out.appendLine("[accordo-browser] could not acquire lock — falling back to per-window relay");
    await activatePerWindowRelay(context, out, bridge, token, commentsAvailable);
    return;
  }

  try {
    await startSharedRelayOwner(context, out, bridge, token, handleSharedClientEvent, handleBrowserComment);
    relayPort = RELAY_BASE_PORT;
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] SharedBrowserRelayServer start failed: ${relayStartError}`);
    releaseRelayLock();
    await activatePerWindowRelay(context, out, bridge, token, commentsAvailable);
    return;
  }

  publishSharedState(bridge, relayPort, relayStartError, sharedState);
}
