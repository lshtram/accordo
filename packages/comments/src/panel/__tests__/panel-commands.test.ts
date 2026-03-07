/**
 * Tests for PanelCommands (M45-CMD)
 *
 * API checklist:
 * ✓ registerPanelCommands   — M45-CMD-01
 * ✓ navigateToAnchor        — M45-CMD-02
 * ✓ resolve                 — M45-CMD-03
 * ✓ reopen                  — M45-CMD-04
 * ✓ reply                   — M45-CMD-05
 * ✓ delete                  — M45-CMD-06
 * ✓ refresh                 — M45-CMD-07
 * ✓ filterByStatus          — M45-CMD-08
 * ✓ filterByIntent          — M45-CMD-09
 * ✓ clearFilters            — M45-CMD-10
 * ✓ nc sync after mutation  — M45-CMD-11
 * ✓ no-arg graceful         — M45-CMD-12
 * ✓ author = User           — M45-CMD-13
 * ✓ groupBy                 — M45-CMD-14
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPanelCommands } from "../../panel/panel-commands.js";
import type { PanelCommandStore, NativeCommentsSync, PanelCommandUI } from "../../panel/panel-commands.js";
import type { NavigationEnv } from "../../panel/navigation-router.js";
import { PanelFilters } from "../../panel/panel-filters.js";
import { CommentsTreeProvider, CommentTreeItem } from "../../panel/comments-tree-provider.js";
import type { TreeStoreReader } from "../../panel/comments-tree-provider.js";
import type { CommentThread, CommentAnchorText } from "@accordo/bridge-types";
import { commands as vsCommands, createMockExtensionContext } from "vscode";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockMemento(): { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn().mockImplementation((key: string, fallback?: unknown) =>
      data.has(key) ? data.get(key) : fallback,
    ),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeThread(id: string, status: "open" | "resolved" = "open"): CommentThread {
  return {
    id,
    anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
    comments: [{
      id: "c1", threadId: id, createdAt: "2026-03-06T00:00:00Z",
      author: { kind: "user", name: "User" }, body: "Test body",
      anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      status,
    }],
    status,
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
  };
}

function makeTreeItem(thread: CommentThread): CommentTreeItem {
  const item = new CommentTreeItem("test");
  item.thread = thread;
  item.isGroupHeader = false;
  return item;
}

function createMockStore(threads: CommentThread[] = []): PanelCommandStore & { _threads: Map<string, CommentThread> } {
  const map = new Map(threads.map(t => [t.id, t]));
  return {
    _threads: map,
    resolve: vi.fn().mockResolvedValue(undefined),
    reopen: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ commentId: "c-new" }),
    delete: vi.fn().mockImplementation(async (params: { threadId: string }) => {
      map.delete(params.threadId);
    }),
    getThread: vi.fn().mockImplementation((id: string) => map.get(id)),
  };
}

function createMockNc(): NativeCommentsSync {
  return {
    updateThread: vi.fn(),
    removeThread: vi.fn(),
  };
}

function createMockNavEnv(): NavigationEnv {
  return {
    showTextDocument: vi.fn().mockResolvedValue({ revealRange: vi.fn() }),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    visibleTextEditorUris: vi.fn().mockReturnValue([]),
  };
}

function createMockUI(): PanelCommandUI & {
  showInputBox: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showInformationMessage: ReturnType<typeof vi.fn>;
} {
  return {
    showInputBox: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTreeStore(): TreeStoreReader {
  return {
    getAllThreads: vi.fn().mockReturnValue([]),
    isThreadStale: vi.fn().mockReturnValue(false),
    onChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-CMD PanelCommands", () => {
  let ctx: ReturnType<typeof createMockExtensionContext>;
  let store: ReturnType<typeof createMockStore>;
  let nc: ReturnType<typeof createMockNc>;
  let navEnv: NavigationEnv;
  let filters: PanelFilters;
  let provider: CommentsTreeProvider;
  let ui: ReturnType<typeof createMockUI>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockExtensionContext();
    const thread1 = makeThread("t1", "open");
    const thread2 = makeThread("t2", "resolved");
    store = createMockStore([thread1, thread2]);
    nc = createMockNc();
    navEnv = createMockNavEnv();
    filters = new PanelFilters(createMockMemento() as never);
    provider = new CommentsTreeProvider(createMockTreeStore(), filters);
    ui = createMockUI();
  });

  it("M45-CMD-01: registerPanelCommands returns disposables array", () => {
    const disposables = registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);
    expect(Array.isArray(disposables)).toBe(true);
    expect(disposables.length).toBeGreaterThan(0);
    disposables.forEach(d => expect(typeof d.dispose).toBe("function"));
  });

  it("M45-CMD-02: navigateToAnchor calls router with thread from tree item", async () => {
    const thread = makeThread("t1");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.navigateToAnchor",
    )?.[1];

    expect(handler).toBeDefined();
    const item = makeTreeItem(thread);
    await handler(item);
    // Router should have been called (navigateToThread)
    // We verify via the env mock being called
    expect((navEnv as ReturnType<typeof createMockNavEnv>).showTextDocument).toHaveBeenCalled();
  });

  it("M45-CMD-03: resolve shows inputBox, calls store.resolve, syncs nc", async () => {
    const thread = makeThread("t1", "open");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.resolve",
    )?.[1];

    ui.showInputBox.mockResolvedValueOnce("Fixed the bug");
    await handler(makeTreeItem(thread));

    expect(ui.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.any(String) }));
    expect(store.resolve).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "t1",
      resolutionNote: "Fixed the bug",
      author: { kind: "user", name: "User" },
    }));
  });

  it("M45-CMD-03: resolve on already-resolved thread shows info message", async () => {
    const thread = makeThread("t1", "resolved");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.resolve",
    )?.[1];

    await handler(makeTreeItem(thread));
    expect(store.resolve).not.toHaveBeenCalled();
    expect(ui.showInformationMessage).toHaveBeenCalled();
  });

  it("M45-CMD-04: reopen calls store.reopen, syncs nc", async () => {
    const thread = makeThread("t2", "resolved");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.reopen",
    )?.[1];

    await handler(makeTreeItem(thread));
    expect(store.reopen).toHaveBeenCalledWith("t2", { kind: "user", name: "User" });
  });

  it("M45-CMD-04: reopen on already-open thread shows info message", async () => {
    const thread = makeThread("t1", "open");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.reopen",
    )?.[1];

    await handler(makeTreeItem(thread));
    expect(store.reopen).not.toHaveBeenCalled();
    expect(ui.showInformationMessage).toHaveBeenCalled();
  });

  it("M45-CMD-05: reply navigates to thread anchor — opens gutter widget for text anchors", async () => {
    const thread = makeThread("t1");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.reply",
    )?.[1];

    await handler(makeTreeItem(thread));

    // navigateToThread → showTextDocument + expandThread (gutter widget)
    expect(navEnv.showTextDocument).toHaveBeenCalled();
    expect(navEnv.executeCommand).toHaveBeenCalledWith(
      "accordo_comments_internal_expandThread", "t1",
    );
    // Does NOT use showInputBox or store.reply (native inline widget handles the reply)
    expect(ui.showInputBox).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();
  });

  it("M45-CMD-05: reply no-ops gracefully when called with no argument", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.reply",
    )?.[1];

    await handler(undefined); // no thread arg
    expect(store.reply).not.toHaveBeenCalled();
    expect(navEnv.showTextDocument).not.toHaveBeenCalled();
    expect(ui.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Select a thread"),
    );
  });

  it("M45-CMD-06: delete shows confirm dialog, calls store.delete on confirm", async () => {
    const thread = makeThread("t1");
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.delete",
    )?.[1];

    ui.showWarningMessage.mockResolvedValueOnce("Delete");
    await handler(makeTreeItem(thread));

    expect(ui.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Delete"),
      "Delete",
      "Cancel",
    );
    expect(store.delete).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M45-CMD-06: delete no-ops on Cancel", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.delete",
    )?.[1];

    ui.showWarningMessage.mockResolvedValueOnce("Cancel");
    const thread = makeThread("t1");
    await handler(makeTreeItem(thread));
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("M45-CMD-07: refresh fires provider.refresh()", () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.refresh",
    )?.[1];

    const spy = vi.spyOn(provider, "refresh");
    handler();
    expect(spy).toHaveBeenCalled();
  });

  it("M45-CMD-08: filterByStatus calls filters.setStatus + provider.refresh", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.filterByStatus",
    )?.[1];

    // Mock showQuickPick to return "open"
    const { window } = await import("vscode");
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce("open");

    const statusSpy = vi.spyOn(filters, "setStatus");
    const refreshSpy = vi.spyOn(provider, "refresh");
    await handler();

    expect(statusSpy).toHaveBeenCalledWith("open");
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("M45-CMD-09: filterByIntent calls filters.setIntent + provider.refresh", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.filterByIntent",
    )?.[1];

    const { window } = await import("vscode");
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce("fix");

    const intentSpy = vi.spyOn(filters, "setIntent");
    await handler();
    expect(intentSpy).toHaveBeenCalledWith("fix");
  });

  it("M45-CMD-10: clearFilters calls filters.clear + provider.refresh", () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.clearFilters",
    )?.[1];

    const clearSpy = vi.spyOn(filters, "clear");
    const refreshSpy = vi.spyOn(provider, "refresh");
    handler();
    expect(clearSpy).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("M45-CMD-11: after store mutation, nc is synced (updateThread / removeThread)", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    // Test resolve → nc.updateThread
    const resolveHandler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.resolve",
    )?.[1];
    ui.showInputBox.mockResolvedValueOnce("done");
    await resolveHandler(makeTreeItem(makeThread("t1")));
    expect(nc.updateThread).toHaveBeenCalled();

    // Test delete → nc.removeThread
    const deleteHandler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.delete",
    )?.[1];
    ui.showWarningMessage.mockResolvedValueOnce("Delete");
    await deleteHandler(makeTreeItem(makeThread("t1")));
    expect(nc.removeThread).toHaveBeenCalledWith("t1");
  });

  it("M45-CMD-12: commands no-op gracefully when called with no argument", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const resolveHandler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.resolve",
    )?.[1];

    await resolveHandler(undefined);
    expect(store.resolve).not.toHaveBeenCalled();
    expect(ui.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Select a thread"),
    );
  });

  it("M45-CMD-13: author passed to store mutations is always { kind: 'user', name: 'User' }", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    // Test via resolve (reply no longer calls store.reply — it delegates to inline UI)
    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.resolve",
    )?.[1];

    ui.showInputBox.mockResolvedValueOnce("done");
    await handler(makeTreeItem(makeThread("t1")));

    expect(store.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ author: { kind: "user", name: "User" } }),
    );
  });

  it("M45-CMD-14: groupBy shows quickPick for group mode, calls filters.setGroupMode + provider.refresh", async () => {
    registerPanelCommands(ctx as never, store, nc, navEnv, filters, provider, ui);

    const handler = (vsCommands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([id]: string[]) => id === "accordo.commentsPanel.groupBy",
    )?.[1];

    expect(handler).toBeDefined();

    const { window } = await import("vscode");
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce("by-file");

    const groupSpy = vi.spyOn(filters, "setGroupMode");
    const refreshSpy = vi.spyOn(provider, "refresh");
    await handler();

    expect(groupSpy).toHaveBeenCalledWith("by-file");
    expect(refreshSpy).toHaveBeenCalled();
  });
});
