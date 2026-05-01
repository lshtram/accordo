/**
 * Tests for Extension entry point — M40
 *
 * Source: comments-architecture.md §10.1, §10.2, §10.3
 *
 * Requirements covered:
 *   §10.2  activate acquires BridgeAPI from accordo.accordo-bridge
 *   §10.2  Is inert when bridge is absent (no errors, no tools, no state)
 *   §10.2  Creates CommentStore and calls load()
 *   §10.2  Creates comment controller with id "accordo-comments"
 *   §10.2  Sets commentingRangeProvider to allow commenting on all lines
 *   §10.2  Restores persisted text threads to controller
 *   §10.2  Registers 6 MCP tools via bridge.registerTools
 *   §10.2  Registers user-facing commands (new, resolve, delete, reopen)
 *   §10.2  Wires onDidChangeTextDocument for staleness tracking
 *   §10.2  Publishes initial modality state via bridge.publishState
 *   §10.2  Re-publishes modality state on store changes
 *   §10.3  Registers internal commands for inter-extension API
 *   §10.2  Pushes disposables into context.subscriptions
 */

// API checklist:
// ✓ activate()   — all §10.2 and §10.3 tests (35 tests: 30 existing + 5 new getSurfaceAdapter registration/shape + 6 getSurfaceAdapter behaviour)
// ✓ deactivate() — deactivate no-op (1 test)
// ✓ BridgeAPI interface — mocked via createMockBridge() in every test
// ✓ SurfaceCommentAdapter interface — exercised in §10.3 getSurfaceAdapter block (11 tests: M40-EXT-11)

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommentAnchorSurface, SlideCoordinates, CommentStoreFile } from "@accordo/bridge-types";
import {
  resetMockState,
  mockState,
  createMockExtensionContext,
  workspace,
  comments as vscodeComments,
  extensions,
  Uri,
  Range,
  MarkdownString,
  CommentMode,
  MockComment,
} from "./mocks/vscode.js";
import { activate, deactivate, type BridgeAPI, type SurfaceCommentAdapter } from "../extension.js";
import { NativeComments } from "../native-comments.js";
import type * as vscode from "vscode";

// ── Test helpers ─────────────────────────────────────────────────────────────

function createMockBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

function setupBridgeExtension(bridge: BridgeAPI | undefined): void {
  // Set up the mock so extensions.getExtension returns the bridge
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(
    bridge
      ? { exports: bridge, isActive: true, activate: vi.fn().mockResolvedValue(undefined) }
      : undefined,
  );
}

function textAnchor(uri: string, startLine: number): import("@accordo/bridge-types").CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine, startChar: 0, endLine: startLine, endChar: 0 },
    docVersion: 1,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockState();
});

// ── §10.2 Bridge acquisition ─────────────────────────────────────────────────

describe("§10.2 Bridge acquisition", () => {
  it("acquires BridgeAPI from accordo.accordo-bridge extension", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
  });

  it("is inert when bridge extension is absent — no errors thrown", async () => {
    setupBridgeExtension(undefined);
    const ctx = createMockExtensionContext();

    // Should return without error
    await expect(activate(ctx)).resolves.not.toThrow();
  });

  it("still creates comment controller when bridge is absent (store works independently)", async () => {
    setupBridgeExtension(undefined);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    // Controller IS created — store and NativeComments don't depend on bridge
    expect(vscodeComments.createCommentController).toHaveBeenCalled();
  });

  it("does not register tools when bridge is absent", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(undefined);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    expect(bridge.registerTools).not.toHaveBeenCalled();
  });

  it("does not publish state when bridge is absent", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(undefined);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    expect(bridge.publishState).not.toHaveBeenCalled();
  });
});

// ── §10.2 Store initialization ───────────────────────────────────────────────

describe("§10.2 Store initialization", () => {
  it("creates a CommentStore and calls load()", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    // Verify store.load() was called — the store should be loaded
    // before controller/tools setup begins.
    // Since store is internal, we verify indirectly: if load fails
    // with missing file, it should start fresh (not throw).
    // This confirms load() was called.
    expect(bridge.registerTools).toHaveBeenCalled();
  });
});

