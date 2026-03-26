/**
 * extension-push.test.ts — extension.ts onRelayRequest push notification behaviour
 *
 * Verifies:
 * - When onRelayRequest handles a mutating action (create_comment, reply_comment,
 *   resolve_thread, reopen_thread, delete_comment, delete_thread), it calls
 *   relay.push("notify_comments_updated", ...) with the url from payload.
 * - When onRelayRequest handles a non-mutating action (get_comments), it does
 *   NOT call relay.push().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";
import { createExtensionContextMock, extensions } from "./mocks/vscode.js";

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
const invokeToolMock = vi.fn();

// Capture the relay instance so tests can inspect push() calls
let capturedRelayInstance: {
  start: typeof startMock;
  stop: typeof stopMock;
  isConnected: typeof isConnectedMock;
  request: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  options?: { onRelayRequest?: (...args: unknown[]) => unknown };
} | null = null;

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation((options: { onRelayRequest?: (...args: unknown[]) => unknown }) => {
    const instance = {
      start: startMock,
      stop: stopMock,
      isConnected: isConnectedMock,
      request: vi.fn(),
      push: vi.fn(),
    };
    capturedRelayInstance = { ...instance, options };
    return instance;
  }),
}));

beforeEach(() => {
  capturedRelayInstance = null;
  vi.clearAllMocks();
  startMock.mockResolvedValue(undefined);
  stopMock.mockResolvedValue(undefined);
});

describe("extension.ts onRelayRequest — push notification after mutating action", () => {

  /**
   * REQ-PUSH-01: create_comment triggers relay.push("notify_comments_updated", { url })
   */
  it("REQ-PUSH-01: create_comment calls relay.push with notify_comments_updated and url", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;
    expect(options?.onRelayRequest).toBeDefined();

    await options!.onRelayRequest!("create_comment", {
      body: "hello",
      url: "https://example.com/page",
      anchorKey: "body:center",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com/page" });
  });

  /**
   * REQ-PUSH-02: reply_comment triggers relay.push with url from payload
   */
  it("REQ-PUSH-02: reply_comment calls relay.push with notify_comments_updated", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ replied: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "reply",
      url: "https://example.com/other",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com/other" });
  });

  /**
   * REQ-PUSH-03: resolve_thread triggers relay.push
   */
  it("REQ-PUSH-03: resolve_thread calls relay.push with notify_comments_updated", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ resolved: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("resolve_thread", {
      threadId: "t1",
      url: "https://example.com",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com" });
  });

  /**
   * REQ-PUSH-04: reopen_thread triggers relay.push
   */
  it("REQ-PUSH-04: reopen_thread calls relay.push with notify_comments_updated", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ reopened: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("reopen_thread", {
      threadId: "t1",
      url: "https://example.com",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com" });
  });

  /**
   * REQ-PUSH-05: delete_comment triggers relay.push
   */
  it("REQ-PUSH-05: delete_comment calls relay.push with notify_comments_updated", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ deleted: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("delete_comment", {
      threadId: "t1",
      commentId: "c1",
      url: "https://example.com",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com" });
  });

  /**
   * REQ-PUSH-06: delete_thread triggers relay.push
   */
  it("REQ-PUSH-06: delete_thread calls relay.push with notify_comments_updated", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ deleted: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("delete_thread", {
      threadId: "t1",
      url: "https://example.com",
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", { url: "https://example.com" });
  });

  /**
   * REQ-PUSH-07: mutating action with no url in payload sends empty payload to push()
   */
  it("REQ-PUSH-07: mutating action without url calls relay.push with empty payload", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ replied: true }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "reply without url",
      // no url property
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("notify_comments_updated", {});
  });

  /**
   * REQ-PUSH-08: get_comments does NOT call relay.push (non-mutating action)
   */
  it("REQ-PUSH-08: get_comments does NOT call relay.push", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue([]),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("get_comments", { url: "https://example.com" });

    expect(push).not.toHaveBeenCalled();
  });

  /**
   * REQ-PUSH-09: get_all_comments does NOT call relay.push (non-mutating action)
   */
  it("REQ-PUSH-09: get_all_comments does NOT call relay.push", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue([]),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const { options, push } = capturedRelayInstance!;

    await options!.onRelayRequest!("get_all_comments", {});

    expect(push).not.toHaveBeenCalled();
  });
});
