/**
 * presentation-comments-bridge.test.ts — Tests for PresentationCommentsBridge,
 * encodeBlockId, and parseBlockId.
 *
 * Requirements covered:
 *   M44-CBR-01  Receives webview comment messages, forwards to surface adapter
 *   M44-CBR-02  Constructs slide surface anchors with correct shape
 *   M44-CBR-03  Subscribes to adapter store changes, sends comments:load to webview
 *   M44-CBR-04  Handles missing comments extension gracefully (null adapter = no-op)
 *   M44-CBR-05  blockId encoding: "slide:{slideIndex}:{x.4f}:{y.4f}"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encodeBlockId,
  parseBlockId,
  PresentationCommentsBridge,
} from "../presentation-comments-bridge.js";
import type { SlideCoordinates } from "@accordo/bridge-types";
import type { WebviewSender } from "../presentation-comments-bridge.js";
import type { SurfaceAdapterLike } from "../types.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): SurfaceAdapterLike {
  return {
    createThread: vi.fn().mockResolvedValue({
      id: "t1",
      uri: "file:///deck.md",
      anchor: {} as never,
      comments: [],
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies CommentThread),
    reply: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    reopen: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getThreadsForUri: vi.fn().mockReturnValue([]),
    onChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
}

function makeSender(): WebviewSender {
  return { postMessage: vi.fn().mockResolvedValue(true) };
}

// ── encodeBlockId ─────────────────────────────────────────────────────────────

describe("encodeBlockId", () => {
  it("M44-CBR-05: encodes slide coordinates into 'slide:{idx}:{x.4f}:{y.4f}' format", () => {
    const coords: SlideCoordinates = { type: "slide", slideIndex: 3, x: 0.5, y: 0.3 };
    expect(encodeBlockId(coords)).toBe("slide:3:0.5000:0.3000");
  });

  it("M44-CBR-05: zero coordinates encode to '0.0000'", () => {
    const coords: SlideCoordinates = { type: "slide", slideIndex: 0, x: 0, y: 0 };
    expect(encodeBlockId(coords)).toBe("slide:0:0.0000:0.0000");
  });

  it("M44-CBR-05: full-range coordinates encode to '1.0000'", () => {
    const coords: SlideCoordinates = { type: "slide", slideIndex: 7, x: 1, y: 1 };
    expect(encodeBlockId(coords)).toBe("slide:7:1.0000:1.0000");
  });

  it("M44-CBR-05: fractional values rounded to 4 decimal places", () => {
    const coords: SlideCoordinates = { type: "slide", slideIndex: 2, x: 0.12345, y: 0.67899 };
    const id = encodeBlockId(coords);
    expect(id).toBe("slide:2:0.1235:0.6790");
  });
});

// ── parseBlockId ─────────────────────────────────────────────────────────────

describe("parseBlockId", () => {
  it("M44-CBR-05: decodes a valid slide blockId back to SlideCoordinates", () => {
    const result = parseBlockId("slide:3:0.5000:0.3000");
    expect(result).toEqual<SlideCoordinates>({
      type: "slide",
      slideIndex: 3,
      x: 0.5,
      y: 0.3,
    });
  });

  it("M44-CBR-05: returns null for a non-slide blockId (markdown preview format)", () => {
    expect(parseBlockId("heading:2:introduction")).toBeNull();
    expect(parseBlockId("p:0")).toBeNull();
  });

  it("M44-CBR-05: returns null for an empty string", () => {
    expect(parseBlockId("")).toBeNull();
  });

  it("M44-CBR-05: returns null for a malformed slide blockId", () => {
    expect(parseBlockId("slide:abc:xyz")).toBeNull();
    expect(parseBlockId("slide:1:0.5")).toBeNull(); // missing y
  });

  it("M44-CBR-05: round-trips through encode → decode", () => {
    const original: SlideCoordinates = { type: "slide", slideIndex: 5, x: 0.25, y: 0.75 };
    const id = encodeBlockId(original);
    const decoded = parseBlockId(id);
    expect(decoded).not.toBeNull();
    expect(decoded!.slideIndex).toBe(5);
    expect(decoded!.x).toBeCloseTo(0.25, 3);
    expect(decoded!.y).toBeCloseTo(0.75, 3);
  });
});

// ── PresentationCommentsBridge.buildAnchor ────────────────────────────────────

describe("PresentationCommentsBridge.buildAnchor", () => {
  it("M44-CBR-02: builds a CommentAnchorSurface from a valid slide blockId", () => {
    const bridge = new PresentationCommentsBridge(makeAdapter(), makeSender());
    const anchor = bridge.buildAnchor("slide:2:0.5000:0.3000", "file:///deck.md");
    expect(anchor).not.toBeNull();
    expect(anchor!.kind).toBe("surface");
    expect(anchor!.surfaceType).toBe("slide");
    expect(anchor!.uri).toBe("file:///deck.md");
    expect(anchor!.coordinates).toMatchObject({ type: "slide", slideIndex: 2, x: 0.5, y: 0.3 });
  });

  it("M44-CBR-02: returns null for a non-slide blockId", () => {
    const bridge = new PresentationCommentsBridge(makeAdapter(), makeSender());
    expect(bridge.buildAnchor("heading:1:intro", "file:///deck.md")).toBeNull();
  });
});

// ── PresentationCommentsBridge.handleWebviewMessage ──────────────────────────

describe("PresentationCommentsBridge.handleWebviewMessage", () => {
  const DECK_URI = "file:///deck.md";

  it("M44-CBR-01: comment:create forwards to adapter.createThread with correct anchor", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:create", blockId: "slide:1:0.5000:0.5000", body: "Nice slide!" },
      DECK_URI,
    );
    expect(adapter.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: DECK_URI,
        body: "Nice slide!",
        anchor: expect.objectContaining({ kind: "surface", surfaceType: "slide" }),
      }),
    );
  });

  it("M44-CBR-01: comment:reply forwards to adapter.reply", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:reply", threadId: "t1", body: "I agree" },
      DECK_URI,
    );
    expect(adapter.reply).toHaveBeenCalledWith({ threadId: "t1", body: "I agree" });
  });

  it("M44-CBR-01: comment:resolve forwards to adapter.resolve", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:resolve", threadId: "t1" },
      DECK_URI,
    );
    expect(adapter.resolve).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M44-CBR-01: comment:delete forwards to adapter.delete", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:delete", threadId: "t1" },
      DECK_URI,
    );
    expect(adapter.delete).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M44-CBR-04: null adapter — handleWebviewMessage is a no-op (does not throw)", async () => {
    const bridge = new PresentationCommentsBridge(null, makeSender());
    await expect(
      bridge.handleWebviewMessage(
        { type: "comment:create", blockId: "slide:0:0.0000:0.0000", body: "test" },
        DECK_URI,
      ),
    ).resolves.toBeUndefined();
  });

  it("M44-CBR-01: unknown message type is ignored (no throw)", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await expect(
      bridge.handleWebviewMessage({ type: "unknown:action" }, DECK_URI),
    ).resolves.toBeUndefined();
    expect(adapter.createThread).not.toHaveBeenCalled();
  });
});

// ── PresentationCommentsBridge.loadThreadsForUri ──────────────────────────────

describe("PresentationCommentsBridge.loadThreadsForUri", () => {
  it("M44-CBR-03: sends comments:load with current threads to webview", () => {
    const adapter = makeAdapter();
    const threads: CommentThread[] = [
      {
        id: "t1",
        uri: "file:///deck.md",
        anchor: {} as never,
        comments: [],
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(threads);
    const sender = makeSender();
    const bridge = new PresentationCommentsBridge(adapter, sender);
    bridge.loadThreadsForUri("file:///deck.md");
    expect(sender.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load", threads }),
    );
  });

  it("M44-CBR-03: subscribes to adapter changes via onChanged", () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    bridge.loadThreadsForUri("file:///deck.md");
    expect(adapter.onChanged).toHaveBeenCalled();
  });

  it("M44-CBR-04: null adapter — loadThreadsForUri is a no-op (does not throw)", () => {
    const bridge = new PresentationCommentsBridge(null, makeSender());
    expect(() => bridge.loadThreadsForUri("file:///deck.md")).not.toThrow();
  });
});

// ── PresentationCommentsBridge.dispose ────────────────────────────────────────

describe("PresentationCommentsBridge.dispose", () => {
  it("M44-CBR-03: dispose() calls the subscription's dispose", () => {
    const adapter = makeAdapter();
    const subDispose = vi.fn();
    vi.mocked(adapter.onChanged).mockReturnValue({ dispose: subDispose });
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    bridge.loadThreadsForUri("file:///deck.md");
    bridge.dispose();
    expect(subDispose).toHaveBeenCalled();
  });

  it("M44-CBR-04: dispose() on bridge with null adapter does not throw", () => {
    const bridge = new PresentationCommentsBridge(null, makeSender());
    expect(() => bridge.dispose()).not.toThrow();
  });
});
