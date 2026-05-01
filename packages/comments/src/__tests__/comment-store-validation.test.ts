/**
 * Tests for CommentStore / CommentRepository load-time and mutation validation.
 *
 * Source: requirements-comments.md M36-CS-12, M36-CS-13
 *
 * Requirements:
 *   M36-CS-12: Persisted store data validated at load time — empty IDs, mismatched
 *              comment.threadId, duplicate IDs are dropped with a validation report.
 *   M36-CS-13: Mutation boundaries validate caller-supplied IDs before repository
 *              mutation — empty/whitespace IDs never enter runtime state.
 *
 * Validation contract:
 *   - Trim rule: threadId/commentId are trimmed; "" or whitespace-only → invalid
 *   - Load-time duplicate precedence: first valid occurrence wins, later duplicates dropped
 *   - Load-time thread precedence: thread with invalid/whitespace thread ID is dropped
 *     before comment-level validation
 *   - Load-time comment precedence: empty-comment-id → mismatched-comment-thread-id →
 *     duplicate-comment-id (first issue code wins)
 *   - Empty-thread-after-sanitization: thread dropped when all comments are dropped
 *   - Stable error vocabulary: invalid-thread-id, invalid-comment-id, duplicate-thread-id,
 *     duplicate-comment-id, thread-not-found, comment-not-found, thread-already-resolved,
 *     thread-not-resolved
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { workspace, resetMockState } from "./mocks/vscode.js";
import { CommentStore } from "../comment-store.js";
import { sanitizeLoadedCommentStoreFile } from "../comment-store-validation.js";
import { COMMENT_MAX_COMMENTS_PER_THREAD, COMMENT_MAX_THREADS, type CommentStoreFile, type CommentAnchorText } from "@accordo/bridge-types";

function makeInMemoryStore(threads: CommentStoreFile["threads"] = []): CommentStore {
  let data: CommentStoreFile = { version: "1.0", threads };
  const adapter = {
    async read() { return data; },
    async write(file: CommentStoreFile) { data = file; },
  };
  return new CommentStore(adapter);
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function textAnchor(uri: string, line: number): CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine: line, startChar: 0, endLine: line, endChar: 0 },
    docVersion: 1,
  };
}

function makeStoreFile(threads: CommentStoreFile["threads"]): CommentStoreFile {
  return { version: "1.0", threads };
}

async function expectRejectsWithExactMessage(action: Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expectedMessage);
    return;
  }
  throw new Error(`Expected rejection with ${expectedMessage}`);
}

// ── Setup ────────────────────────────────────────────────────────────────────

let store: CommentStore;

beforeEach(() => {
  resetMockState();
  store = new CommentStore();
});

// ── M36-CS-12: Load-time validation ─────────────────────────────────────────

describe("M36-CS-12: load-time validation", () => {
  describe("empty thread ID at load time", () => {
    it("drops thread with empty string thread ID", async () => {
      const file = makeStoreFile([
        {
          id: "",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [{
            id: "c1",
            threadId: "",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Should be dropped",
            anchor: textAnchor("file:///project/src/auth.ts", 42),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
        {
          id: "valid-thread",
          anchor: textAnchor("file:///project/src/auth.ts", 10),
          comments: [{
            id: "c2",
            threadId: "valid-thread",
            createdAt: "2026-03-03T10:01:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Valid thread",
            anchor: textAnchor("file:///project/src/auth.ts", 10),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:01:00Z",
          lastActivity: "2026-03-03T10:01:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      expect(store.getAllThreads()).toHaveLength(1);
      expect(store.getThread("valid-thread")).toBeDefined();
      expect(store.getThread("")).toBeUndefined();
    });

    it("drops thread with whitespace-only thread ID after trim", async () => {
      const file = makeStoreFile([
        {
          id: "   ",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [{
            id: "c1",
            threadId: "   ",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Should be dropped",
            anchor: textAnchor("file:///project/src/auth.ts", 42),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      expect(store.getAllThreads()).toHaveLength(0);
    });
  });

  describe("mismatched comment.threadId at load time", () => {
    it("drops comment where comment.threadId does not match parent thread.id", async () => {
      const file = makeStoreFile([
        {
          id: "thread-1",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [
            {
              id: "c1",
              threadId: "thread-1", // correct
              createdAt: "2026-03-03T10:00:00Z",
              author: { kind: "user", name: "Dev" },
              body: "Valid comment",
              anchor: textAnchor("file:///project/src/auth.ts", 42),
              status: "open",
            },
            {
              id: "c2",
              threadId: "wrong-thread-id", // mismatched — should be dropped
              createdAt: "2026-03-03T10:01:00Z",
              author: { kind: "user", name: "Dev" },
              body: "Mismatched comment",
              anchor: textAnchor("file:///project/src/auth.ts", 42),
              status: "open",
            },
          ],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      // Thread may be undefined if load-time validation dropped it
      const thread = store.getThread("thread-1");
      expect(thread).toBeDefined();
      expect(thread!.comments).toHaveLength(1);
      expect(thread!.comments[0].id).toBe("c1");
    });

    it("drops entire thread when all comments have mismatched threadId", async () => {
      const file = makeStoreFile([
        {
          id: "thread-1",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [
            {
              id: "c1",
              threadId: "wrong-id", // mismatched — thread should be dropped
              createdAt: "2026-03-03T10:00:00Z",
              author: { kind: "user", name: "Dev" },
              body: "Bad comment",
              anchor: textAnchor("file:///project/src/auth.ts", 42),
              status: "open",
            },
          ],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      expect(store.getAllThreads()).toHaveLength(0);
    });
  });

  describe("load-time duplicate precedence (first wins)", () => {
    it("first occurrence of duplicate thread ID is retained; later duplicate dropped", async () => {
      const file = makeStoreFile([
        {
          id: "duplicate-id",
          anchor: textAnchor("file:///project/a.ts", 1),
          comments: [{
            id: "c1",
            threadId: "duplicate-id",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "First — should be kept",
            anchor: textAnchor("file:///project/a.ts", 1),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
        {
          id: "duplicate-id", // duplicate — should be dropped
          anchor: textAnchor("file:///project/b.ts", 2),
          comments: [{
            id: "c2",
            threadId: "duplicate-id",
            createdAt: "2026-03-03T10:01:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Second — should be dropped",
            anchor: textAnchor("file:///project/b.ts", 2),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:01:00Z",
          lastActivity: "2026-03-03T10:01:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      const threads = store.getAllThreads();
      expect(threads).toHaveLength(1);
      expect(threads[0].comments[0].body).toBe("First — should be kept");
    });

    it("first occurrence of duplicate comment ID is retained within same thread; later duplicate dropped", async () => {
      const file = makeStoreFile([
        {
          id: "thread-1",
          anchor: textAnchor("file:///project/src/auth.ts", 42),
          comments: [
            {
              id: "dup-comment",
              threadId: "thread-1",
              createdAt: "2026-03-03T10:00:00Z",
              author: { kind: "user", name: "Dev" },
              body: "First comment — kept",
              anchor: textAnchor("file:///project/src/auth.ts", 42),
              status: "open",
            },
            {
              id: "dup-comment", // duplicate comment ID within same thread — dropped
              threadId: "thread-1",
              createdAt: "2026-03-03T10:01:00Z",
              author: { kind: "user", name: "Dev" },
              body: "Duplicate — dropped",
              anchor: textAnchor("file:///project/src/auth.ts", 42),
              status: "open",
            },
          ],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      // Thread may be undefined if load-time validation dropped it
      const thread = store.getThread("thread-1");
      expect(thread).toBeDefined();
      expect(thread!.comments).toHaveLength(1);
      expect(thread!.comments[0].body).toBe("First comment — kept");
    });

    it("duplicate comment ID across different threads — each thread keeps its own first occurrence", async () => {
      const file = makeStoreFile([
        {
          id: "thread-1",
          anchor: textAnchor("file:///project/a.ts", 1),
          comments: [{
            id: "shared-comment-id",
            threadId: "thread-1",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Thread 1 comment",
            anchor: textAnchor("file:///project/a.ts", 1),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
        {
          id: "thread-2",
          anchor: textAnchor("file:///project/b.ts", 2),
          comments: [{
            id: "shared-comment-id", // same comment ID but different thread — both kept
            threadId: "thread-2",
            createdAt: "2026-03-03T10:01:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Thread 2 comment",
            anchor: textAnchor("file:///project/b.ts", 2),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:01:00Z",
          lastActivity: "2026-03-03T10:01:00Z",
        },
      ]);
      const encoder = new TextEncoder();
      workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));
      await store.load("/project");

      // Both threads are kept — duplicate check is per-thread, not global
      expect(store.getAllThreads()).toHaveLength(2);
    });
  });
});

// ── Validation report helpers ─────────────────────────────────────────────────

/** Extract sorted issue codes from a validation result. */
function issueCodes(
  result: import("../comment-store-validation.js").CommentStoreValidationResult,
): string[] {
  return result.issues.map((i) => i.code).sort();
}

