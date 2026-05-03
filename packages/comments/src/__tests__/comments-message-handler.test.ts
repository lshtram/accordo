/**
 * comments-message-handler.test.ts
 *
 * Runtime validation tests for CommentsPanelWebviewMessage handler.
 * Validates M45-WVC-02, M45-WVC-09 contract requirements:
 *  - source is required on all toggle/invoke messages
 *  - apiVersion ("1") is required on panel:ready
 *  - Malformed messages fail with panel:error code "invalid-payload"
 *    before any state mutation, command execution, scope validation, or thread lookup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CommentsPanelHostMessage,
  CommentsPanelUiState,
  CommentsPanelViewModel,
} from "../panel/comments-webview-contract.js";

const makeDeps = () => {
  const postMessage = vi.fn<(_msg: CommentsPanelHostMessage) => Thenable<boolean> | undefined>();
  const buildViewModel = vi.fn<(_uiState: CommentsPanelUiState) => CommentsPanelViewModel>();
  const getStore = vi.fn(() => ({ getAllThreads: vi.fn(() => []) }));
  const executeCommand = vi.fn<(_cmd: string, ..._args: unknown[]) => Thenable<unknown>>();
  const getUiState = vi.fn<() => CommentsPanelUiState>(() => ({
    expandedThreadIds: new Set<string>(),
    collapsedGroupIds: new Set<string>(),
  }));
  const mutateUiState = vi.fn<(_fn: (_s: CommentsPanelUiState) => CommentsPanelUiState) => void>();
  const refresh = vi.fn<() => void>();

  return { postMessage, buildViewModel, getStore, executeCommand, getUiState, mutateUiState, refresh };
};

// ── helpers ───────────────────────────────────────────────────────────────────

const okMsg = (type: string, extras: Record<string, unknown> = {}) => ({
  type,
  ...extras,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseCall = (fn: ReturnType<typeof vi.fn>): any => {
  const calls = fn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
};

const expectInvalidPayloadError = (
  postMessage: ReturnType<typeof vi.fn>,
  expectedSubstring: string,
) => {
  const msg = parseCall(postMessage) as CommentsPanelHostMessage;
  expect(msg).toMatchObject({ type: "panel:error", code: "invalid-payload" });
  expect(msg.message).toContain(expectedSubstring);
};

const expectNoMutations = (
  mutateUiState: ReturnType<typeof vi.fn>,
  executeCommand: ReturnType<typeof vi.fn>,
  getStore: ReturnType<typeof vi.fn>,
) => {
  expect(mutateUiState).not.toHaveBeenCalled();
  expect(executeCommand).not.toHaveBeenCalled();
  expect(getStore).not.toHaveBeenCalled();
};

// ── panel:ready — apiVersion validation ─────────────────────────────────────

describe("panel:ready", () => {
  it("accepts apiVersion: '1'", async () => {
    const { postMessage, buildViewModel, getUiState } = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler({
      postMessage,
      buildViewModel,
      getStore: makeDeps().getStore,
      executeCommand: makeDeps().executeCommand,
      getUiState,
      mutateUiState: makeDeps().mutateUiState,
      refresh: makeDeps().refresh,
    });

    await handler.handleMessage(okMsg("panel:ready", { apiVersion: "1" }));

    const stateMsg = parseCall(postMessage) as CommentsPanelHostMessage;
    expect(stateMsg).toMatchObject({ type: "panel:state" });
  });

  it("rejects missing apiVersion", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:ready", { apiVersion: undefined }));

    expectInvalidPayloadError(deps.postMessage, "apiVersion");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects invalid apiVersion (not '1')", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:ready", { apiVersion: "2" }));

    expectInvalidPayloadError(deps.postMessage, "apiVersion");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects apiVersion: null", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:ready", { apiVersion: null }));

    expectInvalidPayloadError(deps.postMessage, "apiVersion");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });
});

// ── panel:toggle-thread — source validation ─────────────────────────────────

describe("panel:toggle-thread", () => {
  const validMsg = () => okMsg("panel:toggle-thread", { threadId: "thread-1", source: "mouse" });

  it("accepts source: 'mouse'", async () => {
    const deps = makeDeps();
    deps.getStore = vi.fn(() => ({ getAllThreads: () => [{ id: "thread-1" }] }));
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(validMsg());

    expect(deps.mutateUiState).toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it("accepts source: 'keyboard'", async () => {
    const deps = makeDeps();
    deps.getStore = vi.fn(() => ({ getAllThreads: () => [{ id: "thread-1" }] }));
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: "keyboard" }));

    expect(deps.mutateUiState).toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it("accepts source: 'programmatic'", async () => {
    const deps = makeDeps();
    deps.getStore = vi.fn(() => ({ getAllThreads: () => [{ id: "thread-1" }] }));
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: "programmatic" }));

    expect(deps.mutateUiState).toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects missing source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1" }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects invalid source value", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: "touch" }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects source: null", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: null }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects source: undefined", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: undefined }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });
});

// ── panel:toggle-group — source validation ───────────────────────────────────

describe("panel:toggle-group", () => {
  it("accepts valid source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-group", { groupId: "group-1", source: "mouse" }));

    expect(deps.mutateUiState).toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects missing source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-group", { groupId: "group-1" }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects invalid source value", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-group", { groupId: "group-1", source: "voice" }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects source: null", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-group", { groupId: "group-1", source: null }));

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });
});

// ── panel:invoke-global-command — source validation ───────────────────────────

describe("panel:invoke-global-command", () => {
  const validMsg = () =>
    okMsg("panel:invoke-global-command", {
      commandId: "accordo.commentsPanel.refresh",
      source: "keyboard",
    });

  it("accepts valid source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(validMsg());

    expect(deps.executeCommand).toHaveBeenCalledWith("accordo.commentsPanel.refresh");
    expect(deps.mutateUiState).not.toHaveBeenCalled();
  });

  it("rejects missing source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-global-command", { commandId: "accordo.commentsPanel.refresh" }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects invalid source value", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-global-command", { commandId: "accordo.commentsPanel.refresh", source: "gesture" }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects source: undefined", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-global-command", { commandId: "accordo.commentsPanel.refresh", source: undefined }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });
});

// ── panel:invoke-thread-command — source validation ──────────────────────────

describe("panel:invoke-thread-command", () => {
  const validMsg = () =>
    okMsg("panel:invoke-thread-command", {
      commandId: "accordo.commentsPanel.reply",
      threadId: "thread-1",
      source: "programmatic",
    });

  it("accepts valid source", async () => {
    const deps = makeDeps();
    deps.getStore = vi.fn(() => ({ getAllThreads: () => [{ id: "thread-1" }] }));
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(validMsg());

    expect(deps.executeCommand).toHaveBeenCalled();
    expect(deps.mutateUiState).not.toHaveBeenCalled();
  });

  it("rejects missing source", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-thread-command", {
        commandId: "accordo.commentsPanel.reply",
        threadId: "thread-1",
      }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects invalid source value", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-thread-command", {
        commandId: "accordo.commentsPanel.reply",
        threadId: "thread-1",
        source: "trackpad",
      }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });

  it("rejects source: null", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-thread-command", {
        commandId: "accordo.commentsPanel.reply",
        threadId: "thread-1",
        source: null,
      }),
    );

    expectInvalidPayloadError(deps.postMessage, "source");
    expectNoMutations(deps.mutateUiState, deps.executeCommand, deps.getStore);
  });
});

// ── No mutation on validation failure — integration check ────────────────────

describe("no mutation before validation passes", () => {
  it("panel:toggle-thread with invalid source does not touch getStore", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:toggle-thread", { threadId: "thread-1", source: "invalid" }));

    expect(deps.getStore).not.toHaveBeenCalled();
  });

  it("panel:invoke-global-command with invalid source does not execute command", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(
      okMsg("panel:invoke-global-command", { commandId: "accordo.commentsPanel.refresh", source: "bad" }),
    );

    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it("panel:ready with invalid apiVersion does not build view model", async () => {
    const deps = makeDeps();
    const { RuntimeMessageHandler } = await import("../panel/comments-message-handler.js");
    const handler = new RuntimeMessageHandler(deps);

    await handler.handleMessage(okMsg("panel:ready", { apiVersion: "0" }));

    expect(deps.buildViewModel).not.toHaveBeenCalled();
  });
});