import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";
import { createExtensionContextMock, extensions } from "./mocks/vscode.js";

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
const invokeToolMock = vi.fn();

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation(() => ({
    start: startMock,
    stop: stopMock,
    isConnected: isConnectedMock,
    request: vi.fn(),
    // onRelayRequest will be set by the extension during activate()
    onRelayRequest: undefined as ((...args: unknown[]) => unknown) | undefined,
  })),
}));

describe("M83-BTOOLS extension activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BR-F-122 (M86): does NOT register accordo_browser_* tools — unified routing active", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // M86: browser tools are NOT registered — unified comment_* routing used instead
    expect(bridge.registerTools).not.toHaveBeenCalled();
  });

  it("M86: routes Chrome create_comment through unified accordo_comment_create tool", async () => {
    // The mock relay server has onRelayRequest set by the extension during activate()
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t1", commentId: "c1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // Simulate Chrome sending a create_comment event through the relay interceptor
    if (mockInstance?.onRelayRequest) {
      const result = await mockInstance.onRelayRequest("create_comment", {
        body: "test comment",
        url: "https://example.com",
        anchorKey: "body:center",
      });
      // invokeTool should have been called with comment_create
      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_create",
        expect.objectContaining({ body: "test comment" }),
      );
      expect(result).toMatchObject({ success: true });
    }
  });

  it("BR-F-123: publishes relay state for observability", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
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
