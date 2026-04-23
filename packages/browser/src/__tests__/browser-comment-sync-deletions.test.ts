import { describe, it, expect, vi } from "vitest";
import { importSyncApi, makeLocalThread, makeLocalThreadWithComments, makeRemoteThread, type BrowserBridgeAPI, type BrowserRelayLike, vscode } from "./browser-comment-sync-fixtures.js";

describe("browser-comment-sync deletions", () => {
  it("deletes local-only threads after full successful fetch but skips thread deletions on partial fetch", async () => {
    const localThread = makeLocalThread("t-local-only", "https://example.com/other");
    const relay = { request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page1" }, { url: "https://example.com/page2" }] } }).mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page1", threads: [] } }).mockResolvedValueOnce({ success: false, error: "timeout" }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValue([localThread]) }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await expect(syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel)).resolves.toBe("partial");
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_delete", expect.objectContaining({ threadId: "t-local-only" }));
  });

  it("deletes only local-only replies when thread remains and respects remote deleted replies", async () => {
    const remoteThread = { ...makeRemoteThread("t-keep", "https://example.com/page"), comments: [{ id: "t-keep", threadId: "t-keep", createdAt: "2024-01-01T00:00:00.000Z", author: { kind: "user" as const, name: "Browser User" }, body: "Root", anchorKey: "body:center", pageUrl: "https://example.com/page", status: "open" as const }, { id: "reply-present", threadId: "t-keep", createdAt: "2024-01-01T00:01:00.000Z", author: { kind: "user" as const, name: "Browser User" }, body: "Keep", anchorKey: "body:center", pageUrl: "https://example.com/page", status: "open" as const }, { id: "reply-deleted", threadId: "t-keep", createdAt: "2024-01-01T00:02:00.000Z", author: { kind: "user" as const, name: "Browser User" }, body: "Gone", anchorKey: "body:center", pageUrl: "https://example.com/page", status: "open" as const, deletedAt: "2024-01-02T00:00:00.000Z" }] };
    const localThread = makeLocalThreadWithComments("t-keep", "https://example.com/page", ["t-keep", "reply-present", "reply-deleted", "reply-local-only"]);
    const relay = { request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } }).mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValueOnce([localThread]).mockResolvedValue({ success: true }) }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_delete", { threadId: "t-keep", commentId: "reply-deleted" });
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_delete", { threadId: "t-keep", commentId: "reply-local-only" });
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_delete", { threadId: "t-keep" });
  });

  it("skips deleted remote threads from upsert and delete work", async () => {
    const deletedThread = makeRemoteThread("t-deleted", "https://example.com/page", "open");
    deletedThread.deletedAt = "2024-01-01T12:00:00.000Z";
    const relay = { request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } }).mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [deletedThread] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValue([]) }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_create", expect.anything());
    expect(bridge.invokeTool).not.toHaveBeenCalledWith("comment_delete", expect.anything());
  });
});
