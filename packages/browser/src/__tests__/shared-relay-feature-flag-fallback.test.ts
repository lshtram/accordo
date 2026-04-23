import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, createExtensionContextMock, createVscodeMock, makeBridgeMock, sharedFsState, sharedRelayDiscoveryMock, vscode } from "./shared-relay-feature-flag-fixtures.js";

describe("shared relay feature flag - fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
  });

  it("sharedRelay=false uses BrowserRelayServer and not shared relay classes", async () => {
    const mockVscode = createVscodeMock(false);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    await activate(createExtensionContextMock() as never);
    const { BrowserRelayServer } = await import("../relay-server.js");
    const { SharedBrowserRelayServer } = await import("../shared-relay-server.js");
    const { SharedRelayClient } = await import("../shared-relay-client.js");
    expect(BrowserRelayServer).toHaveBeenCalled();
    expect(SharedBrowserRelayServer).not.toHaveBeenCalled();
    expect(SharedRelayClient).not.toHaveBeenCalled();
    expect(bridge.registerTools).toHaveBeenCalledOnce();
    expect(bridge.registerTools.mock.calls[0][0]).toBe("accordo.accordo-browser");
  });

  it("lock acquisition failure falls back to per-window relay", async () => {
    sharedRelayDiscoveryMock.acquireRelayLockResult = false;
    const mockVscode = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    await activate(createExtensionContextMock() as never);
    const { BrowserRelayServer } = await import("../relay-server.js");
    expect(BrowserRelayServer).toHaveBeenCalled();
    expect(bridge.registerTools).toHaveBeenCalled();
    sharedRelayDiscoveryMock.acquireRelayLockResult = true;
  });
});
