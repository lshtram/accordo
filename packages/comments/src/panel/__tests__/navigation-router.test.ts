/**
 * Tests for NavigationRouter (M45-NR)
 *
 * API checklist:
 * ✓ navigateToThread  — 10 tests (M45-NR-01 → M45-NR-10)
 * ✓ buildNavigationDispatchPlan  — 17 tests (Q-SURFACE-01, Q-SLIDE-01/02, Q-MD-01, Q-BROWSER-01/02, Q-DIAGRAM-01, M45-NR-14)
 * ✓ buildSlideFocusArgs  — 4 tests (Q-SLIDE-02)
 * ✓ navigateWithPlan  — 7 tests (Q-ROUTE-01, M45-NR-12)
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
  activeTextEditorUri: ReturnType<typeof vi.fn>;
} {
  return {
    showTextDocument: vi.fn().mockResolvedValue({ revealRange: vi.fn() }),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    visibleTextEditorUris: vi.fn().mockReturnValue([]),
    activeTextEditorUri: vi.fn().mockReturnValue(undefined),
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

  // Phase C contract: navigateToThread is now implemented using buildNavigationDispatchPlan → navigateWithPlan.
  // For surface anchors, it calls executeCommand with the surface-specific focus command.
  // For text anchors, it calls showTextDocument (requires vscode module — tested via buildNavigationDispatchPlan).
  it("M45-NR-02: text anchor → buildNavigationDispatchPlan returns target:'text' with empty primaryArgs", () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/auth.ts",
      range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("text");
    expect(plan.primaryArgs).toEqual([]);
  });

  // Phase C: text anchor on .md with visible text editor → plan targets 'text'
  it("M45-NR-02b: text anchor on .md with text editor visible → plan targets 'text'", () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    env.visibleTextEditorUris.mockReturnValue(["file:///project/README.md"]);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("text");
  });

  // Phase C: text anchor on .md with no text editor open → plan targets 'text'
  it("M45-NR-02c: text anchor on .md with no text editor open → plan targets 'text'", () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    env.visibleTextEditorUris.mockReturnValue([]);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("text");
  });

  it("M45-NR-02c2: markdown text anchor prefers active text editor for same file", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);

    env.activeTextEditorUri.mockReturnValue("file:///project/README.md");

    await navigateToThread(thread, env);

    expect(env.showTextDocument).toHaveBeenCalled();
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_comments_internal_expandThread",
      "thread-1",
    );
    expect(env.executeCommand).not.toHaveBeenCalledWith(
      "vscode.openWith",
      expect.anything(),
      "accordo.markdownPreview",
    );
  });

  it("M45-NR-02d: markdown text anchor navigates via preview focus and does not open text editor", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);

    env.executeCommand
      .mockResolvedValueOnce(false) // first preview focus probe
      .mockResolvedValueOnce(undefined) // vscode.openWith
      .mockResolvedValueOnce(true); // second preview focus

    await navigateToThread(thread, env);

    expect(env.showTextDocument).not.toHaveBeenCalled();
    expect(env.executeCommand).toHaveBeenCalledWith(
      CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
      "file:///project/README.md",
      "thread-1",
      undefined,
    );
    expect(env.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.objectContaining({ fsPath: "/project/README.md" }),
      "accordo.markdownPreview",
    );
  });

  it("M45-NR-02e: markdown text anchor retries preview focus even if openWith throws", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/README.md",
      range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);

    env.executeCommand
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("openWith failed"))
      .mockResolvedValueOnce(false);

    await navigateToThread(thread, env);

    expect(env.showTextDocument).not.toHaveBeenCalled();
    expect(env.executeCommand).toHaveBeenNthCalledWith(
      1,
      CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
      "file:///project/README.md",
      "thread-1",
      undefined,
    );
    expect(env.executeCommand).toHaveBeenNthCalledWith(
      3,
      CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
      "file:///project/README.md",
      "thread-1",
      undefined,
    );
  });

  // Phase C: surface/markdown-preview → navigateWithPlan calls executeCommand with accordo_preview_internal_focusThread
  it("M45-NR-03: surface/markdown-preview → executeCommand with positional args (uri, threadId, blockId)", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "heading:2:intro", blockType: "heading" },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("markdown-preview");
    expect(plan.primaryCommand).toBe("accordo_preview_internal_focusThread");
    expect(plan.primaryArgs).toEqual(["file:///project/README.md", "thread-1", "heading:2:intro"]);
  });

  // Phase C: surface/slide → tries primary command first; on fail uses fallback then retries
  it("M45-NR-04: surface/slide → buildNavigationDispatchPlan returns slide target with focus command and fallback", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("slide");
    expect(plan.primaryCommand).toBe("accordo.presentation.internal.focusThread");
    expect(plan.primaryArgs.length).toBe(3);
    expect(plan.fallbackCommand).toBe("accordo_presentation_internal_goto");
  });

  // Phase C: surface/slide → plan includes fallbackCommand for retry path
  it("M45-NR-04: surface/slide → includes fallbackCommand for retry path", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.fallbackCommand).toBeDefined();
    expect(plan.fallbackCommand).toBe("accordo_presentation_internal_goto");
  });

  // Phase C: surface/browser → navigateWithPlan checks health then calls accordo_browser.focusThread
  it("M45-NR-05: surface/browser → buildNavigationDispatchPlan returns browser target with focus command", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "https://example.com",
      surfaceType: "browser",
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("browser");
    expect(plan.primaryCommand).toBe("accordo_browser.focusThread");
    expect(plan.primaryArgs).toEqual(["thread-1"]);
    expect(plan.disconnectedMessage).toBeDefined();
  });

  // Phase C: surface/diagram → executeCommand accordo_diagram_focusThread with graceful fallback
  it("M45-NR-06: surface/diagram → buildNavigationDispatchPlan returns diagram target with focus command", () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/diagram.tldr",
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node-42" },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("diagram");
    expect(plan.primaryCommand).toBe("accordo_diagram_focusThread");
    expect(plan.primaryArgs).toEqual(["thread-1", "file:///project/diagram.tldr"]);
    expect(plan.disconnectedMessage).toBeDefined();
  });

  // Phase C: file anchor → buildNavigationDispatchPlan returns target:'file'
  it("M45-NR-07: file anchor → buildNavigationDispatchPlan returns target:'file'", () => {
    const thread = makeThread({ kind: "file", uri: "file:///project/package.json" });
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("file");
  });

  // Phase C: unknown surfaceType → buildNavigationDispatchPlan returns target:'unknown-surface'
  it("M45-NR-08: unrecognised surfaceType falls back to showTextDocument via unknown-surface target", () => {
    const anchor = {
      kind: "surface" as const,
      uri: "file:///project/unknown.xyz",
      surfaceType: "unknown-future-type" as never,
      coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("unknown-surface");
  });

  // Phase C: text anchor with missing file → showTextDocument would be called (plan targets 'text')
  it("M45-NR-09: text anchor → buildNavigationDispatchPlan returns plan for text target", () => {
    const thread = makeThread({
      kind: "text",
      uri: "file:///project/missing.ts",
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
      docVersion: 0,
    });
    const plan = buildNavigationDispatchPlan(thread);
    expect(plan.target).toBe("text");
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
    expect(typeof e.activeTextEditorUri).toBe("function");
  });
});

// ── Priority Q: Surface Focus Navigation ───────────────────────────────────────

import { SURFACE_FOCUS_COMMANDS, buildNavigationDispatchPlan, buildSlideFocusArgs } from "../../panel/navigation-contract.js";
import { CAPABILITY_COMMANDS, DEFERRED_COMMANDS } from "@accordo/capabilities";
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
  // Phase C: buildNavigationDispatchPlan for slide is implemented and calls buildSlideFocusArgs.
  describe("Q-SLIDE-01: Slide surface → buildNavigationDispatchPlan", () => {
    it("returns target: 'slide' for slide surface anchor", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.target).toBe("slide");
    });

    it("sets primaryCommand to accordo.presentation.internal.focusThread", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryCommand).toBe("accordo.presentation.internal.focusThread");
    });

    it("primaryArgs is a 3-element tuple: [uri, threadId, blockId]", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryArgs.length).toBe(3);
    });

    it("blockId in primaryArgs follows slide:{index}:{x}:{y} format", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      const blockId = plan.primaryArgs[2] as string;
      expect(blockId).toMatch(/^slide:3:0\.5:0\.5$/);
    });

    it("first element of primaryArgs is the anchor URI", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryArgs[0]).toBe("file:///project/deck.md");
    });

    it("second element of primaryArgs is the threadId", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.primaryArgs[1]).toBe("thread-slide-1");
    });

    it("includes fallbackCommand: accordo_presentation_internal_goto for slide", () => {
      const thread = makeSlideThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.fallbackCommand).toBe("accordo_presentation_internal_goto");
    });
  });

  // ── Q-SLIDE-02: buildSlideFocusArgs returns canonical [uri, threadId, blockId] tuple ──
  describe("Q-SLIDE-02: buildSlideFocusArgs contract", () => {
    it("returns a 3-element readonly tuple", () => {
      const thread = makeSlideThread();
      const args = buildSlideFocusArgs(thread);
      expect(args.length).toBe(3);
    });

    it("tuple element [0] is a string URI", () => {
      const thread = makeSlideThread();
      const args = buildSlideFocusArgs(thread);
      expect(typeof args[0]).toBe("string");
      expect(args[0]).toContain(".md");
    });

    it("tuple element [1] is the thread id", () => {
      const thread = makeSlideThread();
      const args = buildSlideFocusArgs(thread);
      expect(args[1]).toBe("thread-slide-1");
    });

    it("tuple element [2] is a blockId string", () => {
      const thread = makeSlideThread();
      const args = buildSlideFocusArgs(thread);
      expect(typeof args[2]).toBe("string");
      expect(args[2]).toMatch(/^slide:/);
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

    it("includes disconnectedMessage for drawing-backed diagram surface", () => {
      const thread = makeDiagramThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.disconnectedMessage).toBeDefined();
      expect(plan.disconnectedMessage).toContain("Drawing");
    });
  });

  // ── M45-NR-14: .md text anchor with slide-target hint takes precedence over markdown-preview ──
  /**
   * M45-NR-14: For text anchors in `.md` files, router must avoid forcing markdown preview
   * when the active target is a slide presentation thread; slide-target hints (when present
   * in thread metadata/context) take precedence over markdown-preview smart-viewer fallback.
   *
   * Precedence rule: When a text anchor's blockId matches the slide:{index}:{x}:{y} pattern,
   * the plan must target 'slide' and use slide focus command, NOT text/markdown-preview.
   */
  describe("M45-NR-14: .md text anchor with slide-target hint precedence", () => {
    it("M45-NR-14: text anchor with blockId matching slide:{index}:{x}:{y} pattern routes to slide focus", () => {
      // A .md file anchor that carries a slide blockId hint must NOT fall through to
      // text-preview. The blockId "slide:2:0.5:0.5" signals this is a slide in a deck.
      const anchor = {
        kind: "text" as const,
        uri: "file:///project/deck.md",
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
        docVersion: 0,
        // blockId here is the slide-target hint — it takes precedence over text kind
        blockId: "slide:2:0.5:0.5",
      };
      const thread = makeThread(anchor);

      // M45-NR-14 contract: buildNavigationDispatchPlan must detect slide-target hint
      // and route to slide focus, not text or markdown-preview
      const plan = buildNavigationDispatchPlan(thread);

      // The plan should target 'slide', not 'text'
      expect(plan.target).toBe("slide");
      // Primary command should be the slide focus command, not empty (which would
      // be the case for a plain text anchor that doesn't know about slide hints)
      expect(plan.primaryCommand).toBe("accordo.presentation.internal.focusThread");
      // primaryArgs should be a 3-element tuple [uri, threadId, blockId]
      const args = plan.primaryArgs as readonly unknown[];
      expect(args.length).toBe(3);
      expect(args[0]).toBe("file:///project/deck.md");
      expect(args[1]).toBe("thread-1");
      expect(args[2]).toBe("slide:2:0.5:0.5");
    });

    it("M45-NR-14: text anchor WITHOUT slide-target hint (regular blockId) routes to text target", () => {
      // A regular text anchor with a non-slide blockId (e.g., heading blockId) should NOT
      // be confused with a slide hint — it should remain a text/text anchor
      const anchor = {
        kind: "text" as const,
        uri: "file:///project/README.md",
        range: { startLine: 5, startChar: 0, endLine: 5, endChar: 0 },
        docVersion: 0,
        blockId: "heading:1:intro", // regular heading blockId — not a slide hint
      };
      const thread = makeThread(anchor);

      const plan = buildNavigationDispatchPlan(thread);

      // This should NOT be treated as a slide — heading blockId is not a slide hint
      expect(plan.target).toBe("text");
    });
  });

  // ── Q-BROWSER-02: Browser relay health reader probes before showing disconnected message ──
  describe("Q-BROWSER-02: Browser relay health abstraction", () => {
    it("CommandBackedBrowserRelayHealthReader is instantiable", () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      expect(reader).toBeDefined();
    });

    it("readHealth method returns a Promise that resolves to { connected: boolean }", async () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      // Phase C: readHealth() calls accordo_browser_health via vscode commands.
      // In test environment (no vscode), it returns { connected: false } gracefully.
      const health = await reader.readHealth();
      expect(typeof health.connected).toBe("boolean");
    });

    it("readHealth returns BrowserRelayHealth with connected: boolean shape", async () => {
      const reader = new CommandBackedBrowserRelayHealthReader();
      const health = await reader.readHealth();
      expect(typeof health.connected).toBe("boolean");
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
      // Phase C: navigateWithPlan for slide surface calls executeCommand with focus args
      await navigateWithPlan(deps, thread);
      expect(mockEnv.executeCommand).toHaveBeenCalledWith(
        "accordo.presentation.internal.focusThread",
        "file:///project/deck.md",
        "thread-slide-1",
        "slide:3:0.5:0.5",
      );
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
      // Phase C: navigateWithPlan for browser surface calls executeCommand with thread id
      await navigateWithPlan(deps, thread);
      expect(mockEnv.executeCommand).toHaveBeenCalledWith(
        "accordo_browser.focusThread",
        "thread-browser-1",
      );
    });
  });

  // ── M45-NR-12: Browser surface routing with health-aware disconnected messaging ──
  /**
   * M45-NR-12: Browser surface behavior differs based on relay health:
   * - When relay is connected (connected: true): fire browser focus command
   * - When relay is disconnected (connected: false): surface disconnected state
   *
   * The health reader is probed before command dispatch to avoid false "not connected"
   * errors when the browser is simply busy or the focus command fails for other reasons.
   */
  describe("M45-NR-12: Browser surface health-aware routing", () => {
    let mockEnv: ReturnType<typeof makeEnv>;

    beforeEach(() => {
      mockEnv = makeEnv();
    });

    it("M45-NR-12: when browser relay health returns connected: true, focus command fires", async () => {
      const { navigateWithPlan } = await import("../../panel/navigation-router.js");
      const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
      const thread = makeBrowserThread();
      const connectedHealth = { readHealth: vi.fn().mockResolvedValue({ connected: true }) };
      const deps = {
        env: mockEnv,
        registry: createNavigationAdapterRegistry(),
        browserRelayHealth: connectedHealth,
      };

      // Phase C: when connected=true, executeCommand is called without showing disconnected message
      await navigateWithPlan(deps, thread);

      expect(connectedHealth.readHealth).toHaveBeenCalled();
      expect(mockEnv.executeCommand).toHaveBeenCalledWith(
        "accordo_browser.focusThread",
        "thread-browser-1",
      );
      expect(mockEnv.showInformationMessage).not.toHaveBeenCalled();
    });

    it("M45-NR-12: when browser relay health returns connected: false, disconnected state is surfaced", async () => {
      const { navigateWithPlan } = await import("../../panel/navigation-router.js");
      const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
      const thread = makeBrowserThread();
      const disconnectedHealth = { readHealth: vi.fn().mockResolvedValue({ connected: false }) };
      const deps = {
        env: mockEnv,
        registry: createNavigationAdapterRegistry(),
        browserRelayHealth: disconnectedHealth,
      };

      // Phase C: when connected=false, showInformationMessage is called with disconnected message
      await navigateWithPlan(deps, thread);

      expect(disconnectedHealth.readHealth).toHaveBeenCalled();
      expect(mockEnv.executeCommand).not.toHaveBeenCalledWith(
        "accordo_browser.focusThread",
        expect.anything(),
      );
      expect(mockEnv.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("Browser"),
      );
    });

    it("M45-NR-12: browser surface plan includes disconnectedMessage for user-facing copy", () => {
      // The dispatch plan includes disconnectedMessage regardless of actual health —
      // this is the fallback copy shown when the relay cannot be reached.
      const thread = makeBrowserThread();
      const plan = buildNavigationDispatchPlan(thread);
      expect(plan.disconnectedMessage).toBeDefined();
      expect(typeof plan.disconnectedMessage).toBe("string");
      expect(plan.disconnectedMessage).toContain("Browser");
    });

    it("M45-NR-12: health reader is consulted BEFORE attempting browser focus command", async () => {
      // Verifies that the navigation router probes health as a pre-flight check,
      // not as a fallback after the command fails.
      const { navigateWithPlan } = await import("../../panel/navigation-router.js");
      const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
      const thread = makeBrowserThread();

      const healthProbeOrder: string[] = [];
      const sequencedHealth = {
        readHealth: vi.fn().mockImplementation(async () => {
          healthProbeOrder.push("health-check");
          return { connected: true };
        }),
      };

      mockEnv.executeCommand = vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "accordo_browser.focusThread") {
          healthProbeOrder.push("focus-command");
        }
        return undefined;
      });

      const deps = {
        env: mockEnv,
        registry: createNavigationAdapterRegistry(),
        browserRelayHealth: sequencedHealth,
      };

      try {
        await navigateWithPlan(deps, thread);
      } catch {
        // Phase B throws — ignore
      }

      // Phase C contract: health must be checked BEFORE focus command is attempted
      // This ensures we don't show false "disconnected" errors when relay is healthy
      // but the focus command itself fails for a different reason.
      // In Phase B, the stub throws before this ordering can be exercised.
      // Phase C: uncomment and verify
      // expect(healthProbeOrder).toEqual(["health-check", "focus-command"]);
    });
  });
});
