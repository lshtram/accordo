/**
 * Tests for StateContribution — M39
 *
 * Source: comments-architecture.md §7
 *
 * Requirements covered:
 *   §7    buildCommentSummary: open/resolved counts, summary array
 *   §7    Summary capped at COMMENT_MAX_SUMMARY_THREADS (10) open threads
 *   §7    Body truncated to COMMENT_SUMMARY_PREVIEW_LENGTH (80 chars)
 *   §7    Most recent threads first (by lastActivity)
 *   §7    startStateContribution: publishes initial state + reactive updates
 *   §7    Text anchors include line number in summary
 *   §7    Surface anchors include surfaceType and nodeId in summary
 */

// API checklist:
// ✓ buildCommentSummary()       — §7 buildCommentSummary (9 tests)
// ✓ startStateContribution()    — §7 startStateContribution (4 tests)
// ✓ StateBridgeAPI interface    — mocked via makeMockBridge in every test

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetMockState, workspace } from "./mocks/vscode.js";
import {
  buildCommentSummary,
  startStateContribution,
  type StateBridgeAPI,
} from "../state-contribution.js";
import { CommentStore } from "../comment-store.js";
import type {
  CommentStateSummary,
  CommentThread,
  CommentAnchorText,
} from "@accordo/bridge-types";
import {
  COMMENT_MAX_SUMMARY_THREADS,
  COMMENT_SUMMARY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockStore(threads: CommentThread[] = []): CommentStore & {
  _listeners: Array<() => void>;
  _fireChanged: () => void;
} {
  const listeners: Array<() => void> = [];
  const store = new CommentStore();

  // Override methods to avoid "not implemented"
  store.getAllThreads = vi.fn().mockReturnValue(threads);
  store.getCounts = vi.fn().mockReturnValue({
    open: threads.filter(t => t.status === "open").length,
    resolved: threads.filter(t => t.status === "resolved").length,
  });
  store.onChanged = vi.fn().mockImplementation((cb: () => void) => {
    listeners.push(cb);
    return { dispose: () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } };
  });

  return Object.assign(store, {
    _listeners: listeners,
    _fireChanged: () => listeners.forEach(l => l()),
  });
}

function makeThread(id: string, overrides?: Partial<CommentThread>): CommentThread {
  return {
    id,
    anchor: {
      kind: "text" as const,
      uri: "file:///project/src/auth.ts",
      range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
      docVersion: 1,
    },
    comments: [
      {
        id: `c-${id}`,
        threadId: id,
        createdAt: "2026-03-03T10:00:00Z",
        author: { kind: "user" as const, name: "Developer" },
        body: "Fix this issue",
        anchor: {
          kind: "text" as const,
          uri: "file:///project/src/auth.ts",
          range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
          docVersion: 1,
        },
        status: "open" as const,
        intent: "fix" as const,
      },
    ],
    status: "open" as const,
    createdAt: "2026-03-03T10:00:00Z",
    lastActivity: "2026-03-03T10:00:00Z",
    ...overrides,
  };
}

function makeMockBridge(): StateBridgeAPI & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    publishState: vi.fn().mockImplementation((id: string, state: Record<string, unknown>) => {
      calls.push([id, state]);
    }),
    calls,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockState();
});

// ── §7 buildCommentSummary ───────────────────────────────────────────────────

