/**
 * relay-onrelay.test.ts — BUG-1: Shape mismatch in comment_list response
 *
 * Tests that onRelayRequest returns the correct response shape when handling
 * get_comments/get_all_comments from Chrome.
 *
 * Chrome's service-worker.ts (GET_THREADS handler) parses the relay response expecting:
 *   hubResult.data as { threads?: HubCommentThread[] }
 * So response.data MUST be { threads: CommentThread[] }, not a bare array.
 *
 * API checklist (onRelayRequest):
 * - get_comments      → verify response.data is { threads: CommentThread[] }
 * - get_all_comments → verify response.data is { threads: CommentThread[] }
 * - create_comment    → verify success response shape
 * - reply_comment    → verify success response shape
 * - resolve_thread   → verify success response shape
 * - reopen_thread    → verify success response shape
 * - delete_comment   → verify success response shape
 * - delete_thread    → verify success response shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";
import { createExtensionContextMock, extensions } from "./mocks/vscode.js";

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
const invokeToolMock = vi.fn();

// Capture the relay instance and the options passed to it
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
    // Capture the instance and options so tests can access onRelayRequest after activate()
    capturedRelayInstance = { ...instance, options };
    return instance;
  }),
}));

beforeEach(() => {
  capturedRelayInstance = null;
});

describe("BUG-1: onRelayRequest response shape for get_comments", () => {

  /**
   * REQ-01: get_comments response.data must be { threads: CommentThread[] }.
   *
   * Chrome's service-worker.ts GET_THREADS handler parses response as:
   *   const raw = hubResult.data as { threads?: HubCommentThread[] };
   *   if (raw.threads && Array.isArray(raw.threads)) { ... }
   *
   * So the relay layer MUST wrap the bare array from comment_list in { threads: [...] }
   * before returning to Chrome. A bare array would leave raw.threads undefined and
   * Chrome would see zero Hub threads.
   */
  it("REQ-01: get_comments response.data must be { threads: CommentThread[] } (not a bare array)", async () => {
    // Setup: bridge returns full CommentThread[] (what comment_list returns with detail:true)
    const mockThreads = [
      {
        id: "t1",
        anchor: {
          kind: "surface",
          uri: "https://example.com/page",
          surfaceType: "browser",
          coordinates: { type: "normalized", x: 0.5, y: 0.5 },
        },
        status: "open" as const,
        comments: [{
          id: "c1", threadId: "t1", createdAt: "2026-03-24T10:00:00Z",
          author: { kind: "user" as const, name: "Test User" },
          body: "Hello world",
          status: "open" as const,
        }],
        createdAt: "2026-03-24T10:00:00Z",
        lastActivity: "2026-03-24T10:00:00Z",
      },
    ];

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue(mockThreads),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // Access onRelayRequest from the captured options (where extension.ts stores it)
    expect(capturedRelayInstance).not.toBeNull();
    expect(capturedRelayInstance!.options?.onRelayRequest).toBeDefined();

    // Call onRelayRequest with get_comments action
    const result = await capturedRelayInstance!.options!.onRelayRequest!("get_comments", { url: "https://example.com/page" });

    // Verify the response structure
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("data");

    // REQ-01: data must be { threads: [...] } so Chrome's raw.threads lookup succeeds
    const resultData = (result as { data: unknown }).data;
    expect(Array.isArray(resultData)).toBe(false);
    expect(resultData).toHaveProperty("threads");

    // Verify full thread data is present (not a ThreadSummary)
    const wrapped = resultData as { threads: Array<Record<string, unknown>> };
    const threads = wrapped.threads;
    expect(Array.isArray(threads)).toBe(true);
    expect(threads.length).toBe(1);
    expect(threads[0]).toHaveProperty("id", "t1");
    expect(threads[0]).toHaveProperty("anchor");
    expect(threads[0]).toHaveProperty("comments");
    expect(threads[0]).toHaveProperty("createdAt");
    expect(Array.isArray(threads[0]["comments"])).toBe(true);
    const comments = threads[0]["comments"] as Array<Record<string, unknown>>;
    expect(comments[0]).toHaveProperty("body", "Hello world");
    expect((threads[0]["anchor"] as { uri: string }).uri).toBe("https://example.com/page");
  });

  /**
   * REQ-02: get_all_comments response.data must be { threads: CommentThread[] }.
   *
   * Same shape requirement as REQ-01, but without URL filtering.
   * Chrome's EXPORT handler also checks raw.threads (service-worker.ts line 382-387).
   */
  it("REQ-02: get_all_comments response.data must be { threads: CommentThread[] } (not a bare array)", async () => {
    const mockThreads = [
      {
        id: "t2",
        anchor: {
          kind: "surface",
          uri: "https://other.com/page",
          surfaceType: "browser",
          coordinates: { type: "normalized", x: 0.5, y: 0.5 },
        },
        status: "open" as const,
        comments: [{
          id: "c2", threadId: "t2", createdAt: "2026-03-24T11:00:00Z",
          author: { kind: "agent" as const, name: "Agent" },
          body: "Reply",
          status: "open" as const,
        }],
        createdAt: "2026-03-24T11:00:00Z",
        lastActivity: "2026-03-24T11:00:00Z",
      },
    ];

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue(mockThreads),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("get_all_comments", {});

    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("data");

    // REQ-02: data must be { threads: [...] } so Chrome's raw.threads lookup succeeds
    const resultData = (result as { data: unknown }).data;
    expect(Array.isArray(resultData)).toBe(false);
    expect(resultData).toHaveProperty("threads");

    const wrapped = resultData as { threads: Array<Record<string, unknown>> };
    const threads = wrapped.threads;
    expect(Array.isArray(threads)).toBe(true);
    expect(threads.length).toBe(1);
    expect(threads[0]).toHaveProperty("id", "t2");
    expect(threads[0]).toHaveProperty("comments");
    expect(threads[0]).toHaveProperty("createdAt");
  });

  /**
   * REQ-03: create_comment response must have success: true
   */
  it("REQ-03: create_comment returns success:true with created thread info", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        created: true,
        threadId: "t1",
        commentId: "c1",
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("create_comment", {
      body: "test comment",
      url: "https://example.com",
      anchorKey: "body:center",
    });

    expect(result).toHaveProperty("success", true);
  });

  it("BUG-DEL-01: create_comment forwards caller threadId/commentId to comment_create", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t-local", commentId: "c-local" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("create_comment", {
      body: "test comment",
      url: "https://example.com",
      anchorKey: "div:2:hero_title@120,45",
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
    expect(result).toHaveProperty("success", true);
  });

  /**
   * REQ-04: reply_comment returns success:true
   */
  it("REQ-04: reply_comment returns success:true with replied comment info", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        replied: true,
        commentId: "c2",
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "reply text",
    });

    expect(result).toHaveProperty("success", true);
  });

  it("BR-F-140-MAP: reply_comment with explicit commentId passes it through to comment_reply tool", async () => {
    // Parity check: when the Chrome service-worker forwards ADD_COMMENT with a
    // caller-supplied commentId, accordo-browser must pass that same commentId into
    // the comment_reply tool so Hub's store persists the reply under the exact same id.
    const explicitCommentId = "explicit-reply-cid-xyz789";

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        replied: true,
        commentId: explicitCommentId,
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();

    // Call onRelayRequest with reply_comment including an explicit commentId
    const result = await capturedRelayInstance!.options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "reply with explicit id",
      commentId: explicitCommentId,
    });

    // The mapping must forward commentId into comment_reply args
    expect(invokeToolMock).toHaveBeenCalledWith(
      "comment_reply",
      expect.objectContaining({
        threadId: "t1",
        body: "reply with explicit id",
        commentId: explicitCommentId,
      }),
    );

    expect(result).toHaveProperty("success", true);
  });

  /**
   * REQ-05: resolve_thread returns success:true
   */
  it("REQ-05: resolve_thread returns success:true", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        resolved: true,
        threadId: "t1",
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("resolve_thread", {
      threadId: "t1",
      resolutionNote: "Fixed",
    });

    expect(result).toHaveProperty("success", true);
  });

  /**
   * REQ-06: reopen_thread returns success:true
   */
  it("REQ-06: reopen_thread returns success:true", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        reopened: true,
        threadId: "t1",
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("reopen_thread", {
      threadId: "t1",
    });

    expect(result).toHaveProperty("success", true);
  });

  /**
   * REQ-07: delete_comment returns success:true
   */
  it("REQ-07: delete_comment returns success:true", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        deleted: true,
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("delete_comment", {
      threadId: "t1",
      commentId: "c1",
    });

    expect(result).toHaveProperty("success", true);
  });

  /**
   * REQ-08: delete_thread returns success:true
   */
  it("REQ-08: delete_thread returns success:true", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({
        deleted: true,
      }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    const result = await capturedRelayInstance!.options!.onRelayRequest!("delete_thread", {
      threadId: "t1",
    });

    expect(result).toHaveProperty("success", true);
  });

  /**
   * BR-F-142 / get_comments_version mapping:
   * The Chrome service worker calls relayBridge.send("get_comments_version", {})
   * to poll VS Code for a version number. This action must be mapped to the
   * "comment_sync_version" tool so Hub can respond with the current version.
   *
   * If the mapping is missing, get_comments_version returns an error and periodic
   * sync silently does nothing (SW-wake rehydration appears to work but version
   * changes are never detected).
   */
  it("BR-F-142: get_comments_version action maps to comment_sync_version tool and returns version data", async () => {
    const versionData = { version: 7, lastActivity: "2026-03-25T00:00:00Z" };

    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue(versionData),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();

    // Call get_comments_version — this is what checkAndSync sends to the relay
    const result = await capturedRelayInstance!.options!.onRelayRequest!("get_comments_version", {});

    // Must succeed
    expect(result).toHaveProperty("success", true);

    // Verify the underlying tool invoked was comment_sync_version (not get_comments_version)
    expect(invokeToolMock).toHaveBeenCalledWith("comment_sync_version", expect.any(Object));

    // The version payload must be forwarded to Chrome so checkAndSync can compare versions
    const resultData = (result as { data: unknown }).data;
    expect(resultData).toEqual(versionData);
  });

  /**
   * BR-AUTH-01: create_comment with authorName passes authorKind/authorName to comment_create
   */
  it("BR-AUTH-01: create_comment with authorName forwards authorKind=user and authorName to comment_create", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t1", commentId: "c1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    await capturedRelayInstance!.options!.onRelayRequest!("create_comment", {
      body: "Hello from browser",
      url: "https://example.com",
      anchorKey: "body:center",
      authorName: "Guest",
    });

    expect(invokeToolMock).toHaveBeenCalledWith(
      "comment_create",
      expect.objectContaining({
        authorKind: "user",
        authorName: "Guest",
      }),
    );
  });

  /**
   * BR-AUTH-02: create_comment without authorName does NOT inject authorKind/authorName
   */
  it("BR-AUTH-02: create_comment without authorName does not inject authorKind/authorName", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ created: true, threadId: "t1", commentId: "c1" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    await capturedRelayInstance!.options!.onRelayRequest!("create_comment", {
      body: "No author",
      url: "https://example.com",
      anchorKey: "body:center",
    });

    const calledArgs = invokeToolMock.mock.calls[0][1] as Record<string, unknown>;
    expect(calledArgs["authorKind"]).toBeUndefined();
    expect(calledArgs["authorName"]).toBeUndefined();
  });

  /**
   * BR-AUTH-03: reply_comment with authorName forwards authorKind=user and authorName to comment_reply
   */
  it("BR-AUTH-03: reply_comment with authorName forwards authorKind=user and authorName to comment_reply", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ replied: true, commentId: "c2" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    await capturedRelayInstance!.options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "Reply from browser",
      authorName: "Alice",
    });

    expect(invokeToolMock).toHaveBeenCalledWith(
      "comment_reply",
      expect.objectContaining({
        authorKind: "user",
        authorName: "Alice",
      }),
    );
  });

  /**
   * BR-AUTH-04: reply_comment without authorName does NOT inject authorKind/authorName
   */
  it("BR-AUTH-04: reply_comment without authorName does not inject authorKind/authorName", async () => {
    const bridge = {
      registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      publishState: vi.fn(),
      invokeTool: invokeToolMock.mockResolvedValue({ replied: true, commentId: "c2" }),
    };
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedRelayInstance).not.toBeNull();
    await capturedRelayInstance!.options!.onRelayRequest!("reply_comment", {
      threadId: "t1",
      body: "Reply no author",
    });

    const calledArgs = invokeToolMock.mock.calls[0][1] as Record<string, unknown>;
    expect(calledArgs["authorKind"]).toBeUndefined();
    expect(calledArgs["authorName"]).toBeUndefined();
  });
});
