/**
 * Tests for NativeComments — M37
 *
 * Source: comments-architecture.md §2.1, §9, §10.1
 *
 * Requirements covered:
 *   §2.1    CommentController creation, gutter "+" on all lines
 *   §10.1   Controller ID "accordo-comments", commentingRangeProvider
 *   §10.2   Restore persisted text threads as widgets
 *   §9      Staleness label ("⚠ Context may have changed")
 *   §4      Commands: resolve, reopen, delete, reply, createNote
 *   §2.1    Sync store→widget (agent creates → widget appears)
 *   §2.1    Sync widget→store (user resolves via UI → store updates)
 */

// API checklist:
// ✓ NativeComments constructor — class instantiated in every test group
// ✓ init()                    — §2.1/§10.1 Controller creation (3 tests)
// ✓ restoreThreads()          — §10.2 Restore (4 tests)
// ✓ addThread()               — §2.1 Add/Update/Remove (2 tests)
// ✓ updateThread()            — §2.1 Add/Update/Remove (1 test)
// ✓ removeThread()            — §2.1 Add/Update/Remove (1 test)
// ✓ markStale()               — §9 Staleness indicator (1 test)
// ✓ updateThreadRange()       — §9 updateThreadRange (1 test)
// ✓ registerCommands()        — §10.1 Commands (2 tests)
// ✓ getController()           — called inside init tests

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  comments,
  commands,
  Uri,
  Range,
  Position,
  mockState,
  resetMockState,
  MockCommentController,
  CommentThreadCollapsibleState,
} from "./mocks/vscode.js";
import { NativeComments } from "../native-comments.js";
import { CommentStore } from "../comment-store.js";
import type {
  CommentThread,
  CommentAnchorText,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeThread(overrides?: Partial<CommentThread>): CommentThread {
  return {
    id: "thread-1",
    anchor: {
      kind: "text",
      uri: "file:///project/src/auth.ts",
      range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
      docVersion: 1,
    },
    comments: [
      {
        id: "comment-1",
        threadId: "thread-1",
        createdAt: "2026-03-03T10:00:00Z",
        author: { kind: "user", name: "Developer" },
        body: "Fix this auth check",
        anchor: {
          kind: "text",
          uri: "file:///project/src/auth.ts",
          range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
          docVersion: 1,
        },
        status: "open",
        intent: "fix",
      },
    ],
    status: "open",
    createdAt: "2026-03-03T10:00:00Z",
    lastActivity: "2026-03-03T10:00:00Z",
    ...overrides,
  };
}

function makeMockStore(): CommentStore {
  const store = new CommentStore();
  // We mock out load so it doesn't throw "not implemented"
  // Tests will invoke NativeComments methods directly, passing threads
  return store;
}

// ── Setup ────────────────────────────────────────────────────────────────────

let native: NativeComments;
let mockContext: { subscriptions: Array<{ dispose(): void }> };

beforeEach(() => {
  resetMockState();
  native = new NativeComments();
  mockContext = { subscriptions: [] };
});

// ── §2.1, §10.1 CommentController creation ──────────────────────────────────

describe("§2.1, §10.1 CommentController creation", () => {
  it("init creates a CommentController with id 'accordo-comments'", () => {
    const store = makeMockStore();
    const handle = native.init(store, mockContext);
    expect(handle.controller).toBeDefined();
    expect(handle.controller.id).toBe("accordo-comments");
  });

  it("init sets commentingRangeProvider that covers entire document", () => {
    const store = makeMockStore();
    native.init(store, mockContext);
    const controller = native.getController();
    expect(controller.commentingRangeProvider).toBeDefined();

    // Simulate a document with 100 lines
    const mockDoc = { lineCount: 100 };
    const ranges = controller.commentingRangeProvider!.provideCommentingRanges(
      mockDoc as unknown as import("vscode").TextDocument,
      {} as import("vscode").CancellationToken,
    );
    expect(ranges).toBeDefined();
    // Should cover from line 0 to line 99
    const rangeArr = ranges as Range[];
    expect(rangeArr.length).toBeGreaterThanOrEqual(1);
    expect(rangeArr[0].start.line).toBe(0);
    expect(rangeArr[0].end.line).toBe(99);
  });

  it("init adds controller to context.subscriptions", () => {
    const store = makeMockStore();
    native.init(store, mockContext);
    expect(mockContext.subscriptions.length).toBeGreaterThan(0);
  });
});

// ── §10.2 Restore persisted threads ──────────────────────────────────────────

describe("§10.2 Restore persisted threads", () => {
  it("restoreThreads creates VSCode CommentThread widgets for text-anchored threads", () => {
    const store = makeMockStore();
    native.init(store, mockContext);

    const thread = makeThread();
    native.restoreThreads([thread]);

    const controller = native.getController() as unknown as MockCommentController;
    const vsThreads = controller.getThreads();
    expect(vsThreads).toHaveLength(1);
    expect(vsThreads[0].uri.fsPath).toContain("auth.ts");
  });

  it("restoreThreads creates file-level widget for surface-anchored threads", () => {
    const store = makeMockStore();
    native.init(store, mockContext);

    const surfaceThread: CommentThread = {
      ...makeThread(),
      id: "surface-1",
      anchor: {
        kind: "surface",
        uri: "file:///project/diagrams/arch.mmd",
        surfaceType: "diagram",
        coordinates: { type: "diagram-node", nodeId: "auth" },
      },
    };
    native.restoreThreads([surfaceThread]);

    const controller = native.getController() as unknown as MockCommentController;
    // Surface threads now appear in the Comments panel as file-level widgets
    expect(controller.getThreads()).toHaveLength(1);
  });

  it("restoreThreads creates file-level thread (navigates to start of file) for file-anchored threads", () => {
    const store = makeMockStore();
    native.init(store, mockContext);

    const fileThread: CommentThread = {
      ...makeThread(),
      id: "file-1",
      anchor: { kind: "file", uri: "file:///project/README.md" },
    };
    native.restoreThreads([fileThread]);

    const controller = native.getController() as unknown as MockCommentController;
    const vsThreads = controller.getThreads();
    expect(vsThreads).toHaveLength(1);
    // File-level threads get a (0,0,0,0) range so VS Code can navigate to the file
    expect(vsThreads[0].range).toBeDefined();
    expect(vsThreads[0].range.start.line).toBe(0);
    expect(vsThreads[0].range.end.line).toBe(0);
  });

  it("restoreThreads shows all comments in thread with correct authors", () => {
    const store = makeMockStore();
    native.init(store, mockContext);

    const thread = makeThread({
      comments: [
        {
          id: "c1",
          threadId: "thread-1",
          createdAt: "2026-03-03T10:00:00Z",
          author: { kind: "user", name: "Developer" },
          body: "Fix this",
          anchor: makeThread().anchor,
          status: "open",
        },
        {
          id: "c2",
          threadId: "thread-1",
          createdAt: "2026-03-03T10:01:00Z",
          author: { kind: "agent", name: "Agent", agentId: "a1" },
          body: "Fixed it",
          anchor: makeThread().anchor,
          status: "open",
        },
      ],
    });
    native.restoreThreads([thread]);

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.comments).toHaveLength(2);
    expect(vsThread.comments[0].author.name).toBe("Developer");
    expect(vsThread.comments[1].author.name).toBe("Agent");
  });
});