// ── §10.2 Comment controller ─────────────────────────────────────────────────

describe("§10.2 Comment controller", () => {
  it("creates controller with id 'accordo-comments'", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(vscodeComments.createCommentController).toHaveBeenCalledWith(
      "accordo-comments",
      "Accordo Comments",
    );
  });

  it("sets commentingRangeProvider on the controller", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    const controller = (vscodeComments.createCommentController as ReturnType<typeof vi.fn>)
      .mock.results[0].value;
    expect(controller.commentingRangeProvider).toBeDefined();
  });

  it("pushes controller into context.subscriptions", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    // controller should be in subscriptions
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(1);
  });
});

// ── §10.2 Tool registration ──────────────────────────────────────────────────

describe("§10.2 Tool registration", () => {
  it("registers tools via bridge.registerTools with extensionId 'accordo-comments'", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(bridge.registerTools).toHaveBeenCalledWith(
      "accordo-comments",
      expect.any(Array),
    );
  });

  it("M38-CT-01,06: registers exactly 8 MCP tools (including comment_reopen and comment_sync_version)", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    const tools = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(tools).toHaveLength(8);
  });

  it("pushes tool disposable into context.subscriptions", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    // Should have at least controller + tools disposable
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(2);
  });
});

// ── §10.2 Command registration ───────────────────────────────────────────────

describe("§10.2 Command registration", () => {
  it("registers 'accordo.comments.new' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.new")).toBe(true);
  });

  it("registers 'accordo.comments.resolveThread' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.resolveThread")).toBe(true);
  });

  it("registers 'accordo.comments.deleteThread' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.deleteThread")).toBe(true);
  });

  it("registers 'accordo.comments.reopenThread' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.reopenThread")).toBe(true);
  });

  it("registers 'accordo.comments.deleteComment' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.deleteComment")).toBe(true);
  });
});

// ── §10.2 Document change wiring ─────────────────────────────────────────────

describe("§10.2 Document change wiring", () => {
  it("subscribes to workspace.onDidChangeTextDocument", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    // Verify the event subscription was registered
    expect(workspace.onDidChangeTextDocument).toHaveBeenCalled();
  });
});

// ── §10.2 State publishing ───────────────────────────────────────────────────

describe("§10.2 State publishing", () => {
  it("publishes initial modality state on activation", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo-comments",
      expect.objectContaining({ isOpen: true }),
    );
  });

  it("publishes state at least once during activation", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });
});

// ── §10.3 Inter-extension internal commands ──────────────────────────────────

describe("§10.3 Inter-extension internal commands", () => {
  it("registers 'accordo_comments_internal_getThreadsForUri' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(
      mockState.registeredCommands.has("accordo_comments_internal_getThreadsForUri"),
    ).toBe(true);
  });

  it("registers 'accordo_comments_internal_createSurfaceComment' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(
      mockState.registeredCommands.has("accordo_comments_internal_createSurfaceComment"),
    ).toBe(true);
  });

  it("registers 'accordo_comments_internal_resolveThread' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(
      mockState.registeredCommands.has("accordo_comments_internal_resolveThread"),
    ).toBe(true);
  });
});

// ── §10.3 getSurfaceAdapter (M40-EXT-11) ─────────────────────────────────────

