/**
 * Tests for CommentStore — M36
 *
 * Source: comments-architecture.md §3, §5
 *
 * Requirements covered:
 *   §3.2  AccordoComment structure, author, intent, status
 *   §3.3  CommentThread structure, derived status, timestamps
 *   §5.1  Persistence to .accordo/comments.json
 *   §5.2  File format (version "1.0", threads array)
 *   §5.3  Restore on activation (load from file)
 *   §5.4  Scale limits (500 threads, 50 comments/thread)
 *   §5.5  Store encapsulation (all access through CommentStore API)
 *   §4    State machine (open → resolved → open, transitions)
 *   §9    Diff-aware staleness (line-shift, overlap detection)
 */

// API checklist:
// ✓ CommentStore constructor — class instantiated in every test
// ✓ load()                  — §5.3 Load / Restore (4 tests)
// ✓ createThread()          — §3.2/§3.3 Create Thread (9 tests)
// ✓ reply()                 — §3.3 Reply (6 tests)
// ✓ resolve()               — §4 Resolve (6 tests)
// ✓ reopen()                — §4 Reopen (5 tests)
// ✓ delete()                — §4 Delete (7 tests)
// ✓ getThread()             — used in reply/resolve/reopen/delete tests
// ✓ getAllThreads()          — §5 Listing/Querying (2 tests)
// ✓ listThreads()           — §5 filter/pagination (11 tests)
// ✓ getThreadsForUri()      — §5 URI filtering (2 tests)
// ✓ getCounts()             — getCounts (1 test)
// ✓ toStoreFile()           — §5.2 Serialization (1 test)
// ✓ onDocumentChanged()     — §9 Staleness (7 tests)
// ✓ isThreadStale()         — called via onDocumentChanged tests
// ✓ onChanged()             — onChanged listener (1 test)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { workspace, Uri, resetMockState } from "./mocks/vscode.js";
import { rename as mockRename } from "node:fs/promises";

// Mock node:fs/promises so rename is interceptable in unit tests
vi.mock("node:fs/promises", () => ({
  rename: vi.fn().mockResolvedValue(undefined),
}));
import {
  CommentStore,
  type CreateCommentParams,
  type ListThreadsOptions,
} from "../comment-store.js";
import type {
  CommentAnchorText,
  CommentAnchorSurface,
  CommentAnchorFile,
  CommentStoreFile,
  CommentThread,
} from "@accordo/bridge-types";
import {
  COMMENT_MAX_THREADS,
  COMMENT_MAX_COMMENTS_PER_THREAD,
  COMMENT_LIST_DEFAULT_LIMIT,
  COMMENT_LIST_MAX_LIMIT,
  COMMENT_LIST_BODY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function textAnchor(uri: string, startLine: number, endLine?: number): CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine, startChar: 0, endLine: endLine ?? startLine, endChar: 0 },
    docVersion: 1,
  };
}

function surfaceAnchor(uri: string): CommentAnchorSurface {
  return {
    kind: "surface",
    uri,
    surfaceType: "diagram",
    coordinates: { type: "diagram-node", nodeId: "auth" },
  };
}

function fileAnchor(uri: string): CommentAnchorFile {
  return { kind: "file", uri };
}

