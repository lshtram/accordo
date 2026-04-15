/**
 * A16 — Excalidraw canvas emission tests (Phase B — all RED until Phase C)
 *
 * Tests cover the webview-side message emission logic in excalidraw-canvas.ts:
 *   – handleChangeCallback posts canvas:edge-routed when arrow waypoints change
 *   – existing node-move/style messages are NOT regressed
 *
 * handleChangeCallback is extracted as a pure function with explicit dependencies
 * so it can be unit-tested without React or browser globals.
 *
 * Source: diagram-update-plan.md §12.5 (P-B)
 *
 * API checklist:
 * ✓ handleChangeCallback — 7 tests (REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-09)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleChangeCallback } from "../webview/message-handler.js";
import type { ExcalidrawAPIElement } from "../webview/scene-adapter.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeArrowElement(
  id: string,
  mermaidId: string,
  x: number,
  y: number,
  points: ReadonlyArray<[number, number]>,
): ExcalidrawAPIElement {
  return {
    id,
    type: "arrow",
    x,
    y,
    width: 0,
    height: 0,
    version: 1,
    versionNonce: 0,
    isDeleted: false,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 0,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    fontFamily: 1,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    roundness: null,
    points,
    customData: { mermaidId },
  };
}

function makeRectElement(
  id: string,
  mermaidId: string,
  x: number,
  y: number,
): ExcalidrawAPIElement {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 100,
    height: 50,
    version: 1,
    versionNonce: 0,
    isDeleted: false,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 0,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    fontFamily: 1,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    roundness: null,
    customData: { mermaidId },
  };
}

// ── handleChangeCallback tests ────────────────────────────────────────────────

describe("handleChangeCallback — canvas:edge-routed emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-01: arrow with valid Mermaid edge key and changed route points → posts canvas:edge-routed", () => {
    // Arrow A->B:0 at (x=100, y=200) changed waypoints from [[50,50],[100,100]] to [[60,60],[120,120]]
    const prevArrow = makeArrowElement("exc-1", "A->B:0", 100, 200, [[50, 50], [100, 100]]);
    const nextArrow = makeArrowElement("exc-1", "A->B:0", 100, 200, [[60, 60], [120, 120]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextArrow as never], emptyAppState, [prevArrow], mockVscode);

    // canvas:edge-routed must be posted
    const routedMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    );
    expect(routedMsg).toBeDefined();
    expect((routedMsg as { edgeKey: string }).edgeKey).toBe("A->B:0");
  });

  it("REQ-02: emitted payload uses exact contract { type:'canvas:edge-routed', edgeKey, waypoints }", () => {
    // Use 3 points: [start-anchor, interior-control-point, end-anchor].
    // After stripping anchors, waypoints should contain exactly the 1 interior point.
    const prevArrow = makeArrowElement("exc-1", "X->Y:1", 0, 0, [[0, 0], [150, 200], [300, 400]]);
    const nextArrow = makeArrowElement("exc-1", "X->Y:1", 0, 0, [[0, 0], [160, 210], [300, 400]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextArrow as never], emptyAppState, [prevArrow], mockVscode);

    // Exact contract check
    const routedMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    ) as { type: string; edgeKey: string; waypoints: Array<{ x: number; y: number }> } | undefined;
    expect(routedMsg).toBeDefined();
    expect(routedMsg!.type).toBe("canvas:edge-routed");
    expect(routedMsg!.edgeKey).toBe("X->Y:1");
    expect(Array.isArray(routedMsg!.waypoints)).toBe(true);
    // Only the interior control point (index 1) is persisted — anchors are stripped
    expect(routedMsg!.waypoints.length).toBeGreaterThan(0);
  });

  it("REQ-03: relative arrow points are converted to absolute waypoint coordinates correctly", () => {
    // Arrow at (x=100, y=200) with 3 relative points:
    //   [0]=start-anchor, [1]=interior control point (60,60), [2]=end-anchor
    // After stripping anchors, interior absolute: (100+60, 200+60) = (160, 260)
    const prevArrow = makeArrowElement("exc-1", "A->B:0", 100, 200, [[0, 0], [50, 50], [120, 120]]);
    const nextArrow = makeArrowElement("exc-1", "A->B:0", 100, 200, [[0, 0], [60, 60], [120, 120]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextArrow as never], emptyAppState, [prevArrow], mockVscode);

    const routedMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    ) as { waypoints: Array<{ x: number; y: number }> } | undefined;
    expect(routedMsg).toBeDefined();
    // Only the interior control point is persisted; anchors (index 0 and 2) are stripped
    expect(routedMsg!.waypoints).toEqual([
      { x: 160, y: 260 },
    ]);
  });

  it("REQ-06: existing node-move messages are NOT regressed when arrow waypoints also change", () => {
    // Arrow changes waypoints AND a node moves — both should be posted
    const prevArrow = makeArrowElement("exc-arrow", "A->B:0", 0, 0, [[0, 0]]);
    const nextArrow = makeArrowElement("exc-arrow", "A->B:0", 0, 0, [[100, 100]]);
    const prevNode = makeRectElement("exc-node", "auth", 0, 0);
    const nextNode = makeRectElement("exc-node", "auth", 500, 600);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback(
      [nextArrow as never, nextNode as never],
      emptyAppState,
      [prevArrow, prevNode],
      mockVscode,
    );

    // Both canvas:node-moved AND canvas:edge-routed must be posted
    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: "canvas:node-moved", nodeId: "auth", x: 500, y: 600 }),
    );
    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: "canvas:edge-routed", edgeKey: "A->B:0" }),
    );
  });

  it("REQ-04: non-arrow (rectangle) element changes → does NOT post canvas:edge-routed", () => {
    const prevRect = makeRectElement("exc-rect", "auth", 0, 0);
    const nextRect = makeRectElement("exc-rect", "auth", 100, 100);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextRect as never], emptyAppState, [prevRect], mockVscode);

    const routedMessages = postedMessages.filter(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    );
    expect(routedMessages).toHaveLength(0);
  });

  it("REQ-05: arrow without valid Mermaid edge key (no '->') → does NOT post canvas:edge-routed", () => {
    // Arrow with mermaidId "standalone" (no "->") — not a Mermaid edge
    const prevArrow = makeArrowElement("exc-arrow", "standalone", 0, 0, [[0, 0]]);
    const nextArrow = makeArrowElement("exc-arrow", "standalone", 0, 0, [[50, 50]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextArrow as never], emptyAppState, [prevArrow], mockVscode);

    const routedMessages = postedMessages.filter(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    );
    expect(routedMessages).toHaveLength(0);
  });

  // ── Regression tests ─────────────────────────────────────────────────────────

  it("REQ-07: shallow snapshot of prevElements aliases nested points array — in-place Excalidraw mutation still emits canvas:edge-routed", () => {
    // Regression: handleChangeCallback snapshots prevElements via shallow clone { ...el }.
    // If Excalidraw mutates an arrow's points array in-place between callbacks (same
    // array reference, different contents), shallow cloning does NOT protect against it:
    // prevPoints and nextPoints become the SAME (mutated) array reference, the per-index
    // comparison loop sees prevPoints[i] === nextPoints[i] (both point to the mutated
    // array's elements at the same indices), and the mutation is silently dropped.
    //
    // Use 3 points [start, interior, end] so the interior point persists in waypoints.
    const arrow = makeArrowElement("exc-arrow", "A->B:0", 100, 200, [[0, 0], [50, 50], [100, 100]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    // First call: establish baseline
    const prevAfterFirst = handleChangeCallback(
      [arrow as never],
      emptyAppState,
      [],
      mockVscode,
    );

    // Simulate Excalidraw mutating the arrow's points array in-place.
    // Mutate all three points — the interior (index 1) is the one that becomes a waypoint.
    (arrow.points as [number, number][])[0] = [0, 0];
    (arrow.points as [number, number][])[1] = [999, 999];
    (arrow.points as [number, number][])[2] = [888, 888];

    // Second call: Excalidraw passes the same element object whose points were mutated in-place.
    // With a shallow snapshot, prevAfterFirst[0].points === arrow.points (same reference),
    // so detectArrowRouteMutations sees identical arrays and skips the mutation.
    // The correct behavior (deep snapshot or in-place mutation detection) should still emit.
    const prevAfterSecond = handleChangeCallback(
      [arrow as never],
      emptyAppState,
      prevAfterFirst,
      mockVscode,
    );

    // The interior point changed from [50,50] to [999,999].
    // canvas:edge-routed MUST be emitted.
    const routedMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    );
    expect(routedMsg).toBeDefined();
    expect((routedMsg as { edgeKey: string }).edgeKey).toBe("A->B:0");
    // Waypoints contain only the interior point (index 1), anchors (0, 2) stripped
    expect((routedMsg as { waypoints: Array<{ x: number; y: number }> }).waypoints).toEqual([
      { x: 1099, y: 1199 }, // 100+999, 200+999
    ]);
    void prevAfterSecond; // used to satisfy lint
  });

  it("REQ-08: changed arrow origin (x/y) with unchanged relative points → does NOT emit canvas:edge-routed (no false positive)", () => {
    // Arrow moved on canvas (x/y changed) but its relative waypoints are identical.
    // detectArrowRouteMutations compares relative points — the route geometry is
    // unchanged from Mermaid's perspective, so canvas:edge-routed must NOT be emitted.
    // This guards against a false positive if someone incorrectly factors x/y into
    // the route-change detection.
    const prevArrow = makeArrowElement("exc-arrow", "A->B:0", 100, 200, [[50, 50], [100, 100]]);
    const nextArrow = makeArrowElement("exc-arrow", "A->B:0", 500, 600, [[50, 50], [100, 100]]);

    const postedMessages: unknown[] = [];
    const mockVscode = { postMessage: (msg: unknown) => postedMessages.push(msg) };
    const emptyAppState = {};

    handleChangeCallback([nextArrow as never], emptyAppState, [prevArrow], mockVscode);

    const routedMessages = postedMessages.filter(
      (m) => (m as { type?: string }).type === "canvas:edge-routed",
    );
    // x/y moved but relative points are unchanged — route is unchanged, no emission
    expect(routedMessages).toHaveLength(0);
  });

  it("REQ-09: handleChangeCallback preserves snapshot isolation across multiple rapid calls", () => {
    // Pure-function regression: verify that returned prevElements is fully independent
    // from the input nextElements, so subsequent calls cannot be corrupted by in-place
    // Excalidraw mutations. This is the snapshot safety guarantee that detectArrowRouteMutations
    // relies on. We test it via the handleChangeCallback public API.
    // Use 3 points [start, interior, end] to have a real interior waypoint.
    const arrow = makeArrowElement("exc-arrow", "A->B:0", 0, 0, [[0, 0], [0, 0], [10, 10]]);

    const mockVscode = { postMessage: vi.fn() };
    const emptyAppState = {};

    // Call 1: baseline
    const snap1 = handleChangeCallback([arrow as never], emptyAppState, [], mockVscode);

    // Mutate the original element's interior point in-place (simulating Excalidraw between callbacks)
    (arrow.points as [number, number][])[1] = [77, 88];

    // Call 2: pass same mutated element, but snap1 must still hold the original points
    const snap2 = handleChangeCallback([arrow as never], emptyAppState, snap1, mockVscode);

    // snap1's points must NOT reflect the mutation (snapshot isolation)
    expect((snap1[0] as ExcalidrawAPIElement).points).toEqual([[0, 0], [0, 0], [10, 10]]);
    // snap2 correctly detects the change and emits
    const routedMsg = mockVscode.postMessage.mock.calls.find(
      (call) => call[0]?.type === "canvas:edge-routed",
    );
    expect(routedMsg).toBeDefined();
    // Only the interior point (index 1) is in waypoints; anchors (0, 2) are stripped
    expect((routedMsg![0] as { waypoints: Array<{ x: number; y: number }> }).waypoints).toEqual([
      { x: 77, y: 88 },
    ]);
    void snap2; // used to satisfy lint
  });
});
