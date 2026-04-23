import { describe, it, expect, vi, beforeEach } from "vitest";
import { ACCORDO_DIR, activate, createExtensionContextMock, createVscodeMock, makeBridgeMock, sharedFsState, sharedRelayClientState, sharedRelayDiscoveryMock, vscode } from "./shared-relay-feature-flag-fixtures.js";

describe("shared relay feature flag - shared mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
    sharedRelayClientState.onEvent = null;
    const mock = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mock.workspace.getConfiguration;
    (vscode.extensions as Record<string, unknown>).getExtension = mock.extensions.getExtension;
  });

  it("owner path constructs SharedBrowserRelayServer and registers tools", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    await activate(createExtensionContextMock() as never);
    const { SharedBrowserRelayServer } = await import("../shared-relay-server.js");
    expect(SharedBrowserRelayServer).toHaveBeenCalled();
    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("hub path constructs SharedRelayClient, registers tools, and publishes initial disconnected state", async () => {
    sharedFsState.set(`${ACCORDO_DIR}/shared-relay.json`, JSON.stringify({ port: 40111, pid: 99999, token: "hub-token", startedAt: new Date().toISOString(), ownerHubId: "owner-1" }));
    sharedRelayDiscoveryMock.isRelayAlive = true;
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    await activate(createExtensionContextMock() as never);
    const { SharedRelayClient } = await import("../shared-relay-client.js");
    expect(SharedRelayClient).toHaveBeenCalled();
    expect(bridge.registerTools).toHaveBeenCalled();
    expect(bridge.publishState).toHaveBeenCalledWith("accordo.accordo-browser", expect.objectContaining({ connected: false, relayConnected: false, chromeConnected: false }));
    sharedRelayDiscoveryMock.isRelayAlive = false;
  });

  it("shared connected state requires both relay and chrome signals", async () => {
    sharedFsState.set(`${ACCORDO_DIR}/shared-relay.json`, JSON.stringify({ port: 40111, pid: 99999, token: "hub-token", startedAt: new Date().toISOString(), ownerHubId: "owner-1" }));
    sharedRelayDiscoveryMock.isRelayAlive = true;
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    await activate(createExtensionContextMock() as never);
    sharedRelayClientState.onEvent?.("relay-connected", {});
    expect(bridge.publishState).toHaveBeenLastCalledWith("accordo.accordo-browser", expect.objectContaining({ connected: false, relayConnected: true, chromeConnected: false }));
    sharedRelayClientState.onEvent?.("chrome-status", { connected: true });
    expect(bridge.publishState).toHaveBeenLastCalledWith("accordo.accordo-browser", expect.objectContaining({ connected: true, relayConnected: true, chromeConnected: true }));
    sharedRelayClientState.onEvent?.("chrome-status", { connected: false });
    expect(bridge.publishState).toHaveBeenLastCalledWith("accordo.accordo-browser", expect.objectContaining({ connected: false, relayConnected: true, chromeConnected: false }));
    sharedRelayClientState.onEvent?.("relay-disconnected", {});
    expect(bridge.publishState).toHaveBeenLastCalledWith("accordo.accordo-browser", expect.objectContaining({ connected: false, relayConnected: false, chromeConnected: false }));
    sharedRelayDiscoveryMock.isRelayAlive = false;
  });
});
