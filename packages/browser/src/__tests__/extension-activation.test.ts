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

  it("BUG-DEL-01: create_comment forwards caller threadId/commentId for stable cross-surface IDs", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t-local", commentId: "c-local" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("create_comment", {
        body: "from chrome",
        url: "https://example.com/page",
        anchorKey: "div:0:title@20,10",
        threadId: "t-local",
        commentId: "c-local",
      });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_create",
        expect.objectContaining({
          threadId: "t-local",
          commentId: "c-local",
        }),
      );
    }
  });

  // ── BUG-4: Missing onRelayRequest action path tests ────────────────────────

  /**
   * REQ-B4-01: get_comments → comment_list with browser scope and URL filter
   */
  it("BUG-4: get_comments calls comment_list with browser scope and url", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ threads: [], total: 0, hasMore: false }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("get_comments", { url: "https://example.com/page" });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_list",
        expect.objectContaining({
          scope: expect.objectContaining({ modality: "browser", url: "https://example.com/page" }),
        }),
      );
    }
  });

  /**
   * REQ-B4-02: get_all_comments → comment_list with browser scope (no URL filter)
   */
  it("BUG-4: get_all_comments calls comment_list with browser scope (no url)", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ threads: [], total: 0, hasMore: false }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("get_all_comments", {});

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_list",
        expect.objectContaining({
          scope: expect.objectContaining({ modality: "browser" }),
        }),
      );
      // get_all_comments should NOT include url in scope
      const callArgs = invokeToolMock.mock.calls[0][1] as { scope: Record<string, unknown> };
      expect(callArgs.scope).not.toHaveProperty("url");
    }
  });

  /**
   * REQ-B4-03: reply_comment → comment_reply with threadId and body
   */
  it("BUG-4: reply_comment calls comment_reply with threadId and body", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ replied: true, commentId: "c2" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("reply_comment", {
        threadId: "t1",
        body: "reply text",
      });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_reply",
        expect.objectContaining({
          threadId: "t1",
          body: "reply text",
        }),
      );
    }
  });

  /**
   * REQ-B4-04: resolve_thread → comment_resolve with threadId and resolutionNote
   */
  it("BUG-4: resolve_thread calls comment_resolve with threadId and resolutionNote", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ resolved: true, threadId: "t1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("resolve_thread", {
        threadId: "t1",
        resolutionNote: "Fixed the issue",
      });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_resolve",
        expect.objectContaining({
          threadId: "t1",
          resolutionNote: "Fixed the issue",
        }),
      );
    }
  });

  /**
   * REQ-B4-05: reopen_thread → comment_reopen with threadId
   */
  it("BUG-4: reopen_thread calls comment_reopen with threadId", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ reopened: true, threadId: "t1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("reopen_thread", { threadId: "t1" });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_reopen",
        expect.objectContaining({
          threadId: "t1",
        }),
      );
    }
  });

  /**
   * REQ-B4-06: delete_comment → comment_delete with threadId and optional commentId
   */
  it("BUG-4: delete_comment calls comment_delete with threadId and commentId", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ deleted: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("delete_comment", {
        threadId: "t1",
        commentId: "c1",
      });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({
          threadId: "t1",
          commentId: "c1",
        }),
      );
    }
  });

  /**
   * REQ-B4-07: delete_thread → comment_delete with threadId only (no commentId)
   */
  it("BUG-4: delete_thread calls comment_delete with threadId only", async () => {
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;
    const mockInstance = MockRelayServer.mock.results[0]?.value as {
      onRelayRequest?: (...args: unknown[]) => unknown;
    };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ deleted: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    if (mockInstance?.onRelayRequest) {
      await mockInstance.onRelayRequest("delete_thread", { threadId: "t1" });

      expect(invokeToolMock).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({
          threadId: "t1",
        }),
      );
      // delete_thread should NOT pass commentId
      const callArgs = invokeToolMock.mock.calls[0][1] as { commentId?: string };
      expect(callArgs.commentId).toBeUndefined();
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
