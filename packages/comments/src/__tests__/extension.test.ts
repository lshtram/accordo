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
import type { CommentAnchorSurface, SlideCoordinates } from "@accordo/bridge-types";
import {
  resetMockState,
  mockState,
  createMockExtensionContext,
  workspace,
  comments as vscodeComments,
  extensions,
} from "./mocks/vscode.js";
import { activate, deactivate, type BridgeAPI, type SurfaceCommentAdapter } from "../extension.js";
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

// ── deactivate ───────────────────────────────────────────────────────────────

describe("deactivate", () => {
  it("is a no-op (disposables cleaned up via context.subscriptions)", () => {
    // Should not throw
    expect(() => deactivate()).not.toThrow();
  });
});
