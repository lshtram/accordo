/**
 * Runtime message validation and dispatch tests (M45-WVC-07)
 *
 * These tests call the REAL production seam:
 *   RuntimeMessageHandler.handleMessage (from comments-message-handler.ts)
 *
 * Phase B: handleMessage stub throws "not implemented" before producing any
 * validated output. Each test wraps the call in try/catch so that:
 *   1. The stub-error assertion runs first and PASSES (confirming the Phase B stub)
 *   2. The behavior assertions run after and FAIL (proving no behavior yet)
 *   3. The test result is FAIL (not ERROR) — correct Phase B outcome
 *
 * Phase C: handleMessage is implemented. The try/catch still runs but the error
 * path is never hit; all behavior assertions PASS.
 *
 * IMPORTANT: do NOT remove the catch wrapper. Without it, vitest marks the
 * test as ERROR (unhandled exception) instead of FAIL (assertion failure).
 * The reviewer requires FAIL on assertions, not ERROR on exceptions.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CommentsPanelWebviewMessage,
  CommentsPanelHostMessage,
} from "../../panel/comments-webview-contract.js";
import { RuntimeMessageHandler } from "../../panel/comments-message-handler.js";

// ── Mock store ────────────────────────────────────────────────────────────────

interface MockStore {
  resolve: ReturnType<typeof vi.fn>;
  reopen: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  getAllThreads: ReturnType<typeof vi.fn>;
}
function createMockStore(): MockStore {
  return {
    resolve: vi.fn(),
    reopen: vi.fn(),
    delete: vi.fn(),
    reply: vi.fn(),
    getAllThreads: vi.fn().mockReturnValue([]),
  };
}

// ── Mock command dispatcher ────────────────────────────────────────────────────

interface MockCmdDispatcher {
  dispatched: Array<{ commandId: string; args: unknown[] }>;
  executeCommand: ReturnType<typeof vi.fn>;
}
function createMockCmdDispatcher(): MockCmdDispatcher {
  return {
    dispatched: [],
    executeCommand: vi.fn().mockImplementation(async () => {}),
  };
}

// ── Handler factory ──────────────────────────────────────────────────────────

function makeHandler(
  postMessage: (msg: CommentsPanelHostMessage) => Thenable<boolean> | undefined = vi.fn(),
  buildViewModel = () => ({
    generatedAt: new Date().toISOString(),
    filtersSummary: "",
    groupMode: "by-status" as const,
    groups: [],
    totalThreadCount: 0,
    openThreadCount: 0,
    resolvedThreadCount: 0,
  }),
  store: MockStore = createMockStore(),
  cmdDispatcher: MockCmdDispatcher = createMockCmdDispatcher(),
  refresh = vi.fn(),
) {
  return new RuntimeMessageHandler({
    postMessage,
    buildViewModel,
    getStore: () => store,
    executeCommand: (cmd, ...args) => {
      cmdDispatcher.dispatched.push({ commandId: cmd, args });
      return cmdDispatcher.executeCommand(cmd, ...args);
    },
    getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
    mutateUiState: () => {},
    refresh,
  });
}

/**
 * Direct call to handleMessage — Phase C implementation no longer throws.
 */
