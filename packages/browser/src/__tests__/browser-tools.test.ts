import { describe, it, expect, vi } from "vitest";
import { createBrowserTools } from "../browser-tools.js";

describe("M83-BTOOLS tools", () => {
  it("BR-F-122: registers expected browser tool names", () => {
    const relay = {
      request: vi.fn(),
      isConnected: vi.fn(() => false),
    };
    const tools = createBrowserTools(relay);
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      "browser_getAllComments",
      "browser_getComments",
      "browser_createComment",
      "browser_replyComment",
      "browser_resolveThread",
      "browser_reopenThread",
      "browser_deleteComment",
      "browser_deleteThread",
    ]);
  });

  it("BR-F-124: tool handlers forward calls to relay actions", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true }),
      isConnected: vi.fn(() => true),
    };
    const tools = createBrowserTools(relay);

    await tools[0].handler({});
    expect(relay.request).toHaveBeenCalledWith("get_all_comments", {});

    await tools[1].handler({});
    expect(relay.request).toHaveBeenCalledWith("get_comments", {});

    await tools[2].handler({ body: "new comment" });
    expect(relay.request).toHaveBeenCalledWith("create_comment", { body: "new comment" });

    await tools[3].handler({ threadId: "t1", body: "reply" });
    expect(relay.request).toHaveBeenCalledWith("reply_comment", { threadId: "t1", body: "reply", authorName: "Agent" });

    await tools[4].handler({ threadId: "t1", resolutionNote: "done" });
    expect(relay.request).toHaveBeenCalledWith("resolve_thread", { threadId: "t1", resolutionNote: "done" });

    await tools[5].handler({ threadId: "t1" });
    expect(relay.request).toHaveBeenCalledWith("reopen_thread", { threadId: "t1" });

    await tools[6].handler({ threadId: "t1", commentId: "c1" });
    expect(relay.request).toHaveBeenCalledWith("delete_comment", { threadId: "t1", commentId: "c1" });
  });
});
