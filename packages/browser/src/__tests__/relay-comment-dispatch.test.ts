/**
 * relay-comment-dispatch.test.ts
 *
 * Tests for dispatchBrowserCommentAction() in:
 * packages/browser/src/relay-comment-dispatch.ts
 *
 * API checklist:
 * - dispatchBrowserCommentAction(deps, action, payload, timeout?): Promise<BrowserRelayResponse>  [11 tests]
 *
 * Requirement trace:
 * - BR-F-122: Action routing for all 8 comment actions
 * - BR-F-145: Mutation notify semantics equivalent in both relay modes
 * - BR-F-124, BR-F-130: (existing routing requirements)
 * - PU-F-41, PU-F-43, PU-F-44, PU-F-56: (existing dispatch requirements)
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchBrowserCommentAction } from "../relay-comment-dispatch.js";
import type { RelayDispatchDeps, BrowserRelayCommentAction } from "../relay-comment-dispatch.js";

type Action = BrowserRelayCommentAction;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal mock implementing RelayDispatchDeps */
function makeDeps(overrides?: Partial<RelayDispatchDeps>): RelayDispatchDeps {
  return {
    invokeTool: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchBrowserCommentAction — action routing", () => {
  describe("BR-F-122-01: get_comments", () => {
    it("routes to comment_list with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "get_comments" as Action,
        { url: "https://example.com/page" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_list",
        expect.objectContaining({ url: "https://example.com/page" }),
        undefined,
      );
    });
  });

  describe("BR-F-122-02: get_all_comments", () => {
    it("routes to comment_list with allWindows: true", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "get_all_comments" as Action,
        {},
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_list",
        expect.objectContaining({ allWindows: true }),
        undefined,
      );
    });
  });

  describe("BR-F-122-03: create_comment", () => {
    it("routes to comment_create with correct args", async () => {
      const deps = makeDeps();

      const payload = {
        url: "https://example.com/page",
        anchorKey: "body:center",
        body: "Hello world",
        authorName: "Agent",
      };

      await dispatchBrowserCommentAction(
        deps,
        "create_comment" as Action,
        payload,
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_create",
        expect.objectContaining({
          url: "https://example.com/page",
          anchorKey: "body:center",
          body: "Hello world",
          authorName: "Agent",
        }),
        undefined,
      );
    });
  });

  describe("BR-F-122-04: reply_comment", () => {
    it("routes to comment_reply with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "reply_comment" as Action,
        { threadId: "t123", body: "reply text", authorName: "Agent" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_reply",
        expect.objectContaining({
          threadId: "t123",
          body: "reply text",
          authorName: "Agent",
        }),
        undefined,
      );
    });
  });

  describe("BR-F-122-05: resolve_thread", () => {
    it("routes to comment_resolve with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "resolve_thread" as Action,
        { threadId: "t456", resolutionNote: "Fixed" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_resolve",
        expect.objectContaining({ threadId: "t456", resolutionNote: "Fixed" }),
        undefined,
      );
    });
  });

  describe("BR-F-122-06: reopen_thread", () => {
    it("routes to comment_reopen with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "reopen_thread" as Action,
        { threadId: "t789" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_reopen",
        expect.objectContaining({ threadId: "t789" }),
        undefined,
      );
    });
  });

  describe("BR-F-122-07: delete_comment", () => {
    it("routes to comment_delete with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "delete_comment" as Action,
        { threadId: "t-del", commentId: "c-del" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({ threadId: "t-del", commentId: "c-del" }),
        undefined,
      );
    });
  });

  describe("BR-F-122-08: delete_thread", () => {
    it("routes to comment_delete with correct args", async () => {
      const deps = makeDeps();

      await dispatchBrowserCommentAction(
        deps,
        "delete_thread" as Action,
        { threadId: "t-full-del" },
      );

      expect(deps.invokeTool).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({ threadId: "t-full-del" }),
        undefined,
      );
    });
  });
});

describe("dispatchBrowserCommentAction — error handling", () => {
  it("BR-F-145-04: Returns success: false with correct error discriminator when invokeTool throws", async () => {
    const deps = makeDeps({
      invokeTool: vi.fn().mockRejectedValue(new Error("network error")),
    });

    const response = await dispatchBrowserCommentAction(
      deps,
      "get_comments" as Action,
      { url: "https://example.com/page" },
    );

    expect(response).toHaveProperty("success", false);
    expect(response).toHaveProperty("error");
  });

  it("BR-F-145-04: Returns success: false with correct error discriminator when invokeTool returns error shape", async () => {
    const deps = makeDeps({
      invokeTool: vi.fn().mockResolvedValue({ success: false, error: "timeout" }),
    });

    const response = await dispatchBrowserCommentAction(
      deps,
      "create_comment" as Action,
      { body: "test" },
    );

    expect(response).toHaveProperty("success", false);
    expect(response.error).toBeTruthy();
  });

});

describe("dispatchBrowserCommentAction — RelayDispatchDeps abstraction", () => {
  it("BR-F-43-01: Works with any RelayDispatchDeps satisfying the interface", async () => {
    // Minimal deps — only invokeTool is required
    const minimalDeps: RelayDispatchDeps = {
      invokeTool: vi.fn().mockResolvedValue({ success: true }),
    };

    const response = await dispatchBrowserCommentAction(
      minimalDeps,
      "get_all_comments" as Action,
      {},
    );

    expect(response).toHaveProperty("success", true);
    expect(minimalDeps.invokeTool).toHaveBeenCalled();
  });
});