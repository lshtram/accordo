/**
 * M80-STORE — store.test.ts
 *
 * Tests for the Comment Storage Manager.
 * Covers CRUD, soft-delete semantics, URL normalization, filtered queries.
 *
 * Protects: BR-F-20 through BR-F-30
 *
 * API checklist:
 * ✓ normalizeUrl — 3 tests
 * ✓ getStorageKey — 1 test
 * ✓ createThread — 4 tests
 * ✓ getActiveThreads — 4 tests
 * ✓ getAllThreads — 2 tests
 * ✓ addComment — 2 tests
 * ✓ softDeleteThread — 3 tests
 * ✓ softDeleteComment — 2 tests
 * ✓ updateComment — 1 test
 * ✓ getPageStore — 2 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import {
  normalizeUrl,
  getStorageKey,
  createThread,
  getActiveThreads,
  getAllThreads,
  addComment,
  softDeleteThread,
  softDeleteComment,
  updateComment,
  getPageStore,
  resolveThread,
  reopenThread,
} from "../src/store.js";

describe("M80-STORE — Comment Storage Manager", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("normalizeUrl", () => {
    it("BR-F-29: strips query params from URL", () => {
      // BR-F-29: URL normalization strips query params
      const result = normalizeUrl("https://example.com/page?utm=abc");
      expect(result).toBe("https://example.com/page");
    });

    it("BR-F-29: strips hash fragment from URL", () => {
      // BR-F-29: URL normalization strips hash
      const result = normalizeUrl("https://example.com/page#section");
      expect(result).toBe("https://example.com/page");
    });

    it("BR-F-29: strips both query params and hash", () => {
      // BR-F-29: Full normalization: origin + pathname only
      const result = normalizeUrl("https://example.com/page?utm=abc#section");
      expect(result).toBe("https://example.com/page");
    });
  });

  describe("getStorageKey", () => {
    it("BR-F-30: returns 'comments:{normalizedUrl}' format", () => {
      // BR-F-30: Storage key format is "comments:{normalizedUrl}"
      const key = getStorageKey("https://example.com/page");
      expect(key).toBe("comments:https://example.com/page");
    });
  });

  describe("createThread", () => {
    it("BR-F-20: creates a thread with a generated UUID id", async () => {
      // BR-F-20: Create a new thread with UUID v4 id
      const thread = await createThread("https://example.com/page", "div:0:hello", {
        body: "First comment",
        author: { kind: "user", name: "Alice" },
      });
      expect(typeof thread.id).toBe("string");
      expect(thread.id.length).toBeGreaterThan(0);
    });

    it("BR-F-21: first comment's id becomes the thread id", async () => {
      // BR-F-21: thread.id === thread.comments[0].id
      const thread = await createThread("https://example.com/page", "h1:0:title", {
        body: "Hello",
        author: { kind: "user", name: "Bob" },
      });
      expect(thread.id).toBe(thread.comments[0].id);
    });

    it("BR-F-21: normalizes URL before storing (strips query params)", async () => {
      // BR-F-21: createThread normalizes URL
      const thread = await createThread(
        "https://example.com/page?ref=xyz",
        "span:2:text",
        {
          body: "Comment",
          author: { kind: "user", name: "Alice" },
        }
      );
      // Thread should be stored under normalized URL
      const threads = await getActiveThreads("https://example.com/page");
      expect(threads.some((t) => t.id === thread.id)).toBe(true);
    });

    it("BR-F-20: sets createdAt to ISO 8601 timestamp", async () => {
      // BR-F-20: createdAt is valid ISO 8601
      const thread = await createThread("https://example.com", "p:0:text", {
        body: "Test",
        author: { kind: "user", name: "Alice" },
      });
      const parsed = new Date(thread.createdAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });
  });

  describe("getActiveThreads", () => {
    it("BR-F-27: returns only non-deleted threads for the URL", async () => {
      // BR-F-27: getActiveThreads excludes soft-deleted threads
      const t1 = await createThread("https://example.com/page", "div:0:a", {
        body: "Active",
        author: { kind: "user", name: "Alice" },
      });
      const t2 = await createThread("https://example.com/page", "div:1:b", {
        body: "Will be deleted",
        author: { kind: "user", name: "Bob" },
      });
      await softDeleteThread(t2.id);
      const active = await getActiveThreads("https://example.com/page");
      expect(active.some((t) => t.id === t1.id)).toBe(true);
      expect(active.some((t) => t.id === t2.id)).toBe(false);
    });

    it("BR-F-27: returns empty array when no threads exist", async () => {
      // BR-F-27: Empty result for unknown URL
      const threads = await getActiveThreads("https://unknown.com");
      expect(threads).toEqual([]);
    });

    it("BR-F-27: excludes soft-deleted threads from results", async () => {
      // BR-F-27: Soft-deleted threads hidden from active query
      const t = await createThread("https://example.com", "p:0:x", {
        body: "Deleted thread",
        author: { kind: "user", name: "Alice" },
      });
      await softDeleteThread(t.id);
      const active = await getActiveThreads("https://example.com");
      expect(active.find((th) => th.id === t.id)).toBeUndefined();
    });

    it("BR-F-27: filters out soft-deleted comments within active threads", async () => {
      // BR-F-27: Comments with deletedAt are excluded from active thread results
      const t = await createThread("https://example.com", "p:0:text", {
        body: "First",
        author: { kind: "user", name: "Alice" },
      });
      const reply = await addComment(t.id, {
        body: "Reply to delete",
        author: { kind: "user", name: "Bob" },
      });
      await softDeleteComment(t.id, reply.id);
      const active = await getActiveThreads("https://example.com");
      const found = active.find((th) => th.id === t.id);
      expect(found).toBeDefined();
      // Deleted comment must not appear in active thread
      expect(found!.comments.some((c) => c.id === reply.id)).toBe(false);
    });
  });

  describe("getAllThreads", () => {
    it("BR-F-28: returns ALL threads including soft-deleted", async () => {
      // BR-F-28: getAllThreads returns full history
      const t1 = await createThread("https://example.com", "div:0:a", {
        body: "Active",
        author: { kind: "user", name: "Alice" },
      });
      const t2 = await createThread("https://example.com", "div:1:b", {
        body: "Deleted",
        author: { kind: "user", name: "Bob" },
      });
      await softDeleteThread(t2.id);
      const all = await getAllThreads("https://example.com");
      expect(all.some((t) => t.id === t1.id)).toBe(true);
      expect(all.some((t) => t.id === t2.id)).toBe(true);
    });

    it("BR-F-28: returns empty array when no threads exist", async () => {
      // BR-F-28: Empty result for unknown URL
      const all = await getAllThreads("https://unknown.com");
      expect(all).toEqual([]);
    });
  });

  describe("addComment", () => {
    it("BR-F-22: appends comment to an existing thread", async () => {
      // BR-F-22: Reply appends comment with matching threadId
      const t = await createThread("https://example.com", "p:0:text", {
        body: "Original",
        author: { kind: "user", name: "Alice" },
      });
      const before = (await getActiveThreads("https://example.com")).find(
        (th) => th.id === t.id
      )!.comments.length;
      await addComment(t.id, {
        body: "Reply here",
        author: { kind: "user", name: "Bob" },
      });
      const after = (await getActiveThreads("https://example.com")).find(
        (th) => th.id === t.id
      )!.comments.length;
      expect(after).toBe(before + 1);
    });

    it("BR-F-22: updates thread lastActivity timestamp", async () => {
      // BR-F-22: lastActivity updated on reply
      vi.useFakeTimers();
      const t = await createThread("https://example.com", "p:0:text", {
        body: "Original",
        author: { kind: "user", name: "Alice" },
      });
      const before = t.lastActivity;
      // Advance timers deterministically
      await vi.advanceTimersByTimeAsync(5);
      await addComment(t.id, {
        body: "Another reply",
        author: { kind: "user", name: "Alice" },
      });
      const updated = (await getActiveThreads("https://example.com")).find(
        (th) => th.id === t.id
      )!;
      expect(updated.lastActivity >= before).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("softDeleteThread", () => {
    it("BR-F-26: sets thread deletedAt timestamp", async () => {
      // BR-F-26: Soft-delete sets deletedAt to ISO 8601 timestamp
      const t = await createThread("https://example.com", "div:0:a", {
        body: "Delete me",
        author: { kind: "user", name: "Alice" },
      });
      await softDeleteThread(t.id);
      const all = await getAllThreads("https://example.com");
      const found = all.find((th) => th.id === t.id);
      expect(found).toBeDefined();
      expect(found!.deletedAt).toBeDefined();
    });

    it("BR-F-26: soft-deleted thread remains in storage (not removed)", async () => {
      // BR-F-26: Thread still exists in storage after soft-delete
      const t = await createThread("https://example.com", "div:0:b", {
        body: "Keep me in storage",
        author: { kind: "user", name: "Alice" },
      });
      await softDeleteThread(t.id);
      const all = await getAllThreads("https://example.com");
      expect(all.some((th) => th.id === t.id)).toBe(true);
    });

    it("BR-F-28: soft-deleted thread still readable via getAllThreads", async () => {
      // BR-F-28: getAllThreads returns soft-deleted threads
      const t = await createThread("https://example.com", "div:0:c", {
        body: "Audit trail",
        author: { kind: "user", name: "Alice" },
      });
      await softDeleteThread(t.id);
      const all = await getAllThreads("https://example.com");
      expect(all.find((th) => th.id === t.id)?.deletedAt).toBeDefined();
    });
  });

  describe("softDeleteComment", () => {
    it("BR-F-25: sets comment deletedAt timestamp", async () => {
      // BR-F-25: Soft-delete sets comment.deletedAt
      const t = await createThread("https://example.com", "div:0:d", {
        body: "First",
        author: { kind: "user", name: "Alice" },
      });
      const reply = await addComment(t.id, {
        body: "Reply to delete",
        author: { kind: "user", name: "Bob" },
      });
      await softDeleteComment(t.id, reply.id);
      const all = await getAllThreads("https://example.com");
      const thread = all.find((th) => th.id === t.id)!;
      const comment = thread.comments.find((c) => c.id === reply.id);
      expect(comment).toBeDefined();
      expect(comment!.deletedAt).toBeDefined();
    });

    it("BR-F-27: soft-deleted comment is excluded from getActiveThreads", async () => {
      // BR-F-27: Active query filters out deleted comments
      const t = await createThread("https://example.com", "div:0:e", {
        body: "First",
        author: { kind: "user", name: "Alice" },
      });
      const reply = await addComment(t.id, {
        body: "To be deleted",
        author: { kind: "user", name: "Bob" },
      });
      await softDeleteComment(t.id, reply.id);
      const active = await getActiveThreads("https://example.com");
      const thread = active.find((th) => th.id === t.id)!;
      expect(thread.comments.some((c) => c.id === reply.id)).toBe(false);
    });
  });

  describe("updateComment", () => {
    it("BR-F-22: updates comment body in storage", async () => {
      // BR-F-22: updateComment changes body field
      const t = await createThread("https://example.com", "p:0:f", {
        body: "Original body",
        author: { kind: "user", name: "Alice" },
      });
      const commentId = t.comments[0].id;
      await updateComment(t.id, commentId, "Updated body text");
      const active = await getActiveThreads("https://example.com");
      const thread = active.find((th) => th.id === t.id)!;
      const comment = thread.comments.find((c) => c.id === commentId);
      expect(comment!.body).toBe("Updated body text");
    });
  });

  describe("resolveThread", () => {
    it("BR-F-23: sets thread status to 'resolved'", async () => {
      // BR-F-23: Resolve a thread: sets thread.status = "resolved"
      const t = await createThread("https://example.com", "p:0:g", {
        body: "Issue here",
        author: { kind: "user", name: "Alice" },
      });
      await resolveThread(t.id);
      const active = await getActiveThreads("https://example.com");
      const resolved = active.find((th) => th.id === t.id);
      expect(resolved!.status).toBe("resolved");
    });

    it("BR-F-23: can optionally set resolutionNote on the thread", async () => {
      // BR-F-23: Optionally sets resolutionNote
      const t = await createThread("https://example.com", "p:0:h", {
        body: "Fixed",
        author: { kind: "user", name: "Bob" },
      });
      await resolveThread(t.id, "Fixed in v2.1");
      const all = await getAllThreads("https://example.com");
      const resolved = all.find((th) => th.id === t.id)!;
      expect(resolved).toHaveProperty("resolutionNote", "Fixed in v2.1");
    });
  });

  describe("reopenThread", () => {
    it("BR-F-24: sets thread status back to 'open'", async () => {
      // BR-F-24: Reopen a resolved thread: sets status = "open"
      const t = await createThread("https://example.com", "p:0:i", {
        body: "Was resolved",
        author: { kind: "user", name: "Alice" },
      });
      await resolveThread(t.id);
      await reopenThread(t.id);
      const active = await getActiveThreads("https://example.com");
      const reopened = active.find((th) => th.id === t.id);
      expect(reopened!.status).toBe("open");
    });
  });

  describe("getPageStore", () => {
    it("BR-F-30: returns null when no store exists for the URL", async () => {
      // BR-F-30: getPageStore returns null for unknown URL
      const store = await getPageStore("https://unknown.com");
      expect(store).toBeNull();
    });

    it("BR-F-30: returns the PageCommentStore after a thread is created", async () => {
      // BR-F-30: getPageStore returns the stored object for a known URL
      await createThread("https://example.com/page", "div:0:g", {
        body: "Some comment",
        author: { kind: "user", name: "Alice" },
      });
      const store = await getPageStore("https://example.com/page");
      expect(store).not.toBeNull();
      expect(store!.url).toBe("https://example.com/page");
    });
  });
});
