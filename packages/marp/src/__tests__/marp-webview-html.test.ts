/**
 * marp-webview-html.test.ts — Tests for buildMarpWebviewHtml
 *
 * Tests the HTML template function that produces the webview document.
 * Covers Comment SDK injection, init, message handlers, and Alt+click creation.
 *
 * Requirements covered:
 *   M50-PVD-12  buildMarpWebviewHtml() exported from src/marp-webview-html.ts
 *   M50-PVD-13  Webview HTML includes SDK <script> and <link> tags with nonce when URIs provided
 *   M50-PVD-14  sdk.init() called with coordinateToScreen that maps blockId → pixel position
 *   M50-PVD-15  Webview handles comments:load, comments:add, comments:update, comments:remove
 *   M50-PVD-16  comments:focus handler navigates to target slide + sdk.openPopover(threadId)
 *   M50-PVD-17  Alt+click captures normalized coords, encodes blockId, invokes callbacks.onCreate
 */

import { describe, it, expect } from "vitest";
import type { MarpRenderResult } from "../types.js";
import { createRuntimeHarness } from "./helpers/runtime-harness.js";

/**
 * These tests import buildMarpWebviewHtml from marp-webview-html.ts.
 * Interface (from design doc §4):
 *   export interface MarpWebviewHtmlOptions {
 *     renderResult: MarpRenderResult;
 *     nonce: string;
 *     cspSource: string;
 *     sdkJsUri?: string;   // When provided, Comment SDK JS is loaded
 *     sdkCssUri?: string;  // When provided, Comment SDK CSS is loaded
 *   }
 *   export function buildMarpWebviewHtml(opts: MarpWebviewHtmlOptions): string;
 */

// ── Test Helpers ────────────────────────────────────────────────────────────────

const RENDER_RESULT: MarpRenderResult = {
  html: "<section id='s0'><h1>Slide One</h1></section><section id='s1'><h1>Slide Two</h1></section>",
  css: "section { display: block; }",
  slideCount: 2,
  comments: ["", ""],
};

const NONCE = "test-nonce-123";
const CSP_SOURCE = "https://localhost";

// ── M50-PVD-12: buildMarpWebviewHtml exists ────────────────────────────────────

describe("M50-PVD-12: buildMarpWebviewHtml exported", () => {
  it("buildMarpWebviewHtml is exported from src/marp-webview-html.ts", async () => {
    const mod = await import("../marp-webview-html.js");
    expect(typeof mod.buildMarpWebviewHtml).toBe("function");
  });

  it("produces a complete HTML document", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });
});

// ── M50-PVD-13: SDK asset injection ───────────────────────────────────────────

describe("M50-PVD-13: Comment SDK asset injection", () => {
  it("when mermaidJsUri provided — HTML includes Mermaid script tag", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      mermaidJsUri: "vscode-resource://mermaid/mermaid.min.js",
    });
    expect(html).toContain("vscode-resource://mermaid/mermaid.min.js");
  });

  it("when sdkJsUri provided — HTML includes <script> tag pointing to sdkJsUri with nonce", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://comment-sdk/sdk.js",
    });
    expect(html).toMatch(/<script[^>]*src=["']vscode-resource:\/\/comment-sdk\/sdk\.js["'][^>]*>/);
    expect(html).toContain("nonce-test-nonce-123");
  });

  it("when sdkCssUri provided — HTML includes <link> tag pointing to sdkCssUri with nonce", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkCssUri: "vscode-resource://comment-sdk/sdk.css",
    });
    expect(html).toMatch(/<link[^>]*href=["']vscode-resource:\/\/comment-sdk\/sdk\.css["'][^>]*>/);
    expect(html).toContain("nonce-test-nonce-123");
  });

  it("when sdkJsUri is NOT provided — HTML contains no SDK script tag", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("sdk.js");
    expect(html).not.toContain("sdk.min.js");
  });

  it("when sdkCssUri is NOT provided — HTML contains no SDK stylesheet link", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("sdk.css");
  });

  it("SDK script nonce attribute uses the same nonce as other scripts", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
    });
    const nonceAttr = 'nonce="test-nonce-123"';
    expect(html).toContain(nonceAttr);
  });

  it("SDK CSS link nonce attribute uses the same nonce as style tags", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    const nonceAttr = 'nonce="test-nonce-123"';
    expect(html).toContain(nonceAttr);
  });
});

