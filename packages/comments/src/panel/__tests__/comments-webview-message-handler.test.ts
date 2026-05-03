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
      args: expect.arrayContaining(["t-42"]),
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
      args: expect.arrayContaining(["t-42"]),
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

  it("all thread command IDs dispatched with exact string plus threadId", async () => {
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

      // Thread command dispatched with correct id + threadId
      expect(cmdDispatcher.dispatched).toContainEqual({
        commandId: threadCommands[i],
        args: expect.arrayContaining([threadIds[i % threadIds.length]]),
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
    const handler = makeHandler(postMessage, vi.fn(), createMockStore());

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
  });

  it("panel:toggle-thread (valid threadId): no error posted", async () => {
    const store = createMockStore();
    store.getAllThreads = vi.fn().mockReturnValue([{ id: "t-42" }]);
    const postMessage = vi.fn();
    const handler = makeHandler(postMessage, vi.fn(), store);

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
      source: "keyboard",
    };
    await callHandler(handler, msg);

    // Unknown group is non-fatal — no error
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:error" }),
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