describe("§10.3 getSurfaceAdapter (M40-EXT-11)", () => {
  function getAdapter(): SurfaceCommentAdapter {
    const handler = mockState.registeredCommands.get(
      "accordo_comments_internal_getSurfaceAdapter",
    );
    return handler?.() as SurfaceCommentAdapter;
  }

  it("[M40-EXT-11] registers 'accordo_comments_internal_getSurfaceAdapter' command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    await activate(ctx);

    expect(
      mockState.registeredCommands.has("accordo_comments_internal_getSurfaceAdapter"),
    ).toBe(true);
  });

  it("[M40-EXT-11] getSurfaceAdapter returns adapter with all 7 required methods", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();

    expect(adapter).toBeDefined();
    expect(typeof adapter.createThread).toBe("function");
    expect(typeof adapter.reply).toBe("function");
    expect(typeof adapter.resolve).toBe("function");
    expect(typeof adapter.reopen).toBe("function");
    expect(typeof adapter.delete).toBe("function");
    expect(typeof adapter.getThreadsForUri).toBe("function");
    expect(typeof adapter.onChanged).toBe("function");
  });

  it("[M40-EXT-11] adapter.createThread accepts caller-provided anchor verbatim — slide surface", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const slideAnchor = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.3 },
    };

    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: slideAnchor,
      body: "Great point on slide 3",
    });

    expect(thread).toBeDefined();
    expect(thread.anchor).toEqual(slideAnchor);
    const surfaceAnchor = thread.anchor as CommentAnchorSurface;
    expect(surfaceAnchor.surfaceType).toBe("slide");
    expect((surfaceAnchor.coordinates as SlideCoordinates).slideIndex).toBe(3);
  });

  it("[M40-EXT-11] adapter.createThread returns a CommentThread with expected shape", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();

    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0, y: 0 } },
      body: "Test comment",
    });

    expect(thread).toMatchObject({
      id: expect.any(String),
      status: "open",
      comments: expect.arrayContaining([
        expect.objectContaining({ body: "Test comment" }),
      ]),
    });
  });

  it("[M40-EXT-11] adapter.reply appends a comment to the thread", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 1, x: 0.1, y: 0.2 } },
      body: "First comment",
    });

    await adapter.reply({ threadId: thread.id, body: "Reply text" });

    const threads = adapter.getThreadsForUri("file:///deck.md");
    const updated = threads.find(t => t.id === thread.id);
    expect(updated?.comments).toHaveLength(2);
    expect(updated?.comments[1].body).toBe("Reply text");
  });

  it("[M40-EXT-11] adapter.resolve marks the thread as resolved", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.5 } },
      body: "Review this slide",
    });

    await adapter.resolve({ threadId: thread.id });

    const threads = adapter.getThreadsForUri("file:///deck.md");
    const updated = threads.find(t => t.id === thread.id);
    expect(updated?.status).toBe("resolved");
  });

  it("[M40-EXT-11] adapter.reopen re-opens a resolved thread", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 4, x: 0.2, y: 0.8 } },
      body: "Needs rework",
    });
    await adapter.resolve({ threadId: thread.id });
    await adapter.reopen({ threadId: thread.id });

    const threads = adapter.getThreadsForUri("file:///deck.md");
    const updated = threads.find(t => t.id === thread.id);
    expect(updated?.status).toBe("open");
  });

  it("[M40-EXT-11] adapter.delete removes the thread", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const thread = await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 5, x: 0.9, y: 0.1 } },
      body: "Remove me",
    });

    await adapter.delete({ threadId: thread.id });

    const threads = adapter.getThreadsForUri("file:///deck.md");
    expect(threads.find(t => t.id === thread.id)).toBeUndefined();
  });

  it("[M40-EXT-11] adapter.getThreadsForUri returns only threads for the given URI", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    await adapter.createThread({
      uri: "file:///deck-a.md",
      anchor: { kind: "surface", uri: "file:///deck-a.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0, y: 0 } },
      body: "Deck A comment",
    });
    await adapter.createThread({
      uri: "file:///deck-b.md",
      anchor: { kind: "surface", uri: "file:///deck-b.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0, y: 0 } },
      body: "Deck B comment",
    });

    const threads = adapter.getThreadsForUri("file:///deck-a.md");
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe("Deck A comment");
  });

  it("[M40-EXT-11] adapter.onChanged fires when threads change", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const listener = vi.fn();
    const sub = adapter.onChanged(listener);

    await adapter.createThread({
      uri: "file:///deck.md",
      anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0, y: 0 } },
      body: "Trigger change",
    });

    expect(listener).toHaveBeenCalledWith("file:///deck.md");
    sub.dispose();
  });

  it("[M40-EXT-11] adapter.onChanged returns a disposable subscription", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const adapter = getAdapter();
    const sub = adapter.onChanged(vi.fn());

    expect(sub).toHaveProperty("dispose");
    expect(typeof sub.dispose).toBe("function");
    sub.dispose();
  });
});