describe("§7 buildCommentSummary", () => {
  it("returns correct counts for empty store", () => {
    const store = makeMockStore([]);
    const summary = buildCommentSummary(store);
    expect(summary.isOpen).toBe(true);
    expect(summary.openThreadCount).toBe(0);
    expect(summary.resolvedThreadCount).toBe(0);
    expect(summary.summary).toEqual([]);
  });

  it("returns correct open/resolved counts", () => {
    const threads = [
      makeThread("t1", { status: "open" }),
      makeThread("t2", { status: "open" }),
      makeThread("t3", { status: "resolved" }),
    ];
    const store = makeMockStore(threads);
    const summary = buildCommentSummary(store);
    expect(summary.openThreadCount).toBe(2);
    expect(summary.resolvedThreadCount).toBe(1);
  });

  it("includes only open threads in summary array", () => {
    const threads = [
      makeThread("t1", { status: "open" }),
      makeThread("t2", { status: "resolved" }),
    ];
    const store = makeMockStore(threads);
    const summary = buildCommentSummary(store);
    expect(summary.summary).toHaveLength(1);
    expect(summary.summary[0].threadId).toBe("t1");
  });

  it("caps summary at COMMENT_MAX_SUMMARY_THREADS open threads", () => {
    const threads: CommentThread[] = [];
    for (let i = 0; i < 15; i++) {
      threads.push(makeThread(`t${i}`, {
        status: "open",
        lastActivity: `2026-03-03T10:${String(i).padStart(2, "0")}:00Z`,
      }));
    }
    const store = makeMockStore(threads);
    const summary = buildCommentSummary(store);
    expect(summary.summary).toHaveLength(COMMENT_MAX_SUMMARY_THREADS);
  });

  it("orders summary by most recent lastActivity first", () => {
    const threads = [
      makeThread("t-old", { status: "open", lastActivity: "2026-03-03T10:00:00Z" }),
      makeThread("t-new", { status: "open", lastActivity: "2026-03-03T11:00:00Z" }),
    ];
    const store = makeMockStore(threads);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].threadId).toBe("t-new");
    expect(summary.summary[1].threadId).toBe("t-old");
  });

  it("truncates preview to COMMENT_SUMMARY_PREVIEW_LENGTH", () => {
    const longBody = "A".repeat(200);
    const threads = [
      makeThread("t1", {
        status: "open",
        comments: [{
          id: "c1",
          threadId: "t1",
          createdAt: "2026-03-03T10:00:00Z",
          author: { kind: "user", name: "Dev" },
          body: longBody,
          anchor: makeThread("t1").anchor,
          status: "open",
        }],
      }),
    ];
    const store = makeMockStore(threads);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].preview.length).toBeLessThanOrEqual(COMMENT_SUMMARY_PREVIEW_LENGTH);
  });

  it("includes line number for text-anchored threads", () => {
    const store = makeMockStore([makeThread("t1")]);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].line).toBe(42);
  });

  it("includes surfaceType and nodeId for surface-anchored threads", () => {
    const surfThread = makeThread("t-surf", {
      anchor: {
        kind: "surface",
        uri: "file:///project/diagrams/arch.mmd",
        surfaceType: "diagram",
        coordinates: { type: "diagram-node", nodeId: "auth-node" },
      },
    });
    const store = makeMockStore([surfThread]);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].surfaceType).toBe("diagram");
    expect(summary.summary[0].nodeId).toBe("auth-node");
  });

  it("includes intent from first comment", () => {
    const store = makeMockStore([makeThread("t1")]);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].intent).toBe("fix");
  });

  it("includes URI in summary entries", () => {
    const store = makeMockStore([makeThread("t1")]);
    const summary = buildCommentSummary(store);
    expect(summary.summary[0].uri).toBe("file:///project/src/auth.ts");
  });
});

// ── §7 startStateContribution ────────────────────────────────────────────────

describe("§7 startStateContribution", () => {
  it("publishes initial state immediately", () => {
    const store = makeMockStore([makeThread("t1")]);
    const bridge = makeMockBridge();
    startStateContribution(bridge, store);
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo-comments",
      expect.objectContaining({ isOpen: true }),
    );
  });

  it("re-publishes on store change", () => {
    const store = makeMockStore([makeThread("t1")]);
    const bridge = makeMockBridge();
    startStateContribution(bridge, store);

    // Simulate store change
    store._fireChanged();

    expect(bridge.publishState).toHaveBeenCalledTimes(2);
  });

  it("returns a disposable that stops reactive updates", () => {
    const store = makeMockStore([makeThread("t1")]);
    const bridge = makeMockBridge();
    const disposable = startStateContribution(bridge, store);

    disposable.dispose();

    // After dispose, changes should not trigger publish
    store._fireChanged();
    // Initial + no more after dispose = still 1
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });

  it("publishes to extensionId 'accordo-comments'", () => {
    const store = makeMockStore([]);
    const bridge = makeMockBridge();
    startStateContribution(bridge, store);
    expect(bridge.calls[0][0]).toBe("accordo-comments");
  });

  it("re-publishes when store fires onChanged (P1: onDocumentChanged emit fix)", () => {
    // Verifies that the state contribution wiring responds to store.onChanged events,
    // which are now emitted after onDocumentChanged in the real CommentStore.
    const store = makeMockStore([makeThread("t1")]);
    const bridge = makeMockBridge();
    startStateContribution(bridge, store);
    vi.mocked(bridge.publishState).mockClear();

    // Simulate what the real store does after onDocumentChanged: fire all onChanged listeners
    store._fireChanged();

    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });
});
