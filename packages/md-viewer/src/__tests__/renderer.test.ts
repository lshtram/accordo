/**
 * MarkdownRenderer — failing tests (Phase B)
 *
 * Requirements tested:
 *   M41b-RND-01  GFM tables, strikethrough, task lists
 *   M41b-RND-02  Code blocks: shiki syntax highlighting
 *   M41b-RND-03  Inline math $...$ → KaTeX HTML
 *   M41b-RND-04  Display math $$...$$ → KaTeX display block
 *   M41b-RND-05  Mermaid fenced blocks → <div class="mermaid">
 *   M41b-RND-06  Footnotes → links + section
 *   M41b-RND-07  Emoji :rocket: → 🚀
 *   M41b-RND-08  Front matter → stripped from visible output
 *   M41b-RND-09  Heading anchors → id attributes
 *   M41b-RND-10  Admonitions :::note → admonition div
 *   M41b-RND-11  data-block-id attributes on block elements
 *   M41b-RND-12  Relative images → resolved URI (with webview)
 *   M41b-RND-13  <script> in markdown → not in output HTML
 */

import { describe, it, expect, beforeAll } from "vitest";
import { MarkdownRenderer } from "../renderer.js";

// ── Shared renderer instance (expensive to create — build once) ───────────────

let renderer: MarkdownRenderer;

beforeAll(async () => {
  renderer = await MarkdownRenderer.create();
});

const BASE_OPTS = { docFsPath: "/project/README.md" } as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MarkdownRenderer", () => {
  // ── M41b-RND-01: GFM ──────────────────────────────────────────────────────

  it("M41b-RND-01: renders GFM table with <table> element", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("M41b-RND-01: renders ~~strikethrough~~ as <s> or <del>", async () => {
    const { html } = await renderer.render("~~delete me~~", BASE_OPTS);
    expect(html).toMatch(/<s>|<del>/);
  });

  it("M41b-RND-01: renders task list items with checkboxes", async () => {
    const md = "- [x] Done\n- [ ] Pending\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  // ── M41b-RND-02: Syntax highlighting ──────────────────────────────────────

  it("M41b-RND-02: fenced code block has shiki class and inline color styles", async () => {
    const md = "```typescript\nconst x: number = 1;\n```\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    // Shiki produces a <pre class="shiki ..."> wrapper
    expect(html).toMatch(/class="shiki/);
    // Shiki uses inline style color attributes for tokens
    expect(html).toMatch(/style="[^"]*color:/);
  });

  // ── M41b-RND-03 / M41b-RND-04: Math ──────────────────────────────────────

  it("M41b-RND-03: inline math $E=mc^2$ is rendered to KaTeX HTML", async () => {
    const { html } = await renderer.render("Einstein: $E=mc^2$", BASE_OPTS);
    // KaTeX output contains class="katex" elements
    expect(html).toContain("katex");
  });

  it("M41b-RND-04: display math $$\\sum$$ is rendered as a KaTeX display block", async () => {
    const { html } = await renderer.render("$$\n\\sum_{i=0}^{n} i\n$$", BASE_OPTS);
    expect(html).toContain("katex-display");
  });

  // ── M41b-RND-05: Mermaid ─────────────────────────────────────────────────

  it("M41b-RND-05: mermaid fenced block becomes <div class=\"mermaid\">", async () => {
    const md = "```mermaid\ngraph TD\n  A-->B\n```\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD");
  });

  // ── M41b-RND-06: Footnotes ────────────────────────────────────────────────

  it("M41b-RND-06: footnote reference [^1] creates a superscript link", async () => {
    const md = "See here[^1]\n\n[^1]: Footnote text\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).toContain("footnote");
    expect(html).toContain("Footnote text");
  });

  // ── M41b-RND-07: Emoji ───────────────────────────────────────────────────

  it("M41b-RND-07: :rocket: emoji shortcode is converted to the rocket emoji", async () => {
    const { html } = await renderer.render("Launch :rocket:", BASE_OPTS);
    expect(html).toContain("🚀");
  });

  // ── M41b-RND-08: Front matter ─────────────────────────────────────────────

  it("M41b-RND-08: YAML front matter block does not appear in HTML output", async () => {
    const md = "---\ntitle: My Doc\ndate: 2026-03-04\n---\n\n# Content\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).not.toContain("title: My Doc");
    expect(html).not.toContain("date: 2026-03-04");
    expect(html).toContain("<h1");
  });

  // ── M41b-RND-09: Heading anchors ─────────────────────────────────────────

  it("M41b-RND-09: headings get id attributes for anchor links", async () => {
    const { html } = await renderer.render("# Getting Started\n", BASE_OPTS);
    expect(html).toContain('id="getting-started"');
  });

  // ── M41b-RND-10: Admonitions ─────────────────────────────────────────────

  it("M41b-RND-10: :::note container renders as an admonition div", async () => {
    const md = "::: note\nThis is important\n:::\n";
    const { html } = await renderer.render(md, BASE_OPTS);
    expect(html).toMatch(/class="[^"]*admonition|note[^"]*"/);
    expect(html).toContain("This is important");
  });

  // ── M41b-RND-11: Block IDs ────────────────────────────────────────────────

  it("M41b-RND-11: heading block has data-block-id attribute", async () => {
    const { html } = await renderer.render("# Introduction\n", BASE_OPTS);
    expect(html).toContain("data-block-id=\"heading:1:introduction\"");
  });

  it("M41b-RND-11: paragraph block has data-block-id='p:0'", async () => {
    const { html } = await renderer.render("Hello world\n", BASE_OPTS);
    expect(html).toContain("data-block-id=\"p:0\"");
  });

  it("M41b-RND-11: resolver maps heading blockId to line 0", async () => {
    const { resolver } = await renderer.render("# Intro\n", BASE_OPTS);
    expect(resolver.blockIdToLine("heading:1:intro")).toBe(0);
  });

  // ── M41b-RND-12: Image resolution ────────────────────────────────────────

  it("M41b-RND-12: without webview, relative image src is unchanged or present", async () => {
    const { html } = await renderer.render("![alt](./image.png)", BASE_OPTS);
    expect(html).toContain("<img");
  });

  it("M41b-RND-12: with webview mock, relative image gets resolved URI", async () => {
    const mockWebview = {
      asWebviewUri: (uri: { fsPath: string; toString: () => string }) => ({
        fsPath: uri.fsPath,
        toString: () => `vscode-resource:${uri.fsPath}`,
      }),
    };
    const { html } = await renderer.render("![alt](./image.png)", {
      docFsPath: "/project/docs/README.md",
      webview: mockWebview,
    });
    expect(html).toContain("vscode-resource:");
  });

  // ── M41b-RND-13: Script sanitization ─────────────────────────────────────

  it("M41b-RND-13: <script> tags in markdown are not rendered to output", async () => {
    const { html } = await renderer.render("<script>alert('xss')</script>", BASE_OPTS);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert('xss')");
  });
});
