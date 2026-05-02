import { describe, it, expect, vi } from "vitest";
import { importSyncApi, makeLocalThread, makeLocalThreadWithComments, makeRemoteThread, type BrowserBridgeAPI, type BrowserRelayLike, vscode } from "./browser-comment-sync-fixtures.js";

describe("browser-comment-sync full-state relay", () => {
  /**
   * M36-BR-FN-01: syncBrowserComments sends sync_comment_state relay action (not get_all_comments).
   * This is tested in browser-comment-sync-core.test.ts — covered there.
   */

  /**
   * M36-BR-FN-02: syncBrowserComments returns 'partial' when relay.request throws.
   */
  it("M36-BR-FN-02: returns 'partial' when relay.request throws", async () => {
    const relay = {
      request: vi.fn().mockRejectedValue(new Error("connection refused")),
      push: vi.fn(),
      isConnected: () => true,
    };
    const bridge = { invokeTool: vi.fn() };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();

    await expect(
      syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel),
    ).resolves.toBe("partial");

    expect(relay.request).toHaveBeenCalledWith("sync_comment_state", {}, 5000);
    expect(out.appendLine).toHaveBeenCalledWith(expect.stringContaining("sync_comment_state request failed"));
  });

  /**
   * M36-BR-FN-03: syncBrowserComments returns 'success' when sync_comment_state succeeds with empty data.
   * Verifies that a successful response with no pages is still 'success'.
   */
  it("M36-BR-FN-03: returns 'success' when sync_comment_state succeeds with empty pages", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        data: { schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0, emittedBy: "browser-extension", generatedAt: new Date().toISOString(), pages: [] },
      }),
      push: vi.fn(),
      isConnected: () => true,
    };
    const bridge = { invokeTool: vi.fn() };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();

    await expect(
      syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel),
    ).resolves.toBe("success");

    expect(relay.request).toHaveBeenCalledWith("sync_comment_state", {}, 5000);
  });

  /**
   * M36-BR-FN-04: syncBrowserComments does NOT call comment_delete, comment_create, or any
   * mutation tool after receiving sync_comment_state response.
   * The new full-state contract means mutation logic lives in the comments package;
   * the browser package relay only sends sync_comment_state and processes the response.
   */
  it("M36-BR-FN-04: does NOT call comment_delete after sync_comment_state success", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        data: { schemaVersion: "2.0", browserRevision: 2, accordoRevision: 1, emittedBy: "browser-extension", generatedAt: new Date().toISOString(), pages: [] },
      }),
      push: vi.fn(),
      isConnected: () => true,
    };
    const bridge = { invokeTool: vi.fn() };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();

    await syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);

    // The browser package does NOT do mutation work — that's handled by the comments package's
    // applyBrowserCommentSyncState. syncBrowserComments is a pure relay: send sync, return status.
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_delete", expect.anything());
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_create", expect.anything());
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_reply", expect.anything());
  });

  /**
   * M36-BR-FN-05: syncBrowserComments does NOT call get_all_comments or get_comments.
   * These deprecated per-mutation relay actions are no longer used in the new full-state contract.
   */
  it("M36-BR-FN-05: does NOT call get_all_comments or get_comments (deprecated actions)", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        data: { schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0, emittedBy: "browser-extension", generatedAt: new Date().toISOString(), pages: [] },
      }),
      push: vi.fn(),
      isConnected: () => true,
    };
    const bridge = { invokeTool: vi.fn() };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();

    await syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);

    // Only sync_comment_state should be called — not the deprecated get_all_comments or get_comments
    expect(relay.request).toHaveBeenCalledTimes(1);
    expect(relay.request).toHaveBeenCalledWith("sync_comment_state", {}, 5000);
  });

  /**
   * M36-BR-FN-06: syncBrowserComments with non-empty pages in response still returns 'success'
   * (the data is handled by comments package applyBrowserCommentSyncState, not browser package).
   */
  it("M36-BR-FN-06: returns 'success' when sync_comment_state response contains full-state pages", async () => {
    const remoteThread = {
      ...makeRemoteThread("t-remote", "https://example.com/page"),
      comments: [
        { id: "c1", threadId: "t-remote", createdAt: "2024-01-01T00:00:00.000Z", author: { kind: "user" as const, name: "Browser User" }, body: "Root", anchorKey: "body:center", pageUrl: "https://example.com/page", status: "open" as const },
      ],
    };
    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        data: {
          schemaVersion: "2.0",
          browserRevision: 3,
          accordoRevision: 2,
          emittedBy: "browser-extension",
          generatedAt: new Date().toISOString(),
          pages: [{ pageUrl: "https://example.com/page", threads: [remoteThread] }],
        },
      }),
      push: vi.fn(),
      isConnected: () => true,
    };
    const bridge = { invokeTool: vi.fn() };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();

    await expect(
      syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel),
    ).resolves.toBe("success");
  });
});
