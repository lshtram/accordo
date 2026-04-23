import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { BrowserBridgeAPI, BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import { SharedBrowserRelayServer } from "./shared-relay-server.js";
import { SharedRelayClient } from "./shared-relay-client.js";
import { writeSharedRelayInfo, releaseRelayLock, removeSharedRelayInfo } from "./relay-discovery.js";
import type { SharedRelayInfo } from "./shared-relay-types.js";
import { RELAY_BASE_PORT, RELAY_HOST } from "./relay-lifecycle-primitives.js";
import { createRelayRequestHandler, registerRelayRuntime } from "./relay-lifecycle-runtime.js";

export async function startSharedRelayOwner(
  context: vscode.ExtensionContext,
  out: vscode.OutputChannel,
  bridge: BrowserBridgeAPI,
  token: string,
  onSharedClientEvent: (event: string, details?: Record<string, unknown>) => void,
  handleBrowserComment?: (
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    relay: SharedRelayClient,
    correlationId?: string,
  ) => Promise<BrowserRelayResponse>,
): Promise<void> {
  const server = new SharedBrowserRelayServer({
    port: RELAY_BASE_PORT,
    host: RELAY_HOST,
    token,
    onEvent: (event, details): void => {
      out.appendLine(`[accordo-browser:server] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
    },
  });
  await server.start();

  const ownerInfo: SharedRelayInfo = {
    port: RELAY_BASE_PORT,
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
    ownerHubId: randomUUID(),
  };
  writeSharedRelayInfo(ownerInfo);
  releaseRelayLock();
  out.appendLine(`[accordo-browser] SharedBrowserRelayServer started on ${RELAY_HOST}:${RELAY_BASE_PORT}`);

  context.subscriptions.push({
    dispose: () => {
      void server.stop();
      removeSharedRelayInfo();
      releaseRelayLock();
    },
  });

  const ownerClient: SharedRelayClient = new SharedRelayClient({
    host: RELAY_HOST,
    port: RELAY_BASE_PORT,
    hubId: ownerInfo.ownerHubId,
    token,
    label: "accordo-browser-owner",
    onEvent: (event, details): void => {
      out.appendLine(`[accordo-browser:owner-hub] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      onSharedClientEvent(event, details);
    },
    onRelayRequest: createRelayRequestHandler({ out, bridge, getRelay: (): SharedRelayClient => ownerClient, logLabel: "owner", handleBrowserComment }),
  });
  ownerClient.start();
  context.subscriptions.push({ dispose: () => ownerClient.stop() });
  out.appendLine(`[accordo-browser] SharedRelayClient started for owner hub ${ownerInfo.ownerHubId}`);
  registerRelayRuntime({ context, out, bridge, relay: ownerClient, modeLabel: "shared mode, owner" });
}
