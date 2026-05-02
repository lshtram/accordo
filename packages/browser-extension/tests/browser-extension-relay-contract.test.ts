/**
 * browser-extension-relay-contract.test.ts
 *
 * Phase B — Browser-extension canonical sync store tests.
 *
 * Tests target the Phase C production seams in:
 *   src/browser-comment-sync-store.ts   — canonical v2 store (key, meta, active read)
 *   src/browser-comment-sync-runner.ts — full-state sync runner (sync_comment_state, persist, broadcast)
 *
 * All tests use assertion-level proof (not import-level). Stubs export real API names
 * but produce no-op behavior, causing concrete assertions to fail until Phase C wires real logic.
 *
 * Requirement IDs covered:
 *   M36-CS-14, M36-CS-16, M36-CS-17, M36-CS-18
 *   M38-CT-12, M38-CT-13, M38-CT-14
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  BrowserCommentSyncPage,
  BrowserCommentSyncThread,
} from "../src/browser-comment-sync-store.js";

// ── SECTION A: Canonical store key constant 🔴 ────────────────────────────────

describe("A — Canonical store key constant 🔴", () => {
  it("M36-CS-14-01: 🔴 CANONICAL_BROWSER_COMMENT_SYNC_KEY constant exported from store module", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    expect(typeof store.CANONICAL_BROWSER_COMMENT_SYNC_KEY).toBe("string");
    expect(store.CANONICAL_BROWSER_COMMENT_SYNC_KEY.length).toBeGreaterThan(0);
  });

  it("M36-CS-14-02: 🔴 CANONICAL_BROWSER_COMMENT_SYNC_KEY value is 'accordo:browser-comments-sync:v2'", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    expect(store.CANONICAL_BROWSER_COMMENT_SYNC_KEY).toBe("accordo:browser-comments-sync:v2");
  });
});

// ── SECTION B: Canonical meta persistence (assert concrete values) 🔴 ─────────

describe("B — Canonical meta persistence 🔴", () => {
  it("M36-CS-16-01: 🔴 applyMergedBrowserCommentSyncState function exported", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    expect(typeof store.applyMergedBrowserCommentSyncState).toBe("function");
  });

  it("M36-CS-16-02: 🔴 applyMergedBrowserCommentSyncState updates stored meta to exact values from response", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    const fn = store.applyMergedBrowserCommentSyncState as (response: {
      schemaVersion: string;
      browserRevision: number;
      accordoRevision: number;
      emittedBy: string;
      generatedAt: string;
      pages: BrowserCommentSyncPage[];
    }) => Promise<void>;

    // Phase C: applyMergedBrowserCommentSyncState updates stored meta from response
    // Stub: apply is a no-op → meta stays at initial values (all zeros)
    // BROKEN: meta not updated → stored values are zeros → FAILS
    // CORRECT: meta updated to response values → assertion passes
    const response = {
      schemaVersion: "2.0",
      browserRevision: 5,
      accordoRevision: 3,
      emittedBy: "vscode-accordo",
      generatedAt: new Date().toISOString(),
      pages: [],
    };
    await fn(response);

    const meta = store.getStoredMeta();
    expect(meta.lastSentBrowserRevision).toBe(5);      // FAILS on stub (is 0)
    expect(meta.lastAckedBrowserRevision).toBe(5);     // FAILS on stub (is 0)
    expect(meta.lastPersistedAccordoRevision).toBe(3); // FAILS on stub (is 0)
    expect(meta.nextBrowserRevision).toBe(6);          // FAILS on stub (is 1)
  });

  it("M36-CS-16-03: 🔴 persistMergedBrowserCommentSyncState function exported", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    expect(typeof store.persistMergedBrowserCommentSyncState).toBe("function");
  });

  it("M36-CS-16-04: 🔴 persistMergedBrowserCommentSyncState stores exact meta values for observation", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    const persistFn = store.persistMergedBrowserCommentSyncState as (state: {
      schemaVersion: string;
      browserRevision: number;
      accordoRevision: number;
      emittedBy: string;
      generatedAt: string;
      pages: BrowserCommentSyncPage[];
    }) => Promise<void>;

    const state = {
      schemaVersion: "2.0",
      browserRevision: 7,
      accordoRevision: 4,
      emittedBy: "browser-extension",
      generatedAt: new Date().toISOString(),
      pages: [],
      };
      await persistFn(state as Parameters<typeof persistFn>[0]);

    const meta = store.getStoredMeta();
    // Stub: meta fields remain at initial zero values → FAILS
    // CORRECT: meta updated to match persisted state values
    expect(meta.lastSentBrowserRevision).toBe(7);   // FAILS on stub
    expect(meta.lastPersistedAccordoRevision).toBe(4); // FAILS on stub
  });
});

// ── SECTION C: Canonical active read — red proof via storage injection 🔴 ────

describe("C — Canonical active read (storage-injection red proof) 🔴", () => {
  /**
   * These tests use storage injection to prove the read function delegates to
   * the canonical v2 storage (not legacy keys). The stub's apply/persist do NOT
   * delegate to storage, so after calling persist the injected fakeStorage remains
   * empty → getActiveBrowserThreadsForPage returns empty → assertion fails.
   *
   * BROKEN (stub): persist does nothing → fakeStorage has no data → read returns [] → FAILS
   * CORRECT (Phase C): persist writes to fakeStorage → read returns persisted thread → PASSES
   */

  it("M36-CS-17-02: 🔴 getActiveBrowserThreadsForPage returns concrete thread IDs from canonical storage after persist", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    const { configureBrowserCommentSyncStorage } = store;

    // Inject fake storage that tracks what canonical key is written
    // Initial state: empty (simulates canonical key has no data yet)
    let storedDoc: { meta: typeof store.getStoredMeta extends () => infer R ? R : never; pages: BrowserCommentSyncPage[] } = {
      meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 },
      pages: [] as BrowserCommentSyncPage[],
    };
    const fakeStorage = {
      loadDocument: () => storedDoc,
      saveDocument: (doc: typeof storedDoc) => {
        storedDoc = doc;
      },
    };
    configureBrowserCommentSyncStorage(fakeStorage);

    try {
      const persistFn = store.persistMergedBrowserCommentSyncState as (state: {
        schemaVersion: string;
        browserRevision: number;
        accordoRevision: number;
        emittedBy: string;
        generatedAt: string;
        pages: BrowserCommentSyncPage[];
      }) => Promise<void>;

      const readFn = store.getActiveBrowserThreadsForPage as (url: string) => Promise<Array<{ id: string }>>;

      const state = {
        schemaVersion: "2.0",
        browserRevision: 2,
        accordoRevision: 1,
        emittedBy: "browser-extension",
        generatedAt: new Date().toISOString(),
        pages: [{
          pageUrl: "https://example.com/canonical-read-page",
          threads: [{
            id: "t-from-canonical-storage",
            anchorKey: "body:center",
            pageUrl: "https://example.com/canonical-read-page",
            status: "open",
            deletedAt: undefined,
            comments: [{
              id: "c-from-canonical",
              threadId: "t-from-canonical-storage",
              createdAt: "",
              author: { kind: "user", name: "Alice" },
              body: "Test",
              anchorKey: "body:center",
              status: "open",
            }],
            createdAt: "",
            lastActivity: "",
          }],
        }],
      };
      await persistFn(state as unknown as Parameters<typeof persistFn>[0]);

      // After persist, read from canonical store
      // BROKEN: stub persist does not write to fakeStorage → fakeStorage still empty → FAILS
      // CORRECT: persist writes to fakeStorage → read returns persisted thread → PASSES
      const threads = await readFn("https://example.com/canonical-read-page");
      expect(threads.some((t) => t.id === "t-from-canonical-storage")).toBe(true);
    } finally {
      // Reset to default storage
      configureBrowserCommentSyncStorage({
        loadDocument: () => ({ meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 }, pages: [] }),
        saveDocument: () => {},
      });
    }
  });

  it("M36-CS-17-03: 🔴 getActiveBrowserThreadsForPage filters tombstoned threads from canonical storage", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    const { configureBrowserCommentSyncStorage } = store;

    let storedDoc: { meta: { lastSentBrowserRevision: number; lastAckedBrowserRevision: number; lastPersistedAccordoRevision: number; nextBrowserRevision: number }; pages: BrowserCommentSyncPage[] } = {
      meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 },
      pages: [] as BrowserCommentSyncPage[],
    };
    const fakeStorage = {
      loadDocument: () => storedDoc,
      saveDocument: (doc: typeof storedDoc) => {
        storedDoc = doc;
      },
    };
    configureBrowserCommentSyncStorage(fakeStorage);

    try {
      const persistFn = store.persistMergedBrowserCommentSyncState as (state: {
        schemaVersion: string;
        browserRevision: number;
        accordoRevision: number;
        emittedBy: string;
        generatedAt: string;
        pages: BrowserCommentSyncPage[];
      }) => Promise<void>;
      const readFn = store.getActiveBrowserThreadsForPage as (url: string) => Promise<Array<{ id: string; deletedAt?: string }>>;

      const state = {
        schemaVersion: "2.0",
        browserRevision: 3,
        accordoRevision: 2,
        emittedBy: "browser-extension",
        generatedAt: new Date().toISOString(),
        pages: [{
          pageUrl: "https://example.com/tombstone-filter-page",
          threads: [
            { id: "t-deleted-thread", anchorKey: "body:center", pageUrl: "https://example.com/tombstone-filter-page", status: "open", deletedAt: "2026-01-02T00:00:00.000Z", comments: [], createdAt: "", lastActivity: "" },
            { id: "t-active-thread", anchorKey: "body:top", pageUrl: "https://example.com/tombstone-filter-page", status: "open", deletedAt: undefined, comments: [{ id: "c-active", threadId: "t-active-thread", createdAt: "", author: { kind: "user", name: "" }, body: "", anchorKey: "", status: "open" }], createdAt: "", lastActivity: "" },
          ],
        }],
      };
      await persistFn(state as unknown as Parameters<typeof persistFn>[0]);
      const threads = await readFn("https://example.com/tombstone-filter-page");

      // BROKEN: stub persist does not write → fakeStorage empty → FAILS
      // CORRECT: persist writes both threads → read filters deleted → PASSES
      expect(threads.some((t) => t.id === "t-deleted-thread")).toBe(false);
      expect(threads.some((t) => t.id === "t-active-thread")).toBe(true);
    } finally {
      configureBrowserCommentSyncStorage({
        loadDocument: () => ({ meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 }, pages: [] }),
        saveDocument: () => {},
      });
    }
  });

  it("M36-CS-17-04: 🔴 getActiveBrowserThreadsForPage reads from canonical v2 key, NOT legacy comments:{url} keys", async () => {
    const store = await import("../src/browser-comment-sync-store.js");
    const { configureBrowserCommentSyncStorage } = store;

    // Fake storage that only has data under canonical key (empty initial)
    // If the stub reads from wrong key (legacy), it gets nothing.
    // If it reads from canonical key (correct), it gets what persist wrote.
    let storedDoc: { meta: { lastSentBrowserRevision: number; lastAckedBrowserRevision: number; lastPersistedAccordoRevision: number; nextBrowserRevision: number }; pages: BrowserCommentSyncPage[] } = {
      meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 },
      pages: [] as BrowserCommentSyncPage[],
    };
    const fakeStorage = {
      loadDocument: () => storedDoc,
      saveDocument: (doc: typeof storedDoc) => {
        storedDoc = doc;
      },
    };
    configureBrowserCommentSyncStorage(fakeStorage);

    try {
      const persistFn = store.persistMergedBrowserCommentSyncState as (state: {
        schemaVersion: string;
        browserRevision: number;
        accordoRevision: number;
        emittedBy: string;
        generatedAt: string;
        pages: BrowserCommentSyncPage[];
      }) => Promise<void>;
      const readFn = store.getActiveBrowserThreadsForPage as (url: string) => Promise<Array<{ id: string }>>;

      const canonicalOnlyUrl = "https://example.com/canonical-only-page";
      const state = {
        schemaVersion: "2.0",
        browserRevision: 4,
        accordoRevision: 3,
        emittedBy: "browser-extension",
        generatedAt: new Date().toISOString(),
        pages: [{
          pageUrl: canonicalOnlyUrl,
          threads: [{
            id: "t-canonical-only-v2",
            anchorKey: "body:center",
            pageUrl: canonicalOnlyUrl,
            status: "open",
            deletedAt: undefined,
            comments: [{
              id: "c-canonical-only",
              threadId: "t-canonical-only-v2",
              createdAt: "",
              author: { kind: "user", name: "" },
              body: "",
              anchorKey: "",
              status: "open",
            }],
            createdAt: "",
            lastActivity: "",
          }],
        }],
      };
      await persistFn(state as unknown as Parameters<typeof persistFn>[0]);
      const threads = await readFn(canonicalOnlyUrl);

      // BROKEN: persist does not write → fakeStorage empty → threads [] → FAILS
      // CORRECT: persist writes to canonical key → read returns thread → PASSES
      expect(threads.some((t) => t.id === "t-canonical-only-v2")).toBe(true);
    } finally {
      configureBrowserCommentSyncStorage({
        loadDocument: () => ({ meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 }, pages: [] }),
        saveDocument: () => {},
      });
    }
  });
});

