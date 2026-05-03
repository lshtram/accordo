import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayResponse, BrowserRelayLike } from "./types.js";
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
import { syncBrowserComments } from "./comment-sync-runtime.js";

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
    out?: vscode.OutputChannel,
  ) => Promise<BrowserRelayResponse>,
): Promise<BrowserRelayLike> {
  let relayStartError: string | null = null;
  let relayPort = RELAY_BASE_PORT;
  const sharedState: SharedState = { relayConnected: false, chromeConnected: false };
  let activeRelay: BrowserRelayLike | null = null;
  let connectionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionSyncInFlight = false;
  const scheduleConnectedSync = (): void => {
    if (!activeRelay || !sharedState.relayConnected || !sharedState.chromeConnected) return;
    if (connectionSyncTimer !== null) clearTimeout(connectionSyncTimer);
    connectionSyncTimer = setTimeout(() => {
      connectionSyncTimer = null;
      if (!activeRelay || connectionSyncInFlight || !sharedState.relayConnected || !sharedState.chromeConnected) return;
      connectionSyncInFlight = true;
      void syncBrowserComments(activeRelay, bridge, out).finally(() => {
        connectionSyncInFlight = false;
      });
    }, 200);
  };
  const handleSharedClientEvent = (event: string, details?: Record<string, unknown>): void => {
    updateSharedState(event, details, sharedState);
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
    scheduleConnectedSync();
  };

  const existingInfo = readSharedRelayInfo();
  if (existingInfo && isRelayAlive(existingInfo)) {
    out.appendLine(`[accordo-browser] shared relay already running on ${RELAY_BASE_PORT} — connecting as Hub`);
    const hubId = randomUUID();
    const client: SharedRelayClient = new SharedRelayClient({
      host: RELAY_HOST,
      port: RELAY_BASE_PORT,
      hubId,
      token: existingInfo.token,
      label: "accordo-browser-hub",
      onEvent: (event, details): void => {
        out.appendLine(`[accordo-browser:hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
        handleSharedClientEvent(event, details);
      },
      onRelayRequest: createRelayRequestHandler({ out, bridge, getRelay: (): SharedRelayClient => client, handleBrowserComment }),
    });
    activeRelay = client;
    client.start();
    context.subscriptions.push({
      dispose: () => {
        if (connectionSyncTimer !== null) clearTimeout(connectionSyncTimer);
        client.stop();
      },
    });
    out.appendLine(`[accordo-browser] SharedRelayClient started for hub ${hubId}`);
    registerRelayRuntime({ context, out, bridge, relay: client, modeLabel: "shared mode" });
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
    return client;
  }

  out.appendLine(`[accordo-browser] no running shared relay found — starting as Owner`);
  if (!acquireRelayLock()) {
    out.appendLine("[accordo-browser] could not acquire lock — falling back to per-window relay");
    return await activatePerWindowRelay(context, out, bridge, token, commentsAvailable);
  }

  let ownerClient: SharedRelayClient;
  try {
    ownerClient = await startSharedRelayOwner(context, out, bridge, token, handleSharedClientEvent, handleBrowserComment);
    activeRelay = ownerClient;
    relayPort = RELAY_BASE_PORT;
    publishSharedState(bridge, relayPort, relayStartError, sharedState);
    scheduleConnectedSync();
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] SharedBrowserRelayServer start failed: ${relayStartError}`);
    releaseRelayLock();
    return await activatePerWindowRelay(context, out, bridge, token, commentsAvailable);
  }

  publishSharedState(bridge, relayPort, relayStartError, sharedState);
  return ownerClient;
}