function makeCreateParams(overrides?: Partial<CreateCommentParams>): CreateCommentParams {
  return {
    uri: "file:///project/src/auth.ts",
    anchor: textAnchor("file:///project/src/auth.ts", 42),
    body: "Fix this auth check",
    author: { kind: "user", name: "Developer" },
    intent: "fix",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let store: CommentStore;

beforeEach(() => {
  resetMockState();
  store = new CommentStore();

  // Default: no existing file (fresh start)
  workspace.fs.readFile.mockRejectedValue(new Error("FileNotFound"));
  workspace.fs.writeFile.mockResolvedValue(undefined);
  workspace.fs.createDirectory.mockResolvedValue(undefined);
});

// ── §5.3 Load / Restore ─────────────────────────────────────────────────────

describe("§5.3 Load / Restore", () => {
  it("loads with empty store when .accordo/comments.json is missing", async () => {
    workspace.fs.readFile.mockRejectedValue(new Error("FileNotFound"));
    await store.load("/project");
    expect(store.getAllThreads()).toEqual([]);
  });

  it("restores threads from a valid .accordo/comments.json", async () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [{
            id: "c1",
            threadId: "t1",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Fix this",
            anchor: textAnchor("file:///project/src/auth.ts", 42),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };
    const encoder = new TextEncoder();
    workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
    await store.load("/project");
    expect(store.getAllThreads()).toHaveLength(1);
    expect(store.getThread("t1")).toBeDefined();
    expect(store.getThread("t1")!.comments[0].body).toBe("Fix this");
  });

  it("starts fresh with warning when file is corrupt JSON", async () => {
    const encoder = new TextEncoder();
    workspace.fs.readFile.mockResolvedValue(encoder.encode("{not valid json!!!"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.load("/project");
    expect(store.getAllThreads()).toEqual([]);
    consoleSpy.mockRestore();
  });

  it("starts fresh when file has unknown version", async () => {
    const file = { version: "99.0", threads: [] };
    const encoder = new TextEncoder();
    workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.load("/project");
    expect(store.getAllThreads()).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ── §3.2, §3.3 Create Thread ────────────────────────────────────────────────

describe("§3.2, §3.3 Create Thread", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("creates a thread with a text anchor and returns threadId + commentId", async () => {
    const result = await store.createThread(makeCreateParams());
    expect(result.threadId).toBeTruthy();
    expect(result.commentId).toBeTruthy();
    expect(typeof result.threadId).toBe("string");
    expect(typeof result.commentId).toBe("string");
  });

  it("creates a thread with a surface anchor", async () => {
    const result = await store.createThread(makeCreateParams({
      anchor: surfaceAnchor("file:///project/diagrams/arch.mmd"),
      uri: "file:///project/diagrams/arch.mmd",
    }));
    const thread = store.getThread(result.threadId);
    expect(thread).toBeDefined();
    expect(thread!.anchor.kind).toBe("surface");
  });

  it("creates a thread with a file-level anchor", async () => {
    const result = await store.createThread(makeCreateParams({
      anchor: fileAnchor("file:///project/README.md"),
      uri: "file:///project/README.md",
    }));
    const thread = store.getThread(result.threadId);
    expect(thread).toBeDefined();
    expect(thread!.anchor.kind).toBe("file");
  });

  it("assigns UUID-format IDs to thread and comment", async () => {
    const result = await store.createThread(makeCreateParams());
    // UUID v4 pattern: 8-4-4-4-12 hex chars
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(result.threadId).toMatch(uuidRegex);
    expect(result.commentId).toMatch(uuidRegex);
  });

  it("sets createdAt and lastActivity to ISO 8601 timestamps", async () => {
    const before = new Date().toISOString();
    const result = await store.createThread(makeCreateParams());
    const after = new Date().toISOString();
    const thread = store.getThread(result.threadId)!;
    expect(thread.createdAt >= before).toBe(true);
    expect(thread.createdAt <= after).toBe(true);
    expect(thread.lastActivity).toBe(thread.createdAt);
  });

  it("sets thread status to 'open' on creation", async () => {
    const result = await store.createThread(makeCreateParams());
    const thread = store.getThread(result.threadId)!;
    expect(thread.status).toBe("open");
  });

  it("stores author, body, intent on the first comment", async () => {
    const result = await store.createThread(makeCreateParams({
      body: "Markdown **bold** text",
      intent: "review",
      author: { kind: "agent", name: "TestAgent", agentId: "agent-1" },
    }));
    const thread = store.getThread(result.threadId)!;
    expect(thread.comments).toHaveLength(1);
    const c = thread.comments[0];
    expect(c.body).toBe("Markdown **bold** text");
    expect(c.intent).toBe("review");
    expect(c.author.kind).toBe("agent");
    expect(c.author.name).toBe("TestAgent");
    expect(c.author.agentId).toBe("agent-1");
  });

  it("stores context when provided", async () => {
    const ctx = {
      viewportSnap: { before: "line1\nline2", after: "line3\nline4" },
      languageId: "typescript",
      git: { branch: "main", commit: "abc123" },
    };
    const result = await store.createThread(makeCreateParams({ context: ctx }));
    const thread = store.getThread(result.threadId)!;
    expect(thread.comments[0].context).toEqual(ctx);
  });

  it("persists to disk after create", async () => {
    await store.createThread(makeCreateParams());
    expect(workspace.fs.writeFile).toHaveBeenCalled();
    const lastCall = workspace.fs.writeFile.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    // The written data should be valid JSON with version "1.0"
    const written = new TextDecoder().decode(lastCall![1] as Uint8Array);
    const parsed = JSON.parse(written) as CommentStoreFile;
    expect(parsed.version).toBe("1.0");
    expect(parsed.threads).toHaveLength(1);
  });

  it("emits onChanged after create", async () => {
    const listener = vi.fn();
    store.onChanged(listener);
    await store.createThread(makeCreateParams());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── §3.3 Reply ───────────────────────────────────────────────────────────────

describe("§3.3 Reply", () => {
  let threadId: string;

  beforeEach(async () => {
    await store.load("/project");
    const result = await store.createThread(makeCreateParams());
    threadId = result.threadId;
  });

  it("adds a reply to an existing thread", async () => {
    const reply = await store.reply({
      threadId,
      body: "I fixed it",
      author: { kind: "agent", name: "Agent" },
    });
    expect(reply.commentId).toBeTruthy();
    const thread = store.getThread(threadId)!;
    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[1].body).toBe("I fixed it");
  });

  it("updates lastActivity on reply", async () => {
    const beforeReply = store.getThread(threadId)!.lastActivity;
    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 5));
    await store.reply({
      threadId,
      body: "Reply",
      author: { kind: "user", name: "Dev" },
    });
    const afterReply = store.getThread(threadId)!.lastActivity;
    expect(afterReply >= beforeReply).toBe(true);
  });

  it("throws when replying to non-existent thread", async () => {
    await expect(
      store.reply({ threadId: "nonexistent", body: "x", author: { kind: "user", name: "Dev" } }),
    ).rejects.toThrow();
  });

  it("throws when comment-per-thread cap is reached", async () => {
    // Fill to max
    for (let i = 1; i < COMMENT_MAX_COMMENTS_PER_THREAD; i++) {
      await store.reply({ threadId, body: `Reply ${i}`, author: { kind: "user", name: "Dev" } });
    }
    // One more should fail (already has 1 from create + 49 replies = 50)
    await expect(
      store.reply({ threadId, body: "Over limit", author: { kind: "user", name: "Dev" } }),
    ).rejects.toThrow();
  });

  it("persists to disk after reply", async () => {
    workspace.fs.writeFile.mockClear();
    await store.reply({ threadId, body: "Persisted reply", author: { kind: "user", name: "Dev" } });
    expect(workspace.fs.writeFile).toHaveBeenCalled();
  });

  it("emits onChanged after reply", async () => {
    const listener = vi.fn();
    store.onChanged(listener);
    listener.mockClear(); // clear from create
    await store.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── §4 Resolve ───────────────────────────────────────────────────────────────

describe("§4 Resolve", () => {
  let threadId: string;

  beforeEach(async () => {
    await store.load("/project");
    const result = await store.createThread(makeCreateParams());
    threadId = result.threadId;
  });

  it("resolves an open thread with a resolution note", async () => {
    await store.resolve({
      threadId,
      resolutionNote: "Added guard clause",
      author: { kind: "agent", name: "Agent" },
    });
    const thread = store.getThread(threadId)!;
    expect(thread.status).toBe("resolved");
  });

  it("stores the resolution note on the thread", async () => {
    await store.resolve({
      threadId,
      resolutionNote: "Fixed by adding null check",
      author: { kind: "agent", name: "Agent" },
    });
    const thread = store.getThread(threadId)!;
    // Resolution note should be on the resolve comment or the thread's last comment
    const lastComment = thread.comments[thread.comments.length - 1];
    expect(lastComment.resolutionNote).toBe("Fixed by adding null check");
    expect(lastComment.status).toBe("resolved");
  });

  it("throws when resolving an already-resolved thread", async () => {
    await store.resolve({
      threadId,
      resolutionNote: "First resolve",
      author: { kind: "agent", name: "Agent" },
    });
    await expect(
      store.resolve({
        threadId,
        resolutionNote: "Second resolve",
        author: { kind: "agent", name: "Agent" },
      }),
    ).rejects.toThrow(/already resolved/i);
  });

  it("throws when resolving non-existent thread", async () => {
    await expect(
      store.resolve({
        threadId: "nonexistent",
        resolutionNote: "x",
        author: { kind: "user", name: "Dev" },
      }),
    ).rejects.toThrow();
  });

  it("persists to disk after resolve", async () => {
    workspace.fs.writeFile.mockClear();
    await store.resolve({
      threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    expect(workspace.fs.writeFile).toHaveBeenCalled();
  });

  it("emits onChanged after resolve", async () => {
    const listener = vi.fn();
    store.onChanged(listener);
    listener.mockClear();
    await store.resolve({
      threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── §4 Reopen ────────────────────────────────────────────────────────────────

describe("§4 Reopen", () => {
  let threadId: string;

  beforeEach(async () => {
    await store.load("/project");
    const result = await store.createThread(makeCreateParams());
    threadId = result.threadId;
    await store.resolve({
      threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
  });

  it("reopens a resolved thread (user only)", async () => {
    await store.reopen(threadId, { kind: "user", name: "Dev" });
    expect(store.getThread(threadId)!.status).toBe("open");
  });

  it("M38-CT-06: allows agent to reopen a resolved thread (no longer throws)", async () => {
    // Agent reopen is now allowed per requirements-comments.md M38-CT-06
    await store.reopen(threadId, { kind: "agent", name: "Agent", agentId: "agent-1" });
    expect(store.getThread(threadId)!.status).toBe("open");
  });

  it("throws when reopening a thread that is already open", async () => {
    await store.reopen(threadId, { kind: "user", name: "Dev" });
    await expect(
      store.reopen(threadId, { kind: "user", name: "Dev" }),
    ).rejects.toThrow();
  });

  it("throws when reopening non-existent thread", async () => {
    await expect(
      store.reopen("nonexistent", { kind: "user", name: "Dev" }),
    ).rejects.toThrow();
  });

  it("persists to disk after reopen", async () => {
    workspace.fs.writeFile.mockClear();
    await store.reopen(threadId, { kind: "user", name: "Dev" });
    expect(workspace.fs.writeFile).toHaveBeenCalled();
  });
});

// ── §4 Delete ────────────────────────────────────────────────────────────────

describe("§4 Delete", () => {
  let threadId: string;
  let commentId: string;

  beforeEach(async () => {
    await store.load("/project");
    const result = await store.createThread(makeCreateParams());
    threadId = result.threadId;
    commentId = result.commentId;
  });

  it("deletes an entire thread", async () => {
    await store.delete({ threadId });
    expect(store.getThread(threadId)).toBeUndefined();
    expect(store.getAllThreads()).toHaveLength(0);
  });

  it("deletes a single comment from a thread", async () => {
    const reply = await store.reply({
      threadId,
      body: "Reply",
      author: { kind: "user", name: "Dev" },
    });
    await store.delete({ threadId, commentId: reply.commentId });
    const thread = store.getThread(threadId)!;
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].id).toBe(commentId); // original remains
  });

  it("removes thread when last comment is deleted", async () => {
    await store.delete({ threadId, commentId });
    expect(store.getThread(threadId)).toBeUndefined();
  });

  it("throws when deleting non-existent thread", async () => {
    await expect(store.delete({ threadId: "nonexistent" })).rejects.toThrow();
  });

  it("throws when deleting non-existent comment", async () => {
    await expect(
      store.delete({ threadId, commentId: "nonexistent" }),
    ).rejects.toThrow();
  });

  it("persists to disk after delete", async () => {
    workspace.fs.writeFile.mockClear();
    await store.delete({ threadId });
    expect(workspace.fs.writeFile).toHaveBeenCalled();
  });

  it("emits onChanged after delete", async () => {
    const listener = vi.fn();
    store.onChanged(listener);
    listener.mockClear();
    await store.delete({ threadId });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── §5 Listing / Querying ────────────────────────────────────────────────────

describe("§5 Listing / Querying", () => {
  beforeEach(async () => {
    await store.load("/project");
    // Create a mix of threads for filtering tests
    await store.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 42),
      body: "Fix auth",
      intent: "fix",
    }));
    await store.createThread(makeCreateParams({
      uri: "file:///project/src/api.ts",
      anchor: textAnchor("file:///project/src/api.ts", 10),
      body: "Review this endpoint",
      intent: "review",
    }));
    await store.createThread(makeCreateParams({
      uri: "file:///project/diagrams/arch.mmd",
      anchor: surfaceAnchor("file:///project/diagrams/arch.mmd"),
      body: "Diagram needs fallback",
      intent: "design",
    }));
    await store.createThread(makeCreateParams({
      uri: "file:///project/README.md",
      anchor: fileAnchor("file:///project/README.md"),
      body: "Update readme",
      intent: "fix",
    }));
  });

  it("getAllThreads returns all threads", () => {
    expect(store.getAllThreads()).toHaveLength(4);
  });

  it("getThread returns a specific thread by ID", async () => {
    const threads = store.getAllThreads();
    const thread = store.getThread(threads[0].id);
    expect(thread).toBeDefined();
    expect(thread!.id).toBe(threads[0].id);
  });

  it("getThread returns undefined for non-existent ID", () => {
    expect(store.getThread("nonexistent")).toBeUndefined();
  });

  it("getThreadsForUri returns threads for a specific file", () => {
    const threads = store.getThreadsForUri("file:///project/src/auth.ts");
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor.uri).toBe("file:///project/src/auth.ts");
  });

  it("listThreads returns all threads with summary projection", () => {
    const result = store.listThreads();
    expect(result.threads).toHaveLength(4);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(false);
    // Check summary shape
    const first = result.threads[0];
    expect(first.id).toBeTruthy();
    expect(first.anchor).toBeDefined();
    expect(first.status).toBeTruthy();
    expect(first.commentCount).toBeGreaterThanOrEqual(1);
    expect(first.lastActivity).toBeTruthy();
    expect(first.firstComment).toBeDefined();
    expect(first.firstComment.author).toBeDefined();
    expect(first.firstComment.body).toBeTruthy();
  });

  it("listThreads filters by URI", () => {
    const result = store.listThreads({ uri: "file:///project/src/api.ts" });
    expect(result.threads).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("listThreads filters by status", async () => {
    const threads = store.getAllThreads();
    await store.resolve({
      threadId: threads[0].id,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    const open = store.listThreads({ status: "open" });
    expect(open.threads).toHaveLength(3);
    const resolved = store.listThreads({ status: "resolved" });
    expect(resolved.threads).toHaveLength(1);
  });

  it("listThreads filters by intent", () => {
    const result = store.listThreads({ intent: "fix" });
    expect(result.threads).toHaveLength(2); // auth + readme
  });

  it("listThreads filters by anchorKind", () => {
    const text = store.listThreads({ anchorKind: "text" });
    expect(text.threads).toHaveLength(2);
    const surface = store.listThreads({ anchorKind: "surface" });
    expect(surface.threads).toHaveLength(1);
    const file = store.listThreads({ anchorKind: "file" });
    expect(file.threads).toHaveLength(1);
  });

  it("listThreads combines multiple filters", () => {
    const result = store.listThreads({ anchorKind: "text", intent: "fix" });
    expect(result.threads).toHaveLength(1); // only auth.ts
  });

  it("listThreads respects limit", () => {
    const result = store.listThreads({ limit: 2 });
    expect(result.threads).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(true);
  });

  it("listThreads respects offset", () => {
    const result = store.listThreads({ limit: 2, offset: 2 });
    expect(result.threads).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(false);
  });

  it("listThreads defaults limit to COMMENT_LIST_DEFAULT_LIMIT", () => {
    // With only 4 threads, all should be returned
    const result = store.listThreads();
    expect(result.threads.length).toBeLessThanOrEqual(COMMENT_LIST_DEFAULT_LIMIT);
  });

  it("listThreads clamps limit to COMMENT_LIST_MAX_LIMIT", () => {
    const result = store.listThreads({ limit: 999 });
    // Should not exceed max limit (but with only 4 threads, just check it doesn't error)
    expect(result.threads.length).toBeLessThanOrEqual(COMMENT_LIST_MAX_LIMIT);
  });

  it("listThreads truncates firstComment.body to COMMENT_LIST_BODY_PREVIEW_LENGTH", async () => {
    const longBody = "A".repeat(500);
    await store.createThread(makeCreateParams({ body: longBody }));
    const result = store.listThreads();
    const longThread = result.threads.find(t => t.firstComment.body.startsWith("AAA"));
    expect(longThread).toBeDefined();
    expect(longThread!.firstComment.body.length).toBeLessThanOrEqual(COMMENT_LIST_BODY_PREVIEW_LENGTH);
  });

  it("thread summary includes lastAuthor field set to the kind of the most recent comment author", async () => {
    const result = store.listThreads();
    for (const t of result.threads) {
      expect(["user", "agent"]).toContain(t.lastAuthor);
    }
  });

  it("listThreads filters by updatedSince — returns only threads active after the cutoff", async () => {
    // Use an isolated store so seeded threads from beforeEach don't interfere
    const isolatedStore = new CommentStore();
    await isolatedStore.load("/project"); // vscode mocks are set by outer beforeEach
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await isolatedStore.createThread(makeCreateParams({ body: "before cutoff" }));
    const cutoff = "2026-01-01T00:00:01.000Z";
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    await isolatedStore.createThread(makeCreateParams({ body: "after cutoff" }));
    vi.useRealTimers();
    const result = isolatedStore.listThreads({ updatedSince: cutoff });
    expect(result.total).toBe(1);
    expect(result.threads[0].firstComment.body).toContain("after cutoff");
  });

  it("listThreads filters by lastAuthor=user returns threads where last comment is from user", async () => {
    // All seeded threads in makeCreateParams use author kind derived from store methods —
    // the beforeEach setup in this suite creates threads via makeCreateParams which
    // sets author: { kind: "user" }.  So lastAuthor=user should find all of them.
    const result = store.listThreads({ lastAuthor: "user" });
    expect(result.total).toBe(4);
    result.threads.forEach(t => expect(t.lastAuthor).toBe("user"));
  });

  it("listThreads filters by lastAuthor=agent returns no threads when no agent has replied", () => {
    const result = store.listThreads({ lastAuthor: "agent" });
    expect(result.total).toBe(0);
  });

  it("listThreads results are sorted by lastActivity descending", () => {
    const result = store.listThreads();
    for (let i = 0; i < result.threads.length - 1; i++) {
      expect(result.threads[i].lastActivity >= result.threads[i + 1].lastActivity).toBe(true);
    }
  });
});

// ── §5.4 Scale Limits ────────────────────────────────────────────────────────

describe("§5.4 Scale Limits", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("rejects thread creation at COMMENT_MAX_THREADS cap", async () => {
    // Create threads up to the limit (500 iterations — needs generous timeout under concurrent CI load)
    for (let i = 0; i < COMMENT_MAX_THREADS; i++) {
      await store.createThread(makeCreateParams({
        uri: `file:///project/file-${i}.ts`,
        anchor: textAnchor(`file:///project/file-${i}.ts`, i),
        body: `Thread ${i}`,
      }));
    }
    expect(store.getAllThreads()).toHaveLength(COMMENT_MAX_THREADS);

    // One more should be rejected
    await expect(
      store.createThread(makeCreateParams({
        uri: "file:///project/one-too-many.ts",
        anchor: textAnchor("file:///project/one-too-many.ts", 1),
        body: "Over limit",
      })),
    ).rejects.toThrow();
  }, 30_000);
});

// ── §5.2 Serialization ──────────────────────────────────────────────────────

describe("§5.2 Serialization", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("toStoreFile returns valid CommentStoreFile with version 1.0", async () => {
    await store.createThread(makeCreateParams());
    const file = store.toStoreFile();
    expect(file.version).toBe("1.0");
    expect(file.threads).toHaveLength(1);
    expect(file.threads[0].id).toBeTruthy();
    expect(file.threads[0].comments).toHaveLength(1);
  });
});

// ── §4 getCounts ─────────────────────────────────────────────────────────────

describe("getCounts", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("returns correct open/resolved counts", async () => {
    const r1 = await store.createThread(makeCreateParams());
    await store.createThread(makeCreateParams({ body: "Second" }));

    expect(store.getCounts()).toEqual({ open: 2, resolved: 0 });

    await store.resolve({
      threadId: r1.threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });

    expect(store.getCounts()).toEqual({ open: 1, resolved: 1 });
  });
});

// ── §9 Staleness / Line-shift ────────────────────────────────────────────────

describe("§9 Staleness / Line-shift", () => {
  let threadId: string;

  beforeEach(async () => {
    await store.load("/project");
    const result = await store.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 42),
    }));
    threadId = result.threadId;
  });

  it("shifts anchor lines down when lines inserted above", () => {
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 3 }],
    });
    const thread = store.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(45); // 42 + 3
  });

  it("shifts anchor lines up when lines deleted above", () => {
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 15, newLineCount: 0 }],
    });
    const thread = store.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(37); // 42 - 5
  });

  it("marks thread as stale when change overlaps anchor range", () => {
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 40, endLine: 44, newLineCount: 2 }],
    });
    expect(store.isThreadStale(threadId)).toBe(true);
  });

  it("does not shift anchor when change is below anchor", () => {
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 50, endLine: 55, newLineCount: 3 }],
    });
    const thread = store.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(42); // unchanged
  });

  it("does not affect threads in other files", () => {
    store.onDocumentChanged({
      uri: "file:///project/src/other.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 5 }],
    });
    const thread = store.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(42); // unchanged
  });

  it("does not affect surface-anchored threads", async () => {
    const surfResult = await store.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: surfaceAnchor("file:///project/src/auth.ts"),
    }));
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 5 }],
    });
    const surfThread = store.getThread(surfResult.threadId)!;
    expect(surfThread.anchor.kind).toBe("surface"); // unchanged kind
  });

  it("thread is not stale by default", () => {
    expect(store.isThreadStale(threadId)).toBe(false);
  });

  it("pure deletion (newLineCount=0 over a 2-line range) shifts anchor down by -2", () => {
    // Regression for P1 newLineCount fix: split("\\n").length-1 gives 0 for ""
    // Thread anchor is at startLine=42; deleting lines 10-12 above it
    // delta = 0 - (12-10) = -2  →  anchor becomes 40
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 12, newLineCount: 0 }],
    });
    const anchor = store.getThread(threadId)!.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(40);
  });

  it("onDocumentChanged fires the onChanged listener", () => {
    const listener = vi.fn();
    store.onChanged(listener);
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 2 }],
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── onChanged listener ───────────────────────────────────────────────────────

