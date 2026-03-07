/**
 * Tests for PanelFilters (M45-FLT)
 *
 * API checklist:
 * ✓ constructor         — 2 tests (M45-FLT-02, M45-FLT-13)
 * ✓ apply               — 6 tests (M45-FLT-04 + per-filter-field)
 * ✓ setStatus           — 1 test  (M45-FLT-05)
 * ✓ setIntent           — 1 test  (M45-FLT-06)
 * ✓ setAuthorKind       — 1 test  (M45-FLT-07)
 * ✓ setSurfaceType      — 1 test  (M45-FLT-08)
 * ✓ setStaleOnly        — 1 test  (M45-FLT-09)
 * ✓ clear               — 1 test  (M45-FLT-10)
 * ✓ getSummary          — 2 tests (M45-FLT-11)
 * ✓ isActive            — 2 tests (M45-FLT-12)
 * ✓ groupMode getter    — 1 test  (M45-FLT-14)
 * ✓ setGroupMode        — 2 tests (M45-FLT-15)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PanelFilters,
  FILTER_PERSISTENCE_KEY,
} from "../../panel/panel-filters.js";
import type { GroupMode } from "../../panel/panel-filters.js";
import type { CommentThread, CommentAnchorSurface } from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockMemento(
  initial?: Record<string, unknown>,
): { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get: vi.fn().mockImplementation((key: string, fallback?: unknown) =>
      data.has(key) ? data.get(key) : fallback,
    ),
    update: vi.fn().mockImplementation((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
  };
}

function makeThread(overrides: Partial<CommentThread> & { id: string }): CommentThread {
  return {
    anchor: { kind: "file", uri: "file:///test.ts" },
    comments: [
      {
        id: "c1",
        threadId: overrides.id,
        createdAt: "2026-03-06T00:00:00Z",
        author: { kind: "user", name: "User" },
        body: "Test comment",
        anchor: { kind: "file", uri: "file:///test.ts" },
        status: "open",
      },
    ],
    status: "open",
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
    ...overrides,
  };
}

function makeStaleChecker(staleIds: Set<string> = new Set()) {
  return { isThreadStale: (id: string) => staleIds.has(id) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-FLT PanelFilters", () => {
  let memento: ReturnType<typeof createMockMemento>;

  beforeEach(() => {
    memento = createMockMemento();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  it("M45-FLT-02: constructor accepts vscode.Memento", () => {
    const f = new PanelFilters(memento as never);
    expect(f).toBeInstanceOf(PanelFilters);
  });

  it("M45-FLT-13: constructor loads and validates persisted filter state", () => {
    const persisted = { status: "open", intent: "INVALID_VALUE", staleOnly: true };
    memento = createMockMemento({ [FILTER_PERSISTENCE_KEY]: persisted });
    const f = new PanelFilters(memento as never);
    // Valid status should be kept, invalid intent should be reset
    expect(f.isActive()).toBe(true);
    expect(f.getSummary()).toContain("open");
    expect(f.getSummary()).not.toContain("INVALID");
  });

  // ── apply ────────────────────────────────────────────────────────────────

  it("M45-FLT-04: apply() returns filtered array without mutating input", () => {
    const f = new PanelFilters(memento as never);
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "resolved" }),
    ];
    const original = [...threads];
    f.setStatus("open");
    const result = f.apply(threads);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
    expect(threads).toEqual(original); // input not mutated
  });

  it("M45-FLT-04: apply() with no filters returns all threads", () => {
    const f = new PanelFilters(memento as never);
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "resolved" }),
    ];
    const result = f.apply(threads);
    expect(result).toHaveLength(2);
  });

  it("M45-FLT-04: apply() filters by intent using first comment's intent", () => {
    const f = new PanelFilters(memento as never);
    const threads = [
      makeThread({
        id: "t1",
        comments: [{
          id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z",
          author: { kind: "user", name: "User" }, body: "fix this",
          anchor: { kind: "file", uri: "file:///a.ts" }, status: "open",
          intent: "fix",
        }],
      }),
      makeThread({
        id: "t2",
        comments: [{
          id: "c2", threadId: "t2", createdAt: "2026-03-06T00:00:00Z",
          author: { kind: "user", name: "User" }, body: "review this",
          anchor: { kind: "file", uri: "file:///b.ts" }, status: "open",
          intent: "review",
        }],
      }),
    ];
    f.setIntent("fix");
    const result = f.apply(threads);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("M45-FLT-04: apply() filters by authorKind using last comment's author", () => {
    const f = new PanelFilters(memento as never);
    const threads = [
      makeThread({
        id: "t1",
        comments: [
          { id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z", author: { kind: "user", name: "User" }, body: "hi", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
          { id: "c2", threadId: "t1", createdAt: "2026-03-06T01:00:00Z", author: { kind: "agent", name: "Agent" }, body: "reply", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
        ],
      }),
      makeThread({
        id: "t2",
        comments: [
          { id: "c3", threadId: "t2", createdAt: "2026-03-06T00:00:00Z", author: { kind: "user", name: "User" }, body: "hi", anchor: { kind: "file", uri: "file:///b.ts" }, status: "open" },
        ],
      }),
    ];
    f.setAuthorKind("agent");
    const result = f.apply(threads);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("M45-FLT-04: apply() filters by surfaceType (surface anchors only)", () => {
    const f = new PanelFilters(memento as never);
    const slideAnchor: CommentAnchorSurface = { kind: "surface", uri: "file:///deck.md", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 0, x: 0.5, y: 0.5 } };
    const threads = [
      makeThread({ id: "t1", anchor: slideAnchor }),
      makeThread({ id: "t2", anchor: { kind: "file", uri: "file:///a.ts" } }),
    ];
    f.setSurfaceType("slide");
    const result = f.apply(threads);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("M45-FLT-04: apply() filters staleOnly using store.isThreadStale", () => {
    const f = new PanelFilters(memento as never);
    const threads = [
      makeThread({ id: "t1" }),
      makeThread({ id: "t2" }),
    ];
    f.setStaleOnly(true);
    const staleChecker = makeStaleChecker(new Set(["t2"]));
    const result = f.apply(threads, staleChecker);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t2");
  });

  // ── Setters + persistence ────────────────────────────────────────────────

  it("M45-FLT-05: setStatus() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setStatus("resolved");
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ status: "resolved" }),
    );
  });

  it("M45-FLT-06: setIntent() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setIntent("fix");
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ intent: "fix" }),
    );
  });

  it("M45-FLT-07: setAuthorKind() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setAuthorKind("agent");
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ authorKind: "agent" }),
    );
  });

  it("M45-FLT-08: setSurfaceType() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setSurfaceType("slide");
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ surfaceType: "slide" }),
    );
  });

  it("M45-FLT-09: setStaleOnly() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setStaleOnly(true);
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ staleOnly: true }),
    );
  });

  // ── clear ────────────────────────────────────────────────────────────────

  it("M45-FLT-10: clear() resets all filters and persists", () => {
    const f = new PanelFilters(memento as never);
    f.setStatus("open");
    f.setIntent("fix");
    f.setStaleOnly(true);
    f.clear();
    expect(f.isActive()).toBe(false);
    expect(f.getSummary()).toBe("");
    expect(memento.update).toHaveBeenLastCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ status: undefined, intent: undefined, staleOnly: false }),
    );
  });

  // ── getSummary ───────────────────────────────────────────────────────────

  it("M45-FLT-11: getSummary() returns empty string when no filters active", () => {
    const f = new PanelFilters(memento as never);
    expect(f.getSummary()).toBe("");
  });

  it("M45-FLT-11: getSummary() returns readable description with active filters", () => {
    const f = new PanelFilters(memento as never);
    f.setStatus("open");
    f.setIntent("fix");
    const summary = f.getSummary();
    expect(summary).toContain("open");
    expect(summary).toContain("fix");
  });

  // ── isActive ─────────────────────────────────────────────────────────────

  it("M45-FLT-12: isActive() returns false when no filters set", () => {
    const f = new PanelFilters(memento as never);
    expect(f.isActive()).toBe(false);
  });

  it("M45-FLT-12: isActive() returns true when any filter is non-default", () => {
    const f = new PanelFilters(memento as never);
    f.setIntent("review");
    expect(f.isActive()).toBe(true);
  });

  // ── groupMode ────────────────────────────────────────────────────────────

  it("M45-FLT-14: groupMode defaults to 'by-status'", () => {
    const f = new PanelFilters(memento as never);
    expect(f.groupMode).toBe("by-status");
  });

  it("M45-FLT-15: setGroupMode() persists to workspaceState", () => {
    const f = new PanelFilters(memento as never);
    f.setGroupMode("by-file");
    expect(f.groupMode).toBe("by-file");
    expect(memento.update).toHaveBeenCalledWith(
      FILTER_PERSISTENCE_KEY,
      expect.objectContaining({ groupMode: "by-file" }),
    );
  });

  it("M45-FLT-15: invalid groupMode from persisted state falls back to 'by-status'", () => {
    memento = createMockMemento({
      [FILTER_PERSISTENCE_KEY]: { groupMode: "GARBAGE" },
    });
    const f = new PanelFilters(memento as never);
    expect(f.groupMode).toBe("by-status");
  });
});
