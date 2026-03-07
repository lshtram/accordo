/**
 * Tests for CommentsTreeProvider (M45-TP)
 *
 * API checklist:
 * ✓ CommentsTreeProvider class  — M45-TP-01
 * ✓ constructor                 — M45-TP-02, M45-TP-06
 * ✓ getTreeItem                 — M45-TP-03
 * ✓ getChildren (root)          — M45-TP-04, M45-TP-13, M45-TP-14
 * ✓ getChildren (group)         — M45-TP-05
 * ✓ thread item label           — M45-TP-07
 * ✓ thread item description     — M45-TP-08
 * ✓ thread item contextValue    — M45-TP-09
 * ✓ thread item iconPath        — M45-TP-10
 * ✓ thread item tooltip         — M45-TP-11
 * ✓ thread item command         — M45-TP-12
 * ✓ getAnchorLabel              — M45-TP-15 (8 anchor types)
 * ✓ dispose                     — M45-TP-16
 * ✓ 3-level tree (comments)     — M45-TP-17, M45-TP-18
 * ✓ group mode by-file          — M45-TP-23
 * ✓ group mode by-activity      — M45-TP-24
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CommentsTreeProvider,
  CommentTreeItem,
  getAnchorLabel,
  INTENT_EMOJI,
} from "../../panel/comments-tree-provider.js";
import { PanelFilters } from "../../panel/panel-filters.js";
import type { TreeStoreReader } from "../../panel/comments-tree-provider.js";
import type {
  CommentThread,
  CommentAnchor,
  CommentAnchorText,
  CommentAnchorSurface,
} from "@accordo/bridge-types";
import { TreeItemCollapsibleState, ThemeIcon } from "vscode";

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

function makeThread(overrides: Partial<CommentThread> & { id: string }): CommentThread {
  return {
    anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
    comments: [{
      id: "c1", threadId: overrides.id,
      createdAt: "2026-03-06T00:00:00Z",
      author: { kind: "user", name: "User" },
      body: "Test comment body here",
      anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      status: "open",
    }],
    status: "open",
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
    ...overrides,
  };
}

function createMockStore(threads: CommentThread[] = [], staleIds: Set<string> = new Set()): TreeStoreReader {
  const listeners: Array<(uri: string) => void> = [];
  return {
    getAllThreads: vi.fn().mockReturnValue(threads),
    isThreadStale: vi.fn().mockImplementation((id: string) => staleIds.has(id)),
    onChanged: vi.fn().mockImplementation((listener: (uri: string) => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      };
    }),
    // Test helper to simulate a store change
    _fireChanged: (uri: string) => listeners.forEach(l => l(uri)),
  } as TreeStoreReader & { _fireChanged: (uri: string) => void };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-TP CommentsTreeProvider", () => {
  let store: ReturnType<typeof createMockStore>;
  let filters: PanelFilters;

  beforeEach(() => {
    store = createMockStore();
    filters = new PanelFilters(createMockMemento() as never);
  });

  // ── Class & constructor ──────────────────────────────────────────────────

  it("M45-TP-01: exports class CommentsTreeProvider implementing TreeDataProvider", () => {
    const provider = new CommentsTreeProvider(store, filters);
    expect(provider).toBeInstanceOf(CommentsTreeProvider);
    expect(typeof provider.getTreeItem).toBe("function");
    expect(typeof provider.getChildren).toBe("function");
    expect(typeof provider.onDidChangeTreeData).toBe("function");
  });

  it("M45-TP-02: constructor accepts CommentStore and PanelFilters", () => {
    const provider = new CommentsTreeProvider(store, filters);
    expect(provider).toBeDefined();
  });

  it("M45-TP-06: subscribes to store.onChanged; fires tree refresh on notification", () => {
    const provider = new CommentsTreeProvider(store, filters);
    const spy = vi.fn();
    provider.onDidChangeTreeData(spy);

    // Simulate a store change
    (store as unknown as { _fireChanged: (uri: string) => void })._fireChanged("file:///test.ts");

    expect(spy).toHaveBeenCalledWith(undefined);
  });

  // ── getTreeItem ──────────────────────────────────────────────────────────

  it("M45-TP-03: getTreeItem returns the element unchanged", () => {
    const provider = new CommentsTreeProvider(store, filters);
    const item = new CommentTreeItem("test");
    const result = provider.getTreeItem(item);
    expect(result).toBe(item);
  });

  // ── getChildren (root) ───────────────────────────────────────────────────

  it("M45-TP-04/13: root returns Open and Resolved group headers with counts", () => {
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "open" }),
      makeThread({ id: "t3", status: "resolved" }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    expect(roots).toHaveLength(2);
    expect(String(roots[0].label)).toContain("Open");
    expect(String(roots[0].label)).toContain("2");
    expect(roots[0].collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(String(roots[1].label)).toContain("Resolved");
    expect(String(roots[1].label)).toContain("1");
    expect(roots[1].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it("M45-TP-14: group headers with 0 count still appear", () => {
    const threads = [
      makeThread({ id: "t1", status: "open" }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    expect(roots).toHaveLength(2);
    expect(String(roots[1].label)).toContain("Resolved");
    expect(String(roots[1].label)).toContain("0");
  });

  // ── getChildren (group) ──────────────────────────────────────────────────

  it("M45-TP-05: thread items within group sorted by lastActivity descending", () => {
    const threads = [
      makeThread({ id: "t1", status: "open", lastActivity: "2026-03-06T01:00:00Z" }),
      makeThread({ id: "t2", status: "open", lastActivity: "2026-03-06T03:00:00Z" }),
      makeThread({ id: "t3", status: "open", lastActivity: "2026-03-06T02:00:00Z" }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const openGroup = roots[0];
    const children = provider.getChildren(openGroup);

    expect(children).toHaveLength(3);
    expect(children[0].thread!.id).toBe("t2"); // most recent
    expect(children[1].thread!.id).toBe("t3");
    expect(children[2].thread!.id).toBe("t1"); // oldest
  });

  // ── Thread item fields ───────────────────────────────────────────────────

  it("M45-TP-07: thread item label = anchor label, prefixed with '⚠ ' if stale", () => {
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "open" }),
    ];
    store = createMockStore(threads, new Set(["t2"]));
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const children = provider.getChildren(roots[0]);

    const normalItem = children.find(c => c.thread!.id === "t1")!;
    const staleItem = children.find(c => c.thread!.id === "t2")!;

    expect(String(normalItem.label)).not.toContain("⚠");
    expect(String(staleItem.label)).toContain("⚠");
  });

  it("M45-TP-08: thread item description = anchor label + intent emoji + reply count + last update", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [{
          id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z",
          author: { kind: "user", name: "User" }, body: "Fix it",
          anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
          status: "open", intent: "fix",
        }],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const children = provider.getChildren(roots[0]);
    // Anchor label (thread anchor is line 42 from makeThread default), intent emoji in description
    expect(children[0].description).toContain("line "); // anchor label in description
    expect(children[0].description).toContain("🔧");  // intent emoji
  });

  it("M45-TP-09: contextValue = accordo-thread-open / stale / resolved", () => {
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "open" }),
      makeThread({ id: "t3", status: "resolved" }),
    ];
    store = createMockStore(threads, new Set(["t2"]));
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const openChildren = provider.getChildren(roots[0]);
    const resolvedChildren = provider.getChildren(roots[1]);

    expect(openChildren.find(c => c.thread!.id === "t1")!.contextValue).toBe("accordo-thread-open");
    expect(openChildren.find(c => c.thread!.id === "t2")!.contextValue).toBe("accordo-thread-stale");
    expect(resolvedChildren[0].contextValue).toBe("accordo-thread-resolved");
  });

  it("M45-TP-10: iconPath = file-type ThemeIcon derived from anchor URI", () => {
    const threads = [
      makeThread({ id: "t1", status: "open" }),
      makeThread({ id: "t2", status: "resolved" }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const openChildren = provider.getChildren(roots[0]);
    const resolvedChildren = provider.getChildren(roots[1]);

    // Default anchor is auth.ts (.ts file) → "file-code"
    expect((openChildren[0].iconPath as ThemeIcon).id).toBe("file-code");
    expect((resolvedChildren[0].iconPath as ThemeIcon).id).toBe("file-code");
  });

  it("M45-TP-11: tooltip = first comment body (≤200 chars) + author + timestamp", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [{
          id: "c1", threadId: "t1",
          createdAt: "2026-03-06T12:00:00Z",
          author: { kind: "user", name: "Alice" },
          body: "This is a long comment body that should be truncated at 200 characters if needed",
          anchor: { kind: "file", uri: "file:///a.ts" },
          status: "open",
        }],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const children = provider.getChildren(roots[0]);

    const tooltip = String(children[0].tooltip);
    expect(tooltip).toContain("This is a long comment body");
    expect(tooltip).toContain("Alice");
  });

  it("M45-TP-12: thread item command = accordo.commentsPanel.navigateToAnchor with thread arg", () => {
    const threads = [makeThread({ id: "t1", status: "open" })];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const children = provider.getChildren(roots[0]);

    expect(children[0].command).toEqual({
      command: "accordo.commentsPanel.navigateToAnchor",
      title: "Go to Anchor",
      arguments: [threads[0]],
    });
  });

  // ── dispose ──────────────────────────────────────────────────────────────

  it("M45-TP-16: dispose() disposes the onChanged store subscription", () => {
    const provider = new CommentsTreeProvider(store, filters);
    const spy = vi.fn();
    provider.onDidChangeTreeData(spy);

    provider.dispose();

    // After dispose, store changes should not fire tree refresh
    (store as unknown as { _fireChanged: (uri: string) => void })._fireChanged("file:///test.ts");
    // The spy may have been called before dispose (for setup), but not after
    const callCountAfterDispose = spy.mock.calls.length;
    (store as unknown as { _fireChanged: (uri: string) => void })._fireChanged("file:///test.ts");
    expect(spy.mock.calls.length).toBe(callCountAfterDispose);
  });

  // ── 3-level tree: thread → comments ──────────────────────────────────────

  it("M45-TP-17: thread items have collapsibleState = Collapsed (have comment children)", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [
          { id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z", author: { kind: "user", name: "User" }, body: "Original comment", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
          { id: "c2", threadId: "t1", createdAt: "2026-03-06T01:00:00Z", author: { kind: "agent", name: "Agent" }, body: "Agent reply", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
        ],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const children = provider.getChildren(roots[0]);
    expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it("M45-TP-18: getChildren(threadItem) returns one CommentTreeItem per comment", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [
          { id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z", author: { kind: "user", name: "User" }, body: "First", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
          { id: "c2", threadId: "t1", createdAt: "2026-03-06T01:00:00Z", author: { kind: "agent", name: "Agent" }, body: "Second", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
          { id: "c3", threadId: "t1", createdAt: "2026-03-06T02:00:00Z", author: { kind: "user", name: "User" }, body: "Third", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
        ],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const threadItems = provider.getChildren(roots[0]);
    const commentItems = provider.getChildren(threadItems[0]);

    expect(commentItems).toHaveLength(3);
    commentItems.forEach(ci => {
      expect(ci.isComment).toBe(true);
      expect(ci.comment).toBeDefined();
      expect(ci.thread).toBeDefined();
      expect(ci.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
    expect(commentItems[0].comment!.id).toBe("c1");
    expect(commentItems[1].comment!.id).toBe("c2");
    expect(commentItems[2].comment!.id).toBe("c3");
  });

  it("M45-TP-18: comment item label includes author and description includes body preview", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [
          { id: "c1", threadId: "t1", createdAt: "2026-03-06T12:00:00Z", author: { kind: "user", name: "Alice" }, body: "This is a longer comment body that should be shown as a preview", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
        ],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const threadItems = provider.getChildren(roots[0]);
    const commentItems = provider.getChildren(threadItems[0]);

    expect(String(commentItems[0].label)).toContain("Alice");
    expect(String(commentItems[0].description)).toContain("This is a longer comment body");
  });

  it("M45-TP-18: comment item contextValue = 'accordo-comment'", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        comments: [
          { id: "c1", threadId: "t1", createdAt: "2026-03-06T00:00:00Z", author: { kind: "user", name: "User" }, body: "hi", anchor: { kind: "file", uri: "file:///a.ts" }, status: "open" },
        ],
      }),
    ];
    store = createMockStore(threads);
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const threadItems = provider.getChildren(roots[0]);
    const commentItems = provider.getChildren(threadItems[0]);

    expect(commentItems[0].contextValue).toBe("accordo-comment");
  });

  // ── Group mode: by-file ──────────────────────────────────────────────────

  it("M45-TP-23: groupMode 'by-file' creates one group header per distinct file", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
      makeThread({
        id: "t2", status: "open",
        anchor: { kind: "text", uri: "file:///project/src/config.ts", range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
      makeThread({
        id: "t3", status: "resolved",
        anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 20, startChar: 0, endLine: 20, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
    ];
    store = createMockStore(threads);
    filters.setGroupMode("by-file");
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    // auth.ts has 2 threads, config.ts has 1
    expect(roots.length).toBe(2);
    const labels = roots.map(r => String(r.label));
    expect(labels.some(l => l.includes("auth.ts"))).toBe(true);
    expect(labels.some(l => l.includes("config.ts"))).toBe(true);
    roots.forEach(r => {
      expect(r.isGroupHeader).toBe(true);
      expect(r.group).toBeDefined();
    });
  });

  it("M45-TP-23: by-file group children include threads from that file only", () => {
    const threads = [
      makeThread({
        id: "t1", status: "open",
        anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
      makeThread({
        id: "t2", status: "open",
        anchor: { kind: "text", uri: "file:///project/src/config.ts", range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
      makeThread({
        id: "t3", status: "resolved",
        anchor: { kind: "text", uri: "file:///project/src/auth.ts", range: { startLine: 20, startChar: 0, endLine: 20, endChar: 0 }, docVersion: 0 } as CommentAnchorText,
      }),
    ];
    store = createMockStore(threads);
    filters.setGroupMode("by-file");
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    const authGroup = roots.find(r => String(r.label).includes("auth.ts"))!;
    const authChildren = provider.getChildren(authGroup);
    expect(authChildren).toHaveLength(2);
    authChildren.forEach(c => expect(c.thread!.anchor.uri).toContain("auth.ts"));
  });

  // ── Group mode: by-activity ──────────────────────────────────────────────

  it("M45-TP-24: groupMode 'by-activity' returns flat thread list, no group headers", () => {
    const threads = [
      makeThread({ id: "t1", status: "open", lastActivity: "2026-03-06T01:00:00Z" }),
      makeThread({ id: "t2", status: "resolved", lastActivity: "2026-03-06T03:00:00Z" }),
      makeThread({ id: "t3", status: "open", lastActivity: "2026-03-06T02:00:00Z" }),
    ];
    store = createMockStore(threads);
    filters.setGroupMode("by-activity");
    const provider = new CommentsTreeProvider(store, filters);

    const roots = provider.getChildren(undefined);
    // Root level returns thread items directly — no group headers
    expect(roots).toHaveLength(3);
    roots.forEach(r => {
      expect(r.isGroupHeader).toBe(false);
      expect(r.thread).toBeDefined();
    });
    // Sorted by lastActivity desc
    expect(roots[0].thread!.id).toBe("t2"); // most recent
    expect(roots[1].thread!.id).toBe("t3");
    expect(roots[2].thread!.id).toBe("t1"); // oldest
  });
});

// ── getAnchorLabel ─────────────────────────────────────────────────────────

describe("M45-TP-15 getAnchorLabel", () => {
  it("text anchor → 'line {n}' (1-indexed)", () => {
    const anchor: CommentAnchorText = {
      kind: "text", uri: "file:///a.ts",
      range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 },
      docVersion: 0,
    };
    expect(getAnchorLabel(anchor)).toBe("line 42");
  });

  it("surface/slide → 'Slide {n}' (1-indexed)", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    expect(getAnchorLabel(anchor)).toBe("Slide 4");
  });

  it("surface/heading → '§ {headingText}' (truncated to 40 chars)", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "heading", headingText: "A".repeat(50), headingLevel: 2 },
    };
    const label = getAnchorLabel(anchor);
    expect(label).toMatch(/^§ /);
    expect(label.length).toBeLessThanOrEqual(2 + 40); // "§ " + 40 chars
  });

  it("surface/block → 'block: {blockId}' (truncated to 30 chars)", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "B".repeat(40), blockType: "paragraph" },
    };
    const label = getAnchorLabel(anchor);
    expect(label).toMatch(/^block: /);
    expect(label.length).toBeLessThanOrEqual(7 + 30); // "block: " + 30 chars
  });

  it("surface/normalized → '({x%}, {y%})'", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///img.png",
      surfaceType: "image",
      coordinates: { type: "normalized", x: 0.5, y: 0.75 },
    };
    expect(getAnchorLabel(anchor)).toBe("(50%, 75%)");
  });

  it("surface/diagram-node → 'node: {nodeId}'", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///diagram.tldr",
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node-42" },
    };
    expect(getAnchorLabel(anchor)).toBe("node: node-42");
  });

  it("surface/pdf-page → 'p{page} ({x%}, {y%})'", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface", uri: "file:///doc.pdf",
      surfaceType: "pdf",
      coordinates: { type: "pdf-page", page: 3, x: 0.1, y: 0.9 },
    };
    expect(getAnchorLabel(anchor)).toBe("p3 (10%, 90%)");
  });

  it("file anchor → '(file-level)'", () => {
    const anchor = { kind: "file" as const, uri: "file:///package.json" };
    expect(getAnchorLabel(anchor)).toBe("(file-level)");
  });
});
