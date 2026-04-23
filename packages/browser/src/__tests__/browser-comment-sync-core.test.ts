import { describe, it, expect } from "vitest";
import { importSyncApi, makeLocalThread, makeRemoteThread, type BrowserBridgeAPI, type BrowserRelayLike, vscode } from "./browser-comment-sync-fixtures.js";

describe("browser-comment-sync core", () => {
  it("calls get_all_comments first and returns partial on failure", async () => {
    const relay = { request: vi.fn().mockResolvedValue({ success: false, error: "browser-not-connected" }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn() }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await expect(syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel)).resolves.toBe("partial");
    expect(relay.request).toHaveBeenCalledWith("get_all_comments", {}, 5000);
  });

  it("creates missing threads, resolves status, reopens status, and adds replies", async () => {
    const remoteThread = makeRemoteThread("t-1", "https://example.com/page", "resolved");
    remoteThread.comments.push({ id: "c-extra", threadId: "t-1", createdAt: "2024-01-02T00:00:00.000Z", author: { kind: "user", name: "Browser User" }, body: "Second comment", anchorKey: "body:center", pageUrl: "https://example.com/page", status: "resolved" });
    const relay = { request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } }).mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: true }) };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await expect(syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel)).resolves.toBe("success");
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_create", expect.objectContaining({ threadId: "t-1" }));
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_resolve", expect.objectContaining({ threadId: "t-1" }));
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_reply", expect.objectContaining({ threadId: "t-1", commentId: "c-extra" }));
  });

  it("reopens remote-open local-resolved threads", async () => {
    const relay = { request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } }).mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [makeRemoteThread("t-1", "https://example.com/page", "open")] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValueOnce([makeLocalThread("t-1", "https://example.com/page", "resolved")]).mockResolvedValueOnce({ success: true }) };
    const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);
    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_reopen", expect.objectContaining({ threadId: "t-1" }));
  });
});