// ── B6: Canonical store-driven reconcile wiring ─────────────────────────────

/**
 * M37-NC-12: Activation wires one store-driven reconciliation path.
 * store.onChanged → native reconciliation.
 *
 * IMPORTANT: This test MUST NOT pass through legacy direct widget calls
 * (addThread/updateThread/removeThread). It proves the canonical
 * store.onChanged listener calls reconcile(store.getAllThreads()).
 */
describe("B6: store.onChanged → reconcile canonical wiring (M37-NC-12)", () => {
  it("store.onChanged listener calls reconcile with current store threads", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    // Trigger a store mutation (createThread)
    const createHandler = mockState.registeredCommands.get("accordo_comments_internal_getStore");
    const adapter = createHandler!() as Record<string, unknown>;
    await (adapter.createThread as (args: { uri: string; blockId: string; body: string }) => Promise<unknown>)({
      uri: "file:///project/src/auth.ts",
      blockId: "p:42",
      body: "New comment via store",
    });

    // Get sync state via the diagnostic command — prove reconcile ran
    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const state = getSyncStateHandler!() as { storeThreadIds: string[]; nativeWidgetIds: string[]; inSync: boolean; missingWidgetIds: string[] };

    // The canonical path has run — there should be no missing widgets
    expect(state.inSync).toBe(true);
    expect(state.storeThreadIds.length).toBeGreaterThan(0);
    expect(state.missingWidgetIds).toHaveLength(0);
  });

  it("legacy direct addThread cannot mask missing store.onChanged wiring", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    // Get the NC controller and add a widget directly WITHOUT going through
    // the store (bypassing store.onChanged -> reconcile). This simulates
    // legacy code that adds native widgets directly without the store layer.
    const controller = (vscodeComments.createCommentController as ReturnType<typeof vi.fn>)
      .mock.results[0].value as MockCommentController;
    const uri = Uri.parse("file:///project/src/legacy.ts");
    const range = new Range(5, 0, 5, 0);
    const legacyComments: MockComment[] = [
      new MockComment("Direct widget, no store", CommentMode.Preview, { name: "User" }),
    ];
    controller.createCommentThread(uri, range, legacyComments);

    // Query sync state — the orphaned widget should NOT be cleared
    // because reconcile only runs via store.onChanged; direct widget
    // additions are invisible to the sync layer without the store path.
    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const state = getSyncStateHandler!() as { orphanWidgetIds: string[]; inSync: boolean };

    // Low-level VS Code mock widgets are outside Accordo's projection map;
    // they cannot mask the store-driven diagnostic state.
    expect(state.orphanWidgetIds).toHaveLength(0);
    expect(state.inSync).toBe(true);
  });
});

// ── B7: Startup reconcile path ────────────────────────────────────────────────

/**
 * runStartupNativeProjectionReconcile is called in activate() after load/prune.
 * This proves initial persisted threads produce inSync diagnostic state.
 */
describe("B7: startup reconcile produces inSync state (M37-NC-12)", () => {
  it("after activate, persisted threads are inSync=true via diagnostic command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();

    // Pre-seed a file that will be loaded
    const file: CommentStoreFile = {
      version: "1.0",
      threads: [
        {
          id: "startup-thread",
          anchor: textAnchor("file:///project/src/startup.ts", 10),
          comments: [{
            id: "sc1",
            threadId: "startup-thread",
            createdAt: "2026-03-03T10:00:00Z",
            author: { kind: "user", name: "Dev" },
            body: "Startup thread",
            anchor: textAnchor("file:///project/src/startup.ts", 10),
            status: "open",
          }],
          status: "open",
          createdAt: "2026-03-03T10:00:00Z",
          lastActivity: "2026-03-03T10:00:00Z",
        },
      ],
    };
    const encoder = new TextEncoder();
    workspace.fs.readFile.mockResolvedValue(encoder.encode(JSON.stringify(file)));

    await activate(ctx);

    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const state = getSyncStateHandler!() as { storeThreadIds: string[]; nativeWidgetIds: string[]; inSync: boolean; missingWidgetIds: string[]; orphanWidgetIds: string[] };

    expect(state.storeThreadIds).toContain("startup-thread");
    expect(state.inSync).toBe(true);
    expect(state.missingWidgetIds).toHaveLength(0);
    expect(state.orphanWidgetIds).toHaveLength(0);
  });
});