/** Thread IDs present in the sanitized output (sorted for comparison). */
function threadIds(
  result: import("../comment-store-validation.js").CommentStoreValidationResult,
): string[] {
  return result.sanitized.threads.map((t) => t.id).sort();
}

/** Comments for a given thread ID in the sanitized output. */
function commentsFor(
  result: import("../comment-store-validation.js").CommentStoreValidationResult,
  threadId: string,
): import("@accordo/bridge-types").Comment[] {
  return result.sanitized.threads.find((t) => t.id === threadId)?.comments ?? [];
}

// ── M36-CS-12: Validation report surface ─────────────────────────────────────

describe("M36-CS-12: validation report — machine-checkable retained/dropped proof", () => {
  it("reports 'empty-thread-id' issue; drops invalid thread from sanitized output", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "",
          anchor: textAnchor("file:///p/test.ts", 1),
          comments: [{
            id: "c1", threadId: "", createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" }, body: "Bad",
            anchor: textAnchor("file:///p/test.ts", 1), status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };

    let result: import("../comment-store-validation.js").CommentStoreValidationResult;
    try {
      result = sanitizeLoadedCommentStoreFile(file);
    } catch (err) {
      expect(err).toBe(null); // unreachable on stub impl; makes shape assertion the failure point
      return;
    }

    // Exact issue code set
    expect(issueCodes(result)).toEqual(["empty-thread-id"]);

    // Thread with empty ID is dropped; no threads remain
    expect(result.sanitized.threads).toHaveLength(0);
  });

  it("reports 'mismatched-comment-thread-id' issue; drops mismatched comment; drops thread when all comments dropped", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1",
          anchor: textAnchor("file:///p/test.ts", 1),
          comments: [{
            id: "c1", threadId: "wrong-id", createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" }, body: "Mismatched",
            anchor: textAnchor("file:///p/test.ts", 1), status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };

    let result: import("../comment-store-validation.js").CommentStoreValidationResult;
    try {
      result = sanitizeLoadedCommentStoreFile(file);
    } catch (err) {
      expect(err).toBe(null);
      return;
    }

    // Exact issue code set (per-line-133: thread dropped when all comments dropped)
    expect(issueCodes(result)).toEqual(["mismatched-comment-thread-id"]);

    // Thread with zero comments after sanitization is dropped entirely
    expect(result.sanitized.threads).toHaveLength(0);
  });

  it("reports 'duplicate-thread-id' for repeated thread ID; first occurrence retained", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "dup", anchor: textAnchor("file:///p/a.ts", 1),
          comments: [{
            id: "c1", threadId: "dup", createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" }, body: "First",
            anchor: textAnchor("file:///p/a.ts", 1), status: "open",
          }],
          status: "open", createdAt: "2026-03-03T10:00:00Z", lastActivity: "2026-03-03T10:00:00Z",
        },
        {
          id: "dup", anchor: textAnchor("file:///p/b.ts", 2),
          comments: [{
            id: "c2", threadId: "dup", createdAt: "2026-03-03T10:01:00Z",
            author: { kind: "user", name: "Dev" }, body: "Second",
            anchor: textAnchor("file:///p/b.ts", 2), status: "open",
          }],
          status: "open", createdAt: "2026-03-03T10:01:00Z", lastActivity: "2026-03-03T10:01:00Z",
        },
      ],
    };

    let result: import("../comment-store-validation.js").CommentStoreValidationResult;
    try {
      result = sanitizeLoadedCommentStoreFile(file);
    } catch (err) {
      expect(err).toBe(null);
      return;
    }

    // Exact issue code — only duplicate-thread-id (first wins; duplicate dropped)
    expect(issueCodes(result)).toEqual(["duplicate-thread-id"]);

    // Exactly one thread retained (first occurrence)
    expect(threadIds(result)).toEqual(["dup"]);

    // First thread retained with its first comment body
    expect(commentsFor(result, "dup")).toHaveLength(1);
    expect(commentsFor(result, "dup")[0].body).toBe("First");
  });

  it("reports 'duplicate-comment-id' for repeated comment ID; first occurrence retained within same thread", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1", anchor: textAnchor("file:///p/test.ts", 1),
          comments: [
            {
              id: "dup", threadId: "t1", createdAt: "2026-03-03T10:00:00Z",
              author: { kind: "user", name: "Dev" }, body: "First",
              anchor: textAnchor("file:///p/test.ts", 1), status: "open",
            },
            {
              id: "dup", threadId: "t1", createdAt: "2026-03-03T10:01:00Z",
              author: { kind: "user", name: "Dev" }, body: "Second",
              anchor: textAnchor("file:///p/test.ts", 1), status: "open",
            },
          ],
          status: "open", createdAt: "2026-03-03T10:00:00Z", lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };

    let result: import("../comment-store-validation.js").CommentStoreValidationResult;
    try {
      result = sanitizeLoadedCommentStoreFile(file);
    } catch (err) {
      expect(err).toBe(null);
      return;
    }

    // Exact issue code set
    expect(issueCodes(result)).toEqual(["duplicate-comment-id"]);

    // Thread retained; exactly one comment (first wins)
    expect(threadIds(result)).toEqual(["t1"]);
    expect(commentsFor(result, "t1")).toHaveLength(1);
    expect(commentsFor(result, "t1")[0].body).toBe("First");
  });

  it("empty-thread-after-sanitization: thread dropped when all comments are dropped", () => {
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "t1", anchor: textAnchor("file:///p/test.ts", 1),
          comments: [{
            id: "c1", threadId: "wrong-id", createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" }, body: "Bad",
            anchor: textAnchor("file:///p/test.ts", 1), status: "open",
          }],
          status: "open", createdAt: "2026-03-03T10:00:00Z", lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };

    let result: import("../comment-store-validation.js").CommentStoreValidationResult;
    try {
      result = sanitizeLoadedCommentStoreFile(file);
    } catch (err) {
      expect(err).toBe(null);
      return;
    }

    // Mismatch issue reported
    expect(issueCodes(result)).toEqual(["mismatched-comment-thread-id"]);

    // Thread with zero comments after sanitization is dropped entirely
    expect(result.sanitized.threads).toHaveLength(0);
  });
});

