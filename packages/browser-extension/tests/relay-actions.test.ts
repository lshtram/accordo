import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { createThread } from "../src/store.js";
import { handleRelayAction } from "../src/relay-actions.js";

describe("M82-RELAY — browser-extension relay actions", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("BR-F-119: get_comments returns active thread data envelope", async () => {
    await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-1",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "req-1");
    expect((response.data as { totalThreads: number }).totalThreads).toBe(1);
  });

  it("BR-F-124: create_comment creates a new thread on active page by default", async () => {
    setMockTabUrl(1, "https://example.com/created?page=1");
    const response = await handleRelayAction({
      requestId: "req-create",
      action: "create_comment",
      payload: { body: "Created by agent" },
    });

    expect(response.success).toBe(true);
    const created = response.data as { pageUrl: string; comments: Array<{ body: string }> };
    expect(created.pageUrl).toBe("https://example.com/created");
    expect(created.comments[0]?.body).toBe("Created by agent");
  });

  it("BR-F-119: get_comments defaults to active tab URL when url is omitted", async () => {
    setMockTabUrl(1, "https://example.com/active?page=1#top");
    await createThread("https://example.com/active", "div:0:test", {
      body: "from active page",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-active",
      action: "get_comments",
      payload: {},
    });

    expect(response.success).toBe(true);
    const data = response.data as { url: string; totalThreads: number };
    expect(data.url).toBe("https://example.com/active");
    expect(data.totalThreads).toBe(1);
  });

  it("BR-F-119: get_all_comments returns all URLs sorted by lastActivity desc", async () => {
    const first = await createThread("https://example.com/older", "div:0:a", {
      body: "older",
      author: { kind: "user", name: "Alice" },
    });
    await createThread("https://example.com/newer", "div:0:b", {
      body: "newer",
      author: { kind: "user", name: "Bob" },
    });

    await handleRelayAction({
      requestId: "req-reply",
      action: "reply_comment",
      payload: { threadId: first.id, body: "fresh activity", authorName: "Agent" },
    });

    const response = await handleRelayAction({
      requestId: "req-all",
      action: "get_all_comments",
      payload: {},
    });

    expect(response.success).toBe(true);
    const pages = (response.data as { pages: Array<{ url: string }> }).pages;
    expect(pages).toHaveLength(2);
    expect(pages[0]?.url).toBe("https://example.com/older");
    expect(pages[1]?.url).toBe("https://example.com/newer");
  });

  it("BR-F-119: reply_comment appends a comment", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-2",
      action: "reply_comment",
      payload: { threadId: thread.id, body: "reply", authorName: "Agent" },
    });

    expect(response.success).toBe(true);
    expect((response.data as { body?: string }).body).toBe("reply");
  });

  it("BR-F-124: resolve_thread then reopen_thread toggles thread status", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const resolved = await handleRelayAction({
      requestId: "req-r1",
      action: "resolve_thread",
      payload: { threadId: thread.id, resolutionNote: "done" },
    });
    expect(resolved.success).toBe(true);

    const afterResolve = await handleRelayAction({
      requestId: "req-r2",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    const status1 = (afterResolve.data as { threads: Array<{ status: string }> }).threads[0]?.status;
    expect(status1).toBe("resolved");

    const reopened = await handleRelayAction({
      requestId: "req-r3",
      action: "reopen_thread",
      payload: { threadId: thread.id },
    });
    expect(reopened.success).toBe(true);

    const afterReopen = await handleRelayAction({
      requestId: "req-r4",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    const status2 = (afterReopen.data as { threads: Array<{ status: string }> }).threads[0]?.status;
    expect(status2).toBe("open");
  });

  it("BR-F-125: unknown action returns unsupported-action", async () => {
    const response = await handleRelayAction({
      requestId: "req-3",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    expect(response.error).toBeUndefined();

    const bad = await handleRelayAction({
      requestId: "req-4",
      action: "invalid_action" as never,
      payload: {},
    });
    expect(bad.success).toBe(false);
    expect(bad.error).toBe("unsupported-action");
  });
});