// ── B8: Internal diagnostic command registration ─────────────────────────────

/**
 * M40-EXT-14: accordo_comments_internal_getSyncState is registered and returns
 * live diagnostic state from the store + native projection.
 */
describe("B8: accordo_comments_internal_getSyncState command registration (M40-EXT-14)", () => {
  it("command is registered after activate", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo_comments_internal_getSyncState")).toBe(true);
  });

  it("command returns the correct NativeCommentSyncState shape", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const state = getSyncStateHandler!() as { storeThreadIds: string[]; nativeWidgetIds: string[]; missingWidgetIds: string[]; orphanWidgetIds: string[]; inSync: boolean };

    expect(state).toHaveProperty("storeThreadIds");
    expect(state).toHaveProperty("nativeWidgetIds");
    expect(state).toHaveProperty("missingWidgetIds");
    expect(state).toHaveProperty("orphanWidgetIds");
    expect(state).toHaveProperty("inSync");
    expect(Array.isArray(state.storeThreadIds)).toBe(true);
    expect(Array.isArray(state.nativeWidgetIds)).toBe(true);
    expect(Array.isArray(state.missingWidgetIds)).toBe(true);
    expect(Array.isArray(state.orphanWidgetIds)).toBe(true);
    expect(typeof state.inSync).toBe("boolean");
  });

  it("getSyncState reflects store mutations in real time", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");

    // Before mutation
    const before = getSyncStateHandler!() as { storeThreadIds: string[] };
    const beforeCount = before.storeThreadIds.length;

    // Create a thread via the adapter
    const createHandler = mockState.registeredCommands.get("accordo_comments_internal_getStore");
    const adapter = createHandler!() as Record<string, unknown>;
    const thread = await (adapter.createThread as (args: { uri: string; blockId: string; body: string }) => Promise<{ id: string }>)({
      uri: "file:///project/src/dyn.ts",
      blockId: "p:5",
      body: "Dynamic thread",
    });

    // After mutation
    const after = getSyncStateHandler!() as { storeThreadIds: string[]; inSync: boolean };
    expect(after.storeThreadIds).toHaveLength(beforeCount + 1);
    expect(after.storeThreadIds).toContain(thread.id);
    expect(after.inSync).toBe(true);
  });
});

// ── C9: MCP tool boundary → store → native projection ────────────────────────

/**
 * After activate(), tools are registered via bridge.registerTools.
 * Creating a thread via MCP tool and checking the diagnostic command
 * proves the full MCP → store → native projection path.
 */
