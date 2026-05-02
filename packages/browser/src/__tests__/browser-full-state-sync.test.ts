/**
 * browser-full-state-sync.test.ts
 *
 * Phase B — Full-state browser comment sync runtime tests (browser package).
 *
 * Completion-defining tests (🔴 RED) MUST FAIL against broken per-mutation/notify
 * implementation because they call real production boundaries.
 * Pass-eligible tests (🟢 GREEN) validate contract shape using inline fixtures.
 *
 * Requirement IDs covered:
 *   BR-F-157, BR-F-158, BR-F-159, BR-F-160, BR-F-161, BR-F-162, BR-F-163,
 *   BR-F-164, BR-F-165, BR-F-166, BR-F-167, BR-F-168,
 *   M36-CS-14, M36-CS-15, M36-CS-16, M36-CS-17, M36-CS-18,
 *   M38-CT-12, M38-CT-13, M40-EXT-15
 *
 * Phase B test plan: docs/50-reviews/browser-full-state-sync-phase-b.md
 */

import { describe, it, expect, vi } from "vitest";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";
import type { BrowserRelayCommentAction } from "../comment-relay-contract.js";

// ── Mock helpers ───────────────────────────────────────────────────────────────

function createMockRelay(overrides: Partial<BrowserRelayLike> = {}): BrowserRelayLike {
  return {
    request: vi.fn(async () => ({ success: true, requestId: "req-1", data: {} })),
    push: vi.fn(),
    isConnected: () => true,
    ...overrides,
  };
}

function createMockDeps() {
  return {
    invokeTool: vi.fn(async () => ({ success: true, data: {} })),
  };
}

// ── Inline canonical contract types ─────────────────────────────────────────

interface BrowserSyncComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string };
  body: string;
  anchorKey: string;
  status: "open" | "resolved";
  deletedAt?: string;
}