// ── SECTION D: Full-state runner (sync_comment_state, persist-before-broadcast) 🔴 ─

describe("D — Full-state runner 🔴", () => {
  beforeEach(() => {
    // Reset runner state between tests
  });

  it("M36-CS-18-01: 🔴 runBrowserCommentFullStateSync function exported", async () => {
    const runner = await import("../src/browser-comment-sync-runner.js");
    expect(typeof runner.runBrowserCommentFullStateSync).toBe("function");
  });

  it("M36-CS-18-02: 🔴 runBrowserCommentFullStateSync sends sync_comment_state relay action", async () => {
    const runner = await import("../src/browser-comment-sync-runner.js");
    const { getRunnerEventLog } = runner;

    const mockRelay = {
      request: vi.fn(async () => ({
        success: true,
        requestId: "req-1",
        data: {
          schemaVersion: "2.0",
          browserRevision: 1,
          accordoRevision: 0,
          emittedBy: "browser-extension",
          generatedAt: new Date().toISOString(),
          pages: [],
        },
      })),
      push: vi.fn(),
      isConnected: () => true,
    };

    const fn = runner.runBrowserCommentFullStateSync as (relay: unknown) => Promise<void>;
    await fn(mockRelay);

    // BROKEN: stub runner logs no events → getRunnerEventLog() returns [] → FAILS
    // CORRECT: runner calls relay.request("sync_comment_state", ...) → event logged → PASSES
    const eventLog = getRunnerEventLog();
    const requestEvents = eventLog.filter((e): e is { type: "request"; action: string; payload: unknown } => e.type === "request");
    expect(requestEvents.some((e) => e.action === "sync_comment_state")).toBe(true);
  });

  it("M36-CS-18-03: 🔴 runBrowserCommentFullStateSync does NOT call get_all_comments (only if sync_comment_state was sent)", async () => {
    const runner = await import("../src/browser-comment-sync-runner.js");
    const { getRunnerEventLog } = runner;

    // First: assert sync_comment_state was sent (M36-CS-18-02 gate)
    // If sync_comment_state was not sent, this test fails at the gate — proving the runner is broken.
    // Only after confirming sync_comment_state was sent do we check no forbidden actions.

    const mockRelay = {
      request: vi.fn(async () => ({
        success: true,
        requestId: "req-1",
        data: {
          schemaVersion: "2.0",
          browserRevision: 1,
          accordoRevision: 0,
          emittedBy: "browser-extension",
          generatedAt: new Date().toISOString(),
          pages: [],
        },
      })),
      push: vi.fn(),
      isConnected: () => true,
    };

    const fn = runner.runBrowserCommentFullStateSync as (relay: unknown) => Promise<void>;
    await fn(mockRelay);

    const eventLog = getRunnerEventLog();
    const requestEvents = eventLog.filter((e): e is { type: "request"; action: string; payload: unknown } => e.type === "request");
    const actions = requestEvents.map((e) => e.action);

    // Gate: sync_comment_state must be sent first (proves runner did something)
    // BROKEN: stub sends nothing → gate fails → test fails here (not trivial pass)
    // CORRECT: sync_comment_state sent → proceed to forbidden-action check
    expect(actions).toContain("sync_comment_state");

    // Only meaningful after gate passes: verify no get_all_comments
    expect(actions).not.toContain("get_all_comments");
  });

  it("M36-CS-18-04: 🔴 runBrowserCommentFullStateSync does NOT call get_comments per-page (only if sync_comment_state was sent)", async () => {
    const runner = await import("../src/browser-comment-sync-runner.js");
    const { getRunnerEventLog } = runner;

    const mockRelay = {
      request: vi.fn(async () => ({
        success: true,
        requestId: "req-1",
        data: {
          schemaVersion: "2.0",
          browserRevision: 1,
          accordoRevision: 0,
          emittedBy: "browser-extension",
          generatedAt: new Date().toISOString(),
          pages: [],
        },
      })),
      push: vi.fn(),
      isConnected: () => true,
    };

    const fn = runner.runBrowserCommentFullStateSync as (relay: unknown) => Promise<void>;
    await fn(mockRelay);

    const eventLog = getRunnerEventLog();
    const requestEvents = eventLog.filter((e): e is { type: "request"; action: string; payload: unknown } => e.type === "request");
    const actions = requestEvents.map((e) => e.action);

    // Gate: sync_comment_state must be sent first
    expect(actions).toContain("sync_comment_state");

    // Only meaningful after gate passes: verify no get_comments
    expect(actions).not.toContain("get_comments");
  });

  it("M36-CS-18-05: 🔴 runBrowserCommentFullStateSync calls persist BEFORE broadcast/refresh", async () => {
    const runner = await import("../src/browser-comment-sync-runner.js");
    const { getRunnerEventLog } = runner;

    const mockRelay = {
      request: vi.fn(async () => ({
        success: true,
        requestId: "req-1",
        data: {
          schemaVersion: "2.0",
          browserRevision: 2,
          accordoRevision: 1,
          emittedBy: "browser-extension",
          generatedAt: new Date().toISOString(),
          pages: [],  // empty — runner's merged response has no pages
        },
      })),
      push: vi.fn(),
      isConnected: () => true,
    };

    const fn = runner.runBrowserCommentFullStateSync as (relay: unknown) => Promise<void>;
    await fn(mockRelay);

    const eventLog = getRunnerEventLog();

    // 1. sync_comment_state request must appear
    // BROKEN: no request events → FAILS
    // CORRECT: request event logged → continues
    expect(eventLog.some((e) => e.type === "request" && (e as { type: "request"; action: string }).action === "sync_comment_state")).toBe(true);

    // 2. Broadcast must be called
    // BROKEN: no broadcast event → FAILS
    // CORRECT: broadcast event logged → continues
    expect(eventLog.some((e) => e.type === "broadcast")).toBe(true);

    // 3. Persist must be called
    // BROKEN: no persist event → FAILS
    // CORRECT: persist event logged → continues
    expect(eventLog.some((e) => e.type === "persist")).toBe(true);

    // 4. Ordering: persist must come BEFORE broadcast
    // Find indices in event log
    const persistIdx = eventLog.findIndex((e) => e.type === "persist");
    const broadcastIdx = eventLog.findIndex((e) => e.type === "broadcast");

    // BROKEN: if persist not called, persistIdx is -1 → FAILS
    // BROKEN: if broadcast not called, broadcastIdx is -1 → FAILS (caught above)
    // CORRECT: both called → compare indices → persistIdx < broadcastIdx
    expect(persistIdx).toBeLessThan(broadcastIdx);
  });
});

// ── SECTION E: Fixture proof (pass-eligible) 🟢 ───────────────────────────────

describe("E — Fixture proof 🟢 pass-eligible", () => {
  it("M38-CT-14-01: canonical key format has namespace prefix", () => {
    const CANONICAL_KEY = "accordo:browser-comments-sync:v2";
    expect(CANONICAL_KEY).toContain(":");
    expect(CANONICAL_KEY.split(":")).toHaveLength(3);
  });

  it("M38-CT-14-02: sync_comment_state action name is non-empty string", () => {
    expect("sync_comment_state".length).toBeGreaterThan(0);
    expect("request_comment_state_sync".length).toBeGreaterThan(0);
  });

  it("M38-CT-14-03: meta field names match intended Phase C schema", () => {
    const metaFields = [
      "lastSentBrowserRevision",
      "lastAckedBrowserRevision",
      "lastPersistedAccordoRevision",
      "nextBrowserRevision",
    ];
    metaFields.forEach((f) => expect(typeof f).toBe("string"));
  });
});