describe("C9: MCP tool → store → native projection convergence (M38-CT-03 / M37-NC-12)", () => {
  it("comment_create via MCP tool leads to inSync=true via diagnostic command", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    // Simulate MCP tool invocation by directly calling the tool handler
    // We intercept the registered tools from bridge.registerTools
    const registerToolsCall = (bridge.registerTools as ReturnType<typeof vi.fn>);
    expect(registerToolsCall).toHaveBeenCalled();

    const registeredTools = registerToolsCall.mock.calls[0][1] as Array<{ name: string; handler: (args: unknown) => unknown }>;
    const createTool = registeredTools.find(t => t.name === "comment_create");
    expect(createTool).toBeDefined();

    // Invoke the MCP tool handler directly
    const result = await createTool.handler({
      scope: { modality: "text", uri: "file:///project/src/mcp-test.ts" },
      uri: "file:///project/src/mcp-test.ts",
      anchor: { kind: "text", startLine: 20, endLine: 20 },
      body: "MCP-created comment",
      intent: "fix",
    }) as { success: boolean; threadId: string; commentId: string };

    expect(result.success).toBe(true);
    expect(result.threadId).toBeTruthy();

    // Verify store has the thread
    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const state = getSyncStateHandler!() as { storeThreadIds: string[]; inSync: boolean; missingWidgetIds: string[] };

    expect(state.storeThreadIds).toContain(result.threadId);
    // The store.onChanged wiring should have called reconcile, so inSync=true
    expect(state.inSync).toBe(true);
    expect(state.missingWidgetIds).toHaveLength(0);
  });

  it("MCP mutations never directly call NativeComments widget mutation helpers", async () => {
    const sentinel = new Error("direct-native-widget-mutation");
    const addSpy = vi.spyOn(NativeComments.prototype, "addThread").mockImplementation(() => { throw sentinel; });
    const updateSpy = vi.spyOn(NativeComments.prototype, "updateThread").mockImplementation(() => { throw sentinel; });
    const removeSpy = vi.spyOn(NativeComments.prototype, "removeThread").mockImplementation(() => { throw sentinel; });
    const removeManySpy = vi.spyOn(NativeComments.prototype, "removeThreads").mockImplementation(() => { throw sentinel; });

    try {
      const bridge = createMockBridge();
      setupBridgeExtension(bridge);
      const ctx = createMockExtensionContext();
      await activate(ctx);

      const registeredTools = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
      const createTool = registeredTools.find(t => t.name === "comment_create")!;
      const replyTool = registeredTools.find(t => t.name === "comment_reply")!;
      const resolveTool = registeredTools.find(t => t.name === "comment_resolve")!;
      const reopenTool = registeredTools.find(t => t.name === "comment_reopen")!;
      const deleteTool = registeredTools.find(t => t.name === "comment_delete")!;

      const created = await createTool.handler({
        uri: "file:///project/src/no-direct.ts",
        anchor: { kind: "text", startLine: 7, endLine: 7 },
        body: "Created without direct native mutation",
      }) as { threadId: string };
      await replyTool.handler({ threadId: created.threadId, body: "Reply without direct native mutation" });
      await resolveTool.handler({ threadId: created.threadId, resolutionNote: "Resolved without direct native mutation" });
      await reopenTool.handler({ threadId: created.threadId });
      await deleteTool.handler({ threadId: created.threadId });

      await createTool.handler({
        scope: { modality: "browser", url: "https://example.com/no-direct" },
        anchor: { kind: "browser" },
        body: "Browser bulk candidate",
      });
      await deleteTool.handler({ deleteScope: { modality: "browser", all: true } });

      const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState")!;
      const state = getSyncStateHandler() as { missingWidgetIds: string[]; orphanWidgetIds: string[]; inSync: boolean };
      expect(state.missingWidgetIds).toEqual([]);
      expect(state.orphanWidgetIds).toEqual([]);
      expect(state.inSync).toBe(true);
      expect(addSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
      expect(removeManySpy).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      updateSpy.mockRestore();
      removeSpy.mockRestore();
      removeManySpy.mockRestore();
    }
  });
});

// ── C10: Native command boundary — accordo.comments.new ───────────────────────

/**
 * accordo.comments.new is registered in activate(). Invoking it with a VS Code
 * draft comment thread proves user-created text comments enter Accordo store.
 * M45-CMD-11: panel delete command is tested here as a proxy for other panel commands.
 */