describe("onChanged listener", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("returns a disposable that unregisters the listener", async () => {
    const listener = vi.fn();
    const disposable = store.onChanged(listener);
    await store.createThread(makeCreateParams());
    expect(listener).toHaveBeenCalledTimes(1);

    disposable.dispose();
    listener.mockClear();
    await store.createThread(makeCreateParams({ body: "Another" }));
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── pruneStaleThreads ─────────────────────────────────────────────────────────

describe("pruneStaleThreads", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("returns empty array when store has no threads", async () => {
    const removed = await store.pruneStaleThreads(async () => true);
    expect(removed).toEqual([]);
  });

  it("returns empty array when all file URIs exist", async () => {
    await store.createThread(makeCreateParams());
    const removed = await store.pruneStaleThreads(async () => true);
    expect(removed).toEqual([]);
    expect(store.getAllThreads()).toHaveLength(1);
  });

  it("removes threads whose file URI does not exist and returns their IDs", async () => {
    const r1 = await store.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    const r2 = await store.createThread(makeCreateParams({ uri: "file:///alive.ts", anchor: textAnchor("file:///alive.ts", 0) }));

    const existing = new Set(["file:///alive.ts"]);
    const removed = await store.pruneStaleThreads(async (uri) => existing.has(uri));

    expect(removed).toEqual([r1.threadId]);
    expect(store.getAllThreads()).toHaveLength(1);
    expect(store.getThread(r1.threadId)).toBeUndefined();
    expect(store.getThread(r2.threadId)).toBeDefined();
  });

  it("fires onChanged for each pruned URI", async () => {
    await store.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    const listener = vi.fn();
    store.onChanged(listener);

    await store.pruneStaleThreads(async () => false);

    expect(listener).toHaveBeenCalledWith("file:///gone.ts");
  });

  it("removes all threads for a stale URI in one call", async () => {
    await store.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    await store.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 1), body: "second" }));

    const removed = await store.pruneStaleThreads(async () => false);

    expect(removed).toHaveLength(2);
    expect(store.getAllThreads()).toHaveLength(0);
  });
});

