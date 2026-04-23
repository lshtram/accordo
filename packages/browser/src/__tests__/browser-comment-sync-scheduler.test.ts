import { describe, it, expect, vi } from "vitest";
import { createExtensionContextMock, importSyncApi, type BrowserBridgeAPI, type BrowserRelayLike, vscode } from "./browser-comment-sync-fixtures.js";

describe("browser-comment-sync scheduler", () => {
  it("start logs and schedules periodic sync; stop clears it", async () => {
    const relay = { request: vi.fn().mockResolvedValue({ success: true, data: { pages: [] } }), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValue([]) }; const out = { appendLine: vi.fn() };
    const { BrowserCommentSyncScheduler } = await importSyncApi();
    const spySetInterval = vi.spyOn(global, "setInterval"); const spyClearInterval = vi.spyOn(global, "clearInterval");
    const scheduler = new BrowserCommentSyncScheduler(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);
    scheduler.start(); scheduler.stop();
    expect(spySetInterval).toHaveBeenCalledOnce();
    expect(spyClearInterval).toHaveBeenCalledOnce();
    expect(out.appendLine).toHaveBeenCalledWith(expect.stringContaining("scheduler stopped"));
    spySetInterval.mockRestore(); spyClearInterval.mockRestore();
  });

  it("syncNow runs once and in-flight guard skips overlaps", async () => {
    let resolveRequest!: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });
    const relay = { request: vi.fn().mockReturnValue(requestPromise), push: vi.fn(), isConnected: () => true };
    const bridge = { invokeTool: vi.fn().mockResolvedValue([]) }; const out = { appendLine: vi.fn() };
    const { BrowserCommentSyncScheduler } = await importSyncApi();
    const scheduler = new BrowserCommentSyncScheduler(relay as unknown as BrowserRelayLike, bridge as unknown as BrowserBridgeAPI, out as unknown as vscode.OutputChannel);
    const first = scheduler.syncNow(); await scheduler.syncNow(); resolveRequest({ success: true, data: { pages: [] } }); await first;
    expect(relay.request).toHaveBeenCalledTimes(1);
  });

  it("per-window activation creates a disposable sync scheduler", async () => {
    const bridge = { registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }), publishState: vi.fn(), invokeTool: vi.fn().mockResolvedValue([]) };
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    const context = createExtensionContextMock();
    const { activate } = await import("../extension.js");
    await activate(context as never);
    const syncDisposable = context.subscriptions[context.subscriptions.length - 1];
    expect(typeof syncDisposable.dispose).toBe("function");
    syncDisposable.dispose();
  });
});