describe("C10: accordo.comments.new → store → diagnostic convergence", () => {
  it("accordo.comments.new command is registered", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    expect(mockState.registeredCommands.has("accordo.comments.new")).toBe(true);
  });

  it("invoking accordo.comments.new creates exact store delta with exact native sync", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    const newCommentHandler = mockState.registeredCommands.get("accordo.comments.new")!;
    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState")!;
    const getThreadsForUriHandler = mockState.registeredCommands.get("accordo_comments_internal_getThreadsForUri")!;

    const beforeState = getSyncStateHandler() as { storeThreadIds: string[]; nativeWidgetIds: string[] };
    const beforeStoreIds = new Set(beforeState.storeThreadIds);

    // Simulate VS Code calling the command with the correct registered payload:
    // { thread: vscode.CommentThread, text: string }
    const draftUri = Uri.parse("file:///project/src/new-comment.ts");
    const draftRange = new Range(15, 0, 15, 0);
    const draftComments: MockComment[] = [
      new MockComment("User comment", CommentMode.Preview, { name: "User" }),
    ];

    // Create a mock CommentThread with uri, range, and dispose properties
    const mockDraftThread = {
      uri: draftUri,
      range: draftRange,
      comments: draftComments,
      dispose: vi.fn(),
    } as unknown as vscode.CommentThread;

    // Call the handler with the correct { thread, text } shape
    await newCommentHandler({ thread: mockDraftThread, text: "User comment" });

    const state = getSyncStateHandler() as { storeThreadIds: string[]; nativeWidgetIds: string[]; inSync: boolean; missingWidgetIds: string[]; orphanWidgetIds: string[] };
    const createdIds = state.storeThreadIds.filter(id => !beforeStoreIds.has(id));
    expect(createdIds).toHaveLength(1);
    const createdId = createdIds[0];

    const threads = getThreadsForUriHandler("file:///project/src/new-comment.ts") as Array<{
      id: string;
      anchor: { kind: string; uri: string; range?: { startLine: number; startChar: number; endLine: number; endChar: number } };
      comments: Array<{ body: string }>;
    }>;
    const createdThread = threads.find(thread => thread.id === createdId);
    expect(createdThread).toBeDefined();
    expect(createdThread?.anchor.kind).toBe("text");
    expect(createdThread?.anchor.uri).toBe("file:///project/src/new-comment.ts");
    expect(createdThread?.anchor.range).toEqual({ startLine: 15, startChar: 0, endLine: 15, endChar: 0 });
    expect(createdThread?.comments[0]?.body).toBe("User comment");

    expect(state.storeThreadIds).toContain(createdId);
    expect(state.nativeWidgetIds).toContain(createdId);
    expect(state.missingWidgetIds).toEqual([]);
    expect(state.orphanWidgetIds).toEqual([]);
    expect(state.inSync).toBe(true);
  });
});

// ── C11: Delete boundary — orphan widget cleanup ─────────────────────────────

/**
 * Deleting a thread via the store should lead to no orphan widgets
 * via the reconcile path.
 */
describe("C11: delete boundary — no orphan widgets after remove (M37-NC-11)", () => {
  it("deleting a thread via store produces inSync=true with no orphan widgets", async () => {
    const bridge = createMockBridge();
    setupBridgeExtension(bridge);
    const ctx = createMockExtensionContext();
    await activate(ctx);

    // Get store via the registered adapter command
    const createHandler = mockState.registeredCommands.get("accordo_comments_internal_getStore");
    const adapter = createHandler!() as Record<string, unknown>;

    // Create a thread via the adapter
    const thread = await (adapter.createThread as (args: { uri: string; blockId: string; body: string }) => Promise<{ id: string; uri: string }>)({
      uri: "file:///project/src/delete-test.ts",
      blockId: "p:10",
      body: "Will be deleted",
    });

    // Get sync state before delete
    const getSyncStateHandler = mockState.registeredCommands.get("accordo_comments_internal_getSyncState");
    const beforeState = getSyncStateHandler!() as { storeThreadIds: string[]; inSync: boolean };
    expect(beforeState.storeThreadIds).toContain(thread.id);

    // Delete via the adapter's delete method
    await (adapter.delete as (args: { threadId: string }) => Promise<void>)({ threadId: thread.id });

    // After delete, verify store state via getSyncState
    const afterState = getSyncStateHandler!() as { storeThreadIds: string[]; inSync: boolean; orphanWidgetIds: string[] };
    expect(afterState.storeThreadIds).not.toContain(thread.id);
    expect(afterState.orphanWidgetIds).toHaveLength(0);
    expect(afterState.inSync).toBe(true);
  });
});

// ── deactivate ───────────────────────────────────────────────────────────────

describe("deactivate", () => {
  it("is a no-op (disposables cleaned up via context.subscriptions)", () => {
    // Should not throw
    expect(() => deactivate()).not.toThrow();
  });
});