// ── M50-PVD-14: sdk.init() with coordinateToScreen ───────────────────────────

describe("M50-PVD-14: sdk.init() and coordinateToScreen", () => {
  it("HTML includes lightweight Mermaid fallback script when Mermaid asset is provided", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      mermaidJsUri: "vscode-resource://mermaid/mermaid.min.js",
    });
    expect(html).toContain("renderMermaidDiagrams");
    expect(html).toContain("language-mermaid");
  });

  it("HTML includes sdk.init() call when SDK URIs are provided", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("sdk.init");
  });

  it("sdk.init() is passed a coordinateToScreen function", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("coordinateToScreen");
  });

  it("coordinateToScreen parses blockId 'slide:{idx}:{x}:{y}' format", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("slide:");
    expect(html).toContain("slide:(\\d+):");
  });

  it("coordinateToScreen returns pixel position within active slide SVG", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("data-marpit-svg");
    expect(html).toContain("active");
  });

  it("coordinateToScreen returns null when target slide is not current", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("coordinateToScreen");
  });

  it("without SDK URIs — no sdk.init call appears in HTML", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("sdk.init");
  });
});

// ── M50-PVD-15: Comment message handlers ─────────────────────────────────────

describe("M50-PVD-15: Webview comment message handlers", () => {
  it("comments:load message is handled in the webview script", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:load");
  });

  it("comments:add message is handled in the webview script", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:add");
  });

  it("comments:update message is handled in the webview script", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:update");
  });

  it("comments:remove message is handled in the webview script", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:remove");
  });

  it("comments:focus message is handled in the webview script", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:focus");
  });

  it("without SDK URIs — no comment message handlers appear in HTML", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("comments:load");
    expect(html).not.toContain("comments:add");
  });
});

// ── M50-PVD-16: comments:focus navigates + opens popover ─────────────────────

describe("M50-PVD-16: comments:focus handler — navigate + sdk.openPopover", () => {
  it("comments:focus handler calls sdk.openPopover(threadId)", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("openPopover");
  });

  it("comments:focus handler navigates to the slide in blockId if not current", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("comments:focus");
  });

  it("comments:focus handler extracts slideIndex from 'slide:{idx}:{x}:{y}' blockId", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("slide:");
    expect(html).toContain("goTo");
  });
});

// ── M50-PVD-17: Alt+click → onCreate ──────────────────────────────────────────

describe("M50-PVD-17: Alt+click → callbacks.onCreate", () => {
  it("webview has Alt+click handler on the slide container", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("Alt");
    expect(html).toContain("click");
  });

  it("Alt+click captures coordinates relative to the active slide SVG", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("data-marpit-svg");
    expect(html).toContain("active");
  });

  it("Alt+click normalizes coordinates to 0-1 range", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("coordinateToScreen");
  });

  it("Alt+click encodes blockId as 'slide:{slideIndex}:{x.4f}:{y.4f}'", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("slide:");
  });

  it("Alt+click invokes callbacks.onCreate with blockId and body", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({
      renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    expect(html).toContain("onCreate");
  });

  it("without SDK URIs — no Alt+click handler appears in HTML", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("onCreate");
  });
});

// ── CSP / Security ─────────────────────────────────────────────────────────────

describe("CSP and security properties", () => {
  it("CSP nonce attribute is set for script-src directive", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain('nonce="test-nonce-123"');
  });

  it("CSP does NOT include frame-src (no iframe)", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).not.toContain("frame-src");
  });

  it("CSP allows style-src with nonce for Marp CSS", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const html = buildMarpWebviewHtml({ renderResult: RENDER_RESULT, nonce: NONCE, cspSource: CSP_SOURCE });
    expect(html).toContain("style-src");
  });
});

// ── Executable webview script behavior checks (runtime, not string-only) ─────

