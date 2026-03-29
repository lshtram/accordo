/**
 * Tests for CommentRepository — pure domain, synchronous
 *
 * Source: comments-architecture.md §3, §5 (synchronous variant, no I/O)
 *
 * Requirements covered:
 *   §3.2  AccordoComment structure, author, intent, status
 *   §3.3  CommentThread structure, derived status, timestamps
 *   §5.1  loadFromStoreFile / toStoreFile (synchronous persistence)
 *   §5.2  File format (version "1.0", threads array)
 *   §5.4  Scale limits (500 threads, 50 comments/thread)
 *   §4    State machine (open → resolved → open, transitions)
 *   §9    Diff-aware staleness (line-shift, overlap detection)
 *   BUG-FIX deleteAllByModality returns { count, affectedUris }
 *
 * API checklist:
 * ✓ loadFromStoreFile()       — §5.1 Load from CommentStoreFile (4 tests)
 * ✓ toStoreFile()             — §5.2 Serialization (2 tests)
 * ✓ getAllThreads()           — §5 Listing/Querying (2 tests)
 * ✓ getVersionInfo()          — version tracking (5 tests)
 * ✓ getThread()               — single thread lookup (3 tests)
 * ✓ getThreadsForUri()        — URI filtering (2 tests)
 * ✓ listThreads()             — §5 filter/pagination (11 tests)
 * ✓ createThread()            — §3.2/§3.3 Create Thread (9 tests)
 * ✓ reply()                   — §3.3 Reply (6 tests)
 * ✓ resolve()                 — §4 Resolve (6 tests)
 * ✓ reopen()                  — §4 Reopen (5 tests)
 * ✓ delete()                  — §4 Delete (7 tests)
 * ✓ deleteAllByModality()     — BUG-FIX bulk delete (7 tests)
 * ✓ onDocumentChanged()        — §9 Staleness (7 tests)
 * ✓ isThreadStale()           — stale tracking (3 tests)
 * ✓ getCounts()               — getCounts (2 tests)
 * ✓ removeThreadsByUris()     — URI-based bulk removal (4 tests)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CommentRepository,
  type CreateCommentParams,
  type ListThreadsOptions,
} from "../comment-repository.js";
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function textAnchor(uri: string, startLine: number, endLine?: number): CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine, startChar: 0, endLine: endLine ?? startLine, endChar: 0 },
    docVersion: 1,
  };
}

function surfaceAnchor(uri: string, surfaceType = "diagram"): CommentAnchorSurface {
  return {
    kind: "surface",
    uri,
    surfaceType,
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

function browserSurfaceAnchor(uri: string): CommentAnchorSurface {
  return {
    kind: "surface",
    uri,
    surfaceType: "browser",
    coordinates: { type: "normalized", x: 0.5, y: 0.5 },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let repo: CommentRepository;

beforeEach(() => {
  repo = new CommentRepository();
});

// ── §5.1 Load from CommentStoreFile ─────────────────────────────────────────

describe("§5.1 Load from CommentStoreFile", () => {
  it("loads with empty store when given an empty threads array", () => {
    const file: CommentStoreFile = { version: "1.0", threads: [] };
    repo.loadFromStoreFile(file);
    expect(repo.getAllThreads()).toEqual([]);
  });

  it("restores threads from a valid CommentStoreFile", () => {
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
    repo.loadFromStoreFile(file);
    expect(repo.getAllThreads()).toHaveLength(1);
    expect(repo.getThread("t1")).toBeDefined();
    expect(repo.getThread("t1")!.comments[0].body).toBe("Fix this");
  });

  it("loads multiple threads from CommentStoreFile", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///project/src/a.ts", 1),
          comments: [{ id: "c1", threadId: "t1", createdAt: "2026-01-01T00:00:00Z", author: { kind: "user", name: "Dev" }, body: "A", anchor: textAnchor("file:///project/src/a.ts", 1), status: "open" }],
          status: "open",
          createdAt: "2026-01-01T00:00:00Z",
          lastActivity: "2026-01-01T00:00:00Z",
        },
        {
          id: "t2",
          anchor: textAnchor("file:///project/src/b.ts", 2),
          comments: [{ id: "c2", threadId: "t2", createdAt: "2026-01-02T00:00:00Z", author: { kind: "agent", name: "Agent" }, body: "B", anchor: textAnchor("file:///project/src/b.ts", 2), status: "open" }],
          status: "open",
          createdAt: "2026-01-02T00:00:00Z",
          lastActivity: "2026-01-02T00:00:00Z",
        },
      ],
    };
    repo.loadFromStoreFile(file);
    expect(repo.getAllThreads()).toHaveLength(2);
  });

  it("resets internal state on load (replaces existing threads)", () => {
    repo.createThread(makeCreateParams({ threadId: "existing", body: "Old" }));
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///project/src/new.ts", 10),
          comments: [{ id: "c1", threadId: "t1", createdAt: "2026-03-03T10:00:00Z", author: { kind: "user", name: "Dev" }, body: "New", anchor: textAnchor("file:///project/src/new.ts", 10), status: "open" }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };
    repo.loadFromStoreFile(file);
    expect(repo.getAllThreads()).toHaveLength(1);
    expect(repo.getThread("existing")).toBeUndefined();
    expect(repo.getThread("t1")).toBeDefined();
  });
});

// ── §5.2 Serialization ───────────────────────────────────────────────────────

describe("§5.2 Serialization", () => {
  it("toStoreFile returns valid CommentStoreFile with version 1.0", () => {
    repo.createThread(makeCreateParams());
    const file = repo.toStoreFile();
    expect(file.version).toBe("1.0");
    expect(file.threads).toHaveLength(1);
    expect(file.threads[0].id).toBeTruthy();
    expect(file.threads[0].comments).toHaveLength(1);
  });

  it("toStoreFile returns empty threads array for fresh repository", () => {
    const file = repo.toStoreFile();
    expect(file.version).toBe("1.0");
    expect(file.threads).toHaveLength(0);
  });
});

// ── §5 Listing / Querying ────────────────────────────────────────────────────

describe("§5 Listing / Querying", () => {
  beforeEach(() => {
    repo.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 42),
      body: "Fix auth",
      intent: "fix",
    }));
    repo.createThread(makeCreateParams({
      uri: "file:///project/src/api.ts",
      anchor: textAnchor("file:///project/src/api.ts", 10),
      body: "Review this endpoint",
      intent: "review",
    }));
    repo.createThread(makeCreateParams({
      uri: "file:///project/diagrams/arch.mmd",
      anchor: surfaceAnchor("file:///project/diagrams/arch.mmd"),
      body: "Diagram needs fallback",
      intent: "design",
    }));
    repo.createThread(makeCreateParams({
      uri: "file:///project/README.md",
      anchor: fileAnchor("file:///project/README.md"),
      body: "Update readme",
      intent: "fix",
    }));
  });

  it("getAllThreads returns all threads", () => {
    expect(repo.getAllThreads()).toHaveLength(4);
  });

  it("getThread returns a specific thread by ID", () => {
    const threads = repo.getAllThreads();
    const thread = repo.getThread(threads[0].id);
    expect(thread).toBeDefined();
    expect(thread!.id).toBe(threads[0].id);
  });

  it("getThread returns undefined for non-existent ID", () => {
    expect(repo.getThread("nonexistent")).toBeUndefined();
  });

  it("getThreadsForUri returns threads for a specific file", () => {
    const threads = repo.getThreadsForUri("file:///project/src/auth.ts");
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor.uri).toBe("file:///project/src/auth.ts");
  });

  it("getThreadsForUri returns empty array for URI with no threads", () => {
    const threads = repo.getThreadsForUri("file:///project/src/nonexistent.ts");
    expect(threads).toHaveLength(0);
  });

  it("listThreads returns all threads with summary projection", () => {
    const result = repo.listThreads();
    expect(result.threads).toHaveLength(4);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(false);
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
    const result = repo.listThreads({ uri: "file:///project/src/api.ts" });
    expect(result.threads).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("listThreads filters by status", () => {
    const threads = repo.getAllThreads();
    repo.resolve({
      threadId: threads[0].id,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    const open = repo.listThreads({ status: "open" });
    expect(open.threads).toHaveLength(3);
    const resolved = repo.listThreads({ status: "resolved" });
    expect(resolved.threads).toHaveLength(1);
  });

  it("listThreads filters by intent", () => {
    const result = repo.listThreads({ intent: "fix" });
    expect(result.threads).toHaveLength(2); // auth + readme
  });

  it("listThreads filters by anchorKind", () => {
    const text = repo.listThreads({ anchorKind: "text" });
    expect(text.threads).toHaveLength(2);
    const surface = repo.listThreads({ anchorKind: "surface" });
    expect(surface.threads).toHaveLength(1);
    const file = repo.listThreads({ anchorKind: "file" });
    expect(file.threads).toHaveLength(1);
  });

  it("listThreads filters by surfaceType", () => {
    repo.createThread(makeCreateParams({
      uri: "https://example.com/page",
      anchor: browserSurfaceAnchor("https://example.com/page"),
      body: "Browser comment",
    }));
    const result = repo.listThreads({ surfaceType: "browser" });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].anchor.kind).toBe("surface");
  });

  it("listThreads combines multiple filters", () => {
    const result = repo.listThreads({ anchorKind: "text", intent: "fix" });
    expect(result.threads).toHaveLength(1); // only auth.ts
  });

  it("listThreads respects limit", () => {
    const result = repo.listThreads({ limit: 2 });
    expect(result.threads).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(true);
  });

  it("listThreads respects offset", () => {
    const result = repo.listThreads({ limit: 2, offset: 2 });
    expect(result.threads).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(false);
  });

  it("listThreads defaults limit to COMMENT_LIST_DEFAULT_LIMIT", () => {
    const result = repo.listThreads();
    expect(result.threads.length).toBeLessThanOrEqual(COMMENT_LIST_DEFAULT_LIMIT);
  });

  it("listThreads clamps limit to COMMENT_LIST_MAX_LIMIT", () => {
    const result = repo.listThreads({ limit: 999 });
    expect(result.threads.length).toBeLessThanOrEqual(COMMENT_LIST_MAX_LIMIT);
  });

  it("listThreads truncates firstComment.body to COMMENT_LIST_BODY_PREVIEW_LENGTH", () => {
    const longBody = "A".repeat(500);
    repo.createThread(makeCreateParams({ body: longBody }));
    const result = repo.listThreads();
    const longThread = result.threads.find(t => t.firstComment.body.startsWith("AAA"));
    expect(longThread).toBeDefined();
    expect(longThread!.firstComment.body.length).toBeLessThanOrEqual(COMMENT_LIST_BODY_PREVIEW_LENGTH);
  });

  it("listThreads includes lastAuthor field set to the kind of the most recent comment author", () => {
    const result = repo.listThreads();
    for (const t of result.threads) {
      expect(["user", "agent"]).toContain(t.lastAuthor);
    }
  });

  it("listThreads filters by updatedSince — returns only threads active after the cutoff", () => {
    // Use a fresh repo with all threads created under controlled fake time so
    // the real wall-clock date does not pollute the updatedSince comparison.
    const freshRepo = new CommentRepository();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    freshRepo.createThread(makeCreateParams({ body: "before cutoff" }));
    const cutoff = "2026-01-01T00:00:01.000Z";
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    freshRepo.createThread(makeCreateParams({ body: "after cutoff" }));
    vi.useRealTimers();
    const result = freshRepo.listThreads({ updatedSince: cutoff });
    expect(result.total).toBe(1);
    expect(result.threads[0].firstComment.body).toContain("after cutoff");
  });

  it("listThreads filters by lastAuthor=user returns threads where last comment is from user", () => {
    const result = repo.listThreads({ lastAuthor: "user" });
    expect(result.total).toBe(4);
    result.threads.forEach(t => expect(t.lastAuthor).toBe("user"));
  });

  it("listThreads filters by lastAuthor=agent returns no threads when no agent has replied", () => {
    const result = repo.listThreads({ lastAuthor: "agent" });
    expect(result.total).toBe(0);
  });

  it("listThreads results are sorted by lastActivity descending", () => {
    const result = repo.listThreads();
    for (let i = 0; i < result.threads.length - 1; i++) {
      expect(result.threads[i].lastActivity >= result.threads[i + 1].lastActivity).toBe(true);
    }
  });
});

// ── getVersionInfo ─────────────────────────────────────────────────────────────

describe("getVersionInfo", () => {
  it("REPO-VINFO-01: returns version=0, threadCount=0, lastActivity=null on fresh repository", () => {
    const info = repo.getVersionInfo();
    expect(info.version).toBe(0);
    expect(info.threadCount).toBe(0);
    expect(info.lastActivity).toBeNull();
  });

  it("REPO-VINFO-02: version increments to 1 after createThread", () => {
    repo.createThread(makeCreateParams());
    const info = repo.getVersionInfo();
    expect(info.version).toBe(1);
    expect(info.threadCount).toBe(1);
    expect(typeof info.lastActivity).toBe("string");
  });

  it("REPO-VINFO-03: version increments after each mutation", () => {
    const { threadId } = repo.createThread(makeCreateParams());
    repo.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });
    const info = repo.getVersionInfo();
    expect(info.version).toBe(2);
    expect(info.threadCount).toBe(1);
  });

  it("REPO-VINFO-04: threadCount reflects number of active threads", () => {
    repo.createThread(makeCreateParams({ threadId: "t1" }));
    repo.createThread(makeCreateParams({ threadId: "t2" }));
    const info = repo.getVersionInfo();
    expect(info.threadCount).toBe(2);
    expect(info.version).toBe(2);
  });

  it("REPO-VINFO-05: lastActivity is the most recent lastActivity among all threads", () => {
    // Control all time with fake timers so the ISO comparison is deterministic
    // regardless of the real wall-clock date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    repo.createThread(makeCreateParams({ threadId: "t1" }));
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    repo.createThread(makeCreateParams({ threadId: "t2" }));
    vi.useRealTimers();
    const info = repo.getVersionInfo();
    const t2 = repo.getThread("t2");
    expect(info.lastActivity).toBe(t2!.lastActivity);
  });
});

// ── §3.2, §3.3 Create Thread ────────────────────────────────────────────────

describe("§3.2, §3.3 Create Thread", () => {
  it("creates a thread with a text anchor and returns threadId + commentId + affectedUri", () => {
    const result = repo.createThread(makeCreateParams());
    expect(result.threadId).toBeTruthy();
    expect(result.commentId).toBeTruthy();
    expect(result.affectedUri).toBe("file:///project/src/auth.ts");
    expect(typeof result.threadId).toBe("string");
    expect(typeof result.commentId).toBe("string");
  });

  it("creates a thread with a surface anchor", () => {
    const result = repo.createThread(makeCreateParams({
      anchor: surfaceAnchor("file:///project/diagrams/arch.mmd"),
      uri: "file:///project/diagrams/arch.mmd",
    }));
    const thread = repo.getThread(result.threadId);
    expect(thread).toBeDefined();
    expect(thread!.anchor.kind).toBe("surface");
  });

  it("creates a thread with a file-level anchor", () => {
    const result = repo.createThread(makeCreateParams({
      anchor: fileAnchor("file:///project/README.md"),
      uri: "file:///project/README.md",
    }));
    const thread = repo.getThread(result.threadId);
    expect(thread).toBeDefined();
    expect(thread!.anchor.kind).toBe("file");
  });

  it("assigns caller-supplied IDs when provided", () => {
    const result = repo.createThread(makeCreateParams({
      threadId: "my-thread-id",
      commentId: "my-comment-id",
    }));
    expect(result.threadId).toBe("my-thread-id");
    expect(result.commentId).toBe("my-comment-id");
    expect(repo.getThread("my-thread-id")).toBeDefined();
  });

  it("sets createdAt and lastActivity to ISO 8601 timestamps", () => {
    const before = new Date().toISOString();
    const result = repo.createThread(makeCreateParams());
    const after = new Date().toISOString();
    const thread = repo.getThread(result.threadId)!;
    expect(thread.createdAt >= before).toBe(true);
    expect(thread.createdAt <= after).toBe(true);
    expect(thread.lastActivity).toBe(thread.createdAt);
  });

  it("sets thread status to 'open' on creation", () => {
    const result = repo.createThread(makeCreateParams());
    const thread = repo.getThread(result.threadId)!;
    expect(thread.status).toBe("open");
  });

  it("stores author, body, intent on the first comment", () => {
    const result = repo.createThread(makeCreateParams({
      body: "Markdown **bold** text",
      intent: "review",
      author: { kind: "agent", name: "TestAgent", agentId: "agent-1" },
    }));
    const thread = repo.getThread(result.threadId)!;
    expect(thread.comments).toHaveLength(1);
    const c = thread.comments[0];
    expect(c.body).toBe("Markdown **bold** text");
    expect(c.intent).toBe("review");
    expect(c.author.kind).toBe("agent");
    expect(c.author.name).toBe("TestAgent");
    expect(c.author.agentId).toBe("agent-1");
  });

  it("stores context when provided", () => {
    const ctx = {
      viewportSnap: { before: "line1\nline2", after: "line3\nline4" },
      languageId: "typescript",
      git: { branch: "main", commit: "abc123" },
    };
    const result = repo.createThread(makeCreateParams({ context: ctx }));
    const thread = repo.getThread(result.threadId)!;
    expect(thread.comments[0].context).toEqual(ctx);
  });

  it("increments version on create", () => {
    expect(repo.getVersionInfo().version).toBe(0);
    repo.createThread(makeCreateParams());
    expect(repo.getVersionInfo().version).toBe(1);
  });
});

// ── §5.4 Scale Limits ────────────────────────────────────────────────────────

describe("§5.4 Scale Limits", () => {
  it("REPO-LIMIT-01: rejects thread creation at COMMENT_MAX_THREADS cap", () => {
    for (let i = 0; i < COMMENT_MAX_THREADS; i++) {
      repo.createThread(makeCreateParams({
        uri: `file:///project/file-${i}.ts`,
        anchor: textAnchor(`file:///project/file-${i}.ts`, i),
        body: `Thread ${i}`,
      }));
    }
    expect(repo.getAllThreads()).toHaveLength(COMMENT_MAX_THREADS);
    expect(() =>
      repo.createThread(makeCreateParams({
        uri: "file:///project/one-too-many.ts",
        anchor: textAnchor("file:///project/one-too-many.ts", 1),
        body: "Over limit",
      })),
    ).toThrow();
  });
});

// ── §3.3 Reply ───────────────────────────────────────────────────────────────

describe("§3.3 Reply", () => {
  let threadId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams());
    threadId = result.threadId;
  });

  it("adds a reply to an existing thread and returns commentId + affectedUri", () => {
    const reply = repo.reply({
      threadId,
      body: "I fixed it",
      author: { kind: "agent", name: "Agent" },
    });
    expect(reply.commentId).toBeTruthy();
    expect(reply.affectedUri).toBe("file:///project/src/auth.ts");
    const thread = repo.getThread(threadId)!;
    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[1].body).toBe("I fixed it");
  });

  it("updates lastActivity on reply", () => {
    // Use fake timers for the entire test so the reply timestamp is always
    // greater than the thread-creation timestamp, regardless of wall-clock date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { threadId: localThreadId } = repo.createThread(makeCreateParams());
    const beforeReply = repo.getThread(localThreadId)!.lastActivity;
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    repo.reply({
      threadId: localThreadId,
      body: "Reply",
      author: { kind: "user", name: "Dev" },
    });
    vi.useRealTimers();
    const afterReply = repo.getThread(localThreadId)!.lastActivity;
    expect(afterReply >= beforeReply).toBe(true);
  });

  it("throws when replying to non-existent thread", () => {
    expect(() =>
      repo.reply({ threadId: "nonexistent", body: "x", author: { kind: "user", name: "Dev" } }),
    ).toThrow();
  });

  it("throws when comment-per-thread cap is reached", () => {
    for (let i = 1; i < COMMENT_MAX_COMMENTS_PER_THREAD; i++) {
      repo.reply({ threadId, body: `Reply ${i}`, author: { kind: "user", name: "Dev" } });
    }
    expect(() =>
      repo.reply({ threadId, body: "Over limit", author: { kind: "user", name: "Dev" } }),
    ).toThrow();
  });

  it("increments version on reply", () => {
    const initialVersion = repo.getVersionInfo().version;
    repo.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });

  it("preserves thread status on reply", () => {
    repo.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });
    expect(repo.getThread(threadId)!.status).toBe("open");
  });
});

// ── §4 Resolve ───────────────────────────────────────────────────────────────

describe("§4 Resolve", () => {
  let threadId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams());
    threadId = result.threadId;
  });

  it("resolves an open thread with a resolution note and returns affectedUri", () => {
    const result = repo.resolve({
      threadId,
      resolutionNote: "Added guard clause",
      author: { kind: "agent", name: "Agent" },
    });
    expect(result.affectedUri).toBe("file:///project/src/auth.ts");
    const thread = repo.getThread(threadId)!;
    expect(thread.status).toBe("resolved");
  });

  it("stores the resolution note on the resolve comment", () => {
    repo.resolve({
      threadId,
      resolutionNote: "Fixed by adding null check",
      author: { kind: "agent", name: "Agent" },
    });
    const thread = repo.getThread(threadId)!;
    const lastComment = thread.comments[thread.comments.length - 1];
    expect(lastComment.resolutionNote).toBe("Fixed by adding null check");
    expect(lastComment.status).toBe("resolved");
  });

  it("throws when resolving an already-resolved thread", () => {
    repo.resolve({
      threadId,
      resolutionNote: "First resolve",
      author: { kind: "agent", name: "Agent" },
    });
    expect(() =>
      repo.resolve({
        threadId,
        resolutionNote: "Second resolve",
        author: { kind: "agent", name: "Agent" },
      }),
    ).toThrow(/already resolved/i);
  });

  it("throws when resolving non-existent thread", () => {
    expect(() =>
      repo.resolve({
        threadId: "nonexistent",
        resolutionNote: "x",
        author: { kind: "user", name: "Dev" },
      }),
    ).toThrow();
  });

  it("increments version on resolve", () => {
    const initialVersion = repo.getVersionInfo().version;
    repo.resolve({
      threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });

  it("updates lastActivity on resolve", () => {
    // Use fake timers for the entire test so the resolve timestamp is always
    // greater than the thread-creation timestamp, regardless of wall-clock date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { threadId: localThreadId } = repo.createThread(makeCreateParams());
    const beforeResolve = repo.getThread(localThreadId)!.lastActivity;
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    repo.resolve({
      threadId: localThreadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    vi.useRealTimers();
    const afterResolve = repo.getThread(localThreadId)!.lastActivity;
    expect(afterResolve >= beforeResolve).toBe(true);
  });
});

// ── §4 Reopen ────────────────────────────────────────────────────────────────

describe("§4 Reopen", () => {
  let threadId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams());
    threadId = result.threadId;
    repo.resolve({
      threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
  });

  it("reopens a resolved thread and returns affectedUri", () => {
    const result = repo.reopen(threadId, { kind: "user", name: "Dev" });
    expect(result.affectedUri).toBe("file:///project/src/auth.ts");
    expect(repo.getThread(threadId)!.status).toBe("open");
  });

  it("M38-CT-06: allows agent to reopen a resolved thread", () => {
    repo.reopen(threadId, { kind: "agent", name: "Agent", agentId: "agent-1" });
    expect(repo.getThread(threadId)!.status).toBe("open");
  });

  it("throws when reopening a thread that is already open", () => {
    repo.reopen(threadId, { kind: "user", name: "Dev" });
    expect(() =>
      repo.reopen(threadId, { kind: "user", name: "Dev" }),
    ).toThrow();
  });

  it("throws when reopening non-existent thread", () => {
    expect(() =>
      repo.reopen("nonexistent", { kind: "user", name: "Dev" }),
    ).toThrow();
  });

  it("increments version on reopen", () => {
    const initialVersion = repo.getVersionInfo().version;
    repo.reopen(threadId, { kind: "user", name: "Dev" });
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });
});

// ── §4 Delete ────────────────────────────────────────────────────────────────

describe("§4 Delete", () => {
  let threadId: string;
  let commentId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams());
    threadId = result.threadId;
    commentId = result.commentId;
  });

  it("deletes an entire thread and returns affectedUri", () => {
    const result = repo.delete({ threadId });
    expect(result.affectedUri).toBe("file:///project/src/auth.ts");
    expect(repo.getThread(threadId)).toBeUndefined();
    expect(repo.getAllThreads()).toHaveLength(0);
  });

  it("deletes a single comment from a thread", () => {
    const reply = repo.reply({
      threadId,
      body: "Reply",
      author: { kind: "user", name: "Dev" },
    });
    repo.delete({ threadId, commentId: reply.commentId });
    const thread = repo.getThread(threadId)!;
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].id).toBe(commentId); // original remains
  });

  it("removes thread when last comment is deleted", () => {
    repo.delete({ threadId, commentId });
    expect(repo.getThread(threadId)).toBeUndefined();
  });

  it("throws when deleting non-existent thread", () => {
    expect(() => repo.delete({ threadId: "nonexistent" })).toThrow();
  });

  it("throws when deleting non-existent comment", () => {
    expect(() =>
      repo.delete({ threadId, commentId: "nonexistent" }),
    ).toThrow();
  });

  it("increments version on delete", () => {
    const initialVersion = repo.getVersionInfo().version;
    repo.delete({ threadId });
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });

  it("removes thread from stale set when deleted", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 40, endLine: 44, newLineCount: 2 }],
    });
    expect(repo.isThreadStale(threadId)).toBe(true);
    repo.delete({ threadId });
    // No error — stale entry is cleaned up internally
    expect(repo.isThreadStale(threadId)).toBe(false);
  });
});

// ── BUG-FIX deleteAllByModality ─────────────────────────────────────────────

describe("BUG-FIX deleteAllByModality", () => {
  beforeEach(() => {
    repo.createThread(makeCreateParams({
      uri: "https://example.com/1",
      anchor: browserSurfaceAnchor("https://example.com/1"),
      body: "browser 1",
    }));
    repo.createThread(makeCreateParams({
      uri: "https://example.com/2",
      anchor: browserSurfaceAnchor("https://example.com/2"),
      body: "browser 2",
    }));
    repo.createThread(makeCreateParams({
      uri: "file:///project/src/a.ts",
      anchor: textAnchor("file:///project/src/a.ts", 1),
      body: "text comment",
    }));
    repo.createThread(makeCreateParams({
      uri: "file:///project/diagram.mmd",
      anchor: surfaceAnchor("file:///project/diagram.mmd", "diagram"),
      body: "diagram comment",
    }));
  });

  it("deletes all threads with surfaceType=browser and returns { count, affectedUris }", () => {
    const result = repo.deleteAllByModality("browser");
    expect(result.count).toBe(2);
    expect(result.affectedUris).toContain("https://example.com/1");
    expect(result.affectedUris).toContain("https://example.com/2");
    expect(repo.listThreads({ surfaceType: "browser" }).total).toBe(0);
  });

  it("does NOT delete text-anchored threads when deleting browser", () => {
    repo.deleteAllByModality("browser");
    const textThreads = repo.listThreads({ anchorKind: "text" });
    expect(textThreads.total).toBe(1);
  });

  it("does NOT delete diagram threads when deleting browser", () => {
    repo.deleteAllByModality("browser");
    const diagramThreads = repo.listThreads({ surfaceType: "diagram" });
    expect(diagramThreads.total).toBe(1);
  });

  it("deletes only diagram threads when deleting by modality=diagram", () => {
    const result = repo.deleteAllByModality("diagram");
    expect(result.count).toBe(1);
    expect(repo.listThreads({ surfaceType: "browser" }).total).toBe(2); // browser untouched
    expect(repo.listThreads({ anchorKind: "text" }).total).toBe(1); // text untouched
  });

  it("returns count=0 when no threads match the modality", () => {
    const result = repo.deleteAllByModality("pdf");
    expect(result.count).toBe(0);
    expect(result.affectedUris).toEqual([]);
  });

  it("increments version on bulk delete", () => {
    const initialVersion = repo.getVersionInfo().version;
    repo.deleteAllByModality("browser");
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });

  it("removes deleted threads from stale set", () => {
    // Create browser thread and mark it stale
    const browserResult = repo.createThread(makeCreateParams({
      uri: "https://stale.example.com",
      anchor: browserSurfaceAnchor("https://stale.example.com"),
      body: "stale browser",
    }));
    repo.onDocumentChanged({
      uri: "https://stale.example.com",
      changes: [{ startLine: 0, endLine: 5, newLineCount: 10 }],
    });
    expect(repo.isThreadStale(browserResult.threadId)).toBe(true);
    repo.deleteAllByModality("browser");
    expect(repo.isThreadStale(browserResult.threadId)).toBe(false);
  });
});

// ── §9 Staleness / Line-shift ────────────────────────────────────────────────

describe("§9 Staleness / Line-shift", () => {
  let threadId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 42),
    }));
    threadId = result.threadId;
  });

  it("shifts anchor lines down when lines inserted above", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 3 }],
    });
    const thread = repo.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(45); // 42 + 3
  });

  it("shifts anchor lines up when lines deleted above", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 15, newLineCount: 0 }],
    });
    const thread = repo.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(37); // 42 - 5
  });

  it("marks thread as stale when change overlaps anchor range", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 40, endLine: 44, newLineCount: 2 }],
    });
    expect(repo.isThreadStale(threadId)).toBe(true);
  });

  it("does not shift anchor when change is below anchor", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 50, endLine: 55, newLineCount: 3 }],
    });
    const thread = repo.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(42); // unchanged
  });

  it("does not affect threads in other files", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/other.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 5 }],
    });
    const thread = repo.getThread(threadId)!;
    const anchor = thread.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(42); // unchanged
  });

  it("does not affect surface-anchored threads", () => {
    const surfResult = repo.createThread(makeCreateParams({
      uri: "file:///project/src/auth.ts",
      anchor: surfaceAnchor("file:///project/src/auth.ts"),
    }));
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 5 }],
    });
    const surfThread = repo.getThread(surfResult.threadId)!;
    expect(surfThread.anchor.kind).toBe("surface"); // unchanged kind
  });

  it("thread is not stale by default", () => {
    expect(repo.isThreadStale(threadId)).toBe(false);
  });

  it("onDocumentChanged returns affectedUri", () => {
    const result = repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 10, newLineCount: 2 }],
    });
    expect(result.affectedUri).toBe("file:///project/src/auth.ts");
  });

  it("pure deletion (newLineCount=0 over a 2-line range) shifts anchor down by -2", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 10, endLine: 12, newLineCount: 0 }],
    });
    const anchor = repo.getThread(threadId)!.anchor as CommentAnchorText;
    expect(anchor.range.startLine).toBe(40);
  });
});

// ── isThreadStale ────────────────────────────────────────────────────────────

describe("isThreadStale", () => {
  let threadId: string;

  beforeEach(() => {
    const result = repo.createThread(makeCreateParams());
    threadId = result.threadId;
  });

  it("returns false for non-existent thread", () => {
    expect(repo.isThreadStale("nonexistent")).toBe(false);
  });

  it("returns true after overlapping document change", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 40, endLine: 44, newLineCount: 2 }],
    });
    expect(repo.isThreadStale(threadId)).toBe(true);
  });

  it("stale flag persists across repository operations", () => {
    repo.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 40, endLine: 44, newLineCount: 2 }],
    });
    expect(repo.isThreadStale(threadId)).toBe(true);
    // Reply should not clear stale flag
    repo.reply({ threadId, body: "Reply", author: { kind: "user", name: "Dev" } });
    expect(repo.isThreadStale(threadId)).toBe(true);
  });
});

// ── getCounts ─────────────────────────────────────────────────────────────────

describe("getCounts", () => {
  it("returns correct open/resolved counts", () => {
    const r1 = repo.createThread(makeCreateParams());
    repo.createThread(makeCreateParams({ body: "Second" }));
    expect(repo.getCounts()).toEqual({ open: 2, resolved: 0 });
    repo.resolve({
      threadId: r1.threadId,
      resolutionNote: "Done",
      author: { kind: "agent", name: "Agent" },
    });
    expect(repo.getCounts()).toEqual({ open: 1, resolved: 1 });
  });

  it("returns {open:0, resolved:0} for empty repository", () => {
    expect(repo.getCounts()).toEqual({ open: 0, resolved: 0 });
  });
});

// ── removeThreadsByUris ───────────────────────────────────────────────────────

describe("removeThreadsByUris", () => {
  it("REPO-PRUNE-01: returns empty array when store has no threads", () => {
    const removed = repo.removeThreadsByUris(new Set(["file:///gone.ts"]));
    expect(removed).toEqual([]);
  });

  it("REPO-PRUNE-02: returns empty array when all URIs exist", () => {
    repo.createThread(makeCreateParams());
    const removed = repo.removeThreadsByUris(new Set(["file:///project/src/auth.ts"]));
    expect(removed).toEqual([]);
    expect(repo.getAllThreads()).toHaveLength(1);
  });

  it("REPO-PRUNE-03: removes threads whose URIs are in the provided set and returns their IDs", () => {
    const r1 = repo.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    const r2 = repo.createThread(makeCreateParams({ uri: "file:///alive.ts", anchor: textAnchor("file:///alive.ts", 0) }));
    const existing = new Set(["file:///alive.ts"]);
    const removed = repo.removeThreadsByUris(existing);
    expect(removed).toEqual(["file:///gone.ts"]);
    expect(repo.getAllThreads()).toHaveLength(1);
    expect(repo.getThread(r1.threadId)).toBeUndefined();
    expect(repo.getThread(r2.threadId)).toBeDefined();
  });

  it("REPO-PRUNE-04: removes all threads for a given URI in one call", () => {
    repo.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    repo.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 1), body: "second" }));
    // Pass an empty alive-URIs set: both threads on gone.ts are not alive → both removed
    const removed = repo.removeThreadsByUris(new Set<string>([]));
    expect(removed).toHaveLength(2);
    expect(repo.getAllThreads()).toHaveLength(0);
  });

  it("removes threads from stale set when pruned", () => {
    const r1 = repo.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    repo.onDocumentChanged({
      uri: "file:///gone.ts",
      changes: [{ startLine: 0, endLine: 2, newLineCount: 5 }],
    });
    expect(repo.isThreadStale(r1.threadId)).toBe(true);
    // Empty alive-URIs set: gone.ts thread is pruned → stale entry also cleared
    repo.removeThreadsByUris(new Set<string>([]));
    expect(repo.isThreadStale(r1.threadId)).toBe(false);
  });

  it("increments version when threads are removed", () => {
    repo.createThread(makeCreateParams({ uri: "file:///gone.ts", anchor: textAnchor("file:///gone.ts", 0) }));
    const initialVersion = repo.getVersionInfo().version;
    // Empty alive-URIs set: gone.ts thread is not alive → removed → version increments
    repo.removeThreadsByUris(new Set<string>([]));
    expect(repo.getVersionInfo().version).toBe(initialVersion + 1);
  });
});

// ── Round-trip: loadFromStoreFile → mutate → toStoreFile ─────────────────────

describe("Round-trip: loadFromStoreFile → mutate → toStoreFile", () => {
  it("persists mutations after loading from a store file", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///project/src/a.ts", 1),
          comments: [{ id: "c1", threadId: "t1", createdAt: "2026-01-01T00:00:00Z", author: { kind: "user", name: "Dev" }, body: "Initial", anchor: textAnchor("file:///project/src/a.ts", 1), status: "open" }],
          status: "open",
          createdAt: "2026-01-01T00:00:00Z",
          lastActivity: "2026-01-01T00:00:00Z",
        },
      ],
    };
    repo.loadFromStoreFile(file);
    repo.createThread(makeCreateParams({ uri: "file:///project/src/b.ts", anchor: textAnchor("file:///project/src/b.ts", 5), body: "New thread" }));
    const result = repo.toStoreFile();
    expect(result.threads).toHaveLength(2);
    const t1 = result.threads.find(t => t.id === "t1");
    expect(t1).toBeDefined();
    const t2 = result.threads.find(t => t.id !== "t1");
    expect(t2!.comments[0].body).toBe("New thread");
  });

  it("loaded threads can be replied to and resolved", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///project/src/a.ts", 1),
          comments: [{ id: "c1", threadId: "t1", createdAt: "2026-01-01T00:00:00Z", author: { kind: "user", name: "Dev" }, body: "Initial", anchor: textAnchor("file:///project/src/a.ts", 1), status: "open" }],
          status: "open",
          createdAt: "2026-01-01T00:00:00Z",
          lastActivity: "2026-01-01T00:00:00Z",
        },
      ],
    };
    repo.loadFromStoreFile(file);
    repo.reply({ threadId: "t1", body: "Reply to loaded", author: { kind: "agent", name: "Agent" } });
    repo.resolve({ threadId: "t1", resolutionNote: "Resolved", author: { kind: "agent", name: "Agent" } });
    const thread = repo.getThread("t1")!;
    // 1 initial + 1 reply + 1 resolve-comment = 3 comments total
    expect(thread.comments).toHaveLength(3);
    expect(thread.status).toBe("resolved");
  });
});
