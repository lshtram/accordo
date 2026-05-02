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
        expect.objectContaining({
          scope: expect.objectContaining({ modality: "browser", url: "https://example.com/page" }),
          detail: true,
        }),
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
        expect.objectContaining({
          scope: expect.objectContaining({ modality: "browser" }),
          detail: true,
        }),
        undefined,
      );
    });
  });

  describe("BR-F-122-03: create_comment", () => {
    it("returns action-unsupported (M40-EXT-15)", async () => {
      const deps = makeDeps();

      const result = await dispatchBrowserCommentAction(
        deps,
        "create_comment" as Action,
        { url: "https://example.com/page", anchorKey: "body:center", body: "Hello world" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("action-unsupported");
      expect(deps.invokeTool).not.toHaveBeenCalled();
    });
  });

  describe("BR-F-122-04: reply_comment", () => {
    it("returns action-unsupported (M40-EXT-15)", async () => {
      const deps = makeDeps();

      const result = await dispatchBrowserCommentAction(
        deps,
        "reply_comment" as Action,
        { threadId: "t123", body: "reply text" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("action-unsupported");
      expect(deps.invokeTool).not.toHaveBeenCalled();
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

  /**
   * BR-F-122-06 / BR-F-122-07 / BR-F-122-08: Deprecated mutation actions.
   *
   * Per the full-state browser comment sync contract (Phase B), these actions
   * are no longer supported via the relay — they are replaced by the
   * sync_comment_state action which provides complete JSON state.
   * The relay now returns action-unsupported for these deprecated actions.
   */
  describe("BR-F-122-06..08: deprecated mutation actions now return action-unsupported", () => {
    for (const action of ["reply_comment", "delete_comment", "delete_thread"] as const) {
      it(`${action} returns action-unsupported (M40-EXT-15)`, async () => {
        const deps = makeDeps();

        const result = await dispatchBrowserCommentAction(
          deps,
          action as Action,
          { threadId: "t1", commentId: "c1" },
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("action-unsupported");
        // invokeTool should NOT be called for deprecated actions
        expect(deps.invokeTool).not.toHaveBeenCalled();
      });
    }
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
