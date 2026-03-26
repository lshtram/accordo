/**
 * composite-notifier.test.ts
 *
 * Tests for CompositeCommentUINotifier — the fan-out notifier that delegates
 * all CommentUINotifier calls to both the primary notifier and any registered
 * secondary notifiers.
 *
 * Requirements:
 *   CN-01: addThread fans out to all registered notifiers
 *   CN-02: updateThread fans out to all registered notifiers
 *   CN-03: removeThread fans out to all registered notifiers
 *   CN-04: add() returns a disposable that correctly removes the secondary notifier
 *   CN-05: After dispose, the removed notifier no longer receives calls
 *   CN-06: Primary notifier is never removed (dispose only removes the secondary)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompositeCommentUINotifier } from "../comment-tools.js";
import type { CommentUINotifier } from "../comment-tools.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeNotifier(): CommentUINotifier & {
  addThread: ReturnType<typeof vi.fn>;
  updateThread: ReturnType<typeof vi.fn>;
  removeThread: ReturnType<typeof vi.fn>;
} {
  return {
    addThread: vi.fn(),
    updateThread: vi.fn(),
    removeThread: vi.fn(),
  };
}

function makeThread(id = "thread-1"): CommentThread {
  return {
    id,
    anchor: { kind: "file", uri: "file:///foo.ts" },
    status: "open",
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as CommentThread;
}

let primary: ReturnType<typeof makeNotifier>;
let composite: CompositeCommentUINotifier;

beforeEach(() => {
  primary = makeNotifier();
  composite = new CompositeCommentUINotifier(primary);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CompositeCommentUINotifier", () => {

  describe("addThread", () => {
    it("CN-01a: addThread calls the primary notifier", () => {
      const thread = makeThread();
      composite.addThread(thread);
      expect(primary.addThread).toHaveBeenCalledTimes(1);
      expect(primary.addThread).toHaveBeenCalledWith(thread);
    });

    it("CN-01b: addThread fans out to a secondary notifier", () => {
      const secondary = makeNotifier();
      composite.add(secondary);

      const thread = makeThread();
      composite.addThread(thread);

      expect(primary.addThread).toHaveBeenCalledWith(thread);
      expect(secondary.addThread).toHaveBeenCalledWith(thread);
    });

    it("CN-01c: addThread fans out to multiple secondary notifiers", () => {
      const secondary1 = makeNotifier();
      const secondary2 = makeNotifier();
      composite.add(secondary1);
      composite.add(secondary2);

      const thread = makeThread();
      composite.addThread(thread);

      expect(primary.addThread).toHaveBeenCalledWith(thread);
      expect(secondary1.addThread).toHaveBeenCalledWith(thread);
      expect(secondary2.addThread).toHaveBeenCalledWith(thread);
    });
  });

  describe("updateThread", () => {
    it("CN-02a: updateThread calls the primary notifier", () => {
      const thread = makeThread();
      composite.updateThread(thread);
      expect(primary.updateThread).toHaveBeenCalledTimes(1);
      expect(primary.updateThread).toHaveBeenCalledWith(thread);
    });

    it("CN-02b: updateThread fans out to a secondary notifier", () => {
      const secondary = makeNotifier();
      composite.add(secondary);

      const thread = makeThread();
      composite.updateThread(thread);

      expect(primary.updateThread).toHaveBeenCalledWith(thread);
      expect(secondary.updateThread).toHaveBeenCalledWith(thread);
    });
  });

  describe("removeThread", () => {
    it("CN-03a: removeThread calls the primary notifier", () => {
      composite.removeThread("thread-99");
      expect(primary.removeThread).toHaveBeenCalledTimes(1);
      expect(primary.removeThread).toHaveBeenCalledWith("thread-99");
    });

    it("CN-03b: removeThread fans out to a secondary notifier", () => {
      const secondary = makeNotifier();
      composite.add(secondary);

      composite.removeThread("thread-abc");

      expect(primary.removeThread).toHaveBeenCalledWith("thread-abc");
      expect(secondary.removeThread).toHaveBeenCalledWith("thread-abc");
    });
  });

  describe("add() disposable", () => {
    it("CN-04: add() returns an object with a dispose function", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);
      expect(disposable).toHaveProperty("dispose");
      expect(typeof disposable.dispose).toBe("function");
    });

    it("CN-05a: after dispose, the removed secondary notifier no longer receives addThread calls", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);

      disposable.dispose();

      const thread = makeThread();
      composite.addThread(thread);

      expect(secondary.addThread).not.toHaveBeenCalled();
    });

    it("CN-05b: after dispose, the removed secondary notifier no longer receives updateThread calls", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);

      disposable.dispose();

      const thread = makeThread();
      composite.updateThread(thread);

      expect(secondary.updateThread).not.toHaveBeenCalled();
    });

    it("CN-05c: after dispose, the removed secondary notifier no longer receives removeThread calls", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);

      disposable.dispose();

      composite.removeThread("thread-xyz");

      expect(secondary.removeThread).not.toHaveBeenCalled();
    });

    it("CN-06: primary notifier still receives calls after a secondary is disposed", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);

      disposable.dispose();

      const thread = makeThread();
      composite.addThread(thread);

      // Primary must still receive the call
      expect(primary.addThread).toHaveBeenCalledTimes(1);
      expect(primary.addThread).toHaveBeenCalledWith(thread);
    });

    it("CN-06b: dispose is idempotent — calling it twice does not throw", () => {
      const secondary = makeNotifier();
      const disposable = composite.add(secondary);

      disposable.dispose();
      expect(() => disposable.dispose()).not.toThrow();
    });
  });
});