// ── M36-CS-13: Mutation boundary validation ──────────────────────────────────

describe("M36-CS-13: mutation boundary validation rejects invalid IDs", () => {
  beforeEach(() => {
    store = makeInMemoryStore();
  });
  beforeEach(async () => {
    await store.load("/project");
  });

  describe("comment_create: rejects whitespace threadId/commentId", () => {
    it("throws 'invalid-thread-id' for empty string threadId on createThread", async () => {
      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        threadId: "",
      }), "invalid-thread-id");
    });

    it("throws 'invalid-thread-id' for whitespace-only threadId on createThread", async () => {
      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        threadId: "   ",
      }), "invalid-thread-id");
    });

    it("throws 'invalid-comment-id' for empty string commentId on createThread", async () => {
      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        commentId: "",
      }), "invalid-comment-id");
    });

    it("throws 'invalid-comment-id' for whitespace-only commentId on createThread", async () => {
      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        commentId: "\t",
      }), "invalid-comment-id");
    });

    it("valid non-empty threadId is accepted", async () => {
      const result = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        threadId: "my-custom-thread-id",
      });
      expect(store.getThread("my-custom-thread-id")).toBeDefined();
      expect(result.threadId).toBe("my-custom-thread-id");
    });
  });

  describe("comment_reply: validates threadId and commentId", () => {
    it("throws 'invalid-thread-id' for empty threadId on reply", async () => {
      await expectRejectsWithExactMessage(store.reply({
        threadId: "",
        body: "Reply",
        author: { kind: "user", name: "Dev" },
      }), "invalid-thread-id");
    });

    it("throws 'invalid-comment-id' for whitespace-only commentId on reply", async () => {
      const { threadId } = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });

      await expectRejectsWithExactMessage(store.reply({
        threadId,
        body: "Reply",
        author: { kind: "user", name: "Dev" },
        commentId: "  ",
      }), "invalid-comment-id");
    });

    it("throws 'thread-not-found' for non-existent threadId on reply", async () => {
      await expectRejectsWithExactMessage(store.reply({
        threadId: "nonexistent",
        body: "Reply",
        author: { kind: "user", name: "Dev" },
      }), "thread-not-found");
    });
  });

  describe("comment_resolve: validates threadId", () => {
    it("throws 'invalid-thread-id' for empty threadId on resolve", async () => {
      await expectRejectsWithExactMessage(store.resolve({
        threadId: "",
        resolutionNote: "Fixed",
        author: { kind: "user", name: "Dev" },
      }), "invalid-thread-id");
    });

    it("throws 'thread-not-found' for non-existent threadId on resolve", async () => {
      await expectRejectsWithExactMessage(store.resolve({
        threadId: "nonexistent",
        resolutionNote: "Fixed",
        author: { kind: "user", name: "Dev" },
      }), "thread-not-found");
    });

    it("throws 'thread-already-resolved' when resolving an already resolved thread", async () => {
      const { threadId } = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });
      await store.resolve({ threadId, resolutionNote: "Done", author: { kind: "user", name: "Dev" } });

      await expectRejectsWithExactMessage(store.resolve({
        threadId,
        resolutionNote: "Again",
        author: { kind: "user", name: "Dev" },
      }), "thread-already-resolved");
    });
  });

  describe("comment_reopen: validates threadId", () => {
    it("throws 'invalid-thread-id' for empty threadId on reopen", async () => {
      await expectRejectsWithExactMessage(store.reopen("", { kind: "user", name: "Dev" }), "invalid-thread-id");
    });

    it("throws 'thread-not-found' for non-existent threadId on reopen", async () => {
      await expectRejectsWithExactMessage(store.reopen("nonexistent", { kind: "user", name: "Dev" }), "thread-not-found");
    });

    it("throws 'thread-not-resolved' when reopening an open thread", async () => {
      const { threadId } = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });

      await expectRejectsWithExactMessage(store.reopen(threadId, { kind: "user", name: "Dev" }), "thread-not-resolved");
    });
  });

  describe("comment_delete: validates threadId and commentId", () => {
    it("throws 'invalid-thread-id' for empty threadId on delete", async () => {
      await expectRejectsWithExactMessage(store.delete({ threadId: "" }), "invalid-thread-id");
    });

    it("throws 'invalid-comment-id' for whitespace-only commentId on delete", async () => {
      const { threadId, commentId } = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });

      await expectRejectsWithExactMessage(store.delete({ threadId, commentId: "  " }), "invalid-comment-id");
    });

    it("throws 'thread-not-found' for non-existent threadId on delete", async () => {
      await expectRejectsWithExactMessage(store.delete({ threadId: "nonexistent" }), "thread-not-found");
    });

    it("throws 'comment-not-found' for non-existent commentId on delete", async () => {
      const { threadId } = await store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });

      await expectRejectsWithExactMessage(store.delete({ threadId, commentId: "nonexistent" }), "comment-not-found");
    });
  });

  describe("error precedence rules", () => {
    it("validation errors win over lookup errors in comment_create", async () => {
      // A threadId that is whitespace AND a thread that doesn't exist:
      // validation error should fire first (not thread-not-found)
      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/auth.ts",
        anchor: textAnchor("file:///project/src/auth.ts", 42),
        body: "Test",
        author: { kind: "user", name: "Dev" },
        threadId: "   ", // whitespace
      }), "invalid-thread-id");
    });

    it("validation errors win over lookup errors in comment_reply", async () => {
      await expectRejectsWithExactMessage(store.reply({
        threadId: "   ", // whitespace
        body: "Reply",
        author: { kind: "user", name: "Dev" },
      }), "invalid-thread-id");
    });

    it("duplicate thread ID wins over thread-limit-reached", async () => {
      const first = await store.createThread({
        uri: "file:///project/src/first.ts",
        anchor: textAnchor("file:///project/src/first.ts", 1),
        body: "First",
        author: { kind: "user", name: "Dev" },
        threadId: "duplicate-thread",
      });

      for (let index = store.getAllThreads().length; index < COMMENT_MAX_THREADS; index++) {
        await store.createThread({
          uri: `file:///project/src/${index}.ts`,
          anchor: textAnchor(`file:///project/src/${index}.ts`, index),
          body: "Filler",
          author: { kind: "user", name: "Dev" },
          threadId: `thread-${index}`,
        });
      }

      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/overflow.ts",
        anchor: textAnchor("file:///project/src/overflow.ts", 99),
        body: "Duplicate should win",
        author: { kind: "user", name: "Dev" },
        threadId: first.threadId,
      }), "duplicate-thread-id");
    });

    it("duplicate initial comment ID wins over thread-limit-reached", async () => {
      const first = await store.createThread({
        uri: "file:///project/src/first-comment.ts",
        anchor: textAnchor("file:///project/src/first-comment.ts", 1),
        body: "First",
        author: { kind: "user", name: "Dev" },
        commentId: "duplicate-comment",
      });

      for (let index = store.getAllThreads().length; index < COMMENT_MAX_THREADS; index++) {
        await store.createThread({
          uri: `file:///project/src/${index}.ts`,
          anchor: textAnchor(`file:///project/src/${index}.ts`, index),
          body: "Filler",
          author: { kind: "user", name: "Dev" },
          threadId: `thread-${index}`,
        });
      }

      await expectRejectsWithExactMessage(store.createThread({
        uri: "file:///project/src/overflow-comment.ts",
        anchor: textAnchor("file:///project/src/overflow-comment.ts", 99),
        body: "Duplicate comment should win",
        author: { kind: "user", name: "Dev" },
        commentId: first.commentId,
      }), "duplicate-comment-id");
    });

    it("duplicate reply comment ID wins over comment-limit-reached", async () => {
      const { threadId, commentId } = await store.createThread({
        uri: "file:///project/src/full-thread.ts",
        anchor: textAnchor("file:///project/src/full-thread.ts", 1),
        body: "First",
        author: { kind: "user", name: "Dev" },
      });

      for (let index = 1; index < COMMENT_MAX_COMMENTS_PER_THREAD; index++) {
        await store.reply({
          threadId,
          body: "Filler reply",
          author: { kind: "user", name: "Dev" },
          commentId: `reply-${index}`,
        });
      }

      await expectRejectsWithExactMessage(store.reply({
        threadId,
        body: "Duplicate reply should win",
        author: { kind: "user", name: "Dev" },
        commentId,
      }), "duplicate-comment-id");
    });
  });
});
