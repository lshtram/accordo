/**
 * composite-notifier.test.ts
 *
 * Tests for ExternalFanoutNotifier — the external-only fan-out notifier that
 * delegates all CommentUINotifier calls to registered external observers
 * (e.g. browser relay) without involving NativeComments.
 *
 * NOTIFIER ARCHITECTURE (comments-sync-hardening):
 *   - ExternalFanoutNotifier is used for external observers only
 *   - NativeComments NEVER receives mutations via this path
 *   - Native widget mutation happens via store.onChanged -> nc.reconcile() ONLY
 *
 * Requirements (CN-0x):
 *   CN-01: addThread fans out to all registered notifiers
 *   CN-02: updateThread fans out to all registered notifiers
 *   CN-03: removeThread fans out to all registered notifiers
 *   CN-04: removeThreads fans out to all registered notifiers
 *   CN-05: add() returns a disposable that correctly removes the notifier
 *   CN-06: After dispose, the removed notifier no longer receives calls
 *   CN-07: ExternalFanoutNotifier has NO primary notifier (unlike CompositeCommentUINotifier)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExternalFanoutNotifier } from "../comment-tools.js";
import type { CommentUINotifier } from "../comment-tools.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeNotifier(): CommentUINotifier & {
  addThread: ReturnType<typeof vi.fn>;
  updateThread: ReturnType<typeof vi.fn>;
  removeThread: ReturnType<typeof vi.fn>;
  removeThreads: ReturnType<typeof vi.fn>;
} {
  return {
    addThread: vi.fn(),
    updateThread: vi.fn(),
    removeThread: vi.fn(),
    removeThreads: vi.fn(),
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

let fanout: ExternalFanoutNotifier;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fanout = new ExternalFanoutNotifier();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ExternalFanoutNotifier", () => {
  describe("CN-01: addThread fans out to all registered notifiers", () => {
    it("CN-01a: addThread calls the single registered notifier", () => {
      const notifier = makeNotifier();
      fanout.add(notifier);

      const thread = makeThread();
      fanout.addThread(thread);

      expect(notifier.addThread).toHaveBeenCalledTimes(1);
      expect(notifier.addThread).toHaveBeenCalledWith(thread);
    });

    it("CN-01b: addThread fans out to two registered notifiers", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);

      const thread = makeThread();
      fanout.addThread(thread);

      expect(notifier1.addThread).toHaveBeenCalledWith(thread);
      expect(notifier2.addThread).toHaveBeenCalledWith(thread);
    });

    it("CN-01c: addThread fans out to multiple registered notifiers", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      const notifier3 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);
      fanout.add(notifier3);

      const thread = makeThread();
      fanout.addThread(thread);

      expect(notifier1.addThread).toHaveBeenCalledWith(thread);
      expect(notifier2.addThread).toHaveBeenCalledWith(thread);
      expect(notifier3.addThread).toHaveBeenCalledWith(thread);
    });
  });

  describe("CN-02: updateThread fans out to all registered notifiers", () => {
    it("CN-02a: updateThread calls the single registered notifier", () => {
      const notifier = makeNotifier();
      fanout.add(notifier);

      const thread = makeThread();
      fanout.updateThread(thread);

      expect(notifier.updateThread).toHaveBeenCalledTimes(1);
      expect(notifier.updateThread).toHaveBeenCalledWith(thread);
    });

    it("CN-02b: updateThread fans out to multiple registered notifiers", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);

      const thread = makeThread();
      fanout.updateThread(thread);

      expect(notifier1.updateThread).toHaveBeenCalledWith(thread);
      expect(notifier2.updateThread).toHaveBeenCalledWith(thread);
    });
  });

  describe("CN-03: removeThread fans out to all registered notifiers", () => {
    it("CN-03a: removeThread calls the single registered notifier", () => {
      const notifier = makeNotifier();
      fanout.add(notifier);

      fanout.removeThread("thread-99");

      expect(notifier.removeThread).toHaveBeenCalledTimes(1);
      expect(notifier.removeThread).toHaveBeenCalledWith("thread-99");
    });

    it("CN-03b: removeThread fans out to multiple registered notifiers", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);

      fanout.removeThread("thread-abc");

      expect(notifier1.removeThread).toHaveBeenCalledWith("thread-abc");
      expect(notifier2.removeThread).toHaveBeenCalledWith("thread-abc");
    });
  });

  describe("CN-04: removeThreads fans out to all registered notifiers", () => {
    it("CN-04a: removeThreads calls the single registered notifier", () => {
      const notifier = makeNotifier();
      fanout.add(notifier);

      fanout.removeThreads(["thread-1", "thread-2"]);

      expect(notifier.removeThreads).toHaveBeenCalledTimes(1);
      expect(notifier.removeThreads).toHaveBeenCalledWith(["thread-1", "thread-2"]);
    });

    it("CN-04b: removeThreads fans out to multiple registered notifiers", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);

      fanout.removeThreads(["thread-x"]);

      expect(notifier1.removeThreads).toHaveBeenCalledWith(["thread-x"]);
      expect(notifier2.removeThreads).toHaveBeenCalledWith(["thread-x"]);
    });
  });

  describe("CN-05: add() disposable", () => {
    it("CN-05a: after dispose, the removed notifier no longer receives addThread calls", () => {
      const notifier = makeNotifier();
      const disposable = fanout.add(notifier);

      disposable.dispose();

      const thread = makeThread();
      fanout.addThread(thread);

      expect(notifier.addThread).not.toHaveBeenCalled();
    });

    it("CN-05b: after dispose, the removed notifier no longer receives updateThread calls", () => {
      const notifier = makeNotifier();
      const disposable = fanout.add(notifier);

      disposable.dispose();

      const thread = makeThread();
      fanout.updateThread(thread);

      expect(notifier.updateThread).not.toHaveBeenCalled();
    });

    it("CN-05c: after dispose, the removed notifier no longer receives removeThread calls", () => {
      const notifier = makeNotifier();
      const disposable = fanout.add(notifier);

      disposable.dispose();

      fanout.removeThread("thread-xyz");

      expect(notifier.removeThread).not.toHaveBeenCalled();
    });

    it("CN-05d: after dispose, the removed notifier no longer receives removeThreads calls", () => {
      const notifier = makeNotifier();
      const disposable = fanout.add(notifier);

      disposable.dispose();

      fanout.removeThreads(["thread-1", "thread-2"]);

      expect(notifier.removeThreads).not.toHaveBeenCalled();
    });
  });

  describe("CN-06: remaining notifiers still receive calls after one is disposed", () => {
    it("CN-06a: other notifiers still receive addThread after one is disposed", () => {
      const notifier1 = makeNotifier();
      const notifier2 = makeNotifier();
      fanout.add(notifier1);
      fanout.add(notifier2);

      fanout.add(notifier1); // add again so we can test the right one is still active
      const disposable = fanout.add(notifier1);
      disposable.dispose();

      const thread = makeThread();
      fanout.addThread(thread);

      // notifier2 is still active
      expect(notifier2.addThread).toHaveBeenCalledTimes(1);
      expect(notifier2.addThread).toHaveBeenCalledWith(thread);
    });
  });

  it("CN-07: dispose is idempotent — calling it twice does not throw", () => {
    const notifier = makeNotifier();
    const disposable = fanout.add(notifier);

    disposable.dispose();
    expect(() => disposable.dispose()).not.toThrow();
  });

  it("CN-08: with no notifiers registered, fanout operations are no-ops (no throw)", () => {
    const thread = makeThread();
    expect(() => fanout.addThread(thread)).not.toThrow();
    expect(() => fanout.updateThread(thread)).not.toThrow();
    expect(() => fanout.removeThread("id")).not.toThrow();
    expect(() => fanout.removeThreads(["id"])).not.toThrow();
  });
});