async function callHandler(handler: RuntimeMessageHandler, msg: CommentsPanelWebviewMessage) {
  await handler.handleMessage(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-07: invalid messages rejected safely — store not mutated
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-07: invalid messages rejected safely — store not mutated", () => {
  it("unknown message type: error posted with code 'unknown-message', no store mutation", async () => {
    const store = createMockStore();
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const unknownMsg = { type: "panel:unknown-xyz" } as CommentsPanelWebviewMessage;
    await callHandler(handler, unknownMsg);

    // No store mutations (unknown message type has no associated mutation)
    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.reopen).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();

    // Error posted with correct code
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "unknown-message",
        recoverable: true,
      }),
    );
  });

  it("panel:ready: panel:state posted with view model, no store mutation", async () => {
    const store = createMockStore();
    const postMessage = vi.fn();
    const mockModel = {
      generatedAt: new Date().toISOString(),
      filtersSummary: "",
      groupMode: "by-status" as const,
      groups: [],
      totalThreadCount: 0,
      openThreadCount: 0,
      resolvedThreadCount: 0,
    };
    const buildViewModel = vi.fn().mockReturnValue(mockModel);
    const handler = makeHandler(postMessage, buildViewModel, store);

    const readyMsg: CommentsPanelWebviewMessage = { type: "panel:ready", apiVersion: "1" };
    await callHandler(handler, readyMsg);

    // No store mutations
    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.reopen).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();

    // panel:state posted with the built model
    expect(postMessage).toHaveBeenCalledWith({
      type: "panel:state",
      model: expect.objectContaining({ groupMode: "by-status" }),
    });
  });

  it("panel:toggle-thread: no store mutation, no error posted", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const toggleMsg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      source: "mouse",
    };
    await callHandler(handler, toggleMsg);

    // No store mutation
    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.reopen).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();

    // No error for valid toggle
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
  });

  it("panel:toggle-group: no store mutation, no error posted", async () => {
    const store = createMockStore();
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const groupMsg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-group",
      groupId: "file:auth.ts",
      source: "keyboard",
    };
    await callHandler(handler, groupMsg);

    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.reopen).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-03/04: thread-scoped commands require threadId
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-03/04: thread-scoped commands require threadId", () => {
  it("panel:invoke-thread-command without threadId: missing-thread-id error, no store mutation", async () => {
    const store = createMockStore();
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const malformedMsg = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      source: "mouse",
      // threadId missing
    } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, malformedMsg);

    expect(store.resolve).not.toHaveBeenCalled();

    // Error must be missing-thread-id
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "missing-thread-id",
        recoverable: true,
      }),
    );
  });

  it("panel:invoke-thread-command with unknown threadId: thread-not-found error, no store mutation", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      threadId: "nonexistent-thread-xyz",
      source: "mouse",
    };
    await callHandler(handler, msg);

    expect(store.resolve).not.toHaveBeenCalled();

    // Error must be thread-not-found
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "thread-not-found",
        recoverable: true,
      }),
    );
  });

  it("panel:invoke-thread-command with valid threadId: executeCommand called, no error", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      threadId: "t-42",
      source: "keyboard",
    };
    await callHandler(handler, msg);

    // executeCommand called for valid thread with correct id and threadId
    expect(cmdDispatcher.dispatched).toContainEqual({
      commandId: "accordo.commentsPanel.resolve",
      args: expect.arrayContaining([expect.objectContaining({ id: "t-42" })]),
    });
    // No error for valid command
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
  });

  it("panel:invoke-thread-command dispatches correct command id with threadId", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      threadId: "t-42",
      source: "keyboard",
    };
    await callHandler(handler, msg);

    // Command dispatched with correct id + threadId
    expect(cmdDispatcher.dispatched).toContainEqual({
      commandId: "accordo.commentsPanel.resolve",
      args: expect.arrayContaining([expect.objectContaining({ id: "t-42" })]),
    });
  });

  it("panel:invoke-global-command does NOT include threadId", async () => {
    const store = createMockStore();
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-global-command",
      commandId: "accordo.commentsPanel.refresh",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Global command dispatched with empty args (no threadId)
    expect(cmdDispatcher.dispatched).toContainEqual({
      commandId: "accordo.commentsPanel.refresh",
      args: [],
    });
    // threadId must not appear in args
    expect(cmdDispatcher.dispatched[0].args.some((a: unknown) => typeof a === "string" && a.startsWith("t-"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-02/03: command scope enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-02/03: command scope enforcement", () => {
  it("all global command IDs dispatched with exact string, no threadId", async () => {
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage: vi.fn(),
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const globalIds = [
      "accordo.commentsPanel.refresh",
      "accordo.commentsPanel.filterByStatus",
      "accordo.commentsPanel.filterByIntent",
      "accordo.commentsPanel.clearFilters",
      "accordo.commentsPanel.groupBy",
      "accordo.commentsPanel.deleteAllBrowserComments",
    ] as const;

    for (const cmdId of globalIds) {
      cmdDispatcher.dispatched = [];
      const msg: CommentsPanelWebviewMessage = {
        type: "panel:invoke-global-command",
        commandId: cmdId,
        source: "mouse",
      };
      await callHandler(handler, msg);

      // Each command ID dispatched exactly once with empty args
      expect(cmdDispatcher.dispatched).toContainEqual({
        commandId: cmdId,
        args: [],
      });
    }
  });

  it("all thread command IDs dispatched with exact string plus thread context", async () => {
    const cmdDispatcher = createMockCmdDispatcher();
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-1" }, { id: "t-2" }, { id: "t-3" }]);
    const handler = new RuntimeMessageHandler({
      postMessage: vi.fn(),
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const threadCommands = [
      "accordo.commentsPanel.navigateToAnchor",
      "accordo.commentsPanel.resolve",
      "accordo.commentsPanel.reopen",
      "accordo.commentsPanel.reply",
      "accordo.commentsPanel.delete",
    ] as const;
    const threadIds = ["t-1", "t-2", "t-3"];

    for (let i = 0; i < threadCommands.length; i++) {
      cmdDispatcher.dispatched = [];
      const msg: CommentsPanelWebviewMessage = {
        type: "panel:invoke-thread-command",
        commandId: threadCommands[i],
        threadId: threadIds[i % threadIds.length],
        source: "keyboard",
      };
      await callHandler(handler, msg);

      // Thread command dispatched with correct id + thread object context.
      expect(cmdDispatcher.dispatched).toContainEqual({
        commandId: threadCommands[i],
        args: expect.arrayContaining([expect.objectContaining({ id: threadIds[i % threadIds.length] })]),
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-05/06: toggle messages are ephemeral UI state only
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-05/06: toggle messages are ephemeral UI state only", () => {
  it("panel:toggle-group: no error posted", async () => {
    const postMessage = vi.fn();
    const refresh = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), createMockStore(), createMockCmdDispatcher(), refresh);

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-group",
      groupId: "file:utils.ts",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // No error for valid toggle
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("panel:toggle-thread (valid threadId): no error posted", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const refresh = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store, createMockCmdDispatcher(), refresh);

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      source: "keyboard",
    };
    await callHandler(handler, msg);

    // No error for valid toggle
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("panel:toggle-thread (unknown threadId): thread-not-found error posted", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "unknown-thread-xyz",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Error must be thread-not-found
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "thread-not-found",
        recoverable: true,
      }),
    );
  });

it("panel:toggle-group (unknown groupId): no error posted (non-fatal)", async () => {
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), createMockStore());

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-group",
      groupId: "nonexistent-group-xyz",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // No error posted — toggle is non-fatal even for unknown group
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
    );
  });

  it("panel:toggle-group: no buildViewModel or postMessage called (ephemeral only, M45-WVC-06)", async () => {
    const buildViewModel = vi.fn().mockReturnValue({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 });
    const postMessage = vi.fn();
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel,
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => {
        const next = fn(uiStateContainer.current);
        uiStateContainer.current = next;
      },
      refresh: vi.fn(),
    });

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-group",
      groupId: "file:auth.ts",
      source: "keyboard",
    };
    await callHandler(handler, msg);

    // Toggle mutates UI state and asks the provider to refresh.
    expect(buildViewModel).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    // UI state was mutated
    expect(uiStateContainer.current.collapsedGroupIds.has("file:auth.ts")).toBe(true);
  });

  it("panel:toggle-thread: no buildViewModel or postMessage called (ephemeral only, M45-WVC-06)", async () => {
    const buildViewModel = vi.fn().mockReturnValue({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 });
    const postMessage = vi.fn();
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-99" }]);
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel,
      getStore: () => store,
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => {
        const next = fn(uiStateContainer.current);
        uiStateContainer.current = next;
      },
      refresh: vi.fn(),
    });

    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-99",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Toggle mutates UI state and asks the provider to refresh.
    expect(buildViewModel).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    // UI state was mutated (t-99 is now expanded)
    expect(uiStateContainer.current.expandedThreadIds.has("t-99")).toBe(true);
  });

  it("panel:ready uses current UI state (includes prior mutations)", async () => {
    const mockModel = { generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 };
    const buildViewModel = vi.fn().mockReturnValue(mockModel);
    const postMessage = vi.fn();
    // Pre-populate UI state with t-99 expanded and file:auth.ts collapsed
    const uiStateContainer = {
      current: {
        expandedThreadIds: new Set(["t-99"]),
        collapsedGroupIds: new Set(["file:auth.ts"]),
      },
    };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel,
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => {
        const next = fn(uiStateContainer.current);
        uiStateContainer.current = next;
      },
      refresh: vi.fn(),
    });

    // Send panel:ready and verify it uses the current UI state
    const readyMsg: CommentsPanelWebviewMessage = { type: "panel:ready", apiVersion: "1" };
    await callHandler(handler, readyMsg);

    // buildViewModel was called with current UI state
    expect(buildViewModel).toHaveBeenCalledWith(
      expect.objectContaining({
        expandedThreadIds: expect.any(Set),
        collapsedGroupIds: expect.any(Set),
      }),
    );
    // postMessage was called with panel:state (not panel:error)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:state" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-03: invalid command scope — must reject cross-scope dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-03: command scope enforcement — invalid scope rejected", () => {
  it("panel:invoke-global-command with thread command ID: invalid-command-scope error, no executeCommand", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    // A thread-scoped command sent via panel:invoke-global-command scope
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-global-command",
      commandId: "accordo.commentsPanel.navigateToAnchor",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Must NOT execute the command
    expect(cmdDispatcher.dispatched).toHaveLength(0);
    // Must post error with invalid-command-scope code
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "invalid-command-scope",
        recoverable: true,
      }),
    );
  });

  it("panel:invoke-thread-command with global command ID: invalid-command-scope error, no executeCommand", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    // A global command sent via panel:invoke-thread-command scope
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.clearFilters",
      threadId: "t-42",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Must NOT execute the command
    expect(cmdDispatcher.dispatched).toHaveLength(0);
    // Must post error with invalid-command-scope code
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "invalid-command-scope",
        recoverable: true,
      }),
    );
  });

  it("panel:invoke-thread-command with global command ID (unknown thread): invalid-command-scope takes precedence over thread-not-found", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const cmdDispatcher = createMockCmdDispatcher();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    // Global command via thread scope with nonexistent threadId — scope check happens first
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.refresh",
      threadId: "nonexistent-thread",
      source: "mouse",
    };
    await callHandler(handler, msg);

    // Must NOT execute the command
    expect(cmdDispatcher.dispatched).toHaveLength(0);
    // Must post invalid-command-scope (not thread-not-found)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "invalid-command-scope",
      }),
    );
    // Ensure it was NOT thread-not-found
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "thread-not-found" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-01: unknown message type produces unknown-message error code
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-01: unknown message type produces unknown-message error code", () => {
  it("completely unknown type: unknown-message error, no store mutation", async () => {
    const postMessage = vi.fn();
    const store = createMockStore();
    const handler = makeHandler(postMessage, vi.fn(), store);

    const msg = { type: "completely-unknown-type" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.reopen).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.reply).not.toHaveBeenCalled();

    // Error code must be unknown-message
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panel:error",
        code: "unknown-message",
        recoverable: true,
      }),
    );
  });
});

