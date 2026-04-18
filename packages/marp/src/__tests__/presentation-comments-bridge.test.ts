/**
 * presentation-comments-bridge.test.ts — Tests for PresentationCommentsBridge,
 * encodeBlockId, and parseBlockId.
 *
 * The comments bridge translates webview comment messages into surface adapter
 * calls and pushes thread updates back to the webview. It is identical in
 * interface to the Slidev comments bridge — same blockId encoding convention.
 *
 * Requirements covered:
 *   M50-CBR-01  Receives webview comment messages, forwards to surface adapter
 *   M50-CBR-02  Constructs slide surface anchors with correct shape
 *   M50-CBR-03  Subscribes to adapter store changes, sends comments:load to webview
 *   M50-CBR-04  Handles missing comments extension gracefully (null adapter = no-op)
 *   M50-CBR-05  blockId encoding: "slide:{slideIndex}:{x.4f}:{y.4f}"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encodeBlockId,
  parseBlockId,
  toSdkThread,
  PresentationCommentsBridge,
} from "../presentation-comments-bridge.js";
import type { SlideCoordinates, CommentThread } from "@accordo/bridge-types";
import type { WebviewSender } from "../presentation-comments-bridge.js";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): SurfaceCommentAdapter {
  return {
    createThread: vi.fn().mockResolvedValue({
      id: "t1",
      anchor: {} as never,
      comments: [],
      status: "open",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    } as CommentThread),
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
  it("M50-CBR-05: encodes slide coordinates into 'slide:{idx}:{x.4f}:{y.4f}' format", () => {
    // The canonical blockId format for a slide anchor.
    const coords: SlideCoordinates = { type: "slide", slideIndex: 3, x: 0.5, y: 0.3 };
    expect(encodeBlockId(coords)).toBe("slide:3:0.5000:0.3000");
  });

  it("M50-CBR-05: zero coordinates encode to '0.0000'", () => {
    // Origin point must produce zero-padded 4-decimal format.
    const coords: SlideCoordinates = { type: "slide", slideIndex: 0, x: 0, y: 0 };
    expect(encodeBlockId(coords)).toBe("slide:0:0.0000:0.0000");
  });

  it("M50-CBR-05: full-range coordinates encode to '1.0000'", () => {
    // Maximum values must be encoded correctly.
    const coords: SlideCoordinates = { type: "slide", slideIndex: 7, x: 1, y: 1 };
    expect(encodeBlockId(coords)).toBe("slide:7:1.0000:1.0000");
  });

  it("M50-CBR-05: fractional values rounded to 4 decimal places", () => {
    // Floating point rounding must produce 4-decimal precision.
    const coords: SlideCoordinates = { type: "slide", slideIndex: 2, x: 0.12345, y: 0.67899 };
    const id = encodeBlockId(coords);
    expect(id).toBe("slide:2:0.1235:0.6790");
  });

  it("M50-CBR-05: large slideIndex encoded correctly", () => {
    // Non-trivial slide indices must be encoded correctly.
    const coords: SlideCoordinates = { type: "slide", slideIndex: 42, x: 0.25, y: 0.75 };
    expect(encodeBlockId(coords)).toBe("slide:42:0.2500:0.7500");
  });
});

// ── parseBlockId ──────────────────────────────────────────────────────────────

describe("parseBlockId", () => {
  it("M50-CBR-05: decodes a valid slide blockId back to SlideCoordinates", () => {
    // Round-trip decoding must preserve all coordinate values.
    const result = parseBlockId("slide:3:0.5000:0.3000");
    expect(result).toEqual<SlideCoordinates>({
      type: "slide",
      slideIndex: 3,
      x: 0.5,
      y: 0.3,
    });
  });

  it("M50-CBR-05: returns null for a non-slide blockId (markdown preview format)", () => {
    // Non-slide blockIds must return null (not throw).
    expect(parseBlockId("heading:2:introduction")).toBeNull();
    expect(parseBlockId("p:0")).toBeNull();
  });

  it("M50-CBR-05: returns null for an empty string", () => {
    // Empty string is not a valid blockId.
    expect(parseBlockId("")).toBeNull();
  });

  it("M50-CBR-05: returns null for a malformed slide blockId (non-numeric coords)", () => {
    // Invalid coord values must return null.
    expect(parseBlockId("slide:abc:xyz")).toBeNull();
  });

  it("M50-CBR-05: returns null for a slide blockId missing y coordinate", () => {
    // Incomplete blockId must return null.
    expect(parseBlockId("slide:1:0.5")).toBeNull();
  });

  it("M50-CBR-05: round-trips through encode → decode", () => {
    // Encoding then decoding must produce values within floating point precision.
    const original: SlideCoordinates = { type: "slide", slideIndex: 5, x: 0.25, y: 0.75 };
    const id = encodeBlockId(original);
    const decoded = parseBlockId(id);
    expect(decoded).not.toBeNull();
    expect(decoded!.slideIndex).toBe(5);
    expect(decoded!.x).toBeCloseTo(0.25, 3);
    expect(decoded!.y).toBeCloseTo(0.75, 3);
  });

  it("M50-CBR-05: random whitespace in blockId returns null", () => {
    // No lenient parsing — whitespace-contaminated ids are invalid.
    expect(parseBlockId("slide: 3:0.5000:0.3000")).toBeNull();
  });
});

// ── PresentationCommentsBridge.buildAnchor ────────────────────────────────────

describe("PresentationCommentsBridge.buildAnchor", () => {
  it("M50-CBR-02: builds a CommentAnchorSurface from a valid slide blockId", () => {
    // The anchor must have the correct shape for a slide surface comment.
    const bridge = new PresentationCommentsBridge(makeAdapter(), makeSender());
    const anchor = bridge.buildAnchor("slide:2:0.5000:0.3000", "file:///deck.md");
    expect(anchor).not.toBeNull();
    expect(anchor!.kind).toBe("surface");
    expect(anchor!.surfaceType).toBe("slide");
    expect(anchor!.uri).toBe("file:///deck.md");
    expect(anchor!.coordinates).toMatchObject({ type: "slide", slideIndex: 2, x: 0.5, y: 0.3 });
  });

  it("M50-CBR-02: returns null for a non-slide blockId", () => {
    // Headings and other non-slide blockIds must return null.
    const bridge = new PresentationCommentsBridge(makeAdapter(), makeSender());
    expect(bridge.buildAnchor("heading:1:intro", "file:///deck.md")).toBeNull();
  });

  it("M50-CBR-02: anchor coordinates contain all SlideCoordinates fields", () => {
    // Full coordinate shape must be present on the anchor.
    const bridge = new PresentationCommentsBridge(makeAdapter(), makeSender());
    const anchor = bridge.buildAnchor("slide:1:0.1000:0.2000", "file:///deck.md");
    expect(anchor).not.toBeNull();
    expect(anchor!.coordinates).toMatchObject({
      type: "slide",
      slideIndex: 1,
      x: 0.1,
      y: 0.2,
    });
  });
});

// ── PresentationCommentsBridge.handleWebviewMessage ──────────────────────────

describe("PresentationCommentsBridge.handleWebviewMessage", () => {
  const DECK_URI = "file:///deck.md";

  it("M50-CBR-01: comment:create forwards to adapter.createThread with correct anchor", async () => {
    // The bridge must translate the webview message into a createThread call.
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

  it("M50-CBR-01: comment:reply forwards to adapter.reply", async () => {
    // Reply messages must be forwarded verbatim to the adapter.
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:reply", threadId: "t1", body: "I agree" },
      DECK_URI,
    );
    expect(adapter.reply).toHaveBeenCalledWith({ threadId: "t1", body: "I agree" });
  });

  it("M50-CBR-01: comment:resolve forwards to adapter.resolve", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:resolve", threadId: "t1" },
      DECK_URI,
    );
    expect(adapter.resolve).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M50-CBR-01: comment:delete forwards to adapter.delete", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:delete", threadId: "t1" },
      DECK_URI,
    );
    expect(adapter.delete).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M50-CBR-01: comment:reopen forwards to adapter.reopen", async () => {
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await bridge.handleWebviewMessage(
      { type: "comment:reopen", threadId: "t1" },
      DECK_URI,
    );
    expect(adapter.reopen).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("M50-CBR-04: null adapter — handleWebviewMessage is a no-op (does not throw)", async () => {
    // When comments extension is unavailable (null adapter), all messages are silently ignored.
    const bridge = new PresentationCommentsBridge(null, makeSender());
    await expect(
      bridge.handleWebviewMessage(
        { type: "comment:create", blockId: "slide:0:0.0000:0.0000", body: "test" },
        DECK_URI,
      ),
    ).resolves.toBeUndefined();
  });

  it("M50-CBR-01: unknown message type is ignored (no throw)", async () => {
    // Unrecognised message types must be silently ignored.
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    await expect(
      bridge.handleWebviewMessage({ type: "unknown:action" }, DECK_URI),
    ).resolves.toBeUndefined();
    expect(adapter.createThread).not.toHaveBeenCalled();
  });

  it("M50-CBR-04: null adapter — no throw for any comment message type", async () => {
    // All comment message types must be safe with null adapter.
    const bridge = new PresentationCommentsBridge(null, makeSender());
    const msgs = [
      { type: "comment:reply", threadId: "t1", body: "x" },
      { type: "comment:resolve", threadId: "t1" },
      { type: "comment:delete", threadId: "t1" },
      { type: "comment:reopen", threadId: "t1" },
    ];
    for (const msg of msgs) {
      await expect(bridge.handleWebviewMessage(msg, DECK_URI)).resolves.toBeUndefined();
    }
  });
});

// ── PresentationCommentsBridge.loadThreadsForUri ──────────────────────────────

describe("PresentationCommentsBridge.loadThreadsForUri", () => {
  it("M50-CBR-03: sends comments:load with SdkThread[] to webview", () => {
    // loadThreadsForUri must push SdkThread[] (not raw CommentThread[]) to the webview.
    const adapter = makeAdapter();
    const rawThreads: CommentThread[] = [
      {
        id: "t1",
        anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.3 } },
        comments: [],
        status: "open",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
    ];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(rawThreads);
    const sender = makeSender();
    const bridge = new PresentationCommentsBridge(adapter, sender);
    bridge.loadThreadsForUri("file:///deck.md");

    // Convert raw threads to expected SdkThread[] using the same logic the bridge uses
    const loadedAt = new Date().toISOString();
    const expectedSdkThreads = rawThreads.map((t) => toSdkThread(t, loadedAt));

    expect(sender.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load", threads: expectedSdkThreads }),
    );
  });

  it("M50-CBR-03: non-slide anchors produce empty blockId in SdkThread", () => {
    // Threads anchored to non-slide surfaces (or text/file anchors) must have blockId="" so no pin renders.
    const adapter = makeAdapter();
    const rawThreads: CommentThread[] = [
      {
        id: "t1",
        anchor: { kind: "file", uri: "file:///deck.md" },
        comments: [],
        status: "open",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
    ];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(rawThreads);
    const sender = makeSender();
    const bridge = new PresentationCommentsBridge(adapter, sender);
    bridge.loadThreadsForUri("file:///deck.md");

    const loadedAt = new Date().toISOString();
    const expectedSdkThreads = rawThreads.map((t) => toSdkThread(t, loadedAt));

    expect(sender.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load", threads: expectedSdkThreads }),
    );
    // Verify blockId is empty for non-slide anchors
    const postedMessage = vi.mocked(sender.postMessage).mock.calls[0][0] as { threads: Array<{ blockId: string }> };
    expect(postedMessage.threads[0].blockId).toBe("");
  });

  it("M50-CBR-03: subscribes to adapter changes via onChanged", () => {
    // Changes to the adapter's thread store must be relayed to the webview.
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    bridge.loadThreadsForUri("file:///deck.md");
    expect(adapter.onChanged).toHaveBeenCalled();
  });

  it("M50-CBR-03: adapter onChanged callback re-sends comments:load with updated SdkThread[]", () => {
    // When threads change, the adapter calls onChanged and the bridge must push to webview.
    const adapter = makeAdapter();
    const sender = makeSender();
    const bridge = new PresentationCommentsBridge(adapter, sender);

    // Capture the onChanged listener
    let onChangedListener: ((uri: string) => void) | undefined;
    vi.mocked(adapter.onChanged).mockImplementation((listener: (uri: string) => void) => {
      onChangedListener = listener;
      return { dispose: vi.fn() };
    });

    bridge.loadThreadsForUri("file:///deck.md");

    // Simulate threads being added after initial load
    const updatedThreads: CommentThread[] = [
      {
        id: "t1",
        anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0.1, y: 0.2 } },
        comments: [],
        status: "open",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
      {
        id: "t2",
        anchor: { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 1, x: 0.3, y: 0.4 } },
        comments: [],
        status: "resolved",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
    ];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(updatedThreads);

    // Trigger the listener (simulates adapter detecting store change)
    expect(onChangedListener).toBeDefined();
    onChangedListener!("file:///deck.md");

    // Bridge must have pushed SdkThread[] to webview on the second send.
    // We assert the stable slide/block mapping contract and thread identities,
    // without coupling this test to the bridge's private loadedAt timestamp.
    const secondCall = vi.mocked(sender.postMessage).mock.calls[1]?.[0] as
      | { type: string; threads: Array<{ id: string; blockId: string; status: string }> }
      | undefined;

    expect(secondCall).toBeDefined();
    expect(secondCall?.type).toBe("comments:load");
    expect(secondCall?.threads).toHaveLength(2);
    expect(secondCall?.threads.map((t) => ({ id: t.id, blockId: t.blockId, status: t.status }))).toEqual([
      { id: "t1", blockId: "slide:0:0.1000:0.2000", status: "open" },
      { id: "t2", blockId: "slide:1:0.3000:0.4000", status: "resolved" },
    ]);
  });

  it("M50-CBR-04: null adapter — loadThreadsForUri is a no-op (does not throw)", () => {
    // When adapter is null (no comments extension), this is silently a no-op.
    const bridge = new PresentationCommentsBridge(null, makeSender());
    expect(() => bridge.loadThreadsForUri("file:///deck.md")).not.toThrow();
  });

  it("M50-CBR-03: re-subscribes when loadThreadsForUri is called for a new URI", () => {
    // Calling loadThreadsForUri again for a different URI should subscribe for that URI.
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    bridge.loadThreadsForUri("file:///deck1.md");
    bridge.loadThreadsForUri("file:///deck2.md");
    // onChanged should have been called for each load
    expect(adapter.onChanged).toHaveBeenCalledTimes(2);
  });
});

// ── PresentationCommentsBridge.dispose ────────────────────────────────────────

describe("PresentationCommentsBridge.dispose", () => {
  it("M50-CBR-03: dispose() calls the subscription's dispose to clean up listeners", () => {
    // When the bridge is disposed, the adapter onChanged subscription must be released.
    const adapter = makeAdapter();
    const subDispose = vi.fn();
    vi.mocked(adapter.onChanged).mockReturnValue({ dispose: subDispose });
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    bridge.loadThreadsForUri("file:///deck.md");
    bridge.dispose();
    expect(subDispose).toHaveBeenCalled();
  });

  it("M50-CBR-04: dispose() on bridge with null adapter does not throw", () => {
    // Disposal must be safe even when no adapter was provided.
    const bridge = new PresentationCommentsBridge(null, makeSender());
    expect(() => bridge.dispose()).not.toThrow();
  });

  it("M50-CBR-03: dispose() without prior loadThreadsForUri does not throw", () => {
    // Disposing before any subscription is set must be safe.
    const adapter = makeAdapter();
    const bridge = new PresentationCommentsBridge(adapter, makeSender());
    expect(() => bridge.dispose()).not.toThrow();
  });
});
