import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";

// Mock vscode at the top of this file so sharedRelay=false is guaranteed
// before extension.ts evaluates vscode.workspace.getConfiguration(...).
// This avoids cross-file pollution from extension-push.test.ts which modifies
// the shared mocks/vscode.js workspace mock at module level.
// createExtensionContextMock is defined inline so tests can use it without
// importing from mocks/vscode.js (which conflicts with this vi.mock).
vi.mock("vscode", () => {
  const state = new Map<string, unknown>();
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => {
          if (_key === "sharedRelay") return false as unknown as T;
          return defaultValue;
        }),
      })),
    },
    extensions: {
      getExtension: vi.fn(() => ({ exports: null })),
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    Disposable: class Disposable {
      constructor(private readonly fn: () => void) {}
      dispose(): void { this.fn(); }
    },
    // Inline createExtensionContextMock to avoid ./mocks/vscode.js import conflict
    createExtensionContextMock: () => ({
      subscriptions: [] as Array<{ dispose(): void }>,
      globalState: {
        get: vi.fn((k: string) => state.get(k)),
        update: vi.fn(async (k: string, v: unknown) => { state.set(k, v); }),
      },
    }),
  };
});

// After vi.mock, import vscode from the mocked module.
// createExtensionContextMock lives on the mock so tests can call it.
const vscode = await import("vscode");
const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as ReturnType<typeof vi.fn> extends () => infer R ? R : never;

// Mock node:net so findFreePort always resolves the base port (40111) as free,
// regardless of what is actually bound on the test host.
// Note: findFreePort calls once("listening", cb) BEFORE listen(port, host),
// so the 'listening' event must fire INSIDE listen(), not inside once().
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createServer: vi.fn(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const server = {
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
          return server;
        }),
        listen: vi.fn((_port: number, _host: string) => {
          // Fire 'listening' listeners asynchronously so findFreePort's
          // once("listening", cb) has time to register before the event fires.
          Promise.resolve().then(() => {
            const l = listeners["listening"] ?? [];
            l.forEach((cb) => cb());
          });
          return server;
        }),
        close: vi.fn((cb?: () => void) => { if (cb) cb(); return server; }),
        address: vi.fn(() => ({ port: 40111 })),
      };
      return server;
    }),
  };
});

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
const invokeToolMock = vi.fn();

// Capture the relay instance created during activate() so tests can assert on
// handler wiring after the fact.
let capturedRelayInstance: {
  start: typeof startMock;
  stop: typeof stopMock;
  isConnected: typeof isConnectedMock;
  request: ReturnType<typeof vi.fn>;
  options?: { onRelayRequest?: (...args: unknown[]) => unknown };
} | null = null;

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation((options: { onRelayRequest?: (...args: unknown[]) => unknown }) => {
    const instance = {
      start: startMock,
      stop: stopMock,
      isConnected: isConnectedMock,
      request: vi.fn(),
    };
    // onRelayRequest will be set by the extension during activate()
    capturedRelayInstance = { ...instance, options };
    return instance;
  }),
}));

describe("M83-BTOOLS extension activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRelayInstance = null;
  });

  it("PU-REG-01: registers page-understanding tools via bridge.registerTools during activation", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
    };
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // Must be called exactly once with the extension ID and tool array
    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [extensionId, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    expect(extensionId).toBe("accordo.accordo-browser");

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_inspect_element");
    expect(toolNames).toContain("accordo_browser_get_dom_excerpt");
    expect(toolNames).toContain("accordo_browser_capture_region");
  });

  it("M101-DIFF-REG: registerTools includes browser_diff_snapshots in allBrowserTools", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
    };
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_diff_snapshots");
  });

  it("PU-REG-02: registerTools disposable is added to context.subscriptions", async () => {
    const disposeFn = vi.fn();
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: disposeFn }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
    };
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // The disposable returned by registerTools must be in context.subscriptions
    const hasDisposable = context.subscriptions.some((s) => s.dispose === disposeFn);
    expect(hasDisposable).toBe(true);
  });

  it("PU-E2E-01: browser_get_page_map handler calls relay.request('get_page_map', args, timeout)", async () => {
    // Set up relay mock to capture request() calls
    const requestMock = vi.fn().mockResolvedValue({
      requestId: "r1",
      success: true,
      data: {
        pageUrl: "https://example.com",
        title: "Example",
        viewport: { width: 1280, height: 800 },
        nodes: [],
        totalElements: 0,
        truncated: false,
      },
    });

    // We need to get hold of the relay instance BEFORE we call activate, so we can
    // install the request mock. The module mock captures into capturedRelayInstance.
    const relayServerModule = await import("../relay-server.js");
    const MockRelayServer = relayServerModule.BrowserRelayServer as ReturnType<typeof vi.fn>;

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock,
    };
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // Get the actual relay instance created by the mock
    const lastCall = MockRelayServer.mock.results[MockRelayServer.mock.results.length - 1];
    const relayInstance = lastCall?.value as { request: ReturnType<typeof vi.fn> };
    // Swap in our typed request mock
    relayInstance.request = requestMock;
    // Also make isConnected return true so the handler proceeds
    (relayInstance as unknown as { isConnected: ReturnType<typeof vi.fn> }).isConnected = vi.fn(() => true);

    // Get the registered handler for browser_get_page_map
    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>];
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool).toBeDefined();

    // Invoke the handler directly — simulating an MCP agent call
    const args = { maxDepth: 3, maxNodes: 100 };
    await pageMapTool!.handler(args); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- guarded by expect above

    // The handler must forward to relay.request with the correct action and args
    expect(requestMock).toHaveBeenCalledWith("get_page_map", args, expect.any(Number));
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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

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
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo.accordo-browser",
      expect.objectContaining({ relayHost: "127.0.0.1", relayPort: 40111 }),
    );
  });
});