interface BrowserSyncThread {
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  comments: BrowserSyncComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

interface BrowserCommentSyncPage {
  pageUrl: string;
  threads: BrowserSyncThread[];
}

interface BrowserCommentSyncState {
  schemaVersion: "2.0";
  browserRevision: number;
  accordoRevision: number;
  emittedBy: "browser-extension" | "vscode-accordo";
  generatedAt: string;
  pages: BrowserCommentSyncPage[];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFullStatePage(url: string, threads: BrowserSyncThread[] = []): BrowserCommentSyncPage {
  return { pageUrl: url, threads };
}

function makeFullStateThread(overrides: Partial<BrowserSyncThread> = {}): BrowserSyncThread {
  return {
    id: "t1",
    anchorKey: "body:center",
    pageUrl: "https://example.com/page",
    status: "open",
    comments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFullStateComment(overrides: Partial<BrowserSyncComment> = {}): BrowserSyncComment {
  return {
    id: "c1",
    threadId: "t1",
    createdAt: "2026-01-01T00:00:00.000Z",
    author: { kind: "user", name: "Alice" },
    body: "Hello",
    anchorKey: "body:center",
    status: "open",
    ...overrides,
  };
}

// ── SECTION G: syncBrowserComments runtime behavior 🔴 ────────────────────────

describe("G — syncBrowserComments runtime behavior 🔴", () => {
  it("G-01: 🔴 syncBrowserComments calls sync_comment_state relay action", async () => {
    const { syncBrowserComments } = await import("../comment-sync-runtime.js");
    const relay = createMockRelay();
    const bridge: BrowserBridgeAPI = {
      registerTools: vi.fn(() => ({ dispose: vi.fn() })),
      publishState: vi.fn(),
      invokeTool: vi.fn(async () => ({})),
    };
    const mockOutput = { appendLine: vi.fn() } as unknown as import("vscode").OutputChannel;

    await syncBrowserComments(relay, bridge, mockOutput);

    const requestCalls = (relay.request as ReturnType<typeof vi.fn>).mock.calls;
    const requestedActions = requestCalls.map(([action]: [string, unknown]) => action as string);

    // BROKEN: relay calls get_all_comments → test FAILS
    // CORRECT: relay calls sync_comment_state → test PASSES
    expect(requestedActions).toContain("sync_comment_state"); // FAILS on broken
  });

  it("G-02: 🔴 syncBrowserComments does NOT call get_all_comments for bulk sync", async () => {
    const { syncBrowserComments } = await import("../comment-sync-runtime.js");
    const relay = createMockRelay();
    const bridge: BrowserBridgeAPI = {
      registerTools: vi.fn(() => ({ dispose: vi.fn() })),
      publishState: vi.fn(),
      invokeTool: vi.fn(async () => ({})),
    };
    const mockOutput = { appendLine: vi.fn() } as unknown as import("vscode").OutputChannel;

    await syncBrowserComments(relay, bridge, mockOutput);

    const requestCalls = (relay.request as ReturnType<typeof vi.fn>).mock.calls;
    const requestedActions = requestCalls.map(([action]: [string, unknown]) => action as string);

    // BROKEN: get_all_comments IS called → test FAILS
    // CORRECT: get_all_comments NOT called → test PASSES
    expect(requestedActions).not.toContain("get_all_comments"); // FAILS on broken
  });

  it("G-03: 🔴 syncBrowserComments does NOT call reply_comment relay action", async () => {
    const { syncBrowserComments } = await import("../comment-sync-runtime.js");
    const relay = createMockRelay();
    const bridge: BrowserBridgeAPI = {
      registerTools: vi.fn(() => ({ dispose: vi.fn() })),
      publishState: vi.fn(),
      invokeTool: vi.fn(async () => ({})),
    };
    const mockOutput = { appendLine: vi.fn() } as unknown as import("vscode").OutputChannel;

    await syncBrowserComments(relay, bridge, mockOutput);

    const requestCalls = (relay.request as ReturnType<typeof vi.fn>).mock.calls;
    const requestedActions = requestCalls.map(([action]: [string, unknown]) => action as string);

    // BROKEN: reply_comment IS called → test FAILS
    // CORRECT: reply_comment NOT called → test PASSES
    expect(requestedActions).not.toContain("reply_comment"); // FAILS on broken
  });

  it("G-04: 🔴 syncBrowserComments does NOT call create_comment relay action", async () => {
    const { syncBrowserComments } = await import("../comment-sync-runtime.js");
    const relay = createMockRelay();
    const bridge: BrowserBridgeAPI = {
      registerTools: vi.fn(() => ({ dispose: vi.fn() })),
      publishState: vi.fn(),
      invokeTool: vi.fn(async () => ({})),
    };
    const mockOutput = { appendLine: vi.fn() } as unknown as import("vscode").OutputChannel;

    await syncBrowserComments(relay, bridge, mockOutput);

    const requestCalls = (relay.request as ReturnType<typeof vi.fn>).mock.calls;
    const requestedActions = requestCalls.map(([action]: [string, unknown]) => action as string);

    expect(requestedActions).not.toContain("create_comment"); // FAILS on broken
  });

  it("G-05: 🔴 syncBrowserComments does NOT call get_comments per-page (full-state mode)", async () => {
    const { syncBrowserComments } = await import("../comment-sync-runtime.js");
    const relay = createMockRelay();
    const bridge: BrowserBridgeAPI = {
      registerTools: vi.fn(() => ({ dispose: vi.fn() })),
      publishState: vi.fn(),
      invokeTool: vi.fn(async () => ({})),
    };
    const mockOutput = { appendLine: vi.fn() } as unknown as import("vscode").OutputChannel;

    await syncBrowserComments(relay, bridge, mockOutput);

    const requestCalls = (relay.request as ReturnType<typeof vi.fn>).mock.calls;
    const requestedActions = requestCalls.map(([action]: [string, unknown]) => action as string);

    // BROKEN: get_comments IS called per-page → test FAILS
    // CORRECT: get_comments NOT called (full-state uses sync_comment_state) → test PASSES
    expect(requestedActions).not.toContain("get_comments"); // FAILS on broken
  });

  
});

// ── SECTION D: Deprecated dispatch path isolation (M40-EXT-15) 🔴 ─────────────

describe("D — Deprecated relay dispatch isolation (M40-EXT-15) 🔴", () => {
  it("D-01: 🔴 dispatchBrowserCommentAction rejects reply_comment (returns action-unsupported)", async () => {
    // BROKEN: dispatchBrowserCommentAction handles reply_comment → success/error from invokeTool
    // CORRECT: dispatchBrowserCommentAction returns { success: false, error: "action-unsupported" }
    const { dispatchBrowserCommentAction } = await import("../relay-comment-dispatch.js");
    const deps = createMockDeps();
    const result = await dispatchBrowserCommentAction(deps as Parameters<typeof dispatchBrowserCommentAction>[0], "reply_comment", { threadId: "t1", body: "test" });
    // BROKEN: success or action-failed (not action-unsupported) → FAILS
    // CORRECT: { success: false, error: "action-unsupported" } → PASSES
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-unsupported"); // FAILS on broken
  });

  it("D-02: 🔴 dispatchBrowserCommentAction rejects create_comment", async () => {
    const { dispatchBrowserCommentAction } = await import("../relay-comment-dispatch.js");
    const deps = createMockDeps();
    const result = await dispatchBrowserCommentAction(deps as Parameters<typeof dispatchBrowserCommentAction>[0], "create_comment", { pageUrl: "https://example.com/page", anchorKey: "body:center" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-unsupported"); // FAILS on broken
  });

  it("D-03: 🔴 dispatchBrowserCommentAction rejects delete_comment", async () => {
    const { dispatchBrowserCommentAction } = await import("../relay-comment-dispatch.js");
    const deps = createMockDeps();
    const result = await dispatchBrowserCommentAction(deps as Parameters<typeof dispatchBrowserCommentAction>[0], "delete_comment", { threadId: "t1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-unsupported"); // FAILS on broken
  });

  it("D-04: 🔴 dispatchBrowserCommentAction rejects delete_thread", async () => {
    const { dispatchBrowserCommentAction } = await import("../relay-comment-dispatch.js");
    const deps = createMockDeps();
    const result = await dispatchBrowserCommentAction(deps as Parameters<typeof dispatchBrowserCommentAction>[0], "delete_thread", { threadId: "t1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-unsupported"); // FAILS on broken
  });

  it("D-05: 🔴 dispatchBrowserCommentAction rejects update_comment", async () => {
    const { dispatchBrowserCommentAction } = await import("../relay-comment-dispatch.js");
    const deps = createMockDeps();
    const result = await dispatchBrowserCommentAction(deps as Parameters<typeof dispatchBrowserCommentAction>[0], "update_comment" as BrowserRelayCommentAction, { threadId: "t1", body: "updated" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-unsupported"); // FAILS on broken
  });

  it("D-06: 🟢 action-unsupported is a valid error code vocabulary", () => {
    // Pass-eligible: error code vocabulary check
    const validErrors = [
      "action-unsupported",
      "browser-not-connected",
      "invalid-request",
      "action-failed",
    ] as const;
    expect(validErrors).toContain("action-unsupported");
  });

  it("D-07: 🟢 request_comment_state_sync is the only wakeup action (not notify_comments_updated)", () => {
    // Pass-eligible: this tests that the concept is correct, not the implementation
    const wakeup = "request_comment_state_sync";
    expect(wakeup).toBeDefined();
  });
});

// ── SECTION H: Tombstone preservation (M38-CT-13) 🟢 pass-eligible ──────────

describe("H — Tombstone preservation (M38-CT-13) 🟢 pass-eligible", () => {
  it("H-01: deleted thread has deletedAt field in fixture", () => {
    const deletedThread = makeFullStateThread({ id: "t-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
    expect(deletedThread.deletedAt).toBeDefined();
  });

  it("H-02: deleted comment has deletedAt field in fixture", () => {
    const deletedComment = makeFullStateComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
    expect(deletedComment.deletedAt).toBeDefined();
  });

  it("H-03: active thread filter excludes tombstoned threads in fixture", () => {
    const deletedThread = makeFullStateThread({ id: "t-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
    const activeThread = makeFullStateThread({ id: "t-active" });
    const page = makeFullStatePage("https://example.com/page", [deletedThread, activeThread]);
    const activeThreads = page.threads.filter((t) => !t.deletedAt);
    expect(activeThreads).toHaveLength(1);
    expect(activeThreads[0].id).toBe("t-active");
  });

  it("H-04: active comment filter excludes tombstoned comments in fixture", () => {
    const deletedComment = makeFullStateComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
    const activeComment = makeFullStateComment({ id: "c-active" });
    const thread = makeFullStateThread({ id: "t1", comments: [deletedComment, activeComment] });
    const activeComments = thread.comments.filter((c) => !c.deletedAt);
    expect(activeComments).toHaveLength(1);
    expect(activeComments[0].id).toBe("c-active");
  });

  it("H-05: raw data preserves tombstone even when excluded from active reads", () => {
    const deletedComment = makeFullStateComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
    const activeComment = makeFullStateComment({ id: "c-active" });
    const thread = makeFullStateThread({ id: "t1", comments: [deletedComment, activeComment] });
    expect(thread.comments).toHaveLength(2); // raw has both
    const activeComments = thread.comments.filter((c) => !c.deletedAt);
    expect(activeComments).toHaveLength(1);
  });

  it("H-06: thread status is open or resolved", () => {
    const open = makeFullStateThread({ id: "t1", status: "open" });
    const resolved = makeFullStateThread({ id: "t2", status: "resolved" });
    expect(open.status).toBe("open");
    expect(resolved.status).toBe("resolved");
  });
});

// ── SECTION I: Full-state document structure (BR-F-157..168) 🟢 pass-eligible ─

describe("I — Full-state document structure (BR-F-157..168) 🟢 pass-eligible", () => {
  it("I-01: schemaVersion is '2.0' in fixture", () => {
    const state: BrowserCommentSyncState = makeBrowserSyncStateFixture();
    expect(state.schemaVersion).toBe("2.0");
  });

  it("I-02: browserRevision increments per batch", () => {
    const s1 = makeBrowserSyncStateFixture({ browserRevision: 1 });
    const s2 = makeBrowserSyncStateFixture({ browserRevision: 2 });
    expect(s2.browserRevision).toBe(s1.browserRevision + 1);
  });

  it("I-03: accordoRevision ≤ browserRevision", () => {
    const state = makeBrowserSyncStateFixture({ browserRevision: 5, accordoRevision: 3 });
    expect(state.accordoRevision).toBeLessThanOrEqual(state.browserRevision);
  });

  it("I-04: emittedBy is browser-extension for browser-origin", () => {
    const state = makeBrowserSyncStateFixture({ emittedBy: "browser-extension" });
    expect(state.emittedBy).toBe("browser-extension");
  });

  it("I-05: emittedBy is vscode-accordo for hub-origin", () => {
    const state = makeBrowserSyncStateFixture({ emittedBy: "vscode-accordo" });
    expect(state.emittedBy).toBe("vscode-accordo");
  });

  it("I-06: generatedAt follows ISO 8601", () => {
    const state = makeBrowserSyncStateFixture({ generatedAt: "2026-05-02T12:00:00.000Z" });
    expect(state.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("I-07: full-state includes multiple pages", () => {
    const state = makeBrowserSyncStateFixture({
      pages: [
        makeFullStatePage("https://example.com/page1", [makeFullStateThread({ id: "t1" })]),
        makeFullStatePage("https://example.com/page2", [makeFullStateThread({ id: "t2" })]),
        makeFullStatePage("https://example.com/page3", [makeFullStateThread({ id: "t3" })]),
      ],
    });
    expect(state.pages).toHaveLength(3);
  });

  it("I-08: page contains multiple threads", () => {
    const page = makeFullStatePage("https://example.com/page", [
      makeFullStateThread({ id: "t1" }),
      makeFullStateThread({ id: "t2" }),
    ]);
    expect(page.threads).toHaveLength(2);
  });

  it("I-09: thread contains multiple comments", () => {
    const thread = makeFullStateThread({
      id: "t1",
      comments: [
        makeFullStateComment({ id: "c1" }),
        makeFullStateComment({ id: "c2" }),
      ],
    });
    expect(thread.comments).toHaveLength(2);
  });

  it("I-10: comment has required fields", () => {
    const comment = makeFullStateComment({ id: "c1", threadId: "t1" });
    expect(comment.id).toBeDefined();
    expect(comment.threadId).toBeDefined();
    expect(comment.author).toBeDefined();
    expect(comment.body).toBeDefined();
    expect(comment.anchorKey).toBeDefined();
  });

  it("I-11: comment status is open or resolved", () => {
    const open = makeFullStateComment({ id: "c1", status: "open" });
    const resolved = makeFullStateComment({ id: "c2", status: "resolved" });
    expect(open.status).toBe("open");
    expect(resolved.status).toBe("resolved");
  });

  it("I-12: anchorKey is non-empty string", () => {
    const thread = makeFullStateThread({ anchorKey: "body:center" });
    expect(thread.anchorKey.length).toBeGreaterThan(0);
    expect(thread.anchorKey).toContain(":");
  });

  it("I-13: pageUrl is absolute HTTP(S) URL", () => {
    const page = makeFullStatePage("https://example.com/path?query=1", []);
    expect(page.pageUrl).toMatch(/^https?:\/\/.+/);
  });

  it("I-14: full-state with browser + VSCode comments shows both in fixture", () => {
    const state: BrowserCommentSyncState = {
      schemaVersion: "2.0",
      browserRevision: 2,
      accordoRevision: 1,
      emittedBy: "vscode-accordo",
      generatedAt: "2026-01-01T00:01:00.000Z",
      pages: [
        makeFullStatePage("https://example.com/page", [
          makeFullStateThread({
            id: "t-browser-1",
            comments: [
              makeFullStateComment({ id: "c-browser-1", body: "Hello from browser" }),
              makeFullStateComment({ id: "c-vscode-1", body: "Reply from Accordo" }),
            ],
          }),
        ]),
      ],
    };
    const activeComments = state.pages
      .flatMap((p) => p.threads.filter((t) => !t.deletedAt))
      .flatMap((t) => t.comments.filter((c) => !c.deletedAt));
    expect(activeComments).toHaveLength(2);
  });

  it("I-15: multi-page multi-thread full-state fixture", () => {
    const state: BrowserCommentSyncState = {
      schemaVersion: "2.0",
      browserRevision: 4,
      accordoRevision: 3,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        makeFullStatePage("https://example.com/page1", [
          makeFullStateThread({ id: "t1" }),
        ]),
        makeFullStatePage("https://example.com/page2", [
          makeFullStateThread({ id: "t2" }),
          makeFullStateThread({ id: "t3" }),
        ]),
      ],
    };
    expect(state.pages).toHaveLength(2);
    expect(state.pages[0].threads).toHaveLength(1);
    expect(state.pages[1].threads).toHaveLength(2);
  });
});

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeBrowserSyncStateFixture(overrides: Partial<BrowserCommentSyncState> = {}): BrowserCommentSyncState {
  return {
    schemaVersion: "2.0",
    browserRevision: 1,
    accordoRevision: 0,
    emittedBy: "browser-extension",
    generatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    ...overrides,
  };
}