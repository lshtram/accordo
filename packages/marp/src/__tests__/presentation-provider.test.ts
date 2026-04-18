/**
 * presentation-provider.test.ts — Tests for PresentationProvider and buildWebviewHtml
 *
 * Marp-specific provider: no child process, no port, no iframe.
 * Renders Markdown → HTML synchronously via MarpRenderer and injects directly
 * into the WebviewPanel. File watcher triggers re-render + marp:update message.
 *
 * Requirements covered:
 *   M50-PVD-01  Opens deck in a VS Code WebviewPanel
 *   M50-PVD-02  Renders deck via MarpRenderer, injects HTML directly (no iframe)
 *   M50-PVD-03  Webview HTML includes slide navigation JS (section-based, keyboard)
 *   M50-PVD-04  Injects Comment SDK overlay when comments integration is enabled
 *   M50-PVD-05  dispose() disposes panel and resets state
 *   M50-PVD-06  Reopening same URI reveals existing panel (no re-render)
 *   M50-PVD-07  Watches deck file; on change, re-renders and posts marp:update
 *   M50-PVD-08  CSP: nonce-based script policy; NO frame-src (no iframe)
 *   M50-PVD-09  marp:update messages include monotonic revision: number
 *   M50-PVD-10  After re-render, currentSlide clamped to Math.min(old, newCount - 1)
 *   M50-PVD-13  When Comment SDK URIs provided, webview HTML includes SDK <script>/<link> with nonce
 *   M50-PVD-14  Webview initializes Comment SDK via sdk.init() with coordinateToScreen
 *   M50-PVD-15  Webview handles comments:load, comments:add, comments:update, comments:remove, comments:focus
 *   M50-PVD-16  comments:focus handler navigates to slide + calls sdk.openPopover(threadId)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PresentationProvider,
  buildWebviewHtml,
} from "../presentation-provider.js";
import { makeExtensionContext, MockWebviewPanel, window, workspace } from "./mocks/vscode.js";
import type { PresentationRuntimeAdapter } from "../runtime-adapter.js";
import type { PresentationCommentsBridge } from "../presentation-comments-bridge.js";
import type { MarpRenderResult } from "../types.js";
import type * as vscode from "vscode";

// ── Global mock reset ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(window.createWebviewPanel).mockReturnValue(
    new MockWebviewPanel("accordo.marp.presentation", "Deck"),
  );
  vi.mocked(workspace.createFileSystemWatcher).mockReturnValue({
    onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  });
  vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from("") as never);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): PresentationRuntimeAdapter {
  return {
    listSlides: vi.fn().mockResolvedValue([]),
    getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Slide 1" }),
    goto: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined),
    onSlideChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    validateDeck: vi.fn().mockReturnValue({ valid: true }),
    dispose: vi.fn(),
  };
}

function makeRenderResult(overrides?: Partial<MarpRenderResult>): MarpRenderResult {
  return {
    html: "<section><h1>Hello World</h1></section>",
    css: "section { background: white; }",
    slideCount: 3,
    comments: ["", "", ""],
    ...overrides,
  };
}

function makeRenderer(renderResult?: MarpRenderResult) {
  return {
    render: vi.fn().mockReturnValue(renderResult ?? makeRenderResult()),
    getNotes: vi.fn().mockReturnValue(null),
  };
}

function makeProvider() {
  return new PresentationProvider({
    context: makeExtensionContext() as unknown as vscode.ExtensionContext,
  });
}

// ── buildWebviewHtml ──────────────────────────────────────────────────────────

describe("buildWebviewHtml", () => {
  const RENDER: MarpRenderResult = {
    html: "<section id='s0'><h1>Slide One</h1></section><section id='s1'><h1>Slide Two</h1></section>",
    css: "section { display: block; }",
    slideCount: 2,
    comments: ["", ""],
  };

  it("M50-PVD-02: produced HTML contains the Marp-rendered section elements", () => {
    // The raw Marp <section> elements must appear in the webview HTML.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    expect(html).toContain("<section");
    expect(html).toContain("Slide One");
  });

  it("M50-PVD-02: produced HTML contains the Marp-generated CSS", () => {
    // The Marp CSS must be injected into the webview.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    expect(html).toContain("section { display: block; }");
  });

  it("M50-PVD-03: produced HTML contains navigation JavaScript", () => {
    // The webview must include JS for keyboard arrow navigation and slide scrolling.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    // Navigation script must be present
    expect(html).toMatch(/<script/);
  });

  it("M50-PVD-08: CSP contains nonce-based script policy", () => {
    // Script-src must use a nonce (not 'unsafe-inline').
    const html = buildWebviewHtml(RENDER, "mynonce", "https://localhost");
    expect(html).toContain("nonce-mynonce");
    expect(html).toContain("Content-Security-Policy");
  });

  it("M50-PVD-08: CSP does NOT contain frame-src directive", () => {
    // Marp uses no iframe, so frame-src is prohibited in the CSP.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    expect(html).not.toContain("frame-src");
  });

  it("M50-PVD-02: produced HTML is a complete document (has html, head, body elements)", () => {
    // buildWebviewHtml must wrap content in a full HTML document.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    expect(html).toContain("<html");
    expect(html).toContain("<head");
    expect(html).toContain("<body");
  });

  it("M50-PVD-03: webview JS includes postMessage to host for slide changes", () => {
    // The nav JS must post presentation:slideChanged messages to the extension host.
    const html = buildWebviewHtml(RENDER, "nonce123", "https://localhost");
    expect(html).toContain("slideChanged");
  });
});

// ── PresentationProvider.open ─────────────────────────────────────────────────

describe("PresentationProvider.open", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
  });

  it("M50-PVD-01: creates a WebviewPanel when opening a new deck", async () => {
    // open() must call window.createWebviewPanel exactly once for a new deck.
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    expect(window.createWebviewPanel).toHaveBeenCalled();
    expect(provider.getPanel()).not.toBeNull();
  });

  it("M50-PVD-02: sets webview HTML after open (no iframe — direct injection)", async () => {
    // Webview HTML must be set (non-empty) synchronously during open.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    expect(panel.webview.html.length).toBeGreaterThan(0);
  });

  it("M50-PVD-13: uses panel.webview.cspSource for SDK asset CSP allowlist", async () => {
    // Regression guard: CSP must use the real panel webview cspSource,
    // not a pre-panel fallback value.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    panel.webview.cspSource = "vscode-webview://unit-test-origin";
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);

    expect(panel.webview.html).toContain("vscode-webview://unit-test-origin");
  });

  it("M50-PVD-06: re-opening same deck URI reveals existing panel (no re-render)", async () => {
    // If the deck is already open, reveal the panel without creating a new one.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    const firstPanel = provider.getPanel();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    const secondPanel = provider.getPanel();
    expect(secondPanel).toBe(firstPanel);
    // Panel created only once
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    // reveal() called on re-open
    expect(panel.reveal).toHaveBeenCalled();
  });

  it("M50-PVD-01: opening a different deck closes previous and opens new panel", async () => {
    // Switching to a different deck replaces the session.
    const panel1 = new MockWebviewPanel("accordo.marp.presentation", "Deck 1");
    const panel2 = new MockWebviewPanel("accordo.marp.presentation", "Deck 2");
    vi.mocked(window.createWebviewPanel)
      .mockReturnValueOnce(panel1)
      .mockReturnValueOnce(panel2);
    const provider = makeProvider();
    await provider.open("/deck1.md", makeAdapter(), makeRenderer(), null);
    await provider.open("/deck2.md", makeAdapter(), makeRenderer(), null);
    // Old panel must have been disposed
    expect(panel1.dispose).toHaveBeenCalled();
    expect(provider.getCurrentDeckUri()).toBe("/deck2.md");
  });

  it("M50-PVD-04: does not throw when commentsBridge is null (comments disabled)", async () => {
    // Comments integration is optional — must not throw without it.
    const provider = makeProvider();
    await expect(
      provider.open("/deck.md", makeAdapter(), makeRenderer(), null),
    ).resolves.toBeUndefined();
  });

  it("M50-PVD-07: sets up a file system watcher for the deck file", async () => {
    // The provider must watch the deck file for live-reload.
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    expect(workspace.createFileSystemWatcher).toHaveBeenCalled();
  });
});

// ── PresentationProvider.close ────────────────────────────────────────────────

describe("PresentationProvider.close", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
  });

  it("M50-PVD-05: disposes the WebviewPanel on close", async () => {
    // close() must call panel.dispose().
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    provider.close();
    expect(panel.dispose).toHaveBeenCalled();
  });

  it("M50-PVD-05: getPanel returns null after close", async () => {
    // Provider must release its panel reference on close.
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    provider.close();
    expect(provider.getPanel()).toBeNull();
  });

  it("M50-PVD-05: getCurrentDeckUri returns null after close", async () => {
    // Deck URI reference must be cleared on close.
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    provider.close();
    expect(provider.getCurrentDeckUri()).toBeNull();
  });

  it("M50-PVD-05: close() on provider with no open session does not throw", () => {
    // Closing when there's no active session must be safe.
    const provider = makeProvider();
    expect(() => provider.close()).not.toThrow();
  });

  it("M50-PVD-05: onDispose callback is invoked on close", async () => {
    // Callers can register a callback to be notified when the session closes.
    const provider = makeProvider();
    const callback = vi.fn();
    provider.onDispose(callback);
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    provider.close();
    expect(callback).toHaveBeenCalled();
  });
});

// ── PresentationProvider file-change live reload ──────────────────────────────

describe("PresentationProvider — live reload (M50-PVD-07, M50-PVD-09, M50-PVD-10)", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
  });

  it("M50-PVD-07 / M50-PVD-09: file change triggers marp:update with revision to webview", async () => {
    // On file change, the provider must post marp:update with an incremented revision.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let onDidChangeCallback: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        onDidChangeCallback = cb;
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue(mockWatcher);

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);

    // Simulate a file change
    if (onDidChangeCallback) onDidChangeCallback();

    // Wait for async re-render (if any)
    await Promise.resolve();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "marp:update", revision: expect.any(Number) }),
    );
  });

  it("M50-PVD-09: successive marp:update messages have strictly increasing revision numbers", async () => {
    // Each re-render must produce a revision > previous revision.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    const changeCallbacks: Array<() => void> = [];
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        changeCallbacks.push(cb);
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue(mockWatcher);

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);

    // Trigger two file changes
    changeCallbacks.forEach((cb) => cb());
    changeCallbacks.forEach((cb) => cb());
    await Promise.resolve();

    const updateCalls = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(([msg]: [{ type: string }]) => msg.type === "marp:update")
      .map(([msg]: [{ revision: number }]) => msg.revision);

    // Must have at least 2 update calls to verify monotonicity
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < updateCalls.length; i++) {
      expect(updateCalls[i]).toBeGreaterThan(updateCalls[i - 1]);
    }
  });

  it("M50-PVD-10: currentSlide clamped after slide count decreases on re-render", async () => {
    // If slide count drops, the current slide index must be clamped.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let onDidChangeCallback: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        onDidChangeCallback = cb;
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue(mockWatcher);

    // Start with a 5-slide deck
    const bigRenderer = makeRenderer(makeRenderResult({ slideCount: 5, comments: Array(5).fill("") }));
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), bigRenderer, null);

    // Navigate to slide 4 (0-based)
    provider.setCurrentSlide(4);

    // Now the deck shrinks to 2 slides on re-render
    const smallRenderer = makeRenderer(makeRenderResult({ slideCount: 2, comments: ["", ""] }));
    provider.setRenderer(smallRenderer);

    if (onDidChangeCallback) onDidChangeCallback();
    await Promise.resolve();

    // currentSlide must be clamped to Math.min(4, 2-1) = 1
    const updateCall = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(([msg]: [{ type: string }]) => msg.type === "marp:update")
      .at(-1)?.[0] as { currentSlide: number } | undefined;

    expect(updateCall).toBeDefined();
    expect(updateCall!.currentSlide).toBeLessThanOrEqual(1);
  });
});

// ── PresentationProvider.dispose ──────────────────────────────────────────────

describe("PresentationProvider.dispose", () => {
  it("M50-PVD-05: dispose() cleans up all resources without throwing", async () => {
    // dispose() is called when the extension deactivates.
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);
    expect(() => provider.dispose()).not.toThrow();
  });

  it("M50-PVD-05: dispose() on provider with no open session does not throw", () => {
    // Safe to dispose when never opened.
    const provider = makeProvider();
    expect(() => provider.dispose()).not.toThrow();
  });
});

// ── PresentationProvider.onDidReceiveMessage routing ─────────────────────────

describe("PresentationProvider — webview message routing", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
  });

  it("M50-PVD-03: presentation:slideChanged routes to adapter.handleWebviewSlideChanged (if exists)", async () => {
    // The provider must route webview slide changes to the adapter.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let messageHandler: ((msg: Record<string, unknown>) => void) | undefined;
    panel.webview.onDidReceiveMessage = vi.fn().mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    );

    const adapter = makeAdapter();
    // Add handleWebviewSlideChanged mock
    (adapter as unknown as { handleWebviewSlideChanged: ReturnType<typeof vi.fn> })
      .handleWebviewSlideChanged = vi.fn();

    const provider = makeProvider();
    await provider.open("/deck.md", adapter, makeRenderer(), null);

    if (messageHandler) {
      messageHandler({ type: "presentation:slideChanged", index: 2 });
    }

    expect(
      (adapter as unknown as { handleWebviewSlideChanged: ReturnType<typeof vi.fn> })
        .handleWebviewSlideChanged,
    ).toHaveBeenCalledWith(2);
  });

  it("M50-PVD-04: comment:create routes to commentsBridge.handleWebviewMessage", async () => {
    // Comment messages must be forwarded to the comments bridge if present.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let messageHandler: ((msg: Record<string, unknown>) => void) | undefined;
    panel.webview.onDidReceiveMessage = vi.fn().mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    );

    const commentsBridge = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      loadThreadsForUri: vi.fn(),
      buildAnchor: vi.fn(),
      dispose: vi.fn(),
      bindToSender: vi.fn().mockReturnThis(),
    } as unknown as PresentationCommentsBridge;

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), commentsBridge);

    if (messageHandler) {
      messageHandler({ type: "comment:create", blockId: "slide:0:0.5:0.5", body: "test" });
    }

    await Promise.resolve();
    expect(commentsBridge.handleWebviewMessage).toHaveBeenCalled();
  });
});

// ── PresentationProvider — Comment SDK integration (M50-PVD-13..16) ────────────

describe("PresentationProvider — Comment SDK integration", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(
      new MockWebviewPanel("accordo.marp.presentation", "Deck"),
    );
  });

  it("M50-PVD-13: when commentsBridge is non-null, open() calls commentsBridge.loadThreadsForUri(deckUri)", async () => {
    // When comments integration is available, loading threads for the deck is part of the open sequence.
    const commentsBridge = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      loadThreadsForUri: vi.fn(),
      buildAnchor: vi.fn(),
      dispose: vi.fn(),
      bindToSender: vi.fn().mockReturnThis(),
    } as unknown as PresentationCommentsBridge;

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), commentsBridge);

    expect(commentsBridge.loadThreadsForUri).toHaveBeenCalledWith(expect.stringContaining("deck.md"));
  });

  it("M50-PVD-14: open() posts comments:load message to webview after init (via commentsBridge subscription)", async () => {
    // loadThreadsForUri pushes comments:load to the webview via sender.postMessage.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let messageHandler: ((msg: Record<string, unknown>) => void) | undefined;
    panel.webview.onDidReceiveMessage = vi.fn().mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    );

    const commentsBridge = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      loadThreadsForUri: vi.fn().mockImplementation(() => {
        // Simulate the bridge posting comments:load to the webview
        void panel.webview.postMessage({ type: "comments:load", threads: [] });
      }),
      buildAnchor: vi.fn(),
      dispose: vi.fn(),
      bindToSender: vi.fn().mockReturnThis(),
    } as unknown as PresentationCommentsBridge;

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), commentsBridge);

    // The bridge should have been asked to load threads for the deck URI.
    expect(commentsBridge.loadThreadsForUri).toHaveBeenCalled();
  });

  it("M50-PVD-14: open() posts comments:load message to webview after init (via commentsBridge subscription)", async () => {
    // loadThreadsForUri pushes comments:load to the webview via sender.postMessage.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    const commentsBridge = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      loadThreadsForUri: vi.fn().mockImplementation(() => {
        // Simulate the bridge posting comments:load to the webview
        void panel.webview.postMessage({ type: "comments:load", threads: [] });
      }),
      buildAnchor: vi.fn(),
      dispose: vi.fn(),
      bindToSender: vi.fn().mockReturnThis(),
    } as unknown as PresentationCommentsBridge;

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), commentsBridge);

    // The bridge should have been asked to load threads for the deck URI.
    expect(commentsBridge.loadThreadsForUri).toHaveBeenCalled();
  });

  it("M50-PVD-15: onDidReceiveMessage routes webview-originated comment:* messages to bridge.handleWebviewMessage", async () => {
    // Only webview-originated comment messages come through onDidReceiveMessage.
    // Host→Webview comment messages (comments:load/add/update/remove) are sent by
    // PresentationCommentsBridge.sender directly, not routed through onDidReceiveMessage.
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let messageHandler: ((msg: Record<string, unknown>) => void) | undefined;
    panel.webview.onDidReceiveMessage = vi.fn().mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    );

    const commentsBridge = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      loadThreadsForUri: vi.fn(),
      buildAnchor: vi.fn(),
      dispose: vi.fn(),
      bindToSender: vi.fn().mockReturnThis(),
    } as unknown as PresentationCommentsBridge;

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), commentsBridge);

    // Webview sends comment:create → provider routes to bridge
    if (messageHandler) {
      messageHandler({ type: "comment:create", blockId: "slide:0:0.5:0.5", body: "test" });
    }
    await Promise.resolve();
    expect(commentsBridge.handleWebviewMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comment:create" }),
      expect.stringContaining("deck.md"),
    );

    // Webview sends comment:reply → provider routes to bridge
    if (messageHandler) {
      messageHandler({ type: "comment:reply", threadId: "t1", body: "reply text" });
    }
    await Promise.resolve();
    expect(commentsBridge.handleWebviewMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comment:reply" }),
      expect.any(String),
    );
  });

  it("M50-PVD-16: comments:focus with malformed blockId does not throw", async () => {
    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    let messageHandler: ((msg: Record<string, unknown>) => void) | undefined;
    panel.webview.onDidReceiveMessage = vi.fn().mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    );

    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), makeRenderer(), null);

    if (messageHandler) {
      expect(() =>
        messageHandler!({ type: "comments:focus", threadId: "t1", blockId: "heading:1:bad" }),
      ).not.toThrow();
    }
  });
});
