/**
 * Tests for NativeCommentSync.reconcile() and getSyncState() — M37-NC-11, M37-NC-14
 *
 * Source: requirements-comments.md M37-NC-11, M37-NC-14
 * Phase A stub: native-comment-sync.ts reconcile() throws "not implemented"
 *
 * These tests prove the canonical reconcile path — they MUST NOT pass through
 * legacy direct widget manipulation (addThread/updateThread/removeThread) alone.
 * Only reconcile() / getSyncState() are the tested surface.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resetMockState,
  workspace,
} from "./mocks/vscode.js";
import { NativeComments } from "../native-comments.js";
import { CommentStore, type StorageAdapter } from "../comment-store.js";
import type { CommentStoreFile, CommentThread } from "@accordo/bridge-types";

// ── In-memory StorageAdapter for tests ──────────────────────────────────────

function makeInMemoryStore(threads: CommentStoreFile["threads"] = []): CommentStore {
  let data: CommentStoreFile = { version: "1.0", threads };
  const adapter: StorageAdapter = {
    async read() { return data; },
    async write(file) { data = file; },
  };
  return new CommentStore(adapter);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function textAnchor(uri: string, startLine: number): import("@accordo/bridge-types").CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine, startChar: 0, endLine: startLine, endChar: 0 },
    docVersion: 1,
  };
}

function makeThread(overrides?: Partial<CommentThread>): CommentThread {
  return {
    id: "thread-1",
    anchor: textAnchor("file:///project/src/auth.ts", 42),
    comments: [{
      id: "comment-1",
      threadId: "thread-1",
      createdAt: "2026-03-03T10:00:00Z",
      author: { kind: "user", name: "Developer" },
      body: "Fix this auth check",
      anchor: textAnchor("file:///project/src/auth.ts", 42),
      status: "open",
      intent: "fix",
    }],
    status: "open",
    createdAt: "2026-03-03T10:00:00Z",
    lastActivity: "2026-03-03T10:00:00Z",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let nc: NativeComments;
let store: CommentStore;
let mockContext: { subscriptions: Array<{ dispose(): void }> };

beforeEach(() => {
  resetMockState();
  nc = new NativeComments();
  store = makeInMemoryStore(); // no fs needed
  mockContext = { subscriptions: [] };
});

// ── M37-NC-11: reconcile removes orphan native widgets ───────────────────────

describe("M37-NC-11: reconcile removes orphan native widgets", () => {
  it("reconcile disposes widgets whose IDs are not in the store", async () => {
    nc.init(store, mockContext);

    // Seed store with one thread
    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 10),
      body: "Store thread",
      author: { kind: "user", name: "Dev" },
    });

    // Manually create a widget NOT in the store (simulates a stray orphan)
    nc.addThread(makeThread({ id: "orphan-thread", anchor: textAnchor("file:///project/orphan.ts", 5) }));

    // Reconcile against the store (which has only threadId, not orphan-thread)
    const storeThreads = store.getAllThreads();
    const report = nc.reconcile(storeThreads);

    // The orphan widget should be removed by reconcile
    expect(report.orphanWidgetIds).toContain("orphan-thread");
    expect(report.inSync).toBe(true);

    // After reconcile, getSyncState should confirm orphan is gone from the set.
    const state = nc.getSyncState(store.getAllThreads());
    expect(state.orphanWidgetIds).not.toContain("orphan-thread");
  });

  it("reconcile does not remove widgets that correspond to store threads", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 20),
      body: "My thread",
      author: { kind: "user", name: "Dev" },
    });

    // Manually add the thread's widget so it's in the native map
    const thread = store.getThread(threadId)!;
    nc.addThread(thread);

    // Reconcile — the matching widget should NOT be in orphanWidgetIds
    const storeThreads = store.getAllThreads();
    const report = nc.reconcile(storeThreads);

    // The stub returns empty arrays, so these assertions prove real reconciliation:
    expect(report.orphanWidgetIds).not.toContain(threadId);
    // Contract: reconcile must report which store threads it considered
    expect(report.storeThreadIds).toContain(threadId);
    // Contract: reconcile must report which native widgets exist
    expect(report.nativeWidgetIds).toContain(threadId);
    // Contract: inSync requires a matching widget for every store thread
    expect(report.inSync).toBe(true);
  });
});

// ── M37-NC-11: reconcile creates missing native widgets ─────────────────────

describe("M37-NC-11: reconcile creates missing native widgets", () => {
  it("reconcile creates widgets for store threads not in the widget map", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 30),
      body: "Widget should be created",
      author: { kind: "user", name: "Dev" },
    });

    // Do NOT call addThread — the widget map is empty
    // reconcile should create the missing widget
    const storeThreads = store.getAllThreads();
    const report = nc.reconcile(storeThreads);

    expect(report.missingWidgetIds).toContain(threadId);
    expect(report.createdWidgetIds).toContain(threadId);
    expect(report.inSync).toBe(true);
  });

  it("after reconcile, getSyncState shows no missingWidgetIds", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 31),
      body: "Full sync",
      author: { kind: "user", name: "Dev" },
    });

    // Reconcile first (creates widget)
    nc.reconcile(store.getAllThreads());

    // getSyncState should now report inSync=true
    const state = nc.getSyncState(store.getAllThreads());
    expect(state.inSync).toBe(true);
    expect(state.missingWidgetIds).toHaveLength(0);
    expect(state.storeThreadIds).toContain(threadId);
    expect(state.nativeWidgetIds).toContain(threadId);
  });
});

// ── M37-NC-11: reconcile updates changed widgets ────────────────────────────

describe("M37-NC-11: reconcile updates existing widgets when content changes", () => {
  it("reconcile updates widget when thread comments change", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 40),
      body: "Original",
      author: { kind: "user", name: "Dev" },
    });

    // Reconcile to create the initial widget
    nc.reconcile(store.getAllThreads());

    // Reply — changes the thread
    await store.reply({ threadId, body: "A reply", author: { kind: "user", name: "Dev" } });

    // Reconcile again — should detect the change and update the widget
    const updatedThreads = store.getAllThreads();
    const report = nc.reconcile(updatedThreads);

    expect(report.updatedWidgetIds).toContain(threadId);
    // The reply incremented the comment count
    const updatedThread = updatedThreads.find(t => t.id === threadId)!;
    expect(updatedThread.comments).toHaveLength(2);
  });

  it("reconcile updates widget when thread status changes", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 41),
      body: "Will be resolved",
      author: { kind: "user", name: "Dev" },
    });

    nc.reconcile(store.getAllThreads());

    await store.resolve({
      threadId,
      resolutionNote: "Fixed",
      author: { kind: "user", name: "Dev" },
    });

    const updatedThreads = store.getAllThreads();
    const report = nc.reconcile(updatedThreads);

    expect(report.updatedWidgetIds).toContain(threadId);
    const resolved = updatedThreads.find(t => t.id === threadId)!;
    expect(resolved.status).toBe("resolved");
  });

  it("reconcile updates widget when thread range changes", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 50),
      body: "Range will shift",
      author: { kind: "user", name: "Dev" },
    });

    nc.reconcile(store.getAllThreads());

    // Simulate a line-shift document change
    store.onDocumentChanged({
      uri: "file:///project/src/auth.ts",
      changes: [{ startLine: 20, endLine: 20, newLineCount: 5 }],
    });

    const updatedThreads = store.getAllThreads();
    const report = nc.reconcile(updatedThreads);

    expect(report.updatedWidgetIds).toContain(threadId);
  });
});

// ── Regression: MarkdownString body comparison ───────────────────────────────
// Bug: _widgetNeedsUpdate compared store comment body (string) against widget
// comment body (vscode.MarkdownString object). string !== object is always true,
// so every reconcile() call disposed and recreated every widget — causing the
// "flashing" loop visible in the VS Code Comments panel.

describe("Regression: reconcile does not flash widgets when content is unchanged", () => {
  it("second reconcile with unchanged store does NOT update (dispose+recreate) the widget", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 77),
      body: "comment 1",
      author: { kind: "user", name: "User" },
    });

    // First reconcile — creates the widget
    const report1 = nc.reconcile(store.getAllThreads());
    expect(report1.createdWidgetIds).toContain(threadId);
    expect(report1.updatedWidgetIds).not.toContain(threadId);

    // Second reconcile — store unchanged, widget body is MarkdownString
    // Before fix: _widgetNeedsUpdate returned true (string !== MarkdownString)
    // After fix:  _widgetNeedsUpdate returns false (extracts .value before comparing)
    const report2 = nc.reconcile(store.getAllThreads());
    expect(report2.createdWidgetIds).toHaveLength(0);
    expect(report2.updatedWidgetIds).toHaveLength(0); // ← was failing before fix
    expect(report2.inSync).toBe(true);
  });

  it("third reconcile after adding a second thread does NOT re-update the first thread", async () => {
    nc.init(store, mockContext);

    const { threadId: t1 } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 18),
      body: "comment 1",
      author: { kind: "user", name: "User" },
    });

    nc.reconcile(store.getAllThreads());

    // Add a second thread (simulates the user adding a second comment)
    const { threadId: t2 } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 77),
      body: "comment 2",
      author: { kind: "user", name: "User" },
    });

    const report = nc.reconcile(store.getAllThreads());

    // Only the new thread should be created; the first must NOT be updated
    expect(report.createdWidgetIds).toContain(t2);
    expect(report.updatedWidgetIds).not.toContain(t1); // ← was failing before fix
    expect(report.inSync).toBe(true);
  });
});

// ── M37-NC-11: reconcile idempotency ─────────────────────────────────────────

describe("M37-NC-11: reconcile is idempotent — no duplicate widgets", () => {
  it("calling reconcile twice does not create duplicate widgets for the same ID", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/src/auth.ts",
      anchor: textAnchor("file:///project/src/auth.ts", 60),
      body: "Idempotent test",
      author: { kind: "user", name: "Dev" },
    });

    // First reconcile — creates widget
    nc.reconcile(store.getAllThreads());

    // Second reconcile — should update, not duplicate
    const report2 = nc.reconcile(store.getAllThreads());

    // Should NOT create it again (idempotency: no duplicate widget creation)
    expect(report2.createdWidgetIds).toHaveLength(0);

    const state = nc.getSyncState(store.getAllThreads());
    expect(state.nativeWidgetIds.filter(id => id === threadId)).toHaveLength(1);
  });

  it("reconcile with empty store removes all orphan widgets", async () => {
    nc.init(store, mockContext);

    // Create and reconcile widgets
    const t1 = await store.createThread({
      uri: "file:///project/a.ts",
      anchor: textAnchor("file:///project/a.ts", 1),
      body: "T1",
      author: { kind: "user", name: "Dev" },
    });
    const t2 = await store.createThread({
      uri: "file:///project/b.ts",
      anchor: textAnchor("file:///project/b.ts", 2),
      body: "T2",
      author: { kind: "user", name: "Dev" },
    });
    nc.reconcile(store.getAllThreads());

    // Delete all threads
    await store.delete({ threadId: t1.threadId });
    await store.delete({ threadId: t2.threadId });

    // Reconcile with empty store — all widgets become orphans and are removed
    const report = nc.reconcile(store.getAllThreads());

    expect(report.orphanWidgetIds).toHaveLength(2);
    expect(report.inSync).toBe(true); // final state: nothing in store, nothing missing
  });
});

// ── M37-NC-14: getSyncState accuracy ─────────────────────────────────────────

describe("M37-NC-14: getSyncState reports accurate diagnostic state", () => {
  it("getSyncState returns storeThreadIds from the store", async () => {
    nc.init(store, mockContext);

    const t1 = await store.createThread({
      uri: "file:///project/a.ts",
      anchor: textAnchor("file:///project/a.ts", 1),
      body: "T1",
      author: { kind: "user", name: "Dev" },
    });
    const t2 = await store.createThread({
      uri: "file:///project/b.ts",
      anchor: textAnchor("file:///project/b.ts", 2),
      body: "T2",
      author: { kind: "user", name: "Dev" },
    });

    const state = nc.getSyncState(store.getAllThreads());
    expect(state.storeThreadIds).toContain(t1.threadId);
    expect(state.storeThreadIds).toContain(t2.threadId);
    expect(state.storeThreadIds).toHaveLength(2);
  });

  it("getSyncState returns inSync=true when all store threads have native widgets", async () => {
    nc.init(store, mockContext);

    const { threadId } = await store.createThread({
      uri: "file:///project/a.ts",
      anchor: textAnchor("file:///project/a.ts", 5),
      body: "Synced thread",
      author: { kind: "user", name: "Dev" },
    });

    // Reconcile to create the widget
    nc.reconcile(store.getAllThreads());

    const state = nc.getSyncState(store.getAllThreads());
    // The stub returns inSync=true unconditionally and empty arrays,
    // so these assertions prove real sync-state computation:
    expect(state.inSync).toBe(true);
    expect(state.missingWidgetIds).toHaveLength(0);
    expect(state.orphanWidgetIds).toHaveLength(0);
    // Contract: storeThreadIds must reflect what is actually in the store
    expect(state.storeThreadIds).toContain(threadId);
    // Contract: nativeWidgetIds must reflect the widget created by reconcile
    expect(state.nativeWidgetIds).toContain(threadId);
  });

  it("getSyncState returns inSync=false when store has threads without widgets", async () => {
    nc.init(store, mockContext);

    await store.createThread({
      uri: "file:///project/a.ts",
      anchor: textAnchor("file:///project/a.ts", 6),
      body: "Missing widget",
      author: { kind: "user", name: "Dev" },
    });

    // Do NOT call reconcile — widget is missing
    const state = nc.getSyncState(store.getAllThreads());
    expect(state.inSync).toBe(false);
    expect(state.missingWidgetIds.length).toBeGreaterThan(0);
  });

  it("getSyncState lists orphanWidgetIds when native has widgets not in store", async () => {
    nc.init(store, mockContext);

    // Add orphan widgets directly (not via reconcile)
    nc.addThread(makeThread({ id: "orphan-1", anchor: textAnchor("file:///project/orphan.ts", 1) }));
    nc.addThread(makeThread({ id: "orphan-2", anchor: textAnchor("file:///project/orphan2.ts", 2) }));

    const state = nc.getSyncState(store.getAllThreads());
    expect(state.orphanWidgetIds).toContain("orphan-1");
    expect(state.orphanWidgetIds).toContain("orphan-2");
    expect(state.inSync).toBe(false);
  });
});