describe("panel:submit-reply", () => {
  it("calls the injected reply submitter with trimmed body and refreshes", async () => {
    const postMessage = vi.fn();
    const refresh = vi.fn();
    const submitReply = vi.fn().mockResolvedValue(undefined);
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: vi.fn(),
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh,
      submitReply,
    });

    await callHandler(handler, {
      type: "panel:submit-reply",
      threadId: "t-42",
      body: "  Inline reply  ",
      source: "keyboard",
    });

    expect(submitReply).toHaveBeenCalledWith("t-42", "Inline reply");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "panel:error" }));
  });

  it("rejects empty reply bodies without refreshing", async () => {
    const postMessage = vi.fn();
    const refresh = vi.fn();
    const submitReply = vi.fn().mockResolvedValue(undefined);
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => store,
      executeCommand: vi.fn(),
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh,
      submitReply,
    });

    await callHandler(handler, {
      type: "panel:submit-reply",
      threadId: "t-42",
      body: "   ",
      source: "mouse",
    });

    expect(submitReply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "panel:error", code: "invalid-payload" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M45-WVC-07: malformed/missing-field payloads → invalid-payload before later validation
// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WVC-07: malformed payloads rejected with invalid-payload before scope/thread checks", () => {
  it("panel:toggle-thread missing threadId: invalid-payload error, no UI mutation", async () => {
    const postMessage = vi.fn();
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => { uiStateContainer.current = fn(uiStateContainer.current); },
      refresh: vi.fn(),
    });

    const msg = { type: "panel:toggle-thread", source: "mouse" } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    // No UI state mutation occurred
    expect(uiStateContainer.current.expandedThreadIds.size).toBe(0);
    expect(uiStateContainer.current.collapsedGroupIds.size).toBe(0);
  });

  it("panel:toggle-thread invalid (non-string) threadId: invalid-payload error, no UI mutation", async () => {
    const postMessage = vi.fn();
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => { uiStateContainer.current = fn(uiStateContainer.current); },
      refresh: vi.fn(),
    });

    const msg = { type: "panel:toggle-thread", threadId: 123 as unknown, source: "mouse" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    expect(uiStateContainer.current.expandedThreadIds.size).toBe(0);
  });

  it("panel:toggle-group missing groupId: invalid-payload error, no UI mutation", async () => {
    const postMessage = vi.fn();
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => { uiStateContainer.current = fn(uiStateContainer.current); },
      refresh: vi.fn(),
    });

    const msg = { type: "panel:toggle-group", source: "mouse" } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    expect(uiStateContainer.current.collapsedGroupIds.size).toBe(0);
  });

  it("panel:toggle-group invalid (non-string) groupId: invalid-payload error, no UI mutation", async () => {
    const postMessage = vi.fn();
    const uiStateContainer = { current: { expandedThreadIds: new Set<string>(), collapsedGroupIds: new Set<string>() } };
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => uiStateContainer.current,
      mutateUiState: (fn) => { uiStateContainer.current = fn(uiStateContainer.current); },
      refresh: vi.fn(),
    });

    const msg = { type: "panel:toggle-group", groupId: false as unknown, source: "mouse" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    expect(uiStateContainer.current.collapsedGroupIds.size).toBe(0);
  });

  it("panel:invoke-global-command missing commandId: invalid-payload error, no executeCommand", async () => {
    const cmdDispatcher = createMockCmdDispatcher();
    const postMessage = vi.fn();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg = { type: "panel:invoke-global-command", source: "mouse" } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(cmdDispatcher.dispatched).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
  });

  it("panel:invoke-global-command invalid (non-string) commandId: invalid-payload error, no executeCommand", async () => {
    const cmdDispatcher = createMockCmdDispatcher();
    const postMessage = vi.fn();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg = { type: "panel:invoke-global-command", commandId: [] as unknown, source: "mouse" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(cmdDispatcher.dispatched).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
  });

  it("panel:invoke-thread-command missing commandId: invalid-payload error before missing-thread-id", async () => {
    const postMessage = vi.fn();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg = { type: "panel:invoke-thread-command", threadId: "t-42", source: "mouse" } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    // invalid-payload must come before missing-thread-id
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    // Must NOT have posted missing-thread-id
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "missing-thread-id" }),
    );
  });

  it("panel:invoke-thread-command missing threadId (with valid commandId): missing-thread-id error", async () => {
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), createMockStore());

    const msg = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      source: "mouse",
      // threadId missing
    } as unknown as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "missing-thread-id", recoverable: true }),
    );
  });

  it("panel:invoke-thread-command invalid (non-string) commandId: invalid-payload error, no executeCommand", async () => {
    const cmdDispatcher = createMockCmdDispatcher();
    const postMessage = vi.fn();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: (cmd, ...args) => {
        cmdDispatcher.dispatched.push({ commandId: cmd, args });
        return cmdDispatcher.executeCommand(cmd, ...args);
      },
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg = { type: "panel:invoke-thread-command", commandId: 42 as unknown, threadId: "t-42", source: "mouse" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(cmdDispatcher.dispatched).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
  });

  it("panel:invoke-thread-command invalid (non-string) threadId: invalid-payload error before thread-not-found", async () => {
    const postMessage = vi.fn();
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel: () => ({ generatedAt: "", filtersSummary: "", groupMode: "by-status" as const, groups: [], totalThreadCount: 0, openThreadCount: 0, resolvedThreadCount: 0 }),
      getStore: () => createMockStore(),
      executeCommand: vi.fn(),
      getUiState: () => ({ expandedThreadIds: new Set(), collapsedGroupIds: new Set() }),
      mutateUiState: () => {},
      refresh: vi.fn(),
    });

    const msg = { type: "panel:invoke-thread-command", commandId: "accordo.commentsPanel.resolve", threadId: null as unknown, source: "mouse" } as CommentsPanelWebviewMessage;
    await callHandler(handler, msg);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error", code: "invalid-payload", recoverable: true }),
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "thread-not-found" }),
    );
  });
});
