import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";
import { createExtensionContextMock, extensions } from "./mocks/vscode.js";

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation(() => ({
    start: startMock,
    stop: stopMock,
    isConnected: isConnectedMock,
    request: vi.fn(),
  })),
}));

describe("M83-BTOOLS extension activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BR-F-122: registers browser tools through bridge on activate", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [id, tools] = bridge.registerTools.mock.calls[0];
    expect(id).toBe("accordo.accordo-browser");
    expect((tools as Array<{ name: string }>).length).toBe(8);
  });

  it("BR-F-123: publishes relay state for observability", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo.accordo-browser",
      expect.objectContaining({ relayHost: "127.0.0.1", relayPort: 40111 }),
    );
  });
});
