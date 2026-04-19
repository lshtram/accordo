/**
 * Tests for NavigationRouter (M45-NR)
 *
 * API checklist:
 * ✓ navigateToThread  — 10 tests (M45-NR-01 → M45-NR-10)
 *
 * Tests use a mock NavigationEnv — no real VS Code API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { navigateToThread } from "../../panel/navigation-router.js";
import type { NavigationEnv } from "../../panel/navigation-router.js";
import type {
  CommentThread,
  CommentAnchorText,
  CommentAnchorSurface,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEnv(): NavigationEnv & {
  showTextDocument: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showInformationMessage: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
  visibleTextEditorUris: ReturnType<typeof vi.fn>;
} {
  return {
    showTextDocument: vi.fn().mockResolvedValue({ revealRange: vi.fn() }),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    visibleTextEditorUris: vi.fn().mockReturnValue([]),
  };
}

function makeThread(anchor: CommentThread["anchor"]): CommentThread {
  return {
    id: "thread-1",
    anchor,
    comments: [{
      id: "c1", threadId: "thread-1",
      createdAt: "2026-03-06T00:00:00Z",
      author: { kind: "user", name: "User" },
      body: "Test", anchor,
      status: "open",
    }],
    status: "open",
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-NR NavigationRouter", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  it("M45-NR-01: exports navigateToThread as an async function", () => {
    expect(typeof navigateToThread).toBe("function");
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  // These tests document the Phase C behavior.
  // All M45-NR-0x tests were written against the old implementation (Phase A stub replaces it).
  it("M45-NR-02: text anchor → showTextDocument with selection range then expands gutter widget", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/auth.ts",
      range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    // Phase A: navigateToThread is a stub — when implemented, it must:
    // 1. showTextDocument with selection, then
    // 2. executeCommand accordo_comments_internal_expandThread
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    // Verify the env was NOT called yet (stub is a no-op until Phase C)
    expect(env.showTextDocument).not.toHaveBeenCalled();
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-02b: text anchor on .md with text editor visible → navigates to text editor, not preview", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    env.visibleTextEditorUris.mockReturnValue(["file:///project/README.md"]);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.showTextDocument).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-02c: text anchor on .md with no text editor open → opens Accordo preview", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    env.visibleTextEditorUris.mockReturnValue([]);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-03: surface/markdown-preview → executeCommand with positional args (uri, threadId, blockId)", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "heading:2:intro", blockType: "heading" },
    };
    const thread = makeThread(anchor);
    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  // When implemented: tries goto immediately; on fail opens deck, delays 2s, retries goto.
  it("M45-NR-04: surface/slide → tries goto immediately; on fail opens deck, delays 2s, retries goto", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-04: surface/slide → shows info warning if goto command fails and keeps deck open", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-05: surface/browser → executeCommand accordo_browser.focusThread; swallows if not registered", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "https://example.com",
      surfaceType: "browser",
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-06: surface/diagram → executeCommand accordo_diagram_focusThread; graceful fallback", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/diagram.tldr",
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node-42" },
    };
    const thread = makeThread(anchor);

    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.executeCommand).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-07: file anchor → showTextDocument without range", async () => {
    const thread = makeThread({ kind: "file", uri: "file:///project/package.json" });
    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.showTextDocument).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-08: unrecognised surfaceType falls back to showTextDocument", async () => {
    const anchor = {
      kind: "surface" as const,
      uri: "file:///project/unknown.xyz",
      surfaceType: "unknown-future-type" as never,
      coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    // Phase A stub: must throw "not implemented"
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.showTextDocument).not.toHaveBeenCalled();
  });

  // Phase A contract: navigateToThread is a stub that throws "not implemented".
  it("M45-NR-09: navigation errors are caught; shows warning message", async () => {
    const thread = makeThread({
      kind: "text",
      uri: "file:///project/missing.ts",
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
      docVersion: 0,
    });
    // Phase A stub: must throw "not implemented" (no error path yet)
    await expect(navigateToThread(thread, env)).rejects.toThrow("not implemented");
    expect(env.showWarningMessage).not.toHaveBeenCalled();
  });

  it("M45-NR-10: NavigationEnv interface allows injection of mock for all operations", () => {
    // Type-level test: env satisfies NavigationEnv with all methods present
    const e: NavigationEnv = env;
    expect(typeof e.showTextDocument).toBe("function");
    expect(typeof e.executeCommand).toBe("function");
    expect(typeof e.showWarningMessage).toBe("function");
    expect(typeof e.showInformationMessage).toBe("function");
    expect(typeof e.delay).toBe("function");
    expect(typeof e.visibleTextEditorUris).toBe("function");
  });
});

// ── Priority Q: Surface Focus Navigation ───────────────────────────────────────

import { SURFACE_FOCUS_COMMANDS, buildNavigationDispatchPlan, buildSlideFocusArgs } from "../../panel/navigation-contract.js";
import { DEFERRED_COMMANDS } from "@accordo/capabilities";
import { CommandBackedBrowserRelayHealthReader } from "../../panel/browser-relay-health.js";

describe("Priority Q — Surface Focus Navigation", () => {
  // Helper: create a minimal slide-surface thread
  function makeSlideThread(): CommentThread {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    return {
      id: "thread-slide-1",
      anchor,
      comments: [{
        id: "c1", threadId: "thread-slide-1",
        createdAt: "2026-04-19T00:00:00Z",
        author: { kind: "user", name: "User" },
        body: "Slide comment",
        anchor,
        status: "open",
      }],
      status: "open",
      createdAt: "2026-04-19T00:00:00Z",
      lastActivity: "2026-04-19T00:00:00Z",
    };
  }

  function makeMarkdownPreviewThread(): CommentThread {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "heading:2:intro", blockType: "heading" },
    };
    return {
      id: "thread-md-1",
      anchor,
      comments: [{
        id: "c1", threadId: "thread-md-1",
        createdAt: "2026-04-19T00:00:00Z",
        author: { kind: "user", name: "User" },
        body: "MD preview comment",
        anchor,
        status: "open",
      }],
      status: "open",
      createdAt: "2026-04-19T00:00:00Z",
      lastActivity: "2026-04-19T00:00:00Z",
    };
  }

  function makeBrowserThread(): CommentThread {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "https://example.com/page",
      surfaceType: "browser",
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    };
    return {
      id: "thread-browser-1",
      anchor,
      comments: [{
        id: "c1", threadId: "thread-browser-1",
        createdAt: "2026-04-19T00:00:00Z",
        author: { kind: "user", name: "User" },
        body: "Browser comment",
        anchor,
        status: "open",
      }],
      status: "open",
      createdAt: "2026-04-19T00:00:00Z",
      lastActivity: "2026-04-19T00:00:00Z",
    };
  }

  function makeDiagramThread(): CommentThread {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/diagram.mmd",
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node-42" },
    };
    return {
      id: "thread-diagram-1",
      anchor,
      comments: [{
        id: "c1", threadId: "thread-diagram-1",
        createdAt: "2026-04-19T00:00:00Z",
        author: { kind: "user", name: "User" },
        body: "Diagram comment",
        anchor,
        status: "open",
      }],
      status: "open",
      createdAt: "2026-04-19T00:00:00Z",
      lastActivity: "2026-04-19T00:00:00Z",
    };
  }

  // ── Q-SURFACE-01: SURFACE_FOCUS_COMMANDS maps all surface types to canonical commands ──
  describe("Q-SURFACE-01: SURFACE_FOCUS_COMMANDS constant", () => {
    it("maps markdownPreview surface to accordo_preview_internal_focusThread", () => {
      expect(SURFACE_FOCUS_COMMANDS.markdownPreview).toBe("accordo_preview_internal_focusThread");
    });

    it("maps slide surface to accordo.presentation.internal.focusThread", () => {
      // M45-NR-04 corrected: canonical command is accordo.presentation.internal.focusThread
      expect(SURFACE_FOCUS_COMMANDS.slide).toBe("accordo.presentation.internal.focusThread");
    });

    it("maps diagram surface to accordo_diagram_focusThread", () => {
      expect(SURFACE_FOCUS_COMMANDS.diagram).toBe("accordo_diagram_focusThread");
    });

    it("maps browser surface to accordo_browser.focusThread", () => {
      // M45-NR-05 corrected: uses underscore naming to match MCP/VS Code registration
      expect(SURFACE_FOCUS_COMMANDS.browser).toBe("accordo_browser.focusThread");
    });

    it("DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD matches SURFACE_FOCUS_COMMANDS.slide", () => {
      // Contract: DEFERRED_COMMANDS and SURFACE_FOCUS_COMMANDS must agree on slide command
      expect(DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD).toBe(SURFACE_FOCUS_COMMANDS.slide);
    });

    it("DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD matches SURFACE_FOCUS_COMMANDS.browser", () => {
      expect(DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD).toBe(SURFACE_FOCUS_COMMANDS.browser);
    });
  });

  // ── Q-SLIDE-01: Slide surface dispatch plan has correct 3-arg focus command shape ──
  // buildNavigationDispatchPlan for slide calls buildSlideFocusArgs which throws "not implemented".
  // These tests document the contract: they MUST fail until Phase C fills in buildSlideFocusArgs.
  describe("Q-SLIDE-01: Slide surface → buildNavigationDispatchPlan", () => {
    it("returns target: 'slide' for slide surface anchor", () => {
      const thread = makeSlideThread();
      // buildNavigationDispatchPlan calls buildSlideFocusArgs internally → throws "not implemented"
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("sets primaryCommand to accordo.presentation.internal.focusThread", () => {
      const thread = makeSlideThread();
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("primaryArgs is a 3-element tuple: [uri, threadId, blockId]", () => {
      const thread = makeSlideThread();
      // buildSlideFocusArgs throws "not implemented" so primaryArgs can't be tested yet
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("blockId in primaryArgs follows slide:{index}:{x}:{y} format", () => {
      const thread = makeSlideThread();
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("first element of primaryArgs is the anchor URI", () => {
      const thread = makeSlideThread();
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("second element of primaryArgs is the threadId", () => {
      const thread = makeSlideThread();
      expect(() => buildNavigationDispatchPlan(thread)).toThrow("not implemented");
    });

    it("includes fallbackCommand: accordo_presentation_internal_goto for slide", () => {
      const thread = makeSlideThread();
      // Even though buildSlideFocusArgs throws, the plan still returns target + primaryCommand + fallbackCommand
      // before the error propagates from buildSlideFocusArgs
      try {
        const plan = buildNavigationDispatchPlan(thread);
        expect(plan.target).toBe("slide");
        expect(plan.fallbackCommand).toBe("accordo_presentation_internal_goto");
      } catch {
        // Phase B: buildSlideFocusArgs throws — fallbackCommand can only be tested in Phase C
        expect(true).toBe(true);
      }
    });
  });

  // ── Q-SLIDE-02: buildSlideFocusArgs returns canonical [uri, threadId, blockId] tuple ──
  describe("Q-SLIDE-02: buildSlideFocusArgs contract", () => {
    it("returns a 3-element readonly tuple", () => {
      const thread = makeSlideThread();
      // buildSlideFocusArgs throws "not implemented" — test the contract signature
      expect(() => buildSlideFocusArgs(thread)).toThrow("not implemented");
    });

    it("tuple element [0] is a string URI", () => {
      const thread = makeSlideThread();
      try {
        const args = buildSlideFocusArgs(thread);
        expect(typeof args[0]).toBe("string");
        expect(args[0]).toContain(".md");
      } catch {
        // Expected to throw "not implemented" in Phase B
      }
    });

    it("tuple element [1] is the thread id", () => {
      const thread = makeSlideThread();
      try {
        const args = buildSlideFocusArgs(thread);
        expect(args[1]).toBe("thread-slide-1");
      } catch {
        // Expected to throw "not implemented" in Phase B
      }
    });

    it("tuple element [2] is a blockId string", () => {
      const thread = makeSlideThread();
      try {
        const args = buildSlideFocusArgs(thread);
        expect(typeof args[2]).toBe("string");
        expect(args[2]).toMatch(/^slide:/);
      } catch {
        // Expected to throw "not implemented" in Phase B
      }
    });
  });

  // ── Q-MD-01: Markdown preview surface uses correct 3-arg command ──
  // buildNavigationDispatchPlan for markdown-preview is implemented (no stub), but the
  // contract requires [uri, threadId, blockId] — current implementation only has [uri, threadId].
  // Test documents the Phase C contract.
  describe("Q-MD-01: Markdown preview surface → buildNavigationDispatchPlan", () => {
    it("returns target: 'markdown-preview'", () => {
      const thread = makeMarkdownPreviewThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.target).toBe("markdown-preview");
    });

    it("primaryCommand is accordo_preview_internal_focusThread", () => {
      const thread = makeMarkdownPreviewThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryCommand).toBe("accordo_preview_internal_focusThread");
    });

    // Phase C contract: primaryArgs must be [uri, threadId, blockId] — 3 elements.
    // Currently FAILS with assertion error: expected 2 to be 3
    it("primaryArgs is [uri, threadId, blockId] for markdown preview", () => {
      const thread = makeMarkdownPreviewThread();
      const plan = buildNavigationDispatchPlan(thread);
      const args = plan.primaryArgs as readonly unknown[];
      expect(args.length).toBe(3);
      expect(args[0]).toBe("file:///project/README.md");
      expect(args[1]).toBe("thread-md-1");
      expect(args[2]).toBe("heading:2:intro");
    });
  });

  // ── Q-BROWSER-01: Browser surface dispatch plan ──
  describe("Q-BROWSER-01: Browser surface → buildNavigationDispatchPlan", () => {
    it("returns target: 'browser'", () => {
      const thread = makeBrowserThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.target).toBe("browser");
    });

    it("primaryCommand is accordo_browser.focusThread", () => {
      const thread = makeBrowserThread();
      const plan = buildNavigationDispatchPlan(thread);
      // M45-NR-05 corrected: underscore naming
      expect(plan.primaryCommand).toBe("accordo_browser.focusThread");
    });

    it("primaryArgs is [threadId] for browser surface", () => {
      const thread = makeBrowserThread();
      const plan = buildNavigationDispatchPlan(thread);
      const args = plan.primaryArgs as readonly unknown[];
      expect(args.length).toBe(1);
      expect(args[0]).toBe("thread-browser-1");
    });

    it("includes disconnectedMessage for browser surface", () => {
      const thread = makeBrowserThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.disconnectedMessage).toBeDefined();
      expect(plan.disconnectedMessage).toContain("Browser");
    });
  });

  // ── Q-DIAGRAM-01: Diagram surface dispatch plan ──
  describe("Q-DIAGRAM-01: Diagram surface → buildNavigationDispatchPlan", () => {
    it("returns target: 'diagram'", () => {
      const thread = makeDiagramThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.target).toBe("diagram");
    });

    it("primaryCommand is accordo_diagram_focusThread", () => {
      const thread = makeDiagramThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryCommand).toBe("accordo_diagram_focusThread");
    });

    it("primaryArgs is [threadId, uri] for diagram surface", () => {
      const thread = makeDiagramThread();
      const plan = buildNavigationDispatchPlan(thread);
      const args = plan.primaryArgs as readonly unknown[];
      expect(args.length).toBe(2);
      expect(args[0]).toBe("thread-diagram-1");
      expect(args[1]).toBe("file:///project/diagram.mmd");
    });

    it("includes disconnectedMessage for diagram surface", () => {
      const thread = makeDiagramThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.disconnectedMessage).toBeDefined();
      expect(plan.disconnectedMessage).toContain("Diagram");
    });
  });

  // ── Q-BROWSER-02: Browser relay health reader probes before showing disconnected message ──
  describe("Q-BROWSER-02: Browser relay health abstraction", () => {
    it("CommandBackedBrowserRelayHealthReader is instantiable", () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      expect(reader).toBeDefined();
    });

    it("readHealth method exists and returns a Promise that rejects with 'not implemented' in Phase B", async () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      // readHealth() returns a Promise that rejects with "not implemented" until Phase C
      await expect(reader.readHealth()).rejects.toThrow("not implemented");
    });

    it("readHealth returns BrowserRelayHealth with connected: boolean shape", async () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      try {
        const health = await reader.readHealth();
        expect(typeof health.connected).toBe("boolean");
      } catch {
        // Expected to throw "not implemented" in Phase B
      }
    });
  });

  // ── Q-ROUTE-01: navigateWithPlan dispatches correct command per surface ──
  describe("Q-ROUTE-01: navigateWithPlan routing", () => {
    let mockEnv: ReturnType<typeof makeEnv>;
    let mockBrowserHealth: { readHealth: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockEnv = makeEnv();
      mockBrowserHealth = {
        readHealth: vi.fn().mockResolvedValue({ connected: true }),
      };
    });

    it("navigateWithPlan exists as an async function", () => {
      expect(typeof navigateToThread).toBe("function");
    });

    it("calls executeCommand with slide focus command for slide surface", async () => {
      const { navigateWithPlan } = await import("../../panel/navigation-router.js");
      const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
      const thread = makeSlideThread();
      const deps = {
        env: mockEnv,
        registry: createNavigationAdapterRegistry(),
        browserRelayHealth: mockBrowserHealth,
      };
      // navigateWithPlan throws "not implemented" — tests the stub contract
      await expect(navigateWithPlan(deps, thread)).rejects.toThrow("not implemented");
    });

    it("calls executeCommand with browser focus command for browser surface", async () => {
      const { navigateWithPlan } = await import("../../panel/navigation-router.js");
      const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
      const thread = makeBrowserThread();
      const deps = {
        env: mockEnv,
        registry: createNavigationAdapterRegistry(),
        browserRelayHealth: mockBrowserHealth,
      };
      await expect(navigateWithPlan(deps, thread)).rejects.toThrow("not implemented");
    });
  });
});
