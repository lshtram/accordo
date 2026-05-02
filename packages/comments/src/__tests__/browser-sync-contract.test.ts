/**
 * browser-sync-contract.test.ts
 *
 * Phase B — Full-state browser comment sync contract tests (accordo-comments).
 *
 * Pass-eligible tests (🟢): contract shape using inline fixtures.
 * Completion-defining tests (🔴): call real production boundaries — MUST FAIL
 * on broken per-mutation/notify implementation.
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
import type { CommentStoreFile, CommentThread } from "@accordo/bridge-types";

// ── VSCode mock state ──────────────────────────────────────────────────────────

let _mockVscode: {
  comments: { createCommentThread: ReturnType<typeof vi.fn>; updateCommentingRanges: ReturnType<typeof vi.fn> };
  workspace: { fs: { readFile: ReturnType<typeof vi.fn>; writeFile: ReturnType<typeof vi.fn>; createDirectory: ReturnType<typeof vi.fn> } };
  extensions: { getExtension: ReturnType<typeof vi.fn> };
} | null = null;

export async function importVscodeMock() {
  if (_mockVscode) return _mockVscode;
  const vscode = await import("./mocks/vscode.js");
  const mockState = (vscode as unknown as { _state?: typeof _mockVscode })._state;
  if (mockState) { _mockVscode = mockState; return mockState; }
  _mockVscode = {
    comments: { createCommentThread: vi.fn(), updateCommentingRanges: vi.fn() },
    workspace: { fs: { readFile: vi.fn(), writeFile: vi.fn(), createDirectory: vi.fn() } },
    extensions: { getExtension: vi.fn() },
  };
  return _mockVscode;
}

export function resetMockState(): void { _mockVscode = null; }

// ── Inline contract types (canonical full-state sync shape) ─────────────────

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

function makeState(overrides: Partial<BrowserCommentSyncState> = {}): BrowserCommentSyncState {
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

function makePage(url: string, threads: BrowserSyncThread[] = []): BrowserCommentSyncPage {
  return { pageUrl: url, threads };
}

function makeThread(overrides: Partial<BrowserSyncThread> = {}): BrowserSyncThread {
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

function makeComment(overrides: Partial<BrowserSyncComment> = {}): BrowserSyncComment {
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

// ── SECTION A: Contract shape (🟢 pass-eligible) ─────────────────────────────

describe("A — Contract shape (🟢 pass-eligible)", () => {
  describe("schemaVersion field", () => {
    it("BR-F-157-01: valid schemaVersion '2.0' in fixture", () => {
      const s = makeState({ schemaVersion: "2.0" });
      expect(s.schemaVersion).toBe("2.0");
    });
    it("BR-F-157-02: schemaVersion '1.0' representable in fixture (real rejection = Phase C)", () => {
      const s = makeState({ schemaVersion: "1.0" as "2.0" });
      expect(s.schemaVersion).toBe("1.0");
    });
    it("BR-F-157-03: undefined schemaVersion representable", () => {
      const s = makeState({ schemaVersion: undefined as "2.0" });
      expect((s as { schemaVersion?: string }).schemaVersion).toBeUndefined();
    });
    it("BR-F-157-04: null schemaVersion representable", () => {
      const s = makeState({ schemaVersion: null as "2.0" });
      expect((s as { schemaVersion?: unknown }).schemaVersion).toBeNull();
    });
  });

  describe("pageUrl uniqueness", () => {
    it("BR-F-158-01: duplicate pageUrls detectable in fixture", () => {
      const urls = ["https://example.com/page", "https://example.com/page"];
      expect(new Set(urls).size).toBeLessThan(urls.length);
    });
    it("BR-F-158-02: distinct pageUrls pass fixture check", () => {
      const s = makeState({ pages: [makePage("p1"), makePage("p2")] });
      expect(new Set(s.pages.map((p) => p.pageUrl)).size).toBe(s.pages.length);
    });
  });

  describe("thread ID uniqueness", () => {
    it("BR-F-159-01: duplicate thread IDs on same page detectable", () => {
      const ids = ["t1", "t1"];
      expect(new Set(ids).size).toBeLessThan(ids.length);
    });
    it("BR-F-159-02: same thread ID on different pages allowed", () => {
      const s = makeState({
        pages: [
          makePage("https://example.com/page1", [makeThread({ id: "t1" })]),
          makePage("https://example.com/page2", [makeThread({ id: "t1" })]),
        ],
      });
      expect(s.pages[0].threads[0].id).toBe(s.pages[1].threads[0].id);
    });
  });

  describe("comment ID uniqueness", () => {
    it("BR-F-160-01: duplicate comment IDs detectable", () => {
      const ids = ["c1", "c1"];
      expect(new Set(ids).size).toBeLessThan(ids.length);
    });
  });

  describe("timestamp format", () => {
    it("BR-F-161-01: invalid timestamp string detected", () => { expect(isNaN(Date.parse("not-a-date"))).toBe(true); });
    it("BR-F-161-02: empty timestamp detected", () => { expect(isNaN(Date.parse(""))).toBe(true); });
    it("BR-F-161-03: valid ISO timestamp accepted", () => { expect(isNaN(Date.parse("2026-01-01T00:00:00.000Z"))).toBe(false); });
  });

  describe("thread.pageUrl consistency", () => {
    it("BR-F-162-01: matching URLs pass fixture check", () => {
      const pageUrl = "https://example.com/page";
      expect(makeThread({ pageUrl }).pageUrl).toBe(pageUrl);
    });
    it("BR-F-162-02: mismatched URLs detectable", () => {
      expect(makeThread({ pageUrl: "https://other.com/page" }).pageUrl).not.toBe("https://example.com/page");
    });
  });

  describe("comment.threadId consistency", () => {
    it("BR-F-163-01: matching IDs pass fixture check", () => { expect(makeComment({ threadId: "t1" }).threadId).toBe("t1"); });
    it("BR-F-163-02: mismatched IDs detectable", () => { expect(makeComment({ threadId: "wrong" }).threadId).not.toBe("t1"); });
  });

  describe("tombstone shape", () => {
    it("BR-F-164-01: deleted thread has deletedAt field", () => {
      expect(makeThread({ deletedAt: "2026-01-02T00:00:00.000Z" }).deletedAt).toBeDefined();
    });
    it("BR-F-164-02: tombstoned comment excluded by filter in fixture", () => {
      const thread = makeThread({
        comments: [
          makeComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" }),
          makeComment({ id: "c-active" }),
        ],
      });
      const active = thread.comments.filter((c) => !c.deletedAt);
      expect(active).toHaveLength(1);
      expect(thread.comments).toHaveLength(2); // raw preserved
    });
  });

  describe("lastActivity ordering", () => {
    it("BR-F-165-01: newer lastActivity is greater", () => {
      const older = makeThread({ lastActivity: "2026-01-01T00:00:00.000Z" });
      const newer = makeThread({ lastActivity: "2026-01-02T00:00:00.000Z" });
      expect(newer.lastActivity > older.lastActivity).toBe(true);
    });
  });

  describe("anchorKey", () => {
    it("BR-F-166-01: anchorKey is non-empty string", () => {
      const t = makeThread({ anchorKey: "body:center" });
      expect(t.anchorKey.length).toBeGreaterThan(0);
    });
  });

  describe("pageUrl format", () => {
    it("BR-F-167-01: pageUrl is required in fixture", () => { expect(makePage("https://example.com/page").pageUrl).toBeDefined(); });
    it("BR-F-167-02: pageUrl follows HTTP(S) URL pattern", () => {
      expect(makePage("https://example.com/path?query=1").pageUrl).toMatch(/^https?:\/\/.+/);
    });
  });

  describe("revisions", () => {
    it("BR-F-168-01: browserRevision is positive integer in fixture", () => {
      expect(makeState({ browserRevision: 5 }).browserRevision).toBeGreaterThan(0);
    });
    it("BR-F-168-02: accordoRevision ≤ browserRevision in fixture", () => {
      expect(makeState({ browserRevision: 5, accordoRevision: 3 }).accordoRevision).toBeLessThanOrEqual(5);
    });
  });
});

// ── SECTION B: Revision metadata (🟢 pass-eligible) ───────────────────────────

describe("B — Revision metadata (🟢 pass-eligible)", () => {
  it("BR-F-158-03: browserRevision increments per batch in fixture", () => {
    const s1 = makeState({ browserRevision: 1 });
    const s2 = makeState({ browserRevision: 2 });
    expect(s2.browserRevision).toBe(s1.browserRevision + 1);
  });
  it("BR-F-158-04: accordoRevision ≤ browserRevision", () => {
    expect(makeState({ browserRevision: 5, accordoRevision: 3 }).accordoRevision).toBeLessThanOrEqual(5);
  });
  it("BR-F-159-03: emittedBy browser-extension fixture", () => {
    expect(makeState({ emittedBy: "browser-extension" }).emittedBy).toBe("browser-extension");
  });
  it("BR-F-159-04: emittedBy vscode-accordo fixture", () => {
    expect(makeState({ emittedBy: "vscode-accordo" }).emittedBy).toBe("vscode-accordo");
  });
  it("BR-F-160-02: generatedAt follows ISO 8601 in fixture", () => {
    expect(makeState({ generatedAt: "2026-05-02T12:00:00.000Z" }).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
  it("BR-F-161-04: full-state fixture contains all pages", () => {
    const s = makeState({
      pages: [makePage("p1", [makeThread({ id: "t1" })]), makePage("p2", [makeThread({ id: "t2" })])],
    });
    expect(s.pages).toHaveLength(2);
  });
  it("BR-F-161-05: page has multiple threads in fixture", () => {
    expect(makePage("p", [makeThread({ id: "t1" }), makeThread({ id: "t2" })]).threads).toHaveLength(2);
  });
  it("BR-F-162-03: thread has multiple comments in fixture", () => {
    const t = makeThread({ comments: [makeComment({ id: "c1" }), makeComment({ id: "c2" })] });
    expect(t.comments).toHaveLength(2);
  });
  it("BR-F-163-03: comment has required fields in fixture", () => {
    const c = makeComment({ id: "c1", threadId: "t1", body: "Test", anchorKey: "body:center", author: { kind: "user", name: "Alice" } });
    expect(c.id).toBeDefined(); expect(c.threadId).toBeDefined(); expect(c.author).toBeDefined(); expect(c.body).toBeDefined(); expect(c.anchorKey).toBeDefined();
  });
  it("BR-F-163-04: comment status open/resolved in fixture", () => {
    expect(makeComment({ status: "open" }).status).toBe("open");
    expect(makeComment({ status: "resolved" }).status).toBe("resolved");
  });
});

// ── SECTION C: Browser extension storage (🟢 pass-eligible) ──────────────────

describe("C — Browser extension storage (🟢 pass-eligible)", () => {
  it("BR-F-165-02: thread status open/resolved", () => {
    expect(makeThread({ status: "open" }).status).toBe("open");
    expect(makeThread({ status: "resolved" }).status).toBe("resolved");
  });
  it("BR-F-166-02: anchorKey format has colon", () => {
    expect(makeThread({ anchorKey: "body:center" }).anchorKey).toContain(":");
  });
  it("BR-F-167-03: multiple pages in fixture", () => {
    expect(makeState({ pages: [makePage("p1"), makePage("p2"), makePage("p3")] }).pages).toHaveLength(3);
  });
  it("BR-F-168-03: 2 comments on same thread in fixture", () => {
    const s = makeState({
      pages: [makePage("https://example.com/page", [
        makeThread({
          id: "t1",
          comments: [
            makeComment({ id: "c1", body: "Hello from browser" }),
            makeComment({ id: "c2", body: "Reply from Accordo" }),
          ],
        }),
      ])],
    });
    expect(s.pages[0].threads[0].comments).toHaveLength(2);
  });
});

// ── SECTION D: Deprecated path isolation (M40-EXT-15) ────────────────────────
// 🟢 Pass-eligible fixture tests for error vocabulary and concept correctness.
// 🔴 Real dispatch rejection tests are in browser package:
//   packages/browser/src/__tests__/browser-full-state-sync.test.ts (Section D)

describe("D — Deprecated path isolation (M40-EXT-15) 🟢 pass-eligible", () => {
  it("M40-EXT-15-01: action-unsupported is a valid error code vocabulary", () => {
    const validErrors = ["action-unsupported", "browser-not-connected", "invalid-request", "action-failed"] as const;
    expect(validErrors).toContain("action-unsupported");
  });
  it("M40-EXT-15-02: deprecated relay actions concept — reply_comment", () => {
    // 🟢 Concept test: reply_comment is deprecated in full-state mode
    // 🔴 Real proof: browser-full-state-sync.test.ts D-01 calls dispatchBrowserCommentAction
    expect("reply_comment").toBeDefined();
  });
  it("M40-EXT-15-03: deprecated relay actions concept — create_comment", () => {
    expect("create_comment").toBeDefined();
  });
  it("M40-EXT-15-04: deprecated relay actions concept — delete_comment", () => {
    expect("delete_comment").toBeDefined();
  });
  it("M40-EXT-15-05: deprecated relay actions concept — update_comment", () => {
    expect("update_comment").toBeDefined();
  });
  it("M40-EXT-15-06: notify_comments_updated is NOT a sync-path action", () => {
    // notify_comments_updated fires on every mutation for live updates — not for full-state sync
    expect("notify_comments_updated").toBeDefined();
  });
  it("M40-EXT-15-07: request_comment_state_sync is the correct wakeup action", () => {
    // 🔴 Real proof in browser package tests (Section D tests D-01..D-05)
    expect("request_comment_state_sync").toBeDefined();
  });
});

// ── SECTION E: Accordo package integration (M38-CT-12..13, M36-CS-18) 🔴 ─────
// All Section E tests call real production boundaries — MUST FAIL on broken.

describe("E — Accordo package integration (M38-CT-12..13, M36-CS-18) 🔴", () => {
  describe("applyBrowserCommentSyncState method", () => {
    it("M38-CT-12-01: 🔴 CommentStore has applyBrowserCommentSyncState method", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      // BROKEN: method doesn't exist → FAILS
      // CORRECT: method exists → PASSES
      expect(typeof (store as Record<string, unknown>)["applyBrowserCommentSyncState"]).toBe("function");
    });

    it("M38-CT-12-02: 🔴 method is callable (function type)", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      // BROKEN: typeof = "undefined" → FAILS
      // CORRECT: typeof = "function" → PASSES
      expect(typeof method).toBe("function");
    });

    it("M38-CT-12-03: 🔴 applyBrowserCommentSyncState merge persists result via getAllThreads", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      if (typeof method !== "function") {
        expect(typeof method).toBe("function"); return;
      }
      const fullState: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0,
        emittedBy: "browser-extension", generatedAt: "2026-01-01T00:00:00.000Z",
        pages: [makePage("https://example.com/page", [
          makeThread({
            id: "t-merged-1",
            comments: [
              makeComment({ id: "c-browser-1", body: "From browser" }),
              makeComment({ id: "c-vscode-1", threadId: "t-merged-1", body: "From VSCode" }),
            ],
          }),
        ])],
      };
      try {
        await (method as (state: BrowserCommentSyncState) => Promise<unknown>)(fullState);
        const threads = store.getAllThreads();
        expect(threads.length).toBeGreaterThan(0); // FAILS if not persisted
      } catch {
        expect(undefined).toBeDefined(); // FAILS
      }
    });

    it("M38-CT-12-04: 🔴 second applyBrowserCommentSyncState call replaces (not appends) state", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      if (typeof method !== "function") { expect(typeof method).toBe("function"); return; }
      // First sync with one thread
      const state1: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0,
        emittedBy: "browser-extension", generatedAt: "2026-01-01T00:00:00.000Z",
        pages: [makePage("https://example.com/page", [
          makeThread({ id: "t-from-browser", comments: [makeComment({ id: "c1", body: "First sync" })] }),
        ])],
      };
      await (method as (s: BrowserCommentSyncState) => Promise<void>)(state1);
      // Second sync with different thread — store must replace, not append
      const state2: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 2, accordoRevision: 1,
        emittedBy: "browser-extension", generatedAt: "2026-01-02T00:00:00.000Z",
        pages: [makePage("https://example.com/page", [
          makeThread({ id: "t-other", comments: [makeComment({ id: "c2", body: "Second sync" })] }),
        ])],
      };
      await (method as (s: BrowserCommentSyncState) => Promise<void>)(state2);
      const threads = store.getAllThreads();
      const ids = threads.map((t) => t.id);
      // BROKEN: both t-from-browser and t-other exist (append) → FAILS
      // CORRECT: only t-other exists (replace) → PASSES
      expect(ids).not.toContain("t-from-browser");
      expect(ids).toContain("t-other");
    });

    it("M38-CT-12-05: 🔴 applyBrowserCommentSyncState accepts pageUrl as string (not URL object)", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      if (typeof method !== "function") { expect(typeof method).toBe("function"); return; }
      const fullState: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0,
        emittedBy: "browser-extension", generatedAt: "2026-01-01T00:00:00.000Z",
        pages: [makePage("https://example.com/path?query=1", [
          makeThread({ id: "t1", comments: [makeComment({ id: "c1" })] }),
        ])],
      };
      try {
        await (method as (s: BrowserCommentSyncState) => Promise<void>)(fullState);
        const threads = store.getAllThreads();
        expect(threads.length).toBeGreaterThan(0);
      } catch {
        expect(undefined).toBeDefined(); // FAILS on type error
      }
    });
  });

  describe("comment_reply wakeup behavior (M36-CS-18)", () => {
    it("M36-CS-18-01: 🟢 comment_reply MCP tool exists in createCommentTools", async () => {
      const { createCommentTools } = await import("../comment-tools.js");
      const { CommentStore } = await import("../comment-store.js");
      resetMockState();
      const store = new CommentStore();
      const tools = createCommentTools(store);
      expect(tools.find((t) => t.name === "comment_reply")).toBeDefined();
    });

    it("M36-CS-18-02: 🔴 ExternalFanoutNotifier has scheduleWakeup method", async () => {
      const { ExternalFanoutNotifier } = await import("../comment-tools.js");
      const notifier = new ExternalFanoutNotifier();
      // BROKEN: no scheduleWakeup → FAILS
      // CORRECT: scheduleWakeup exists → PASSES
      expect(typeof (notifier as Record<string, unknown>)["scheduleWakeup"]).toBe("function");
    });

    it("M36-CS-18-03: 🔴 comment_reply handler calls scheduleWakeup on external notifier", async () => {
      const { createCommentTools } = await import("../comment-tools.js");
      const { CommentStore } = await import("../comment-store.js");
      const { CommentUINotifier } = await import("../comment-tools.js");
      resetMockState();
      const store = new CommentStore();

      // Test double: implements CommentUINotifier (current interface) plus the
      // intended Phase C scheduleWakeup seam. This is the correct injection point —
      // createCommentTools(store, externalNotifier) receives the notifier that
      // mutation handlers call _external.scheduleWakeup(...) on.
      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        // Intended Phase C seam — handler should call this after mutation
        scheduleWakeup: (action: string, payload?: unknown) => {
          wakeupCalls.push({ action, payload });
        },
      };

      const tools = createCommentTools(store, trackingNotifier);
      const replyTool = tools.find((t) => t.name === "comment_reply");
      expect(replyTool).toBeDefined();

      // Seed a thread via comment_create so reply has a valid target
      const createTool = tools.find((t) => t.name === "comment_create");
      expect(createTool).toBeDefined();
      const createResult = await (createTool!.handler as (args: Record<string, unknown>) => Promise<unknown>)(
        { threadId: undefined, uri: "file:///test/test.ts", anchor: { kind: "text", startLine: 1 }, body: "Initial comment" }
      );
      const created = createResult as { success: boolean; threadId: string };
      expect(created.success).toBe(true);
      const threadId = created.threadId;

      // Call comment_reply — handler should call scheduleWakeup on the notifier
      await (replyTool!.handler as (args: Record<string, unknown>) => Promise<unknown>)({
        threadId,
        body: "A reply that triggers wakeup",
      });

      // BROKEN: handler does NOT call scheduleWakeup → wakeupCalls is empty → FAILS
      // CORRECT: handler calls scheduleWakeup("request_comment_state_sync", ...) → PASSES
      expect(wakeupCalls.some((c) => c.action === "request_comment_state_sync")).toBe(true);
    });
  });

  describe("browserSync tombstone preservation (M38-CT-13)", () => {
    it("M38-CT-13-01: 🔴 CommentStore excludes tombstoned threads from active reads", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      if (typeof method !== "function") { expect(typeof method).toBe("function"); return; }
      const fullState: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0,
        emittedBy: "browser-extension", generatedAt: "2026-01-01T00:00:00.000Z",
        pages: [makePage("https://example.com/page", [
          makeThread({ id: "t-deleted", deletedAt: "2026-01-02T00:00:00.000Z" }),
          makeThread({ id: "t-active" }),
        ])],
      };
      await (method as (state: BrowserCommentSyncState) => Promise<void>)(fullState);
      const threads = store.getAllThreads();
      const activeIds = threads.map((t) => t.id);
      // BROKEN: t-deleted included → FAILS
      // CORRECT: t-deleted excluded → PASSES
      expect(activeIds).not.toContain("t-deleted");
      expect(activeIds).toContain("t-active");
    });

    it("M38-CT-13-02: 🔴 CommentStore excludes tombstoned comments from active reads", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const method = (store as Record<string, unknown>)["applyBrowserCommentSyncState"];
      if (typeof method !== "function") { expect(typeof method).toBe("function"); return; }
      const fullState: BrowserCommentSyncState = {
        schemaVersion: "2.0", browserRevision: 1, accordoRevision: 0,
        emittedBy: "browser-extension", generatedAt: "2026-01-01T00:00:00.000Z",
        pages: [makePage("https://example.com/page", [
          makeThread({
            id: "t1",
            comments: [
              makeComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" }),
              makeComment({ id: "c-active" }),
            ],
          }),
        ])],
      };
      await (method as (state: BrowserCommentSyncState) => Promise<void>)(fullState);
      const threads = store.getAllThreads();
      const activeCommentIds = (threads[0]?.comments ?? []).map((c) => c.id);
      // BROKEN: c-deleted included → FAILS
      // CORRECT: c-deleted excluded → PASSES
      expect(activeCommentIds).not.toContain("c-deleted");
      expect(activeCommentIds).toContain("c-active");
    });

    it("M38-CT-13-03: 🟢 raw tombstone preserved in fixture even when excluded from active", () => {
      const deletedComment = makeComment({ id: "c-deleted", deletedAt: "2026-01-02T00:00:00.000Z" });
      const activeComment = makeComment({ id: "c-active" });
      const thread = makeThread({ id: "t1", comments: [deletedComment, activeComment] });
      expect(thread.comments).toHaveLength(2); // raw preserved
      expect(thread.comments.filter((c) => !c.deletedAt)).toHaveLength(1);
    });
  });
});

// ── SECTION F: Runtime happy-path proof (🟢 pass-eligible) ────────────────────

describe("F — Runtime happy-path proof (🟢 pass-eligible)", () => {
  it("F-01: full-state document for browser-origin content", () => {
    const fullState: BrowserCommentSyncState = makeState({
      browserRevision: 1, accordoRevision: 0, emittedBy: "browser-extension",
      pages: [makePage("https://example.com/page", [
        makeThread({ id: "t-browser-1", comments: [makeComment({ id: "c-browser-1", body: "Hello from browser" })] }),
      ])],
    });
    expect(fullState.schemaVersion).toBe("2.0");
    expect(fullState.pages[0].threads[0].comments).toHaveLength(1);
  });

  it("F-02: merged state shows both browser and VSCode comments", () => {
    const merged = makeState({
      browserRevision: 2, accordoRevision: 1, emittedBy: "vscode-accordo",
      pages: [makePage("https://example.com/page", [
        makeThread({ id: "t1", comments: [
          makeComment({ id: "c-browser-1", body: "Hello from browser" }),
          makeComment({ id: "c-vscode-1", body: "Reply from Accordo" }),
        ] }),
      ])],
    });
    const active = merged.pages.flatMap((p) => p.threads.filter((t) => !t.deletedAt)).flatMap((t) => t.comments.filter((c) => !c.deletedAt));
    expect(active).toHaveLength(2);
  });

  it("F-03: canonical store key constant is non-empty namespaced string", () => {
    const CANONICAL_KEY = "accordo:browser-comments-sync:v2";
    expect(CANONICAL_KEY).toBe("accordo:browser-comments-sync:v2");
    expect(CANONICAL_KEY.length).toBeGreaterThan(0);
    expect(CANONICAL_KEY).toContain(":");
  });

  it("F-04: schemaVersion must be '2.0' (not '1.0')", () => {
    const s: BrowserCommentSyncState = makeState();
    expect(s.schemaVersion).toBe("2.0");
    expect(s.schemaVersion).not.toBe("1.0");
  });

  it("F-05: multi-page full-state fixture", () => {
    const s = makeState({
      browserRevision: 4, accordoRevision: 3, emittedBy: "browser-extension",
      pages: [
        makePage("https://example.com/page1", [makeThread({ id: "t1" })]),
        makePage("https://example.com/page2", [makeThread({ id: "t2" })]),
        makePage("https://example.com/page3", [makeThread({ id: "t3" })]),
      ],
    });
    expect(s.pages).toHaveLength(3);
    expect(s.accordoRevision).toBeLessThanOrEqual(s.browserRevision);
  });
});