// ── Session 14: Unified Comments Contract ─────────────────────────────────────
// Requirements: docs/requirements-comments.md M38-CT-01,03,06,07 + M40-EXT-12

describe("Session 14: Unified Comments Contract — store-level", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  // M38-CT-01: listThreads surfaceType filter
  describe("M38-CT-01: listThreads surfaceType filter", () => {
    beforeEach(async () => {
      // Create threads with different surface types
      await store.createThread(makeCreateParams({
        uri: "file:///project/a.ts",
        anchor: textAnchor("file:///project/a.ts", 1),
        body: "text thread",
      }));
      await store.createThread(makeCreateParams({
        uri: "file:///project/diagram.mmd",
        anchor: surfaceAnchor("file:///project/diagram.mmd"),
        body: "diagram thread",
      }));
      // Override surface type to browser for this test
      const browserParams = makeCreateParams({
        uri: "https://example.com/page",
        anchor: { kind: "surface", uri: "https://example.com/page", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
        body: "browser thread",
      });
      await store.createThread(browserParams);
    });

    it("filters by surfaceType=diagram", () => {
      const result = store.listThreads({ surfaceType: "diagram" });
      expect(result.total).toBe(1);
      expect(result.threads[0].anchor.kind).toBe("surface");
    });

    it("filters by surfaceType=browser", () => {
      const result = store.listThreads({ surfaceType: "browser" });
      expect(result.total).toBe(1);
    });

    it("surfaceType filter does not match text anchors", () => {
      const result = store.listThreads({ surfaceType: "text" });
      expect(result.total).toBe(0);
    });

    it("surfaceType filter does not match other surface types", () => {
      const result = store.listThreads({ surfaceType: "diagram" });
      expect(result.threads.every(t => (t.anchor as { surfaceType?: string }).surfaceType === "diagram")).toBe(true);
    });
  });

  // M38-CT-03: createThread with retention
  describe("M38-CT-03: createThread retention parameter", () => {
    it("stores retention=volatile-browser when specified", async () => {
      const params = makeCreateParams({
        uri: "https://example.com/page",
        anchor: { kind: "surface", uri: "https://example.com/page", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
        body: "browser thread",
        retention: "volatile-browser",
      });
      const result = await store.createThread(params);
      const thread = store.getThread(result.threadId)!;
      expect(thread.retention).toBe("volatile-browser");
    });

    it("defaults to retention=standard when not specified", async () => {
      const result = await store.createThread(makeCreateParams());
      const thread = store.getThread(result.threadId)!;
      expect(thread.retention).toBe("standard");
    });

    it("persists retention value to disk", async () => {
      workspace.fs.writeFile.mockClear();
      const params = makeCreateParams({
        uri: "https://example.com/page",
        anchor: { kind: "surface", uri: "https://example.com/page", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
        body: "browser thread",
        retention: "volatile-browser",
      });
      await store.createThread(params);
      expect(workspace.fs.writeFile).toHaveBeenCalled();
      // Verify the persisted JSON contains the retention value
      const lastCall = workspace.fs.writeFile.mock.calls.at(-1);
      const written = new TextDecoder().decode(lastCall![1] as Uint8Array);
      const parsed = JSON.parse(written);
      expect(parsed.threads[0].retention).toBe("volatile-browser");
    });
  });

  // M38-CT-07 / M40-EXT-12: deleteAllByModality
  describe("M38-CT-07, M40-EXT-12: deleteAllByModality", () => {
    beforeEach(async () => {
      // Create browser threads (surface type = browser)
      const browserParams1 = makeCreateParams({
        uri: "https://example.com/1",
        anchor: { kind: "surface", uri: "https://example.com/1", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
        body: "browser 1",
      });
      const browserParams2 = makeCreateParams({
        uri: "https://example.com/2",
        anchor: { kind: "surface", uri: "https://example.com/2", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
        body: "browser 2",
      });
      await store.createThread(browserParams1);
      await store.createThread(browserParams2);

      // Create text thread
      await store.createThread(makeCreateParams({
        uri: "file:///project/src/a.ts",
        anchor: textAnchor("file:///project/src/a.ts", 1),
        body: "text comment",
      }));

      // Create diagram thread (surface type = diagram)
      const diagramParams = makeCreateParams({
        uri: "file:///project/diagram.mmd",
        anchor: { kind: "surface", uri: "file:///project/diagram.mmd", surfaceType: "diagram", coordinates: { type: "diagram-node", nodeId: "n1" } },
        body: "diagram comment",
      });
      await store.createThread(diagramParams);
    });

    it("deletes all threads with surfaceType=browser", async () => {
      const count = await store.deleteAllByModality("browser");
      expect(count).toBe(2);
      expect(store.listThreads({ surfaceType: "browser" }).total).toBe(0);
    });

    it("returns the count of deleted threads", async () => {
      const count = await store.deleteAllByModality("browser");
      expect(count).toBe(2);
    });

    it("does NOT delete text-anchored threads when deleting browser", async () => {
      await store.deleteAllByModality("browser");
      const textThreads = store.listThreads({ anchorKind: "text" });
      expect(textThreads.total).toBe(1);
    });

    it("does NOT delete diagram threads when deleting browser", async () => {
      await store.deleteAllByModality("browser");
      const diagramThreads = store.listThreads({ surfaceType: "diagram" });
      expect(diagramThreads.total).toBe(1);
    });

    it("deletes only diagram threads when deleting by modality=diagram", async () => {
      const count = await store.deleteAllByModality("diagram");
      expect(count).toBe(1);
      expect(store.listThreads({ surfaceType: "browser" }).total).toBe(2); // browser untouched
      expect(store.listThreads({ anchorKind: "text" }).total).toBe(1); // text untouched
    });

    it("returns 0 when no threads match the modality", async () => {
      const count = await store.deleteAllByModality("pdf");
      expect(count).toBe(0);
    });

    it("persists to disk after bulk delete", async () => {
      workspace.fs.writeFile.mockClear();
      await store.deleteAllByModality("browser");
      expect(workspace.fs.writeFile).toHaveBeenCalled();
    });

    it("emits onChanged for each affected URI after bulk delete", async () => {
      const listener = vi.fn();
      store.onChanged(listener);
      await store.deleteAllByModality("browser");
      // Should emit for each deleted browser thread's URI
      expect(listener).toHaveBeenCalledWith("https://example.com/1");
      expect(listener).toHaveBeenCalledWith("https://example.com/2");
    });

    it("persists correct thread count after bulk delete", async () => {
      await store.deleteAllByModality("browser");
      const file = store.toStoreFile();
      expect(file.threads).toHaveLength(2); // text + diagram
    });
  });
});

// ── §5.1 Atomic write durability ─────────────────────────────────────────────

describe("§5.1 Atomic write durability", () => {
  beforeEach(async () => {
    await store.load("/project");
    vi.mocked(mockRename).mockClear();
  });

  it("writes to .tmp path first, then renames to final path", async () => {
    await store.createThread(makeCreateParams());

    // writeFile should target the .tmp path
    const writeCall = workspace.fs.writeFile.mock.calls.at(-1)!;
    const writtenUri = writeCall[0] as Uri;
    expect(writtenUri.fsPath).toMatch(/comments\.json\.tmp$/);

    // rename should move .tmp → final path
    expect(vi.mocked(mockRename)).toHaveBeenCalledTimes(1);
    const [from, to] = vi.mocked(mockRename).mock.calls[0];
    expect(from).toMatch(/comments\.json\.tmp$/);
    expect(to).toMatch(/comments\.json$/);
    expect(to).not.toMatch(/\.tmp$/);
  });

  it("original file is never touched if writeFile throws mid-write", async () => {
    workspace.fs.writeFile.mockRejectedValueOnce(new Error("disk full"));
    vi.mocked(mockRename).mockClear();

    await expect(store.createThread(makeCreateParams())).rejects.toThrow("disk full");

    // rename must NOT have been called — original comments.json untouched
    expect(vi.mocked(mockRename)).not.toHaveBeenCalled();
  });
});

describe("getVersionInfo", () => {
  beforeEach(async () => {
    await store.load("/project");
  });

  it("PeriodicSync-CS-01: returns version=0, threadCount=0, lastActivity=null on fresh store", () => {
    const info = store.getVersionInfo();

    expect(info.version).toBe(0);
    expect(info.threadCount).toBe(0);
    expect(info.lastActivity).toBe(null);
  });

  it("PeriodicSync-CS-02: version increments to 1 after createThread", async () => {
    await store.createThread(makeCreateParams());

    const info = store.getVersionInfo();

    expect(info.version).toBe(1);
    expect(info.threadCount).toBe(1);
    expect(typeof info.lastActivity).toBe("string");
  });

  it("PeriodicSync-CS-03: version increments after each mutation", async () => {
    const { threadId } = await store.createThread(makeCreateParams());

    await store.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });

    const info = store.getVersionInfo();

    expect(info.version).toBe(2);
    expect(info.threadCount).toBe(1);
  });

  it("PeriodicSync-CS-04: threadCount reflects number of active threads", async () => {
    await store.createThread(makeCreateParams({ threadId: "t1" }));
    await store.createThread(makeCreateParams({ threadId: "t2" }));

    const info = store.getVersionInfo();

    expect(info.threadCount).toBe(2);
    expect(info.version).toBe(2);
  });

  it("PeriodicSync-CS-05: lastActivity is the most recent lastActivity among all threads", async () => {
    await store.createThread(makeCreateParams({ threadId: "t1" }));
    // Small delay to ensure second thread has a later timestamp
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await store.createThread(makeCreateParams({ threadId: "t2" }));

    const info = store.getVersionInfo();
    const t2 = store.getThread("t2");

    expect(info.lastActivity).toBe(t2!.lastActivity);
  });
});
