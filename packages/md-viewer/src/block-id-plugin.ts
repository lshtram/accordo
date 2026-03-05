/**
 * BlockIdPlugin — markdown-it plugin that adds `data-block-id` to every
 * block-level element in the rendered HTML.
 *
 * BlockIdResolver — bidirectional map between block IDs and source line numbers.
 *
 * Block ID format:
 *   headings   → "heading:{level}:{slug}"     e.g. "heading:2:getting-started"
 *   paragraphs → "p:{index}"                  e.g. "p:3"
 *   list items → "li:{listIdx}:{itemIdx}"     e.g. "li:2:1"
 *   code blocks → "pre:{index}"              e.g. "pre:0"
 *
 * Collision handling for headings: if two headings produce the same slug,
 * suffix :2, :3 etc. are appended: "heading:2:intro", "heading:2:intro:2"
 *
 * Source: M41b — BlockIdPlugin (comments-architecture.md §8.4 variant)
 *
 * Requirements:
 *   M41b-BID-01  data-block-id on headings, p, li, pre
 *   M41b-BID-02  heading IDs use content-based slug (stable)
 *   M41b-BID-03  buildMapping() populates blockId ↔ line number map
 *   M41b-BID-04  blockIdToLine() returns source line for a block ID
 *   M41b-BID-05  lineToBlockId() returns nearest block ID for a source line
 *   M41b-BID-06  Empty document → empty mapping, no errors
 *   M41b-BID-07  Duplicate heading slugs get :2, :3 suffix
 */

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

// ── BlockIdPlugin ─────────────────────────────────────────────────────────────

/**
 * A markdown-it plugin that injects `data-block-id` attributes.
 * Install via: md.use(blockIdPlugin)
 */
export function blockIdPlugin(md: MarkdownIt): void {
  // ── Core rule: assign block IDs to all relevant tokens ────────────────────
  md.core.ruler.push("block_id_assign", (state) => {
    const tokens: Token[] = state.tokens;
    let parIdx = 0;
    let preIdx = 0;
    let listIdx = -1;
    const itemIdxMap = new Map<number, number>();
    const listStack: number[] = [];
    const headingCounts = new Map<string, number>();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === "heading_open") {
        // Find the slug from the following inline token
        const inlineToken = tokens[i + 1];
        const headingText =
          inlineToken?.children
            ?.filter((t) => t.type === "text" || t.type === "softbreak")
            .map((t) => t.content)
            .join(" ") ?? "";
        const level = parseInt(token.tag.slice(1), 10);
        const baseSlug = slugify(headingText);
        const count = headingCounts.get(baseSlug) ?? 0;
        headingCounts.set(baseSlug, count + 1);
        const blockId =
          count === 0
            ? `heading:${level}:${baseSlug}`
            : `heading:${level}:${baseSlug}:${count + 1}`;
        token.attrSet("data-block-id", blockId);
      } else if (token.type === "paragraph_open" && token.level === 0) {
        // Only count top-level paragraphs (not those nested inside list items)
        token.attrSet("data-block-id", `p:${parIdx++}`);
      } else if (
        token.type === "bullet_list_open" ||
        token.type === "ordered_list_open"
      ) {
        listIdx++;
        itemIdxMap.set(listIdx, 0);
        listStack.push(listIdx);
      } else if (
        token.type === "bullet_list_close" ||
        token.type === "ordered_list_close"
      ) {
        listStack.pop();
      } else if (token.type === "list_item_open") {
        const curListIdx = listStack[listStack.length - 1] ?? 0;
        const curItemIdx = itemIdxMap.get(curListIdx) ?? 0;
        token.attrSet("data-block-id", `li:${curListIdx}:${curItemIdx}`);
        itemIdxMap.set(curListIdx, curItemIdx + 1);
      } else if (token.type === "fence") {
        // Store in meta — fence renderer override will inject into <pre>
        token.meta = { ...(token.meta ?? {}), blockId: `pre:${preIdx++}` };
      }
    }
  });

  // ── Fence renderer override: inject data-block-id from meta ───────────────
  const prevFenceRule = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const blockId: string | undefined = token.meta?.blockId;
    let html: string;
    if (prevFenceRule) {
      html = prevFenceRule(tokens, idx, options, env, self);
    } else {
      // Default fence rendering if no prior rule
      const code = md.utils.escapeHtml(token.content);
      const lang = token.info ? ` class="language-${md.utils.escapeHtml(token.info.trim())}"` : "";
      html = `<pre><code${lang}>${code}</code></pre>\n`;
    }
    if (blockId) {
      html = html.replace(/^<pre/, `<pre data-block-id="${blockId}"`);
    }
    return html;
  };
}

// ── BlockIdResolver ───────────────────────────────────────────────────────────

/** Maps blockId → 0-based source line number */
export type BlockIdMap = Map<string, number>;

/**
 * Provides the bidirectional blockId ↔ source line mapping.
 *
 * Built by calling buildMapping() after rendering with BlockIdPlugin.
 * The markdown-it token stream carries line information; we read it there
 * (not from the HTML output) to guarantee accuracy.
 */