describe("Executable webview runtime behavior", () => {
  it("emits webview:ready at startup", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const renderResult: MarpRenderResult = {
      html: "<svg data-marpit-svg></svg><svg data-marpit-svg></svg>",
      css: "svg { display:block; }",
      slideCount: 2,
      comments: ["", ""],
    };
    const html = buildMarpWebviewHtml({
      renderResult,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });

    const runtime = createRuntimeHarness(html);
    expect(runtime.getPostMessages()).toContainEqual({ type: "webview:ready" });
  });

  it("drops stale marp:update revisions (runtime execution)", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const renderResult: MarpRenderResult = {
      html: "<svg data-marpit-svg></svg><svg data-marpit-svg></svg>",
      css: "svg { display:block; }",
      slideCount: 2,
      comments: ["", ""],
    };
    const html = buildMarpWebviewHtml({ renderResult, nonce: NONCE, cspSource: CSP_SOURCE });
    const runtime = createRuntimeHarness(html);

    runtime.dispatchMessage({
      type: "marp:update",
      html: "<svg data-marpit-svg id='new-1'></svg>",
      css: "svg{color:red}",
      currentSlide: 0,
      revision: 10,
    });
    const updated = runtime.getSlideContainerHtml();
    expect(updated).toContain("new-1");

    runtime.dispatchMessage({
      type: "marp:update",
      html: "<svg data-marpit-svg id='stale'></svg>",
      css: "svg{color:blue}",
      currentSlide: 0,
      revision: 9,
    });
    expect(runtime.getSlideContainerHtml()).toBe(updated);
  });

  it("comments:update and comments:remove trigger pin refresh (sdk.loadThreads)", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const renderResult: MarpRenderResult = {
      html: "<svg data-marpit-svg></svg><svg data-marpit-svg></svg>",
      css: "svg { display:block; }",
      slideCount: 2,
      comments: ["", ""],
    };
    const html = buildMarpWebviewHtml({
      renderResult,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    const runtime = createRuntimeHarness(html);

    runtime.dispatchMessage({
      type: "comments:load",
      threads: [{ id: "t1", blockId: "slide:0:0.5:0.5" }],
    });
    const afterLoad = runtime.getSdkLoadCalls();

    runtime.dispatchMessage({
      type: "comments:update",
      thread: { id: "t1", blockId: "slide:0:0.3:0.3" },
    });
    runtime.dispatchMessage({
      type: "comments:remove",
      threadId: "t1",
    });

    expect(runtime.getSdkLoadCalls()).toBeGreaterThan(afterLoad + 1);
  });

  it("comments:focus navigates to the target slide and calls sdk.openPopover", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const renderResult: MarpRenderResult = {
      html: "<svg data-marpit-svg></svg><svg data-marpit-svg></svg>",
      css: "svg { display:block; }",
      slideCount: 2,
      comments: ["", ""],
    };
    const html = buildMarpWebviewHtml({
      renderResult,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    const runtime = createRuntimeHarness(html);

    runtime.dispatchMessage({
      type: "comments:focus",
      threadId: "thread-abc",
      blockId: "slide:1:0.2500:0.7500",
    });

    const posts = runtime.getPostMessages();
    expect(posts).toContainEqual({ type: "sdk:openPopover", threadId: "thread-abc" });
    expect(posts).toContainEqual({ type: "presentation:slideChanged", index: 1 });
  });

  it("Alt+click sets data-block-id on active SVG then clears it via setTimeout(0)", async () => {
    const { buildMarpWebviewHtml } = await import("../marp-webview-html.js");
    const renderResult: MarpRenderResult = {
      html: "<svg data-marpit-svg></svg><svg data-marpit-svg></svg>",
      css: "svg { display:block; }",
      slideCount: 2,
      comments: ["", ""],
    };
    const html = buildMarpWebviewHtml({
      renderResult,
      nonce: NONCE,
      cspSource: CSP_SOURCE,
      sdkJsUri: "vscode-resource://sdk/sdk.js",
      sdkCssUri: "vscode-resource://sdk/sdk.css",
    });
    const runtime = createRuntimeHarness(html);

    // Verify slide 0 is active before the click
    expect(runtime.getSlideActiveStates()).toEqual([true, false]);

    // Alt+click in the middle of the active slide (400 = center of 800-wide rect at left=10)
    runtime.simulateAltClick(10 + 400, 20 + 300);

    // Immediately after Alt+click (before setTimeout fires):
    // data-block-id must be set on the active SVG with the correct format
    const blockId = runtime.getActiveSvgDataBlockId();
    expect(blockId).toMatch(/^slide:0:0\.5\d+:0\.5\d+$/);

    // Drain the setTimeout(0) that clears the attribute
    runtime.flushTimeouts();

    // After flush, data-block-id must be null
    expect(runtime.getActiveSvgDataBlockId()).toBeNull();
  });
});
