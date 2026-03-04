/**
 * BlockIdPlugin + BlockIdResolver — failing tests (Phase B)
 *
 * Requirements tested:
 *   M41b-BID-01  data-block-id injected on headings, p, li, pre
 *   M41b-BID-02  Heading IDs use content-based slug (stable across line shifts)
 *   M41b-BID-03  buildMappingFromTokens() populates blockId ↔ line map
 *   M41b-BID-04  blockIdToLine() returns source line for known blockId
 *   M41b-BID-05  lineToBlockId() returns blockId for a source line
 *   M41b-BID-06  Empty document → no errors, empty mapping
 *   M41b-BID-07  Duplicate heading slugs get :2, :3 suffix
 *   M41b-BID-08  slugify() produces stable URL-safe slugs
 */

import { describe, it, expect, beforeEach } from "vitest";
import MarkdownIt from "markdown-it";
import {
  blockIdPlugin,
  BlockIdResolver,
  slugify,
} from "../block-id-plugin.js";

describe("slugify()", () => {
  it("M41b-BID-08: converts 'Getting Started' → 'getting-started'", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
  });

  it("M41b-BID-08: strips non-alphanumeric characters", () => {
    expect(slugify("Hello, World! (2026)")).toBe("hello-world-2026");
  });

  it("M41b-BID-08: collapses multiple hyphens", () => {
    expect(slugify("A  --  B")).toBe("a-b");
  });

  it("M41b-BID-08: handles empty string without error", () => {
    expect(slugify("")).toBe("");
  });

  it("M41b-BID-08: handles leading/trailing spaces", () => {
    expect(slugify("  intro  ")).toBe("intro");
  });
});

describe("blockIdPlugin (markdown-it plugin)", () => {
  let md: MarkdownIt;

  beforeEach(() => {
    md = new MarkdownIt({ html: false });
    md.use(blockIdPlugin);
  });

  it("M41b-BID-01: h1 gets data-block-id='heading:1:{slug}'", () => {
    const html = md.render("# Introduction\n");
    expect(html).toContain("data-block-id=\"heading:1:introduction\"");
  });

  it("M41b-BID-01: h2 gets data-block-id with correct level", () => {
    const html = md.render("## Getting Started\n");
    expect(html).toContain("data-block-id=\"heading:2:getting-started\"");
  });

  it("M41b-BID-01: paragraph gets data-block-id='p:{index}'", () => {
    const html = md.render("Hello world\n");
    expect(html).toContain("data-block-id=\"p:0\"");
  });

  it("M41b-BID-01: second paragraph gets data-block-id='p:1'", () => {
    const html = md.render("First paragraph\n\nSecond paragraph\n");
    expect(html).toContain("data-block-id=\"p:1\"");
  });

  it("M41b-BID-01: fenced code block gets data-block-id='pre:0'", () => {
    const html = md.render("```ts\nconst x = 1;\n```\n");
    expect(html).toContain("data-block-id=\"pre:0\"");
  });

  it("M41b-BID-01: list item gets data-block-id='li:{listIdx}:{itemIdx}'", () => {
    const html = md.render("- first item\n- second item\n");
    expect(html).toContain("data-block-id=\"li:0:0\"");
    expect(html).toContain("data-block-id=\"li:0:1\"");
  });

  it("M41b-BID-02: heading slug is content-based (stable)", () => {
    const html1 = md.render("# My Heading\n");
    const html2 = md.render("# My Heading\n");
    // Extract data-block-id from both
    const match1 = html1.match(/data-block-id="([^"]+)"/)?.[1];
    const match2 = html2.match(/data-block-id="([^"]+)"/)?.[1];
    expect(match1).toBe(match2);
  });

  it("M41b-BID-07: duplicate heading slugs get :2, :3 suffix", () => {
    const html = md.render("# Intro\n\n# Intro\n\n# Intro\n");
    expect(html).toContain("data-block-id=\"heading:1:intro\"");
    expect(html).toContain("data-block-id=\"heading:1:intro:2\"");
    expect(html).toContain("data-block-id=\"heading:1:intro:3\"");
  });
});

describe("BlockIdResolver", () => {
  let md: MarkdownIt;
  let resolver: BlockIdResolver;

  beforeEach(() => {
    md = new MarkdownIt({ html: false });
    md.use(blockIdPlugin);
    resolver = new BlockIdResolver();
  });

  it("M41b-BID-06: empty document → empty map, no errors", () => {
    const tokens = md.parse("", {});
    resolver.buildMappingFromTokens(tokens);
    expect(resolver.getMap().size).toBe(0);
  });

  it("M41b-BID-03: buildMappingFromTokens populates the map", () => {
    const tokens = md.parse("# Introduction\n\nSome text\n", {});
    resolver.buildMappingFromTokens(tokens);
    expect(resolver.getMap().size).toBeGreaterThan(0);
  });

  it("M41b-BID-04: blockIdToLine returns 0-based line for a heading", () => {
    const tokens = md.parse("# Introduction\n\nSome text\n", {});
    resolver.buildMappingFromTokens(tokens);
    const line = resolver.blockIdToLine("heading:1:introduction");
    expect(line).toBe(0);
  });

  it("M41b-BID-04: blockIdToLine returns null for unknown id", () => {
    const tokens = md.parse("# Introduction\n", {});
    resolver.buildMappingFromTokens(tokens);
    expect(resolver.blockIdToLine("p:999")).toBeNull();
  });

  it("M41b-BID-05: lineToBlockId returns blockId for a heading's line", () => {
    const tokens = md.parse("# Introduction\n\nSome text\n", {});
    resolver.buildMappingFromTokens(tokens);
    const blockId = resolver.lineToBlockId(0);
    expect(blockId).toBe("heading:1:introduction");
  });

  it("M41b-BID-05: lineToBlockId returns null for a line with no block", () => {
    const tokens = md.parse("# Introduction\n\nParagraph\n", {});
    resolver.buildMappingFromTokens(tokens);
    expect(resolver.lineToBlockId(999)).toBeNull();
  });

  it("M41b-BID-03: clear() empties the map", () => {
    const tokens = md.parse("# Intro\n", {});
    resolver.buildMappingFromTokens(tokens);
    expect(resolver.getMap().size).toBeGreaterThan(0);
    resolver.clear();
    expect(resolver.getMap().size).toBe(0);
  });
});