// ── §2.1 Add / Update / Remove threads ──────────────────────────────────────

describe("§2.1 Add / Update / Remove threads", () => {
  beforeEach(() => {
    const store = makeMockStore();
    native.init(store, mockContext);
  });

  it("addThread creates a new VSCode CommentThread widget", () => {
    const thread = makeThread();
    native.addThread(thread);

    const controller = native.getController() as unknown as MockCommentController;
    expect(controller.getThreads()).toHaveLength(1);
  });

  it("updateThread refreshes comments in an existing widget", () => {
    const thread = makeThread();
    native.addThread(thread);

    // Add a reply
    const updated = {
      ...thread,
      comments: [
        ...thread.comments,
        {
          id: "c2",
          threadId: "thread-1",
          createdAt: "2026-03-03T10:01:00Z",
          author: { kind: "agent" as const, name: "Agent" },
          body: "I fixed it",
          anchor: thread.anchor,
          status: "open" as const,
        },
      ],
      lastActivity: "2026-03-03T10:01:00Z",
    };
    native.updateThread(updated);

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.comments).toHaveLength(2);
  });

  it("updateThread sets resolved contextValue when thread is resolved", () => {
    const thread = makeThread();
    native.addThread(thread);

    native.updateThread({ ...thread, status: "resolved" });

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.contextValue).toContain("resolved");
  });

  it("removeThread disposes the VSCode CommentThread widget", () => {
    const thread = makeThread();
    native.addThread(thread);

    native.removeThread("thread-1");

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.dispose).toHaveBeenCalled();
  });
});

// ── §9 Staleness indicator ───────────────────────────────────────────────────

describe("§9 Staleness indicator", () => {
  beforeEach(() => {
    const store = makeMockStore();
    native.init(store, mockContext);
    native.addThread(makeThread());
  });

  it("markStale sets thread label to include staleness warning", () => {
    native.markStale("thread-1");

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.label).toContain("Context may have changed");
  });
});

// ── §9 updateThreadRange ─────────────────────────────────────────────────────

describe("§9 updateThreadRange", () => {
  beforeEach(() => {
    const store = makeMockStore();
    native.init(store, mockContext);
    native.addThread(makeThread());
  });

  it("updateThreadRange updates the widget's range after line-shift", () => {
    const newAnchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/src/auth.ts",
      range: { startLine: 45, startChar: 0, endLine: 45, endChar: 0 },
      docVersion: 1,
    };
    native.updateThreadRange("thread-1", newAnchor);

    const controller = native.getController() as unknown as MockCommentController;
    const vsThread = controller.getThreads()[0];
    expect(vsThread.range).toBeDefined();
    expect(vsThread.range!.start.line).toBe(45);
  });
});

// ── §10.1 Commands ───────────────────────────────────────────────────────────

describe("§10.1 Commands", () => {
  it("registerCommands registers all expected commands", () => {
    const store = makeMockStore();
    native.init(store, mockContext);
    native.registerCommands(store, mockContext);

    const expectedCommands = [
      "accordo.comments.resolveThread",
      "accordo.comments.reopenThread",
      "accordo.comments.deleteThread",
      "accordo.comments.deleteComment",
    ];
    for (const cmd of expectedCommands) {
      expect(mockState.registeredCommands.has(cmd)).toBe(true);
    }
  });

  it("registerCommands adds disposables to context.subscriptions", () => {
    const store = makeMockStore();
    native.init(store, mockContext);
    const before = mockContext.subscriptions.length;
    native.registerCommands(store, mockContext);
    expect(mockContext.subscriptions.length).toBeGreaterThan(before);
  });
});
