/**
 * relay-lifecycle-runtime-sync.test.ts
 *
 * Runtime integration tests for full-state sync action handling in
 * createRelayRequestHandler (relay-lifecycle-runtime.ts).
 *
 * These tests call the REAL createRelayRequestHandler (not helper-only mocks)
 * to verify the canonical non-recursive sync protocol:
 *
 *   Canonical protocol:
 *     request_comment_state_sync → syncBrowserComments() once → returns result
 *     sync_comment_state (with payload) → applyBrowserCommentSyncStateFromRelay() once → returns result
 *     Neither action triggers syncBrowserComments() recursively.
 *
 * Both shared and per-window relay modes are covered via the factory pattern
 * in createRelayRequestHandler.
 *
 * Requirement IDs covered: BR-F-157..168, M36-CS-14..18, M40-EXT-15
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";

// ── Mock helpers ───────────────────────────────────────────────────────────────

function createMockRelay(overrides: Partial<BrowserRelayLike> = {}): BrowserRelayLike {
  return {
    request: vi.fn(async () => ({ success: true, requestId: "req-1", data: {} })),
    push: vi.fn(),
    isConnected: () => true,
    ...overrides,
  };
}

function createMockBridge(): BrowserBridgeAPI {
  return {
    registerTools: vi.fn(() => ({ dispose: vi.fn() })),
    publishState: vi.fn(),
    invokeTool: vi.fn(async () => ({})),
  };
}

const mockOutput = { appendLine: vi.fn() } as unknown as vscode.OutputChannel;

// ── Test: sync_comment_state applies payload directly (no recursion) ────────────

describe("sync_comment_state — applies payload directly, no recursion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: accordo-comments not installed
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(null);
  });

  it("RT-SYNC-01: sync_comment_state does NOT call relay.request (no syncBrowserComments recursion)", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 3,
      accordoRevision: 2,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [{
        pageUrl: "https://example.com/page",
        threads: [{
          id: "t1",
          anchorKey: "body:center",
          pageUrl: "https://example.com/page",
          status: "open",
          comments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivity: "2026-01-01T00:00:00.000Z",
        }],
      }],
    });

    // No relay.request calls — sync_comment_state applies state without requesting
    expect(requestSpy.mock.calls).toHaveLength(0);
  });

  it("RT-SYNC-02: sync_comment_state returns success (apply with no accordo-comments is partial)", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    const result = await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    // Without accordo-comments installed, apply returns "partial" → success=false
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });

  it("RT-SYNC-03: sync_comment_state with accordo-comments returns success", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const bridge = createMockBridge();

    const mockApply = vi.fn().mockResolvedValue(undefined);
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
      exports: { applyBrowserCommentSyncState: mockApply },
    });

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    const result = await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    expect(result.success).toBe(true);
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it("RT-SYNC-04: sync_comment_state does NOT invoke VS Code comment tools", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const bridge = createMockBridge();
    const invokeSpy = bridge.invokeTool as ReturnType<typeof vi.fn>;

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    // No VS Code tool calls for sync_comment_state
    const toolCalls = invokeSpy.mock.calls.map(([name]: [string, unknown]) => name as string);
    expect(toolCalls).not.toContain("comment_list");
    expect(toolCalls).not.toContain("comment_create");
  });

  it("RT-SYNC-05: sync_comment_state does NOT push request_comment_state_sync", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const pushSpy = relay.push as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    const pushCalls = pushSpy.mock.calls.map(([action]: [string, unknown]) => action as string);
    expect(pushCalls).not.toContain("request_comment_state_sync");
    expect(pushCalls).not.toContain("notify_comments_updated");
  });

  it("RT-SYNC-06: sync_comment_state passes exact payload to applyBrowserCommentSyncStateFromRelay", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const bridge = createMockBridge();

    const mockApply = vi.fn().mockResolvedValue(undefined);
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
      exports: { applyBrowserCommentSyncState: mockApply },
    });

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    const fullStatePayload = {
      schemaVersion: "2.0",
      browserRevision: 5,
      accordoRevision: 3,
      emittedBy: "browser-extension",
      generatedAt: "2026-05-02T12:00:00.000Z",
      pages: [{
        pageUrl: "https://example.com/test",
        threads: [{
          id: "t-abc",
          anchorKey: "main:100",
          pageUrl: "https://example.com/test",
          status: "resolved",
          comments: [{
            id: "c-xyz",
            threadId: "t-abc",
            createdAt: "2026-05-01T10:00:00.000Z",
            author: { kind: "user" as const, name: "Bob" },
            body: "Test comment",
            anchorKey: "main:100",
            status: "open",
          }],
          createdAt: "2026-05-01T09:00:00.000Z",
          lastActivity: "2026-05-01T10:00:00.000Z",
        }],
      }],
    };

    await handler("sync_comment_state", fullStatePayload);

    expect(mockApply).toHaveBeenCalledTimes(1);
    const [passedState] = mockApply.mock.calls[0] as [unknown];
    expect((passedState as { browserRevision: number }).browserRevision).toBe(5);
    expect((passedState as { pages: unknown[] }).pages[0]).toHaveProperty("pageUrl", "https://example.com/test");
  });
});

// ── Test: request_comment_state_sync triggers sync cycle once ─────────────────

describe("request_comment_state_sync — triggers sync cycle once, no recursion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(null);
  });

  it("RT-WAKE-01: request_comment_state_sync calls relay.request('request_comment_state_sync') once (not sync_comment_state)", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("request_comment_state_sync", { url: "https://example.com/page" });

    // syncBrowserComments calls relay.request("request_comment_state_sync", {}) to initiate,
    // NOT sync_comment_state with {}. The browser's handleRequestCommentStateSync then
    // calls back via sync_comment_state with the full browser state.
    const requestSyncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "request_comment_state_sync");
    expect(requestSyncCalls).toHaveLength(1); // exactly one call, no recursion

    // sync_comment_state should NOT be called from VSCode side in this flow
    const syncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "sync_comment_state");
    expect(syncCalls).toHaveLength(0); // VSCode does NOT call sync_comment_state — browser calls back
  });

  it("RT-WAKE-02: request_comment_state_sync returns success with merged state when sync succeeds", async () => {
    // In the correct protocol, syncBrowserComments calls relay.request("request_comment_state_sync", {})
    // and the response data is the merged BrowserCommentSyncState (returned by handleRequestCommentStateSync
    // which receives it from VSCode's sync_comment_state handler).
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const mergedState = {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    };

    const relay = createMockRelay({
      request: vi.fn(async () => ({
        success: true,
        requestId: "req-1",
        data: mergedState,
      })),
    });
    const bridge = createMockBridge();

    const mockApply = vi.fn().mockResolvedValue(undefined);
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
      exports: { applyBrowserCommentSyncState: mockApply },
    });

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    const result = await handler("request_comment_state_sync", {});

    expect(result.success).toBe(true);
    // Response data should be the merged state (from syncResult.syncResult)
    expect(result.data).toEqual(mergedState);
  });

  it("RT-WAKE-03: request_comment_state_sync returns failure when relay.request throws", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay({
      request: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    const result = await handler("request_comment_state_sync", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("action-failed");
  });
});

// ── Test: No recursion ───────────────────────────────────────────────────────

describe("No recursion — nested sync calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(null);
  });

  it("RT-REC-01: handling sync_comment_state results in zero relay.request calls", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    expect(requestSpy.mock.calls).toHaveLength(0);
  });

  it("RT-REC-02: handling request_comment_state_sync results in zero sync_comment_state calls (request_comment_state_sync is called instead — no recursion)", async () => {
    // Protocol: request_comment_state_sync handler calls syncBrowserComments() which calls
    // relay.request("request_comment_state_sync", {}) to the browser. The browser's
    // handleRequestCommentStateSync then calls back via sync_comment_state.
    // VSCode's handler does NOT call sync_comment_state directly — no recursion.
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("request_comment_state_sync", {});

    // sync_comment_state is NOT called from VSCode side — browser calls back via handleRequestCommentStateSync
    const syncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "sync_comment_state");
    expect(syncCalls).toHaveLength(0); // no sync_comment_state from VSCode

    // request_comment_state_sync IS called (via syncBrowserComments) — one call
    const requestSyncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "request_comment_state_sync");
    expect(requestSyncCalls).toHaveLength(1); // one — no recursion
  });

  it("RT-REC-03: request_comment_state_sync does not push request_comment_state_sync during handling", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const pushSpy = relay.push as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logMappingDetails: false,
    });

    await handler("request_comment_state_sync", {});

    const pushCalls = pushSpy.mock.calls.map(([action]: [string, unknown]) => action as string);
    expect(pushCalls).not.toContain("request_comment_state_sync");
  });
});

// ── Test: Both relay modes follow same non-recursive protocol ─────────────────

describe("Both relay modes — same non-recursive protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(null);
  });

  it("RT-MODE-01: per-window relay (getRelay returns same relay) — no recursion for sync_comment_state", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    // Per-window: getRelay returns the same relay instance on every call
    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logLabel: "per-window",
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 1,
      accordoRevision: 0,
      emittedBy: "browser-extension",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    expect(requestSpy.mock.calls).toHaveLength(0); // direct apply, no relay.request
  });

  it("RT-MODE-02: shared relay mode — sync_comment_state does not call relay.request", async () => {
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logLabel: "shared-owner",
      logMappingDetails: false,
    });

    await handler("sync_comment_state", {
      schemaVersion: "2.0",
      browserRevision: 2,
      accordoRevision: 1,
      emittedBy: "vscode-accordo",
      generatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
    });

    expect(requestSpy.mock.calls).toHaveLength(0);
  });

  it("RT-MODE-03: shared relay mode — request_comment_state_sync calls relay.request('request_comment_state_sync') exactly once (not sync_comment_state)", async () => {
    // syncBrowserComments now calls request_comment_state_sync (not sync_comment_state).
    // The sync_comment_state call is made by the browser's handleRequestCommentStateSync, not VSCode.
    const { createRelayRequestHandler } = await import("../relay-lifecycle-runtime.js");

    const relay = createMockRelay();
    const requestSpy = relay.request as ReturnType<typeof vi.fn>;
    const bridge = createMockBridge();

    const handler = createRelayRequestHandler({
      out: mockOutput,
      bridge,
      getRelay: () => relay,
      logLabel: "shared-owner",
      logMappingDetails: false,
    });

    await handler("request_comment_state_sync", {});

    const requestSyncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "request_comment_state_sync");
    expect(requestSyncCalls).toHaveLength(1);

    // NO sync_comment_state from VSCode side
    const syncCalls = requestSpy.mock.calls.filter(([action]: [string, unknown]) => action === "sync_comment_state");
    expect(syncCalls).toHaveLength(0);
  });
});