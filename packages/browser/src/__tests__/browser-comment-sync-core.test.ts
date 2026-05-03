import { describe, it, expect } from "vitest";
import { importSyncApi, makeLocalThread, makeRemoteThread, type BrowserBridgeAPI, type BrowserRelayLike, vscode } from "./browser-comment-sync-fixtures.js";

describe("browser-comment-sync core", () => {
  it("calls sync_comment_state first and returns partial on failure", async () => {
    const relay = { request: vi.fn().mockResolvedValue({ success: false, error: "browser-not-connected" }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn() }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await expect(syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel)).resolves.toEqual({ status: "partial", syncResult: null });
    expect(relay.request).toHaveBeenCalledWith("request_comment_state_sync", {}, 5000);
  });

  it("returns success when sync_comment_state succeeds", async () => {
    const relay = { request: vi.fn().mockResolvedValue({ success: true, data: { schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0, emittedBy: "browser-extension", generatedAt: new Date().toISOString(), pages: [] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn() }; const out = { appendLine: vi.fn() };
    const { syncBrowserComments } = await importSyncApi();
    await expect(syncBrowserComments(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel)).resolves.toEqual({ status: "success", syncResult: expect.objectContaining({ schemaVersion: "2.0", pages: [] }) });
    expect(relay.request).toHaveBeenCalledWith("request_comment_state_sync", {}, 5000);
  });
});
