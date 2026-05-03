/**
 * browser-extension-relay-runtime.test.ts
 *
 * Phase D2 — Browser-extension relay action runtime integration tests.
 *
 * Tests target the real production handler paths for:
 *   - handleSyncCommentState: persists merged state from VSCode response
 *   - handleRequestCommentStateSync: reads canonical store, sends full state, persists merged response
 *
 * Tests use real handler functions (not mocked) with fake relay/storage injection.
 * Verifies the end-to-end action-path contract:
 *   - request action causes full-state payload send
 *   - sync action result handling persists merged full-state
 *   - merged payload shape returned/propagated correctly
 *   - no empty payload placeholders
 *
 * Requirement IDs covered:
 *   M36-CS-14, M36-CS-16, M36-CS-17, M36-CS-18
 *   BR-F-157..168
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RelayActionRequest, RelayAction } from "../src/relay-definitions.js";
import {
  handleSyncCommentState,
  handleRequestCommentStateSync,
} from "../src/relay-sync-handlers.js";
import {
  configureBrowserCommentSyncStorage,
  persistMergedBrowserCommentSyncState,
  loadBrowserCommentSyncDocument,
  type BrowserCommentSyncPage,
} from "../src/browser-comment-sync-store.js";

// ── Fake relay for testing ──────────────────────────────────────────────────────

type PendingRequest = { action: string; payload: unknown };

interface FakeRelay {
  isConnected: () => boolean;
  send: (action: string, payload: unknown, timeout?: number) => Promise<{ success: boolean; data: unknown }>;
  request: (action: string, payload: unknown, timeout?: number) => Promise<{ success: boolean; data: unknown }>;
  _setResponse: (response: { success: boolean; data: unknown }) => void;
  _getLastSend: () => PendingRequest | null;
  _getLastRequest: () => PendingRequest | null;
}

function createFakeRelay(connected = true): FakeRelay {
  let pendingResponse: { success: boolean; data: unknown } | null = null;
  let lastSend: PendingRequest | null = null;
  let lastRequest: PendingRequest | null = null;

  return {
    isConnected: () => connected,
    send: async (action, payload) => {
      lastSend = { action, payload };
      if (!pendingResponse) {
        return { success: false, data: { error: "no-response-configured" } };
      }
      const resp = pendingResponse;
      pendingResponse = null;
      return resp;
    },
    // request() simulates a call where the response carries the merged state
    request: async (action, payload) => {
      lastRequest = { action, payload };
      if (!pendingResponse) {
        return { success: false, data: { error: "no-response-configured" } };
      }
      const resp = pendingResponse;
      pendingResponse = null;
      return resp;
    },
    _setResponse: (response) => {
      pendingResponse = response;
    },
    _getLastSend: () => lastSend,
    _getLastRequest: () => lastRequest,
  };
}

// Fake relay client module to inject our fake relay
let _fakeRelay: FakeRelay | null = null;

vi.mock("../src/relay-comment-runtime.js", () => ({
  getRelayClient: () => _fakeRelay,
}));

// ── Fake storage for canonical store ───────────────────────────────────────────

let _storedDoc = {
  meta: {
    lastSentBrowserRevision: 0,
    lastAckedBrowserRevision: 0,
    lastPersistedAccordoRevision: 0,
    nextBrowserRevision: 1,
  },
  pages: [] as BrowserCommentSyncPage[],
};

function createFakeStorage() {
  return {
    loadDocument: () => _storedDoc,
    saveDocument: (doc: typeof _storedDoc) => {
      _storedDoc = doc;
    },
  };
}

// ── Test fixtures ────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<{
  schemaVersion: string;
  browserRevision: number;
  accordoRevision: number;
  emittedBy: string;
  generatedAt: string;
  pages: BrowserCommentSyncPage[];
}> = {}): Parameters<typeof persistMergedBrowserCommentSyncState>[0] {
  return {
    schemaVersion: "2.0",
    browserRevision: 5,
    accordoRevision: 3,
    emittedBy: "browser-extension",
    generatedAt: new Date().toISOString(),
    pages: [],
    ...overrides,
  } as Parameters<typeof persistMergedBrowserCommentSyncState>[0];
}

function makeRelayRequest(action: RelayAction, payload: Record<string, unknown> = {}): RelayActionRequest {
  return { requestId: `req-${Date.now()}`, action, payload };
}

// ── Storage injection helper ────────────────────────────────────────────────────

const fakeStorage = createFakeStorage();

beforeEach(() => {
  _storedDoc = {
    meta: {
      lastSentBrowserRevision: 0,
      lastAckedBrowserRevision: 0,
      lastPersistedAccordoRevision: 0,
      nextBrowserRevision: 1,
    },
    pages: [],
  };
  fakeStorage.loadDocument = () => _storedDoc;
  fakeStorage.saveDocument = (doc) => { _storedDoc = doc; };
  configureBrowserCommentSyncStorage(fakeStorage);
  _fakeRelay = createFakeRelay(true);
});

afterEach(() => {
  configureBrowserCommentSyncStorage({
    loadDocument: () => ({
      meta: { lastSentBrowserRevision: 0, lastAckedBrowserRevision: 0, lastPersistedAccordoRevision: 0, nextBrowserRevision: 1 },
      pages: [],
    }),
    saveDocument: () => {},
  });
  _fakeRelay = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A: handleSyncCommentState — persists merged state from VSCode
// ─────────────────────────────────────────────────────────────────────────────

describe("A — handleSyncCommentState persists merged state from VSCode response", () => {
  it("BR-RT-SYNC-01: returns success and persists full merged state from request.payload", async () => {
    const mergedState = makeState({
      schemaVersion: "2.0",
      browserRevision: 7,
      accordoRevision: 4,
      emittedBy: "vscode-accordo",
      pages: [{
        pageUrl: "https://example.com/page1",
        threads: [{
          id: "t-merged-1",
          anchorKey: "body:center",
          pageUrl: "https://example.com/page1",
          status: "open",
          comments: [{
            id: "c-merged-1",
            threadId: "t-merged-1",
            createdAt: "2026-01-01T00:00:00.000Z",
            author: { kind: "agent" as const, name: "Alice" },
            body: "Merged comment",
            anchorKey: "body:center",
            status: "open",
          }],
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivity: "2026-01-01T00:00:00.000Z",
        }],
      }],
    });

    const request = makeRelayRequest("sync_comment_state", mergedState);
    const result = await handleSyncCommentState(request);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ synced: true });

    // Persisted state should have the merged values
    const stored = loadBrowserCommentSyncDocument();
    expect(stored.meta.lastSentBrowserRevision).toBe(7);
    expect(stored.meta.lastPersistedAccordoRevision).toBe(4);
    expect(stored.pages).toHaveLength(1);
    expect(stored.pages[0].threads[0].id).toBe("t-merged-1");
  });

  it("BR-RT-SYNC-02: persists empty pages array (no threads)", async () => {
    const mergedState = makeState({
      browserRevision: 1,
      accordoRevision: 0,
      pages: [],
    });

    const request = makeRelayRequest("sync_comment_state", mergedState);
    const result = await handleSyncCommentState(request);

    expect(result.success).toBe(true);
    const stored = loadBrowserCommentSyncDocument();
    expect(stored.pages).toHaveLength(0);
    expect(stored.meta.lastSentBrowserRevision).toBe(1);
  });

  it("BR-RT-SYNC-03: returns failure when relay is disconnected", async () => {
    _fakeRelay = createFakeRelay(false); // disconnected

    const request = makeRelayRequest("sync_comment_state", makeState());
    const result = await handleSyncCommentState(request);

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("BR-RT-SYNC-04: does NOT call relay.send (no recursion — sync_comment_state is inbound only)", async () => {
    const relay = createFakeRelay(true);
    _fakeRelay = relay;

    const request = makeRelayRequest("sync_comment_state", makeState());
    await handleSyncCommentState(request);

    // handleSyncCommentState should NOT send anything — it only persists the incoming payload
    expect(relay._getLastSend()).toBeNull();
  });

  it("BR-RT-SYNC-05: persists state even when browserRevision is 0 (initial sync)", async () => {
    const mergedState = makeState({
      browserRevision: 0,
      accordoRevision: 0,
      pages: [],
    });

    const request = makeRelayRequest("sync_comment_state", mergedState);
    const result = await handleSyncCommentState(request);

    expect(result.success).toBe(true);
    const stored = loadBrowserCommentSyncDocument();
    expect(stored.meta.lastSentBrowserRevision).toBe(0);
    expect(stored.meta.nextBrowserRevision).toBe(1); // max(1, 0+1) = 1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B: handleRequestCommentStateSync — reads store, sends full state, persists response
// ─────────────────────────────────────────────────────────────────────────────

describe("B — handleRequestCommentStateSync reads canonical store, sends full state, persists response", () => {
  it("BR-RT-WAKE-01: sends sync_comment_state with full canonical state (not empty {})", async () => {
    // Pre-populate canonical store with some state
    const preState = makeState({
      browserRevision: 3,
      accordoRevision: 2,
      pages: [{
        pageUrl: "https://example.com/page1",
        threads: [{
          id: "t-pre-existing",
          anchorKey: "main:99",
          pageUrl: "https://example.com/page1",
          status: "open",
          comments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivity: "2026-01-01T00:00:00.000Z",
        }],
      }],
    });
    await persistMergedBrowserCommentSyncState(preState);

    // Configure relay to return merged state on sync_comment_state
    const relay = createFakeRelay(true);
    relay._setResponse({
      success: true,
      data: makeState({
        browserRevision: 3,
        accordoRevision: 3, // incremented
        pages: preState.pages,
      }),
    });
    _fakeRelay = relay;

    const request = makeRelayRequest("request_comment_state_sync", { url: "https://example.com/page1" });
    await handleRequestCommentStateSync(request);

    // Verify sync_comment_state was sent with FULL state (not {})
    const lastSend = relay._getLastSend();
    expect(lastSend).not.toBeNull();
    expect(lastSend!.action).toBe("sync_comment_state");
    expect(lastSend!.payload).toHaveProperty("schemaVersion", "2.0");
    expect(lastSend!.payload).toHaveProperty("browserRevision", 3);
    expect(lastSend!.payload).toHaveProperty("pages");
    expect((lastSend!.payload as { pages: unknown[] }).pages).toHaveLength(1);
  });

  it("BR-RT-WAKE-02: sends sync_comment_state with empty pages when canonical store is empty", async () => {
    const relay = createFakeRelay(true);
    relay._setResponse({ success: true, data: makeState({ browserRevision: 0, accordoRevision: 0, pages: [] }) });
    _fakeRelay = relay;

    const request = makeRelayRequest("request_comment_state_sync", { url: "https://example.com/empty" });
    await handleRequestCommentStateSync(request);

    const lastSend = relay._getLastSend();
    expect(lastSend).not.toBeNull();
    expect((lastSend!.payload as { pages: unknown[] }).pages).toHaveLength(0);
    expect(lastSend!.payload).toHaveProperty("emittedBy", "browser-extension");
  });

  it("BR-RT-WAKE-03: persists the merged state returned by VSCode (not the sent state)", async () => {
    // Pre-populate store with local state
    await persistMergedBrowserCommentSyncState(makeState({
      browserRevision: 2,
      accordoRevision: 1,
      pages: [{
        pageUrl: "https://example.com/page1",
        threads: [{ id: "t-local", anchorKey: "body:center", pageUrl: "https://example.com/page1", status: "open", comments: [], createdAt: "", lastActivity: "" }],
      }],
    }));

    const relay = createFakeRelay(true);
    // VSCode returns merged state with INCREMENTED accordoRevision
    relay._setResponse({
      success: true,
      data: makeState({
        browserRevision: 2,
        accordoRevision: 5, // incremented by VSCode merge
        pages: [{
          pageUrl: "https://example.com/page1",
          threads: [{ id: "t-local", anchorKey: "body:center", pageUrl: "https://example.com/page1", status: "resolved", comments: [], createdAt: "", lastActivity: "" }],
        }],
      }),
    });
    _fakeRelay = relay;

    await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    const stored = loadBrowserCommentSyncDocument();
    // Persisted accordoRevision should be from VSCode's merged response (5), not local (1)
    expect(stored.meta.lastPersistedAccordoRevision).toBe(5);
    expect(stored.pages[0].threads[0].status).toBe("resolved");
  });

  it("BR-RT-WAKE-04: returns failure when relay is disconnected", async () => {
    _fakeRelay = createFakeRelay(false);

    const result = await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("BR-RT-WAKE-05: returns failure when relay.send returns success:false", async () => {
    const relay = createFakeRelay(true);
    relay._setResponse({ success: false, data: { error: "browser-not-connected" } });
    _fakeRelay = relay;

    const result = await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("BR-RT-WAKE-06: uses canonical store browserRevision as the sent browserRevision", async () => {
    // Simulate: lastSentBrowserRevision was set to 10 in a previous sync
    _storedDoc = {
      meta: {
        lastSentBrowserRevision: 10,
        lastAckedBrowserRevision: 8,
        lastPersistedAccordoRevision: 7,
        nextBrowserRevision: 11,
      },
      pages: [],
    };
    fakeStorage.loadDocument = () => _storedDoc;
    configureBrowserCommentSyncStorage(fakeStorage);

    const relay = createFakeRelay(true);
    relay._setResponse({ success: true, data: makeState({ browserRevision: 10, accordoRevision: 8, pages: [] }) });
    _fakeRelay = relay;

    await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    const lastSend = relay._getLastSend();
    expect(lastSend).not.toBeNull();
    expect((lastSend!.payload as { browserRevision: number }).browserRevision).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C: End-to-end contract — no empty payloads, correct shape propagation
// ─────────────────────────────────────────────────────────────────────────────

describe("C — End-to-end contract: no empty payloads, correct shape propagation", () => {
  it("BR-RT-E2E-01: handleSyncCommentState request.payload is used directly (is the merged state)", async () => {
    const mergedState = makeState({
      browserRevision: 9,
      accordoRevision: 6,
      emittedBy: "vscode-accordo",
      pages: [{
        pageUrl: "https://e2e.example.com",
        threads: [{
          id: "t-e2e-1",
          anchorKey: "surface:0.5,0.5",
          pageUrl: "https://e2e.example.com",
          status: "resolved",
          comments: [{
            id: "c-e2e-1",
            threadId: "t-e2e-1",
            createdAt: "2026-04-01T10:00:00.000Z",
            author: { kind: "agent" as const, name: "E2E Test" },
            body: "End-to-end test",
            anchorKey: "surface:0.5,0.5",
            status: "open",
          }],
          createdAt: "2026-04-01T09:00:00.000Z",
          lastActivity: "2026-04-01T10:00:00.000Z",
        }],
      }],
    });

    const relay = createFakeRelay(true);
    _fakeRelay = relay;

    const request = makeRelayRequest("sync_comment_state", mergedState);
    const result = await handleSyncCommentState(request);

    // Result must be success with the merged state shape persisted
    expect(result.success).toBe(true);
    const stored = loadBrowserCommentSyncDocument();
    expect(stored.meta.lastSentBrowserRevision).toBe(9);
    expect(stored.meta.lastPersistedAccordoRevision).toBe(6);
    expect(stored.pages[0].threads[0].id).toBe("t-e2e-1");
    expect(stored.pages[0].threads[0].status).toBe("resolved");

    // NO relay.send was called (no recursion)
    expect(relay._getLastSend()).toBeNull();
  });

  it("BR-RT-E2E-02: handleRequestCommentStateSync sends non-empty full state (not empty placeholder {})", async () => {
    await persistMergedBrowserCommentSyncState(makeState({
      browserRevision: 4,
      accordoRevision: 3,
      pages: [{
        pageUrl: "https://full-state.example.com",
        threads: [{
          id: "t-full-1",
          anchorKey: "body:top",
          pageUrl: "https://full-state.example.com",
          status: "open",
          comments: [{
            id: "c-full-1",
            threadId: "t-full-1",
            createdAt: "2026-03-15T12:00:00.000Z",
            author: { kind: "user" as const, name: "Full State User" },
            body: "Full state comment",
            anchorKey: "body:top",
            status: "open",
          }],
          createdAt: "2026-03-15T11:00:00.000Z",
          lastActivity: "2026-03-15T12:00:00.000Z",
        }],
      }],
    }));

    const relay = createFakeRelay(true);
    relay._setResponse({ success: true, data: makeState({ browserRevision: 4, accordoRevision: 3, pages: [] }) });
    _fakeRelay = relay;

    await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    const lastSend = relay._getLastSend();
    expect(lastSend).not.toBeNull();
    // Must be non-empty: must have schemaVersion, browserRevision, pages
    const payload = lastSend!.payload as Record<string, unknown>;
    expect(payload).toHaveProperty("schemaVersion");
    expect(payload).toHaveProperty("browserRevision");
    expect(payload).toHaveProperty("pages");
    expect(payload).toHaveProperty("emittedBy");
    expect(payload).toHaveProperty("generatedAt");
    // Must NOT be an empty object
    expect(Object.keys(payload).length).toBeGreaterThan(1);
    expect((payload.pages as unknown[])).toHaveLength(1);
  });

  it("BR-RT-E2E-03: merged state shape matches BrowserCommentSyncState wire contract", async () => {
    const canonicalState = makeState({
      browserRevision: 6,
      accordoRevision: 5,
      pages: [{
        pageUrl: "https://shape.example.com",
        threads: [{
          id: "t-shape-1",
          anchorKey: "main:100",
          pageUrl: "https://shape.example.com",
          status: "open",
          comments: [{
            id: "c-shape-1",
            threadId: "t-shape-1",
            createdAt: "2026-02-20T08:00:00.000Z",
            author: { kind: "agent" as const, name: "Shape Test" },
            body: "Shape verification",
            anchorKey: "main:100",
            status: "open",
          }],
          createdAt: "2026-02-20T07:00:00.000Z",
          lastActivity: "2026-02-20T08:00:00.000Z",
        }],
      }],
    });

    const relay = createFakeRelay(true);
    relay._setResponse({ success: true, data: canonicalState });
    _fakeRelay = relay;

    await handleRequestCommentStateSync(makeRelayRequest("request_comment_state_sync", {}));

    const lastSend = relay._getLastSend();
    const sent = lastSend!.payload as Record<string, unknown>;

    // Required fields for BrowserCommentSyncState wire format
    expect(typeof sent.schemaVersion).toBe("string");
    expect(typeof sent.browserRevision).toBe("number");
    expect(typeof sent.accordoRevision).toBe("number");
    expect(typeof sent.emittedBy).toBe("string");
    expect(typeof sent.generatedAt).toBe("string");
    expect(Array.isArray(sent.pages)).toBe(true);
  });
});