export class BlockIdResolver {
  private _idToLine: BlockIdMap = new Map();
  private _lineToId: Map<number, string> = new Map();
  /** Sorted array of mapped line numbers — built lazily for closest-line lookup. */
  private _sortedLines: number[] = [];

  /**
   * M41b-BID-03
   * Build the mapping from the markdown-it token stream produced by md.parse().
   * Must be called after md.parse() but before (or during) md.render().
   * @param tokens  Result of md.parse(markdown, {})
   */
  buildMappingFromTokens(tokens: unknown[]): void {
    this._idToLine.clear();
    this._lineToId.clear();
    this._sortedLines = [];

    const typedTokens = tokens as Token[];
    let parIdx = 0;
    let preIdx = 0;
    let listIdx = -1;
    const itemIdxMap = new Map<number, number>();
    const listStack: number[] = [];
    const headingCounts = new Map<string, number>();

    for (let i = 0; i < typedTokens.length; i++) {
      const token = typedTokens[i];
      const line: number | undefined = token.map?.[0];

      if (token.type === "heading_open") {
        const inlineToken = typedTokens[i + 1];
        const headingText =
          inlineToken?.children
            ?.filter((t: Token) => t.type === "text" || t.type === "softbreak")
            .map((t: Token) => t.content)
            .join(" ") ?? "";
        const level = parseInt(token.tag.slice(1), 10);
        const baseSlug = slugify(headingText);
        const count = headingCounts.get(baseSlug) ?? 0;
        headingCounts.set(baseSlug, count + 1);
        const blockId =
          count === 0
            ? `heading:${level}:${baseSlug}`
            : `heading:${level}:${baseSlug}:${count + 1}`;
        if (line !== undefined) {
          this._idToLine.set(blockId, line);
          this._lineToId.set(line, blockId);
        }
      } else if (token.type === "paragraph_open" && token.level === 0) {
        const blockId = `p:${parIdx++}`;
        if (line !== undefined) {
          this._idToLine.set(blockId, line);
          this._lineToId.set(line, blockId);
        }
      } else if (
        token.type === "bullet_list_open" ||
        token.type === "ordered_list_open"
      ) {
        listIdx++;
        itemIdxMap.set(listIdx, 0);
        listStack.push(listIdx);
      } else if (
        token.type === "bullet_list_close" ||
        token.type === "ordered_list_close"
      ) {
        listStack.pop();
      } else if (token.type === "list_item_open") {
        const curListIdx = listStack[listStack.length - 1] ?? 0;
        const curItemIdx = itemIdxMap.get(curListIdx) ?? 0;
        const blockId = `li:${curListIdx}:${curItemIdx}`;
        itemIdxMap.set(curListIdx, curItemIdx + 1);
        if (line !== undefined) {
          this._idToLine.set(blockId, line);
          this._lineToId.set(line, blockId);
        }
      } else if (token.type === "fence") {
        const blockId = `pre:${preIdx++}`;
        if (line !== undefined) {
          this._idToLine.set(blockId, line);
          this._lineToId.set(line, blockId);
        }
      }
    }

    // Build sorted line array for closest-line lookup (M41b-BID-05)
    this._sortedLines = Array.from(this._lineToId.keys()).sort((a, b) => a - b);
  }

  /**
   * M41b-BID-04
   * Returns the 0-based source line number for a given blockId.
   * Returns null if the blockId is not in the current mapping.
   */
  blockIdToLine(blockId: string): number | null {
    return this._idToLine.get(blockId) ?? null;
  }

  /**
   * M41b-BID-05
   * Returns the blockId for the nearest block at or before the given 0-based
   * source line.  This ensures that a text comment placed on any line inside
   * a multi-line block still maps to the correct webview pin.
   * Returns null only when: (a) the mapping is empty, or (b) the given line
   * is before the first mapped block.
   */
  lineToBlockId(line: number): string | null {
    // Fast path: exact hit
    const exact = this._lineToId.get(line);
    if (exact !== undefined) return exact;

    // Binary search for the largest mapped line ≤ `line`
    const lines = this._sortedLines;
    if (lines.length === 0) return null;

    let lo = 0;
    let hi = lines.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lines[mid] <= line) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return null;
    return this._lineToId.get(lines[best]) ?? null;
  }

  /** Returns the full blockId→line map for inspection/testing. */
  getMap(): BlockIdMap {
    return this._idToLine;
  }

  /** Clears the mapping (used when the document content changes). */
  clear(): void {
    this._idToLine.clear();
    this._lineToId.clear();
    this._sortedLines = [];
  }
}

// ── Slug helper (exported for testing) ───────────────────────────────────────

/**
 * Convert heading text to a URL-safe slug.
 * - Lowercase
 * - Replace spaces with hyphens
 * - Strip non-alphanumeric/hyphen characters
 * - Collapse multiple hyphens
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
