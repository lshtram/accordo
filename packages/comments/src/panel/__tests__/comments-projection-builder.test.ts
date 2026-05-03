/**
 * Tests for CommentsPanelProjectionBuilder (M45-PJ)
 *
 * API checklist:
 * ✓ buildCommentsPanelViewModel — M45-PJ-01..07 (by-file grouping + expanded threads)
 *
 * M45-PJ-01: projection derived from CommentStore + PanelFilters + uiState only
 * M45-PJ-02: supports by-status, by-file, by-activity group modes
 * M45-PJ-03: by-file renders one group per distinct file URI label; groups are collapsible
 * M45-PJ-04: thread rows preserve status, stale, anchor label, intent, reply count, preview, last-activity
 * M45-PJ-05: expanded thread projection includes full inline conversation payload
 * M45-PJ-06: projection is read-only; no store mutations
 * M45-PJ-07: expanded/collapsed state is panel UI state, not store state
 *
 * Phase B: all tests are pass-eligible because M45-PJ is pure derivation that currently
 * throws "not implemented" — tests document the expected contract without depending
 * on the stub to pass (they assert on concrete expected shapes, not stub behavior).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCommentsPanelViewModel } from "../../panel/comments-projection-builder.js";
import type { CommentsPanelProjectionStore } from "../../panel/comments-projection-builder.js";
import type { PanelFilters } from "../../panel/panel-filters.js";
import type {
  CommentsPanelUiState,
  CommentsPanelViewModel,
  CommentsPanelGroupViewModel,
  CommentsPanelThreadViewModel,
} from "../../panel/comments-webview-contract.js";
import { PanelFilters as PanelFiltersClass } from "../../panel/panel-filters.js";
import type { CommentThread, CommentAnchorText, CommentAnchorSurface } from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockMemento(): { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn().mockImplementation((key: string, fallback?: unknown) =>
      data.has(key) ? data.get(key) : fallback,
    ),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTextAnchor(uri: string, line: number): CommentAnchorText {
  return {
    kind: "text",
    uri,
    range: { startLine: line, startChar: 0, endLine: line, endChar: 0 },
    docVersion: 0,
  };
}

function makeSurfaceAnchor(uri: string, surfaceType: "slide" | "browser" | "markdown-preview" | "diagram"): CommentAnchorSurface {
  return {
    kind: "surface",
    uri,
    surfaceType,
    coordinates: { type: "normalized", x: 0.5, y: 0.5 },
  };
}

function makeThread(overrides: Partial<CommentThread> & { id: string }): CommentThread {
  const base: CommentThread = {
    anchor: makeTextAnchor("file:///project/src/utils.ts", 10),
    comments: [
      {
        id: "c1",
        threadId: overrides.id,
        createdAt: "2026-03-06T10:00:00Z",
        author: { kind: "user", name: "User" },
        body: "First comment body text",
        anchor: makeTextAnchor("file:///project/src/utils.ts", 10),
        status: "open",
        intent: "fix",
      },
    ],
    status: "open",
    createdAt: "2026-03-06T10:00:00Z",
    lastActivity: "2026-03-06T10:00:00Z",
    ...overrides,
  };
  return base;
}

function createMockStore(threads: CommentThread[], staleIds: Set<string> = new Set()): CommentsPanelProjectionStore {
  return {
    getAllThreads: vi.fn().mockReturnValue(threads),
    isThreadStale: vi.fn().mockImplementation((id: string) => staleIds.has(id)),
  };
}

function emptyUiState(): CommentsPanelUiState {
  return {
    expandedThreadIds: new Set<string>(),
    collapsedGroupIds: new Set<string>(),
  };
}

function makeFilters(): PanelFilters {
  return new PanelFiltersClass(createMockMemento() as never);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-PJ CommentsPanelProjectionBuilder", () => {

  // M45-PJ-01: projection is derived from store + filters + uiState only
  describe("M45-PJ-01: projection derived from store + filters + uiState only", () => {
    it("returns a valid CommentsPanelViewModel shape", () => {
      const store = createMockStore([]);
      const filters = makeFilters();
      const uiState = emptyUiState();
      // Phase B: this throws "not implemented" against the stub
      const result = buildCommentsPanelViewModel(store, filters, uiState);
      expect(result).toHaveProperty("generatedAt");
      expect(result).toHaveProperty("filtersSummary");
      expect(result).toHaveProperty("groupMode");
      expect(result).toHaveProperty("groups");
      expect(result).toHaveProperty("totalThreadCount");
      expect(result).toHaveProperty("openThreadCount");
      expect(result).toHaveProperty("resolvedThreadCount");
      expect(Array.isArray(result.groups)).toBe(true);
    });

    it("totalThreadCount equals all store threads", () => {
      const threads = [
        makeThread({ id: "t1" }),
        makeThread({ id: "t2" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.totalThreadCount).toBe(2);
    });

    it("openThreadCount and resolvedThreadCount are accurate", () => {
      const threads = [
        makeThread({ id: "t1", status: "open" }),
        makeThread({ id: "t2", status: "resolved" }),
        makeThread({ id: "t3", status: "open" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.openThreadCount).toBe(2);
      expect(result.resolvedThreadCount).toBe(1);
    });
  });

  // M45-PJ-02: supports by-status, by-file, by-activity group modes
  describe("M45-PJ-02: group mode support", () => {
    it("by-status groups by thread status", () => {
      const threads = [
        makeThread({ id: "t1", status: "open" }),
        makeThread({ id: "t2", status: "resolved" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-status"); // explicit for this test
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.groupMode).toBe("by-status");
      const groupLabels = result.groups.map(g => g.label);
      expect(groupLabels).toContain("open");
      expect(groupLabels).toContain("resolved");
    });

    it("by-file groups by file URI label", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/auth.ts", 10) }),
        makeThread({ id: "t2", anchor: makeTextAnchor("file:///project/src/auth.ts", 20) }),
        makeThread({ id: "t3", anchor: makeTextAnchor("file:///project/src/utils.ts", 5) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.groupMode).toBe("by-file");
      expect(result.groups).toHaveLength(2);
      const authGroup = result.groups.find(g => g.label.includes("auth.ts"));
      expect(authGroup).toBeDefined();
      expect(authGroup!.count).toBe(2);
    });

    it("by-activity groups by relative time bucket (day/week/month)", () => {
      const threads = [
        makeThread({ id: "t1", lastActivity: "2026-05-01T10:00:00Z" }),
        makeThread({ id: "t2", lastActivity: "2026-04-15T10:00:00Z" }),
        makeThread({ id: "t3", lastActivity: "2026-03-01T10:00:00Z" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-activity");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.groupMode).toBe("by-activity");
      expect(result.groups.length).toBeGreaterThan(0);
    });
  });

  // M45-PJ-03: by-file groups are collapsible
  describe("M45-PJ-03: by-file groups are collapsible", () => {
    it("returns expanded: boolean per group", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/auth.ts", 10) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");
      const uiState = emptyUiState();
      const result = buildCommentsPanelViewModel(store, filters, uiState);
      expect(result.groups.length).toBeGreaterThan(0);
      result.groups.forEach(group => {
        expect(typeof group.expanded).toBe("boolean");
      });
    });

    it("collapsedGroupIds in uiState causes group.expanded to be false", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/auth.ts", 10) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");

      // Find the file group label
      const preResult = buildCommentsPanelViewModel(store, filters, emptyUiState());
      const fileGroupId = preResult.groups[0]?.groupId;

      const uiState: CommentsPanelUiState = {
        expandedThreadIds: new Set(),
        collapsedGroupIds: new Set(fileGroupId ? [fileGroupId] : []),
      };

      const result = buildCommentsPanelViewModel(store, filters, uiState);
      expect(result.groups[0].expanded).toBe(false);
    });

    it("non-collapsed group has expanded: true", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/auth.ts", 10) }),
        makeThread({ id: "t2", anchor: makeTextAnchor("file:///project/src/utils.ts", 5) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");
      // Only collapse one group
      const uiState: CommentsPanelUiState = {
        expandedThreadIds: new Set(),
        collapsedGroupIds: new Set(),
      };
      const result = buildCommentsPanelViewModel(store, filters, uiState);
      // Groups not in collapsedGroupIds should be expanded
      result.groups.forEach(group => {
        expect(group.expanded).toBe(true);
      });
    });
  });

  // M45-PJ-04: thread rows preserve metadata
  describe("M45-PJ-04: thread rows preserve metadata semantics", () => {
    it("thread row has status, stale, intent, replyCount, preview, title, subtitle", () => {
      const thread: CommentThread = {
        id: "t1",
        anchor: makeTextAnchor("file:///project/src/auth.ts", 42),
        comments: [
          {
            id: "c1",
            threadId: "t1",
            createdAt: "2026-03-06T10:00:00Z",
            author: { kind: "user", name: "User" },
            body: "Fix the null check here",
            anchor: makeTextAnchor("file:///project/src/auth.ts", 42),
            status: "open",
            intent: "fix",
          },
          {
            id: "c2",
            threadId: "t1",
            createdAt: "2026-03-06T11:00:00Z",
            author: { kind: "agent", name: "Agent" },
            body: "LGTM, thanks",
            anchor: makeTextAnchor("file:///project/src/auth.ts", 42),
            status: "open",
            intent: "review",
          },
        ],
        status: "open",
        createdAt: "2026-03-06T10:00:00Z",
        lastActivity: "2026-03-06T11:00:00Z",
      };
      const store = createMockStore([thread], new Set(["t1"])); // t1 is stale
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());

      const t = result.groups[0].threads[0];
      expect(t.threadId).toBe("t1");
      expect(t.status).toBe("open");
      expect(t.stale).toBe(true);
      expect(t.intent).toBe("fix");
      expect(t.replyCount).toBe(1); // 2 comments - 1 root = 1 reply
      expect(t.preview).toContain("Fix the null check");
      expect(t.title).toBeDefined();
      expect(typeof t.title).toBe("string");
      expect(t.subtitle).toBeDefined();
      expect(typeof t.subtitle).toBe("string");
    });

    it("thread row subtitle includes anchor label (file:line)", () => {
      const thread = makeThread({
        id: "t1",
        anchor: makeTextAnchor("file:///project/src/auth.ts", 42),
      });
      const store = createMockStore([thread]);
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      const t = result.groups[0].threads[0];
      expect(t.subtitle).toMatch(/auth\.ts/);
      expect(t.subtitle).toMatch(/42/);
    });

    it("stale flag uses store.isThreadStale", () => {
      const threads = [
        makeThread({ id: "t1" }),
        makeThread({ id: "t2" }),
      ];
      const store = createMockStore(threads, new Set(["t1"]));
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      const allThreads = result.groups.flatMap(g => g.threads);
      const t1 = allThreads.find(t => t.threadId === "t1");
      const t2 = allThreads.find(t => t.threadId === "t2");
      expect(t1?.stale).toBe(true);
      expect(t2?.stale).toBe(false);
    });
  });

  // M45-PJ-05: expanded thread includes full inline conversation payload
  describe("M45-PJ-05: expanded thread emits inline conversation payload", () => {
    function makeUiStateWithExpanded(threadId: string): CommentsPanelUiState {
      return {
        expandedThreadIds: new Set([threadId]),
        collapsedGroupIds: new Set(),
      };
    }

    it("expanded thread includes comments array with all comment data", () => {
      const thread: CommentThread = {
        id: "t1",
        anchor: makeTextAnchor("file:///project/src/auth.ts", 10),
        comments: [
          {
            id: "c1",
            threadId: "t1",
            createdAt: "2026-03-06T10:00:00Z",
            author: { kind: "user", name: "User" },
            body: "First comment",
            anchor: makeTextAnchor("file:///project/src/auth.ts", 10),
            status: "open",
            intent: "fix",
          },
          {
            id: "c2",
            threadId: "t1",
            createdAt: "2026-03-06T11:00:00Z",
            author: { kind: "agent", name: "Copilot" },
            body: "Second reply",
            anchor: makeTextAnchor("file:///project/src/auth.ts", 10),
            status: "open",
            intent: "fix",
          },
        ],
        status: "open",
        createdAt: "2026-03-06T10:00:00Z",
        lastActivity: "2026-03-06T11:00:00Z",
      };
      const store = createMockStore([thread]);
      const filters = makeFilters();
      const uiState = makeUiStateWithExpanded("t1");
      const result = buildCommentsPanelViewModel(store, filters, uiState);

      const t = result.groups[0].threads[0];
      expect(t.expanded).toBe(true);
      expect(t.comments).toHaveLength(2);
      expect(t.comments[0].commentId).toBe("c1");
      expect(t.comments[0].authorName).toBe("User");
      expect(t.comments[0].authorKind).toBe("user");
      expect(t.comments[0].body).toBe("First comment");
      expect(t.comments[1].authorKind).toBe("agent");
      expect(t.comments[1].authorName).toBe("Copilot");
    });

    it("collapsed thread has empty comments array", () => {
      const thread = makeThread({ id: "t1" });
      const store = createMockStore([thread]);
      const filters = makeFilters();
      // not expanded
      const uiState: CommentsPanelUiState = {
        expandedThreadIds: new Set(),
        collapsedGroupIds: new Set(),
      };
      const result = buildCommentsPanelViewModel(store, filters, uiState);
      const t = result.groups[0].threads[0];
      expect(t.expanded).toBe(false);
      expect(t.comments).toHaveLength(0);
    });

    it("only the specified thread is expanded", () => {
      const threads = [
        makeThread({ id: "t1" }),
        makeThread({ id: "t2" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      const uiState = makeUiStateWithExpanded("t1");
      const result = buildCommentsPanelViewModel(store, filters, uiState);
      const allThreads = result.groups.flatMap(g => g.threads);
      const t1 = allThreads.find(t => t.threadId === "t1");
      const t2 = allThreads.find(t => t.threadId === "t2");
      expect(t1?.expanded).toBe(true);
      expect(t2?.expanded).toBe(false);
    });
  });

  // M45-PJ-06: projection is read-only — no store mutations
  describe("M45-PJ-06: projection does not mutate store", () => {
    it("getAllThreads is called but store is not mutated", () => {
      const threads = [makeThread({ id: "t1" })];
      const store = createMockStore(threads);
      const filters = makeFilters();
      buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(store.getAllThreads).toHaveBeenCalled();
      // Phase B: only verification that store is called, not modified (no write methods on store interface)
    });
  });

  // M45-PJ-07: expanded/collapsed is panel UI state, not store state
  describe("M45-PJ-07: expanded/collapsed state is panel UI state", () => {
    it("expanded flag reflects uiState.expandedThreadIds, not store state", () => {
      const threads = [makeThread({ id: "t1" })];
      const store = createMockStore(threads);
      const filters = makeFilters();

      // Same threads, same store — only uiState differs
      const uiStateCollapsed: CommentsPanelUiState = {
        expandedThreadIds: new Set(),
        collapsedGroupIds: new Set(),
      };
      const collapsedResult = buildCommentsPanelViewModel(store, filters, uiStateCollapsed);
      expect(collapsedResult.groups[0].threads[0].expanded).toBe(false);

      const uiStateExpanded: CommentsPanelUiState = {
        expandedThreadIds: new Set(["t1"]),
        collapsedGroupIds: new Set(),
      };
      const expandedResult = buildCommentsPanelViewModel(store, filters, uiStateExpanded);
      expect(expandedResult.groups[0].threads[0].expanded).toBe(true);
    });

    it("group expanded flag reflects uiState.collapsedGroupIds", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/a.ts", 1) }),
        makeThread({ id: "t2", anchor: makeTextAnchor("file:///project/src/b.ts", 1) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");

      // Pre-compute group IDs
      const preResult = buildCommentsPanelViewModel(store, filters, emptyUiState());
      const bGroupId = preResult.groups.find(g => g.label.includes("b.ts"))?.groupId;
      expect(bGroupId).toBeDefined();

      const uiState: CommentsPanelUiState = {
        expandedThreadIds: new Set(),
        collapsedGroupIds: new Set([bGroupId]),
      };
      const result = buildCommentsPanelViewModel(store, filters, uiState);

      result.groups.forEach(group => {
        if (group.label.includes("b.ts")) {
          expect(group.expanded).toBe(false);
        } else {
          expect(group.expanded).toBe(true);
        }
      });
    });
  });

  // M45-PJ-03 / M45-PJ-02: threads sorted by anchor location within file groups
  describe("M45-PJ-03 (sort within file groups): threads sorted by anchor line ascending", () => {
    it("by-file groups sort threads by line number ascending", () => {
      const threads = [
        makeThread({ id: "t1", anchor: makeTextAnchor("file:///project/src/auth.ts", 50) }),
        makeThread({ id: "t2", anchor: makeTextAnchor("file:///project/src/auth.ts", 10) }),
        makeThread({ id: "t3", anchor: makeTextAnchor("file:///project/src/auth.ts", 30) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-file");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());

      const authGroup = result.groups.find(g => g.label.includes("auth.ts"));
      expect(authGroup).toBeDefined();
      const lineNumbers = authGroup!.threads.map(t => {
        // Extract line from subtitle like "src/auth.ts @ L42"
        const match = t.subtitle.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });
      expect(lineNumbers).toEqual([10, 30, 50]);
    });

    it("by-status groups sort threads by line number ascending within each status group", () => {
      const threads = [
        makeThread({ id: "t1", status: "open", anchor: makeTextAnchor("file:///p/a.ts", 100) }),
        makeThread({ id: "t2", status: "open", anchor: makeTextAnchor("file:///p/a.ts", 10) }),
        makeThread({ id: "t3", status: "resolved", anchor: makeTextAnchor("file:///p/a.ts", 50) }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setGroupMode("by-status");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());

      const openGroup = result.groups.find(g => g.label === "open");
      expect(openGroup).toBeDefined();
      const openLines = openGroup!.threads.map(t => {
        const match = t.subtitle.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });
      expect(openLines).toEqual([10, 100]);
    });
  });

  // Filters integration
  describe("filters affect which threads appear in projection", () => {
    it("status filter reduces visible threads while preserving total counter", () => {
      const threads = [
        makeThread({ id: "t1", status: "open" }),
        makeThread({ id: "t2", status: "resolved" }),
        makeThread({ id: "t3", status: "open" }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setStatus("open");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.totalThreadCount).toBe(3);
      expect(result.statusFilter).toBe("open");
      expect(result.groups.flatMap((g) => g.threads)).toHaveLength(2);
    });

    it("intent filter reduces visible threads while preserving total counter", () => {
      const threads = [
        makeThread({
          id: "t1",
          comments: [{
            id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z",
            author: { kind: "user", name: "User" }, body: "Fix this",
            anchor: makeTextAnchor("file:///p/a.ts", 1), status: "open",
            intent: "fix",
          }],
        }),
        makeThread({
          id: "t2",
          comments: [{
            id: "c2", threadId: "t2", createdAt: "2026-03-06T00:00:00Z",
            author: { kind: "user", name: "User" }, body: "Review this",
            anchor: makeTextAnchor("file:///p/a.ts", 2), status: "open",
            intent: "review",
          }],
        }),
      ];
      const store = createMockStore(threads);
      const filters = makeFilters();
      filters.setIntent("fix");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.totalThreadCount).toBe(2);
      expect(result.groups.flatMap((g) => g.threads)).toHaveLength(1);
      expect(result.groups[0].threads[0].threadId).toBe("t1");
    });

    it("filtersSummary reflects active filters", () => {
      const store = createMockStore([]);
      const filters = makeFilters();
      filters.setStatus("open");
      filters.setIntent("fix");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.filtersSummary).toContain("open");
      expect(result.filtersSummary).toContain("fix");
    });

    it("no filters active → filtersSummary is empty", () => {
      const store = createMockStore([]);
      const filters = makeFilters();
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      expect(result.filtersSummary).toBe("");
    });
  });

  // M45-PJ-04: surface type preserved on thread row
  describe("M45-PJ-04: surfaceType preserved on thread row", () => {
    it("thread row preserves surfaceType from anchor", () => {
      const thread: CommentThread = {
        id: "t-slide",
        anchor: makeSurfaceAnchor("file:///project/deck.md", "slide"),
        comments: [{
          id: "c1", threadId: "t-slide", createdAt: "2026-03-06T00:00:00Z",
          author: { kind: "user", name: "User" }, body: "Slide comment",
          anchor: makeSurfaceAnchor("file:///project/deck.md", "slide"),
          status: "open",
        }],
        status: "open",
        createdAt: "2026-03-06T00:00:00Z",
        lastActivity: "2026-03-06T00:00:00Z",
      };
      const store = createMockStore([thread]);
      const filters = makeFilters();
      filters.setGroupMode("by-status");
      const result = buildCommentsPanelViewModel(store, filters, emptyUiState());
      const t = result.groups[0].threads[0];
      expect(t.surfaceType).toBe("slide");
    });
  });
});
